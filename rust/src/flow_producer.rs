//! FlowProducer — atomically add trees of dependent jobs (flows).
//!
//! A flow is a tree-like structure where children jobs are processed before
//! their parent. When all children complete, the parent becomes processable.

use std::collections::HashMap;
use tracing::{debug, instrument};
use uuid::Uuid;

use crate::error::Error;
use crate::job::{Job, ScriptContext};
use crate::keys::{resolve_parent_queue_key, validate_queue_name, QueueKeys};
use crate::options::JobOptions;
use crate::queue::Queue;
use crate::redis_connection::RedisConnection;
use crate::types::ParentKeys;

/// Describes a job to add as part of a flow.
#[derive(Debug, Clone)]
pub struct FlowJob {
    /// Job name.
    pub name: String,
    /// Queue this job belongs to.
    pub queue_name: String,
    /// Job data payload.
    pub data: serde_json::Value,
    /// Job options.
    pub opts: Option<JobOptions>,
    /// Optional prefix override (defaults to FlowProducer's prefix).
    pub prefix: Option<String>,
    /// Child jobs that must complete before this job is processed.
    pub children: Option<Vec<FlowJob>>,
}

/// Options for retrieving a flow tree.
#[derive(Debug, Clone)]
pub struct GetFlowOpts {
    /// Root job queue name.
    pub queue_name: String,
    /// Root job ID.
    pub id: String,
    /// Key prefix (uses FlowProducer's prefix if not provided).
    pub prefix: Option<String>,
    /// Maximum tree depth to traverse (default: 10).
    pub depth: Option<usize>,
    /// Maximum number of children to retrieve per node (default: 20).
    pub max_children: Option<usize>,
}

/// A node in the returned flow tree, containing the job and its children.
#[derive(Debug)]
pub struct JobNode {
    /// The job at this node.
    pub job: Job,
    /// Children nodes (if any).
    pub children: Option<Vec<JobNode>>,
}

/// Per-queue options used when adding a flow.
#[derive(Debug, Clone, Default)]
pub struct FlowQueueOptions {
    /// Default job options applied to every job added to this queue as part of
    /// the flow. Job-level options always take precedence.
    pub default_job_options: Option<JobOptions>,
}

/// Extra options for [`FlowProducer::add_with_opts`] / `add_bulk_with_opts`.
#[derive(Debug, Clone, Default)]
pub struct FlowOpts {
    /// Per-queue options keyed by queue name.
    pub queues_options: HashMap<String, FlowQueueOptions>,
}

/// Options for the FlowProducer.
#[derive(Debug, Clone, Default)]
pub struct FlowProducerOptions {
    /// Redis connection configuration.
    pub connection: crate::options::RedisConnectionOptions,
    /// Key prefix (default: "bull").
    pub prefix: Option<String>,
}

/// Atomically adds trees of dependent jobs (flows) to queues.
///
/// A flow is a tree structure where children must complete before their parent
/// can be processed. The parent can then access children's results.
#[derive(Clone)]
pub struct FlowProducer {
    conn: RedisConnection,
    prefix: String,
}

impl FlowProducer {
    /// Create a new FlowProducer.
pub async fn new(opts: FlowProducerOptions) -> Result<Self, Error> {
        let conn = RedisConnection::new(&opts.connection).await?;
        let prefix = opts.prefix.unwrap_or_else(|| "bull".to_string());
        if prefix.is_empty() || prefix.contains(':') {
            return Err(Error::InvalidConfig(
                "Prefix must be non-empty and cannot contain :".to_string(),
            ));
        }
        Ok(Self { conn, prefix })
    }

    /// Create a FlowProducer with an existing Redis connection.
    pub fn with_connection(conn: RedisConnection, prefix: Option<String>) -> Self {
        Self {
            conn,
            prefix: prefix.unwrap_or_else(|| "bull".to_string()),
        }
    }

    /// The prefix used for keys.
    pub fn prefix(&self) -> &str {
        &self.prefix
    }

    /// The underlying Redis connection.
    pub fn connection(&self) -> &RedisConnection {
        &self.conn
    }

    /// Atomically add a flow (tree of jobs with parent-child dependencies).
    ///
    /// Children are added to their respective queues and the parent is placed
    /// in `waiting-children` state. When all children complete, the parent
    /// moves to `wait` and becomes processable.
    ///
    /// The returned [`JobNode`] keeps the same tree shape as requested. The
    /// root node ID is updated from Redis when available. Child nodes preserve
    /// their in-memory IDs if Redis does not return a child ID (for example,
    /// when an internal parent is deduplicated and descendants are skipped).
    /// If the root job fails to be added (e.g. a referenced external parent key
    /// is missing), this returns an error.
    #[instrument(skip(self, flow), fields(root_name = %flow.name, root_queue = %flow.queue_name))]
    pub async fn add(&self, flow: FlowJob) -> Result<JobNode, Error> {
        self.add_with_opts(flow, &FlowOpts::default()).await
    }

