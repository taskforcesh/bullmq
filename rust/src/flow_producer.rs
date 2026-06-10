//! FlowProducer — atomically add trees of dependent jobs (flows).
//!
//! A flow is a tree-like structure where children jobs are processed before
//! their parent. When all children complete, the parent becomes processable.

use std::collections::HashMap;
use tracing::{debug, instrument};
use uuid::Uuid;

use crate::error::Error;
use crate::job::Job;
use crate::keys::QueueKeys;
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
#[derive(Debug, Clone)]
pub struct FlowProducerOptions {
    /// Redis connection configuration.
    pub connection: crate::options::RedisConnectionOptions,
    /// Key prefix (default: "bull").
    pub prefix: Option<String>,
}

impl Default for FlowProducerOptions {
    fn default() -> Self {
        Self {
            connection: crate::options::RedisConnectionOptions::default(),
            prefix: None,
        }
    }
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
    #[instrument(skip(self, flow), fields(root_name = %flow.name, root_queue = %flow.queue_name))]
    pub async fn add(&self, flow: FlowJob) -> Result<JobNode, Error> {
        self.add_with_opts(flow, &FlowOpts::default()).await
    }

    /// Atomically add a flow, applying per-queue default job options.
    ///
    /// For every job whose `queue_name` is present in `opts.queues_options`,
    /// the corresponding `default_job_options` are merged in. Options set
    /// explicitly on a job always take precedence over the defaults.
    pub async fn add_with_opts(
        &self,
        mut flow: FlowJob,
        opts: &FlowOpts,
    ) -> Result<JobNode, Error> {
        apply_queue_defaults(&mut flow, opts);

        // Ensure scripts are loaded (needed for EVALSHA in pipeline)
        let mut conn = self.conn.conn();
        self.conn.scripts().load_all(&mut conn).await?;

        let mut pipe = redis::pipe();
        pipe.atomic();

        // If the root flow has opts.parent, construct a ParentContext
        let parent_ctx = flow
            .opts
            .as_ref()
            .and_then(|o| o.parent.as_ref())
            .map(|p| {
                let parent_queue_key = p.queue.clone();
                let parent_deps_key = format!("{}:{}:dependencies", parent_queue_key, p.id);
                ParentContext {
                    parent_id: p.id.clone(),
                    parent_queue_key,
                    parent_deps_key,
                }
            });

        let mut job_node = self.add_node(&mut pipe, &flow, parent_ctx.as_ref())?;

        // Execute the atomic pipeline
        let results: Vec<redis::Value> = pipe.query_async(&mut conn).await?;

        // The first result is the root job's script result.
        // When deduplication occurs, the Lua script returns the existing job's ID.
        // A negative code indicates an error (e.g. missing parent key).
        if let Some(first) = results.first() {
            Self::check_add_result(first, parent_ctx.as_ref())?;
            if let Some(id) = Self::extract_job_id(first) {
                job_node.job.set_id(id.clone());
                debug!(job_id = %id, "flow added");
            }
        }

        Ok(job_node)
    }

    /// Atomically add multiple flows.
    #[instrument(skip(self, flows), fields(count = flows.len()))]
    pub async fn add_bulk(&self, flows: Vec<FlowJob>) -> Result<Vec<JobNode>, Error> {
        if flows.is_empty() {
            return Ok(Vec::new());
        }

        // Ensure scripts are loaded (needed for EVALSHA in pipeline)
        let mut conn = self.conn.conn();
        self.conn.scripts().load_all(&mut conn).await?;

        let mut pipe = redis::pipe();
        pipe.atomic();

        let mut job_nodes = Vec::with_capacity(flows.len());
        // Track which result index corresponds to each flow's root command.
        // Each add_node call adds the root command first, so we use a counter.
        let mut root_indices = Vec::with_capacity(flows.len());
        let mut cmd_count = 0usize;

        for flow in &flows {
            let parent_ctx = flow
                .opts
                .as_ref()
                .and_then(|o| o.parent.as_ref())
                .map(|p| {
                    let parent_queue_key = p.queue.clone();
                    let parent_deps_key =
                        format!("{}:{}:dependencies", parent_queue_key, p.id);
                    ParentContext {
                        parent_id: p.id.clone(),
                        parent_queue_key,
                        parent_deps_key,
                    }
                });
            root_indices.push(cmd_count);
            let node = self.add_node(&mut pipe, flow, parent_ctx.as_ref())?;
            cmd_count += Self::count_nodes(&node);
            job_nodes.push(node);
        }

        let results: Vec<redis::Value> = pipe.query_async(&mut conn).await?;

        // Update root job IDs from pipeline results (handles dedup)
        for (i, root_idx) in root_indices.iter().enumerate() {
            if let Some(result) = results.get(*root_idx) {
                if let Some(id) = Self::extract_job_id(result) {
                    job_nodes[i].job.set_id(id);
                }
            }
        }

        Ok(job_nodes)
    }