    /// Atomically add a flow, applying per-queue default job options.
    ///
    /// For every job whose `queue_name` is present in `opts.queues_options`,
    /// the corresponding `default_job_options` are merged in. Options set
    /// explicitly on a job always take precedence over the defaults.
    ///
    /// The returned tree keeps the requested topology and updates the root job
    /// ID from Redis when available. Child nodes may keep their in-memory IDs
    /// in deduplication scenarios where Redis skips descendant creation.
    /// Negative root status codes (e.g. `-5` for a missing parent key) are
    /// returned as errors.
    pub async fn add_with_opts(
        &self,
        mut flow: FlowJob,
        opts: &FlowOpts,
    ) -> Result<JobNode, Error> {
        apply_queue_defaults(&mut flow, opts);
        validate_flow_queue_names(&flow)?;

        let mut conn = self.conn.conn();

        let mut pipe = redis::pipe();
        pipe.atomic();

        // If the root flow has opts.parent, construct a ParentContext
        let root_prefix = flow.prefix.as_deref().unwrap_or(&self.prefix);
        let parent_ctx = match flow.opts.as_ref().and_then(|o| o.parent.as_ref()) {
            Some(p) => {
                let parent_queue_key = resolve_parent_queue_key(root_prefix, &p.queue)?;
                let parent_deps_key = format!("{}:{}:dependencies", parent_queue_key, p.id);
                Some(ParentContext {
                    parent_id: p.id.clone(),
                    parent_queue_key,
                    parent_deps_key,
                })
            }
            None => None,
        };

        let mut job_node = self.add_node(&mut pipe, &flow, parent_ctx.as_ref())?;

        // Execute the atomic pipeline
        let results: Vec<redis::Value> = pipe.query_async(&mut conn).await?;

        // Validate the root result and apply root ID updates. Child results are
        // still consumed for validation, but child IDs intentionally keep the
        // in-memory values to mirror Node.js FlowProducer semantics.
        let mut results_iter = results.iter();
        Self::apply_pipeline_results(&mut job_node, &mut results_iter, true)?;
        debug!(job_id = %job_node.job.id(), "flow added");

        Ok(job_node)
    }

    /// Atomically add multiple flows.
    ///
    /// Each returned [`JobNode`] keeps the requested topology and updates root
    /// IDs from Redis when available. Child IDs keep in-memory values in
    /// deduplication scenarios where Redis skips descendant creation.
    /// The bulk add is validated as a whole: if any root job in any flow fails
    /// to be added (e.g. a missing parent key yields a negative status code),
    /// this returns an error instead of a partially populated result.
    #[instrument(skip(self, flows), fields(count = flows.len()))]
    pub async fn add_bulk(&self, flows: Vec<FlowJob>) -> Result<Vec<JobNode>, Error> {
        if flows.is_empty() {
            return Ok(Vec::new());
        }

        for flow in &flows {
            validate_flow_queue_names(flow)?;
        }

        let mut conn = self.conn.conn();

        let mut pipe = redis::pipe();
        pipe.atomic();

        let mut job_nodes = Vec::with_capacity(flows.len());

        for flow in &flows {
            let root_prefix = flow.prefix.as_deref().unwrap_or(&self.prefix);
            let parent_ctx = match flow.opts.as_ref().and_then(|o| o.parent.as_ref()) {
                Some(p) => {
                    let parent_queue_key = resolve_parent_queue_key(root_prefix, &p.queue)?;
                    let parent_deps_key = format!("{}:{}:dependencies", parent_queue_key, p.id);
                    Some(ParentContext {
                        parent_id: p.id.clone(),
                        parent_queue_key,
                        parent_deps_key,
                    })
                }
                None => None,
            };
            let node = self.add_node(&mut pipe, flow, parent_ctx.as_ref())?;
            job_nodes.push(node);
        }

        let results: Vec<redis::Value> = pipe.query_async(&mut conn).await?;

        // Validate each tree's root result and apply root ID updates across all
        // trees. Commands were queued tree-by-tree, each in pre-order, so a
        // single sequential walk lines up with the flattened results while
        // keeping child ID behavior aligned with Node.js semantics.
        let mut results_iter = results.iter();
        for node in &mut job_nodes {
            Self::apply_pipeline_results(node, &mut results_iter, true)?;
        }

        Ok(job_nodes)
    }

    /// Atomically add multiple flows, applying per-queue default job options.
    ///
    /// This mirrors [`FlowProducer::add_with_opts`], but for bulk adds.
    pub async fn add_bulk_with_opts(
        &self,
        mut flows: Vec<FlowJob>,
        opts: &FlowOpts,
    ) -> Result<Vec<JobNode>, Error> {
        for flow in &mut flows {
            apply_queue_defaults(flow, opts);
        }
        self.add_bulk(flows).await
    }

    /// Retrieve an existing flow tree from Redis.
    ///
    /// Reconstructs the parent-child tree by loading jobs and their dependencies.
pub async fn get_flow(&self, opts: GetFlowOpts) -> Result<JobNode, Error> {
        validate_queue_name(&opts.queue_name)?;
        let prefix = opts.prefix.as_deref().unwrap_or(&self.prefix);
        if prefix.is_empty() || prefix.contains(':') {
            return Err(Error::InvalidConfig(
                "Prefix must be non-empty and cannot contain :".to_string(),
            ));
        }
        let depth = opts.depth.unwrap_or(10);
        let max_children = opts.max_children.unwrap_or(20);

        self.get_node(prefix, &opts.queue_name, &opts.id, depth, max_children)
            .await
    }

    /// Recursively load a node from Redis.
    fn get_node<'a>(
        &'a self,
        prefix: &'a str,
        queue_name: &'a str,
        job_id: &'a str,
        depth: usize,
        max_children: usize,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<JobNode, Error>> + Send + 'a>>
    {
        Box::pin(async move {
            let keys = QueueKeys::new(queue_name, Some(prefix));
            let job_key = keys.job_key(job_id);

            // Load job data from Redis
            let mut conn = self.conn.conn();
            let hash: HashMap<String, String> = redis::cmd("HGETALL")
                .arg(&job_key)
                .query_async(&mut conn)
                .await
                .map_err(Error::Redis)?;

            if hash.is_empty() {
                return Err(Error::JobNotFound(job_id.to_string()));
            }

            let mut job = Job::from_redis_hash(job_id, &hash)?;
            job.set_queue_name(queue_name.to_string());
            job.set_context(self.make_script_context(prefix, queue_name));

            if depth == 0 {
                return Ok(JobNode {
                    job,
                    children: None,
                });
            }

            // Collect child keys from dependencies (unprocessed SET) and the
            // processed/failed HASHes. Use the paginate script (SSCAN/HSCAN with
            // COUNT) instead of SMEMBERS/HKEYS so we never load the entire
            // collections into memory for large flows; each category is bounded
            // to `max_children`.
            let deps_key = format!("{}:dependencies", job_key);
            let processed_key = format!("{}:processed", job_key);
            let failed_key = format!("{}:failed", job_key);

            let unprocessed = self.paginate_child_keys(&deps_key, max_children).await?;
            let processed = self
                .paginate_child_keys(&processed_key, max_children)
                .await?;
            let failed = self.paginate_child_keys(&failed_key, max_children).await?;

            let all_children: Vec<&str> = unprocessed
                .iter()
                .chain(processed.iter())
                .chain(failed.iter())
                .map(|s| s.as_str())
                .take(max_children)
                .collect();

            if all_children.is_empty() {
                return Ok(JobNode {
                    job,
                    children: None,
                });
            }

            let mut child_nodes = Vec::with_capacity(all_children.len());
            for child_key in all_children {
                if let Some((child_prefix, child_queue, child_id)) =
                    Self::parse_child_key(child_key)
                {
                    match self
                        .get_node(child_prefix, child_queue, child_id, depth - 1, max_children)
                        .await
                    {
                        Ok(node) => child_nodes.push(node),
                        Err(Error::JobNotFound(_)) => {}
                        Err(err) => return Err(err),
                    }
                }
            }

            Ok(JobNode {
                job,
                children: if child_nodes.is_empty() {
                    None
                } else {
                    Some(child_nodes)
                },
            })
        })
    }

    /// Collect up to `limit` member keys from a set or hash without loading the
    /// entire collection into memory.
    ///
    /// Uses the `paginate` Lua script, which scans the collection with
    /// `SSCAN`/`HSCAN` (`COUNT`) and stops early once the requested page is
    /// filled, keeping `get_flow` bounded for very large dependency sets/hashes.
    async fn paginate_child_keys(&self, key: &str, limit: usize) -> Result<Vec<String>, Error> {
        if limit == 0 {
            return Ok(Vec::new());
        }

        let script = self
            .conn
            .scripts()
            .get("paginate")
            .ok_or_else(|| Error::InvalidConfig("paginate script not found".to_string()))?
            .clone();

        let mut conn = self.conn.conn();
        let mut cursor = "0".to_string();
        let mut offset: i64 = 0;
        let mut collected: Vec<String> = Vec::with_capacity(limit);
        let end = (limit - 1).to_string();
        // Bound the work per round-trip; the loop continues while the cursor is
        // non-zero and the page is not yet full.
        let max_iterations = "5".to_string();

        loop {
            let start = collected.len().to_string();
            let args = [
                start,
                end.clone(),
                cursor.clone(),
                offset.to_string(),
                max_iterations.clone(),
            ];
            let result = script.execute(&mut conn, &[key], &args).await?;

            let (next_cursor, next_offset, items) = Self::parse_paginate_result(&result)?;
            cursor = next_cursor;
            offset = next_offset;
            collected.extend(items);

            if cursor == "0" || collected.len() >= limit {
                break;
            }
        }

        collected.truncate(limit);
        Ok(collected)
    }