    /// Retrieve an existing flow tree from Redis.
    ///
    /// Reconstructs the parent-child tree by loading jobs and their dependencies.
    pub async fn get_flow(&self, opts: GetFlowOpts) -> Result<JobNode, Error> {
        let prefix = opts.prefix.as_deref().unwrap_or(&self.prefix);
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

            if depth == 0 {
                return Ok(JobNode {
                    job,
                    children: None,
                });
            }

            // Collect child keys from dependencies (unprocessed) and processed
            let deps_key = format!("{}:dependencies", job_key);
            let processed_key = format!("{}:processed", job_key);
            let failed_key = format!("{}:failed", job_key);

            // Get unprocessed dependencies (SET)
            let unprocessed: Vec<String> = redis::cmd("SMEMBERS")
                .arg(&deps_key)
                .query_async(&mut conn)
                .await
                .unwrap_or_default();

            // Get processed children (HASH keys)
            let processed: Vec<String> = redis::cmd("HKEYS")
                .arg(&processed_key)
                .query_async(&mut conn)
                .await
                .unwrap_or_default();

            // Get failed children (HASH keys)
            let failed: Vec<String> = redis::cmd("HKEYS")
                .arg(&failed_key)
                .query_async(&mut conn)
                .await
                .unwrap_or_default();

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
                // Child key format: prefix:queueName:childId
                let parts: Vec<&str> = child_key.splitn(3, ':').collect();
                if parts.len() == 3 {
                    let child_prefix = parts[0];
                    let child_queue = parts[1];
                    let child_id = parts[2];
                    match self
                        .get_node(child_prefix, child_queue, child_id, depth - 1, max_children)
                        .await
                    {
                        Ok(node) => child_nodes.push(node),
                        Err(_) => {} // Skip missing children
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
                self.add_parent_job_to_pipe(
                    pipe,
                    &keys,
                    &job,
                    &job_id,
                    parent,
                )?;

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
        let script_keys = vec![
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
            .ok_or_else(|| {
                Error::InvalidConfig(format!("script '{}' not found", script_name))
            })?
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
            redis::Value::BulkString(bytes) => {
                Some(String::from_utf8_lossy(bytes).to_string())
            }
            redis::Value::SimpleString(s) => Some(s.clone()),
            redis::Value::Int(n) if *n >= 0 => Some(n.to_string()),
            _ => None,
        }
    }

    /// Check the result of an add command for error codes.
    ///
    /// The addJob Lua script returns `-5` when a referenced parent key is
    /// missing. In that case the job is NOT added, so we surface an error
    /// instead of silently dropping the job.
    fn check_add_result(
        value: &redis::Value,
        parent_ctx: Option<&ParentContext>,
    ) -> Result<(), Error> {
        if let redis::Value::Int(code) = value {
            if *code < 0 {
                if *code == -5 {
                    let parent_key = parent_ctx
                        .map(|p| format!("{}:{}", p.parent_queue_key, p.parent_id))
                        .unwrap_or_default();
                    return Err(Error::Script {
                        code: *code,
                        message: format!(
                            "Missing key for parent job {}. addJob",
                            parent_key
                        ),
                    });
                }
                return Err(Error::from_script_code(*code));
            }
        }
        Ok(())
    }

    /// Count total nodes in a JobNode tree (1 command per node).
    fn count_nodes(node: &JobNode) -> usize {
        let mut count = 1;
        if let Some(children) = &node.children {
            for child in children {
                count += Self::count_nodes(child);
            }
        }
        count
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