    /// Parse the `paginate` reply `[cursor, offset, items, numItems, jobs]` into
    /// `(cursor, offset, item_keys)`. For hashes each item is a `[field, value]`
    /// pair; only the field (child key) is kept.
    fn parse_paginate_result(value: &redis::Value) -> Result<(String, i64, Vec<String>), Error> {
        let arr = match value {
            redis::Value::Array(a) => a,
            _ => {
                return Err(Error::MsgPack(
                    "unexpected paginate reply: not an array".to_string(),
                ))
            }
        };

        let cursor = arr
            .first()
            .and_then(Self::value_to_string)
            .unwrap_or_else(|| "0".to_string());
        let offset = arr.get(1).and_then(Self::value_as_i64).unwrap_or(0);

        let mut keys = Vec::new();
        if let Some(redis::Value::Array(items)) = arr.get(2) {
            for item in items {
                if let Some(k) = Self::paginate_item_key(item) {
                    keys.push(k);
                }
            }
        }

        Ok((cursor, offset, keys))
    }

    /// Extract the key from a paginate item: a bare member (set) or the field of
    /// a `[field, value]` pair (hash).
    fn paginate_item_key(item: &redis::Value) -> Option<String> {
        match item {
            redis::Value::Array(pair) => pair.first().and_then(Self::value_to_string),
            other => Self::value_to_string(other),
        }
    }

    fn value_to_string(value: &redis::Value) -> Option<String> {
        match value {
            redis::Value::BulkString(b) => Some(String::from_utf8_lossy(b).to_string()),
            redis::Value::SimpleString(s) => Some(s.clone()),
            redis::Value::Int(n) => Some(n.to_string()),
            _ => None,
        }
    }

    fn value_as_i64(value: &redis::Value) -> Option<i64> {
        match value {
            redis::Value::Int(n) => Some(*n),
            redis::Value::BulkString(b) => String::from_utf8_lossy(b).parse().ok(),
            redis::Value::SimpleString(s) => s.parse().ok(),
            _ => None,
        }
    }

    /// Recursively add a node (job) to the pipeline.
    ///
    /// If the node has children, it's added as a parent job (waiting-children state).
    /// If it has no children, it's added as a standard/delayed/prioritized job.
    fn add_node(
        &self,
        pipe: &mut redis::Pipeline,
        node: &FlowJob,
        parent: Option<&ParentContext>,
    ) -> Result<JobNode, Error> {
        let prefix = node.prefix.as_deref().unwrap_or(&self.prefix);
        let keys = QueueKeys::new(&node.queue_name, Some(prefix));
        let job_id = node
            .opts
            .as_ref()
            .and_then(|o| o.job_id.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        let opts = node.opts.clone().unwrap_or_default();

        // Create the Job struct
        let mut job = Job::new(&node.name, node.data.clone(), Some(opts.clone()));
        job.set_id(job_id.clone());
        job.set_context(self.make_script_context(prefix, &node.queue_name));
        // Set parent info on the job
        if let Some(parent_ctx) = parent {
            job.set_parent(ParentKeys {
                id: parent_ctx.parent_id.clone(),
                queue_key: parent_ctx.parent_queue_key.clone(),
            });
            job.set_parent_key(format!(
                "{}:{}",
                parent_ctx.parent_queue_key, parent_ctx.parent_id
            ));
        }

        if let Some(children) = &node.children {
            if !children.is_empty() {
                // This is a parent node — add via addParentJob script
                self.add_parent_job_to_pipe(pipe, &keys, &job, &job_id, parent)?;

                // Build parent context for children
                let parent_queue_key = format!("{}:{}", prefix, node.queue_name);
                let parent_deps_key = format!("{}:{}:dependencies", parent_queue_key, job_id);
                let child_parent_ctx = ParentContext {
                    parent_id: job_id.clone(),
                    parent_queue_key,
                    parent_deps_key,
                };

                // Recursively add children
                let mut child_nodes = Vec::with_capacity(children.len());
                for child in children {
                    let child_node = self.add_node(pipe, child, Some(&child_parent_ctx))?;
                    child_nodes.push(child_node);
                }

                return Ok(JobNode {
                    job,
                    children: Some(child_nodes),
                });
            }
        }

        // Leaf node — add as standard/delayed/prioritized job
        self.add_leaf_job_to_pipe(pipe, &keys, &job, &job_id, parent)?;

        Ok(JobNode {
            job,
            children: None,
        })
    }

    /// Add a parent job to the pipeline using the addParentJob Lua script.
    fn add_parent_job_to_pipe(
        &self,
        pipe: &mut redis::Pipeline,
        keys: &QueueKeys,
        job: &Job,
        job_id: &str,
        parent: Option<&ParentContext>,
    ) -> Result<(), Error> {
        let script = self
            .conn
            .scripts()
            .get("addParentJob")
            .ok_or_else(|| Error::InvalidConfig("addParentJob script not found".to_string()))?
            .clone();

        // KEYS[1..6]: meta, id, delayed, waiting-children, completed, events
        let script_keys = [
            keys.meta(),
            keys.id(),
            keys.delayed(),
            keys.waiting_children(),
            keys.completed(),
            keys.events(),
        ];

        // ARGV[1]: msgpack args, ARGV[2]: json data, ARGV[3]: msgpack opts
        let argv1 = self.pack_add_args(keys, job, job_id, parent);
        let argv2 = serde_json::to_string(job.data()).unwrap_or_else(|_| "{}".to_string());
        let argv3 = self.pack_job_opts(job);

        // Add EVALSHA to pipeline
        pipe.cmd("EVALSHA")
            .arg(script.sha.as_str())
            .arg(script_keys.len())
            .arg(script_keys[0].as_str())
            .arg(script_keys[1].as_str())
            .arg(script_keys[2].as_str())
            .arg(script_keys[3].as_str())
            .arg(script_keys[4].as_str())
            .arg(script_keys[5].as_str())
            .arg(argv1.as_slice())
            .arg(argv2.as_bytes())
            .arg(argv3.as_slice());

        Ok(())
    }

    /// Add a leaf job (no children) to the pipeline.
    fn add_leaf_job_to_pipe(
        &self,
        pipe: &mut redis::Pipeline,
        keys: &QueueKeys,
        job: &Job,
        job_id: &str,
        parent: Option<&ParentContext>,
    ) -> Result<(), Error> {
        let delay = job.delay();
        let priority = job.priority();

        let script_name = if delay > 0 {
            "addDelayedJob"
        } else if priority > 0 {
            "addPrioritizedJob"
        } else {
            "addStandardJob"
        };

        let script = self
            .conn
            .scripts()
            .get(script_name)
            .ok_or_else(|| Error::InvalidConfig(format!("script '{}' not found", script_name)))?
            .clone();

        let script_keys = self.leaf_job_keys(keys, script_name);

        let argv1 = self.pack_add_args(keys, job, job_id, parent);
        let argv2 = serde_json::to_string(job.data()).unwrap_or_else(|_| "{}".to_string());
        let argv3 = self.pack_job_opts(job);

        let mut cmd = redis::cmd("EVALSHA");
        cmd.arg(script.sha.as_str()).arg(script_keys.len());
        for key in &script_keys {
            cmd.arg(key.as_str());
        }
        cmd.arg(argv1.as_slice())
            .arg(argv2.as_bytes())
            .arg(argv3.as_slice());

        pipe.add_command(cmd);

        Ok(())
    }

    /// Build KEYS array for leaf job scripts.
    fn leaf_job_keys(&self, keys: &QueueKeys, script_name: &str) -> Vec<String> {
        match script_name {
            "addStandardJob" => vec![
                keys.wait(),
                keys.paused(),
                keys.meta(),
                keys.id(),
                keys.completed(),
                keys.delayed(),
                keys.active(),
                keys.events(),
                keys.marker(),
            ],
            "addDelayedJob" => vec![
                keys.marker(),
                keys.meta(),
                keys.id(),
                keys.delayed(),
                keys.completed(),
                keys.events(),
            ],
            "addPrioritizedJob" => vec![
                keys.marker(),
                keys.meta(),
                keys.id(),
                keys.get("prioritized"),
                keys.delayed(),
                keys.completed(),
                keys.active(),
                keys.events(),
                keys.pc(),
            ],
            _ => vec![],
        }
    }

    /// Pack ARGV[1]: msgpack array matching the Lua script contract.
    ///
    /// Positions: [key_prefix, job_id, name, timestamp, parentKey, parentDepsKey, parent, repeatJobKey, deduplicationKey]
    fn pack_add_args(
        &self,
        keys: &QueueKeys,
        job: &Job,
        job_id: &str,
        parent: Option<&ParentContext>,
    ) -> Vec<u8> {
        use rmp::encode::*;

        let mut buf = Vec::with_capacity(128);
        write_array_len(&mut buf, 9).unwrap();

        // [1] key prefix (with trailing colon)
        write_str(&mut buf, &keys.key_prefix()).unwrap();
        // [2] job id
        write_str(&mut buf, job_id).unwrap();
        // [3] name
        write_str(&mut buf, job.name()).unwrap();
        // [4] timestamp
        write_uint(&mut buf, job.timestamp()).unwrap();
        // [5] parentKey
        if let Some(ctx) = parent {
            let parent_key = format!("{}:{}", ctx.parent_queue_key, ctx.parent_id);
            write_str(&mut buf, &parent_key).unwrap();
        } else {
            write_nil(&mut buf).unwrap();
        }
        // [6] parent dependencies key
        if let Some(ctx) = parent {
            write_str(&mut buf, &ctx.parent_deps_key).unwrap();
        } else {
            write_nil(&mut buf).unwrap();
        }
        // [7] parent object {id, queueKey, fpof?, rdof?, idof?, cpof?}
        if let Some(ctx) = parent {
            // Count the map entries: always id + queueKey, plus optional flags
            let opts = job.opts();
            let mut map_len = 2u32;
            if opts.fail_parent_on_failure == Some(true) {
                map_len += 1;
            }
            if opts.remove_dependency_on_failure == Some(true) {
                map_len += 1;
            }
            if opts.ignore_dependency_on_failure == Some(true) {
                map_len += 1;
            }
            if opts.continue_parent_on_failure == Some(true) {
                map_len += 1;
            }

            write_map_len(&mut buf, map_len).unwrap();
            write_str(&mut buf, "id").unwrap();
            write_str(&mut buf, &ctx.parent_id).unwrap();
            write_str(&mut buf, "queueKey").unwrap();
            write_str(&mut buf, &ctx.parent_queue_key).unwrap();

            if opts.fail_parent_on_failure == Some(true) {
                write_str(&mut buf, "fpof").unwrap();
                write_bool(&mut buf, true).unwrap();
            }
            if opts.remove_dependency_on_failure == Some(true) {
                write_str(&mut buf, "rdof").unwrap();
                write_bool(&mut buf, true).unwrap();
            }
            if opts.ignore_dependency_on_failure == Some(true) {
                write_str(&mut buf, "idof").unwrap();
                write_bool(&mut buf, true).unwrap();
            }
            if opts.continue_parent_on_failure == Some(true) {
                write_str(&mut buf, "cpof").unwrap();
                write_bool(&mut buf, true).unwrap();
            }
        } else {
            write_nil(&mut buf).unwrap();
        }
        // [8] repeat job key - nil for flows
        write_nil(&mut buf).unwrap();
        // [9] deduplication key
        if let Some(ref dedup) = job.opts().deduplication {
            let key = format!("{}de:{}", keys.key_prefix(), dedup.id);
            write_str(&mut buf, &key).unwrap();
        } else {
            write_nil(&mut buf).unwrap();
        }

        buf
    }

    /// Pack ARGV[3]: msgpack map of job options.
    fn pack_job_opts(&self, job: &Job) -> Vec<u8> {
        use rmp::encode::*;

        let opts = job.opts();

        let mut entries: Vec<(&str, Vec<u8>)> = Vec::new();

        if let Some(delay) = opts.delay {
            if delay > 0 {
                let mut b = Vec::new();
                write_uint(&mut b, delay).unwrap();
                entries.push(("delay", b));
            }
        }
        if let Some(priority) = opts.priority {
            if priority > 0 {
                let mut b = Vec::new();
                write_uint(&mut b, priority as u64).unwrap();
                entries.push(("priority", b));
            }
        }
        if let Some(attempts) = opts.attempts {
            let mut b = Vec::new();
            write_uint(&mut b, attempts as u64).unwrap();
            entries.push(("attempts", b));
        }
        if let Some(true) = opts.lifo {
            let mut b = Vec::new();
            write_bool(&mut b, true).unwrap();
            entries.push(("lifo", b));
        }

        if let Some(ref roc) = opts.remove_on_complete {
            let b = Queue::encode_remove_on_finish(roc);
            entries.push(("removeOnComplete", b));
        }

        if let Some(ref rof) = opts.remove_on_fail {
            let b = Queue::encode_remove_on_finish(rof);
            entries.push(("removeOnFail", b));
        }

        if let Some(ref backoff) = opts.backoff {
            let b = Queue::encode_backoff(backoff);
            entries.push(("backoff", b));
        }

        if let Some(ref dedup) = opts.deduplication {
            let b = Queue::encode_deduplication(dedup);
            entries.push(("de", b));
        }

        // Encode as msgpack map
        let mut buf = Vec::with_capacity(64);
        write_map_len(&mut buf, entries.len() as u32).unwrap();
        for (key, val) in &entries {
            write_str(&mut buf, key).unwrap();
            buf.extend_from_slice(val);
        }

        buf
    }

    /// Extract a job ID from a Redis value.
    fn extract_job_id(value: &redis::Value) -> Option<String> {
        match value {
            redis::Value::BulkString(bytes) => Some(String::from_utf8_lossy(bytes).to_string()),
            redis::Value::SimpleString(s) => Some(s.clone()),
            redis::Value::Int(n) if *n >= 0 => Some(n.to_string()),
            _ => None,
        }
    }

    /// Walk the freshly added job tree in the same pre-order the pipeline
    /// commands were queued (each node's command precedes its children's),
    /// validating the root's script result while keeping child ID behavior
    /// aligned with Node.js FlowProducer.
    ///
    /// Only the root of a tree (`is_root`) is validated strictly: a negative
    /// code there is a genuine failure (e.g. a missing external parent key).
    /// For non-root nodes, a `-5` ("missing parent key") is benign — it occurs
    /// when an internal parent was deduplicated and its new key was never
    /// created, so those children are intentionally not added. Any other
    /// negative code on a child still surfaces as an error. Child nodes keep
    /// their in-memory IDs; their IDs are not rewritten from child results.
    fn apply_pipeline_results(
        node: &mut JobNode,
        results: &mut std::slice::Iter<'_, redis::Value>,
        is_root: bool,
    ) -> Result<(), Error> {
        if let Some(result) = results.next() {
            if is_root {
                Self::check_add_result(result, node.job.parent_key().map(|s| s.as_str()))?;
            } else if let redis::Value::Int(code) = result {
                if *code < 0 && *code != crate::error::error_code::PARENT_JOB_NOT_EXIST {
                    return Err(Error::from_script_code(*code));
                }
            }
            if is_root {
                if let Some(id) = Self::extract_job_id(result) {
                    node.job.set_id(id);
                }
            }
        }
        if let Some(children) = node.children.as_mut() {
            for child in children {
                Self::apply_pipeline_results(child, results, false)?;
            }
        }
        Ok(())
    }

    /// Check the result of an add command for error codes.
    ///
    /// The addJob Lua script returns `-5` when a referenced parent key is
    /// missing. In that case the job is NOT added, so we surface an error
    /// instead of silently dropping the job.
    fn check_add_result(value: &redis::Value, parent_key: Option<&str>) -> Result<(), Error> {
        if let redis::Value::Int(code) = value {
            if *code < 0 {
                if *code == -5 {
                    return Err(Error::Script {
                        code: *code,
                        message: format!(
                            "Missing key for parent job {}. addJob",
                            parent_key.unwrap_or_default()
                        ),
                    });
                }
                return Err(Error::from_script_code(*code));
            }
        }
        Ok(())
    }

    /// Parse a child job key as `prefix:queueName:jobId`.
    fn parse_child_key(child_key: &str) -> Option<(&str, &str, &str)> {
        let (prefix, queue_and_job_id) = child_key.split_once(':')?;
        let (queue_name, job_id) = queue_and_job_id.split_once(':')?;
        if prefix.is_empty() || queue_name.is_empty() || job_id.is_empty() {
            return None;
        }
        Some((prefix, queue_name, job_id))
    }

    /// Create a ScriptContext for jobs reconstructed by get_flow.
    fn make_script_context(&self, prefix: &str, queue_name: &str) -> ScriptContext {
        let (progress_tx, _) = tokio::sync::broadcast::channel(1);
        ScriptContext {
            conn: self.conn.clone(),
            keys: QueueKeys::new(queue_name, Some(prefix)),
            progress_tx,
            token: String::new(),
            lock_duration: 0,
        }
    }

    /// Close the flow producer connection.
    pub async fn close(&self) {
        // MultiplexedConnection doesn't require explicit close
    }
}

/// Internal context passed to children describing their parent.
#[derive(Debug, Clone)]
struct ParentContext {
    parent_id: String,
    parent_queue_key: String,
    parent_deps_key: String,
}

/// Recursively merge per-queue `default_job_options` into every node of a flow.
///
/// Job-level options always win; defaults only fill in fields left unset.
fn apply_queue_defaults(flow: &mut FlowJob, opts: &FlowOpts) {
    if let Some(queue_opts) = opts.queues_options.get(&flow.queue_name) {
        if let Some(ref defaults) = queue_opts.default_job_options {
            let mut merged = defaults.clone();
            merge_job_options(&mut merged, flow.opts.take().unwrap_or_default());
            flow.opts = Some(merged);
        }
    }
    if let Some(children) = flow.children.as_mut() {
        for child in children {
            apply_queue_defaults(child, opts);
        }
    }
}

fn validate_flow_queue_names(flow: &FlowJob) -> Result<(), Error> {
    validate_queue_name(&flow.queue_name)?;
    if let Some(children) = flow.children.as_ref() {
        for child in children {
            validate_flow_queue_names(child)?;
        }
    }
    Ok(())
}

/// Overlay `over` onto `base`: any field set in `over` replaces the value in
/// `base`. Used to give job-level options precedence over queue defaults.
fn merge_job_options(base: &mut JobOptions, over: JobOptions) {
    macro_rules! overlay {
        ($($field:ident),+ $(,)?) => {
            $(
                if over.$field.is_some() {
                    base.$field = over.$field;
                }
            )+
        };
    }
    overlay!(
        delay,
        priority,
        attempts,
        backoff,
        lifo,
        remove_on_complete,
        remove_on_fail,
        keep_logs,
        job_id,
        timestamp,
        stack_trace_limit,
        parent,
        deduplication,
        repeat,
        prev_millis,
        repeat_job_key,
        fail_parent_on_failure,
        ignore_dependency_on_failure,
        remove_dependency_on_failure,
        continue_parent_on_failure,
    );
}

#[cfg(test)]
mod tests {
    use super::{FlowProducer, JobNode};
    use crate::job::Job;

    fn leaf(name: &str) -> JobNode {
        JobNode {
            job: Job::new(name, serde_json::json!({}), None),
            children: None,
        }
    }

    #[test]
    fn apply_pipeline_results_updates_only_root_id() {
        let mut root = JobNode {
            job: Job::new("root", serde_json::json!({}), None),
            children: Some(vec![leaf("child-a"), leaf("child-b")]),
        };
        {
            let children = root.children.as_mut().unwrap();
            children[0].job.set_id("mem-child-a".to_string());
            children[1].job.set_id("mem-child-b".to_string());
        }
        let results = [
            redis::Value::BulkString(b"root-id".to_vec()),
            redis::Value::BulkString(b"child-a-id".to_vec()),
            redis::Value::BulkString(b"child-b-id".to_vec()),
        ];
        let mut iter = results.iter();
        FlowProducer::apply_pipeline_results(&mut root, &mut iter, true).unwrap();
        assert_eq!(root.job.id(), "root-id");
        let children = root.children.as_ref().unwrap();
        assert_eq!(children[0].job.id(), "mem-child-a");
        assert_eq!(children[1].job.id(), "mem-child-b");
    }

    #[test]
    fn apply_pipeline_results_errors_on_negative_child_code() {
        let mut root = JobNode {
            job: Job::new("root", serde_json::json!({}), None),
            children: Some(vec![leaf("child")]),
        };
        let results = [
            redis::Value::BulkString(b"root-id".to_vec()),
            redis::Value::Int(-3),
        ];
        let mut iter = results.iter();
        let result = FlowProducer::apply_pipeline_results(&mut root, &mut iter, true);
        assert!(result.is_err(), "negative child code should propagate");
    }

    #[test]
    fn apply_pipeline_results_tolerates_deduplicated_child() {
        // A child whose internal parent was deduplicated returns -5 (its new
        // parent key was never created); that must not fail the whole flow.
        let mut root = JobNode {
            job: Job::new("root", serde_json::json!({}), None),
            children: Some(vec![leaf("child")]),
        };
        root.children.as_mut().unwrap()[0]
            .job
            .set_id("mem-child".to_string());
        let results = [
            redis::Value::BulkString(b"existing-root-id".to_vec()),
            redis::Value::Int(-5),
        ];
        let mut iter = results.iter();
        FlowProducer::apply_pipeline_results(&mut root, &mut iter, true).unwrap();
        assert_eq!(root.job.id(), "existing-root-id");
        assert_eq!(root.children.as_ref().unwrap()[0].job.id(), "mem-child");
    }

    #[test]
    fn apply_pipeline_results_errors_on_negative_root_code() {
        let mut root = JobNode {
            job: Job::new("root", serde_json::json!({}), None),
            children: None,
        };
        let results = [redis::Value::Int(-5)];
        let mut iter = results.iter();
        let result = FlowProducer::apply_pipeline_results(&mut root, &mut iter, true);
        assert!(result.is_err(), "negative root code should propagate");
    }

    #[test]
    fn parse_child_key_preserves_job_id_segments() {
        assert_eq!(
            FlowProducer::parse_child_key("bull:queue:job:1"),
            Some(("bull", "queue", "job:1"))
        );
    }

    #[test]
    fn parse_child_key_rejects_incomplete_keys() {
        assert_eq!(FlowProducer::parse_child_key("bull:queue"), None);
        assert_eq!(FlowProducer::parse_child_key("bull::job-1"), None);
        assert_eq!(FlowProducer::parse_child_key("bull:queue:"), None);
    }

    #[test]
    fn parse_paginate_result_handles_set_members() {
        let value = redis::Value::Array(vec![
            redis::Value::BulkString(b"0".to_vec()),
            redis::Value::Int(2),
            redis::Value::Array(vec![
                redis::Value::BulkString(b"bull:q:1".to_vec()),
                redis::Value::BulkString(b"bull:q:2".to_vec()),
            ]),
            redis::Value::Int(2),
            redis::Value::Array(vec![]),
        ]);
        let (cursor, offset, keys) = FlowProducer::parse_paginate_result(&value).unwrap();
        assert_eq!(cursor, "0");
        assert_eq!(offset, 2);
        assert_eq!(keys, vec!["bull:q:1".to_string(), "bull:q:2".to_string()]);
    }

    #[test]
    fn parse_paginate_result_handles_hash_fields() {
        let value = redis::Value::Array(vec![
            redis::Value::Int(5),
            redis::Value::Int(1),
            redis::Value::Array(vec![redis::Value::Array(vec![
                redis::Value::BulkString(b"bull:q:child".to_vec()),
                redis::Value::BulkString(b"{\"result\":1}".to_vec()),
            ])]),
            redis::Value::Int(1),
            redis::Value::Array(vec![]),
        ]);
        let (cursor, offset, keys) = FlowProducer::parse_paginate_result(&value).unwrap();
        assert_eq!(cursor, "5");
        assert_eq!(offset, 1);
        assert_eq!(keys, vec!["bull:q:child".to_string()]);
    }
}
