use tracing::{debug, instrument};

use crate::error::Error;
use crate::job::{Job, ScriptContext};
use crate::keys::QueueKeys;
use crate::options::{JobOptions, QueueOptions};
use crate::redis_connection::RedisConnection;
use crate::types::{JobCounts, JobState};

/// The version string stored in queue metadata for compatibility tracking.
const BULLMQ_VERSION: &str = "bullmq-rust:0.1.0";

/// A Queue is the main entry point for adding jobs to be processed.
///
/// It provides methods for adding single and bulk jobs, and managing
/// queue state (pause, resume, drain, obliterate).
#[derive(Clone)]
pub struct Queue {
    name: String,
    keys: QueueKeys,
    conn: RedisConnection,
    default_job_options: JobOptions,
}

impl Queue {
    /// Create a new Queue connected to Redis.
    pub async fn new(name: &str, opts: QueueOptions) -> Result<Self, Error> {
        let conn = RedisConnection::new(&opts.connection).await?;
        let keys = QueueKeys::new(name, Some(&opts.prefix));

        let queue = Self {
            name: name.to_string(),
            keys,
            conn,
            default_job_options: opts.default_job_options,
        };

        queue.update_meta().await?;

        Ok(queue)
    }

    /// Create a Queue with an existing Redis connection.
    pub async fn with_connection(
        name: &str,
        conn: RedisConnection,
        opts: QueueOptions,
    ) -> Result<Self, Error> {
        let keys = QueueKeys::new(name, Some(&opts.prefix));

        let queue = Self {
            name: name.to_string(),
            keys,
            conn,
            default_job_options: opts.default_job_options,
        };

        queue.update_meta().await?;

        Ok(queue)
    }

    /// The queue name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The queue keys helper.
    pub fn keys(&self) -> &QueueKeys {
        &self.keys
    }

    /// The underlying Redis connection.
    pub fn connection(&self) -> &RedisConnection {
        &self.conn
    }

    /// Add a job to the queue.
    #[instrument(skip(self, data, opts), fields(queue = %self.name))]
    pub async fn add(
        &self,
        name: &str,
        data: serde_json::Value,
        opts: Option<JobOptions>,
    ) -> Result<Job, Error> {
        let merged_opts = self.merge_job_options(opts);
        let mut job = Job::new(name, data, merged_opts);
        self.add_job(&mut job).await?;
        job.set_context(self.make_script_context());
        Ok(job)
    }

    /// Add multiple jobs to the queue in a single operation.
    ///
    /// Jobs are added concurrently over the multiplexed connection for maximum throughput.
    #[instrument(skip(self, jobs), fields(queue = %self.name, count = jobs.len()))]
    pub async fn add_bulk(
        &self,
        jobs: Vec<(String, serde_json::Value, Option<JobOptions>)>,
    ) -> Result<Vec<Job>, Error> {
        if jobs.is_empty() {
            return Ok(Vec::new());
        }

        let mut job_objects: Vec<Job> = jobs
            .into_iter()
            .map(|(name, data, opts)| {
                let merged = self.merge_job_options(opts);
                Job::new(&name, data, merged)
            })
            .collect();

        // Run all add_job calls concurrently since the connection is multiplexed
        let futures: Vec<_> = job_objects
            .iter()
            .map(|job| {
                let delay = job.delay();
                let priority = job.priority();
                let timestamp = job.timestamp();
                let custom_job_id = job.opts().job_id.as_deref().unwrap_or("").to_string();

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
                    })
                    .cloned();
                let keys = self.add_job_keys(script_name);
                let argv1 = self.pack_add_args(job, &custom_job_id, timestamp);
                let argv2 = serde_json::to_string(job.data()).unwrap_or_else(|_| "{}".into());
                let argv3 = self.pack_job_opts(job);
                let mut conn = self.conn.conn();

                async move {
                    let script = script?;
                    let argv2_bytes = argv2.into_bytes();
                    let args: Vec<&[u8]> = vec![&argv1, &argv2_bytes, &argv3];
                    let result = script.execute(&mut conn, &keys, &args).await?;
                    Self::parse_added_job_id(result)
                }
            })
            .collect();

        let results = futures::future::join_all(futures).await;

        let ctx = self.make_script_context();
        for (job, result) in job_objects.iter_mut().zip(results.into_iter()) {
            let id = result?;
            job.set_id(id);
            job.set_context(ctx.clone());
        }

        Ok(job_objects)
    }

    /// Internal: add a single job via the appropriate Lua script.
    async fn add_job(&self, job: &mut Job) -> Result<(), Error> {
        let delay = job.delay();
        let priority = job.priority();
        let timestamp = job.timestamp();

        let custom_job_id = job.opts().job_id.as_deref().unwrap_or("");

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

        // Build KEYS
        let keys = self.add_job_keys(script_name);

        // Build ARGV[1]: msgpack array of metadata
        let argv1 = self.pack_add_args(job, custom_job_id, timestamp);

        // Build ARGV[2]: JSON stringified job data
        let argv2 = serde_json::to_string(job.data()).unwrap_or_else(|_| "{}".to_string());

        // Build ARGV[3]: msgpack map of options
        let argv3 = self.pack_job_opts(job);

        let argv2_bytes = argv2.into_bytes();
        let args: Vec<&[u8]> = vec![&argv1, &argv2_bytes, &argv3];

        let mut conn = self.conn.conn();
        let result = script.execute(&mut conn, &keys, &args).await?;

        let returned_job_id = Self::parse_added_job_id(result)?;
        job.set_id(returned_job_id);

        debug!(job_id = %job.id(), name = %job.name(), "job added");
        Ok(())
    }

    /// Merge per-job options with queue default job options.
    /// Per-job options take precedence over defaults.
    /// Create a ScriptContext for jobs returned by queue methods.
    fn make_script_context(&self) -> ScriptContext {
        let (progress_tx, _) = tokio::sync::broadcast::channel(1);
        ScriptContext {
            conn: self.conn.clone(),
            keys: self.keys.clone(),
            progress_tx,
            token: String::new(),
            lock_duration: 0,
        }
    }

    fn merge_job_options(&self, opts: Option<JobOptions>) -> Option<JobOptions> {
        let defaults = &self.default_job_options;
        let is_default = defaults.attempts.is_none()
            && defaults.backoff.is_none()
            && defaults.remove_on_complete.is_none()
            && defaults.remove_on_fail.is_none()
            && defaults.delay.is_none()
            && defaults.priority.is_none()
            && defaults.lifo.is_none();

        if is_default {
            return opts;
        }

        let job_opts = opts.unwrap_or_default();
        Some(JobOptions {
            attempts: job_opts.attempts.or(defaults.attempts),
            backoff: job_opts
                .backoff
                .clone()
                .or_else(|| defaults.backoff.clone()),
            remove_on_complete: job_opts
                .remove_on_complete
                .clone()
                .or_else(|| defaults.remove_on_complete.clone()),
            remove_on_fail: job_opts
                .remove_on_fail
                .clone()
                .or_else(|| defaults.remove_on_fail.clone()),
            delay: job_opts.delay.or(defaults.delay),
            priority: job_opts.priority.or(defaults.priority),
            lifo: job_opts.lifo.or(defaults.lifo),
            job_id: job_opts.job_id,
            ..job_opts
        })
    }

    /// Build KEYS array for addStandardJob/addDelayedJob/addPrioritizedJob.
    fn add_job_keys(&self, script_name: &str) -> Vec<String> {
        match script_name {
            "addStandardJob" => vec![
                self.keys.wait(),
                self.keys.paused(),
                self.keys.meta(),
                self.keys.id(),
                self.keys.completed(),
                self.keys.delayed(),
                self.keys.active(),
                self.keys.events(),
                self.keys.marker(),
            ],
            "addDelayedJob" => vec![
                self.keys.marker(),
                self.keys.meta(),
                self.keys.id(),
                self.keys.delayed(),
                self.keys.completed(),
                self.keys.events(),
            ],
            "addPrioritizedJob" => vec![
                self.keys.marker(),
                self.keys.meta(),
                self.keys.id(),
                self.keys.prioritized(),
                self.keys.delayed(),
                self.keys.completed(),
                self.keys.active(),
                self.keys.events(),
                self.keys.pc(),
            ],
            _ => vec![],
        }
    }

    /// Pack ARGV[1]: msgpack array matching the Lua script contract.
    ///
    /// Positions: [key_prefix, job_id, name, timestamp, parentKey, parentDepsKey, parent, repeatJobKey, deduplicationKey]
    fn pack_add_args(&self, job: &Job, job_id: &str, timestamp: u64) -> Vec<u8> {
        use rmp::encode::*;

        let mut buf = Vec::with_capacity(128);
        write_array_len(&mut buf, 9).unwrap();

        // [1] key prefix (with trailing colon)
        write_str(&mut buf, &self.keys.key_prefix()).unwrap();
        // [2] job id
        write_str(&mut buf, job_id).unwrap();
        // [3] name
        write_str(&mut buf, job.name()).unwrap();
        // [4] timestamp
        write_uint(&mut buf, timestamp).unwrap();
        // [5] parentKey - nil
        write_nil(&mut buf).unwrap();
        // [6] parent deps key - nil
        write_nil(&mut buf).unwrap();
        // [7] parent - nil
        write_nil(&mut buf).unwrap();
        // [8] repeat job key - nil
        write_nil(&mut buf).unwrap();
        // [9] deduplication key
        if let Some(ref dedup) = job.opts().deduplication_id {
            let key = format!("{}:de:{}", self.keys.base(), dedup);
            write_str(&mut buf, &key).unwrap();
        } else {
            write_nil(&mut buf).unwrap();
        }

        buf
    }

    /// Pack ARGV[3]: msgpack map of job options using the raw script keys.
    fn pack_job_opts(&self, job: &Job) -> Vec<u8> {
        use rmp::encode::*;

        let opts = job.opts();

        // Collect entries
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
            let b = Self::encode_remove_on_finish(roc);
            entries.push(("removeOnComplete", b));
        }

        if let Some(ref rof) = opts.remove_on_fail {
            let b = Self::encode_remove_on_finish(rof);
            entries.push(("removeOnFail", b));
        }

        if let Some(ref backoff) = opts.backoff {
            let b = Self::encode_backoff(backoff);
            entries.push(("backoff", b));
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

    fn encode_remove_on_finish(rof: &crate::types::RemoveOnFinish) -> Vec<u8> {
        use rmp::encode::*;
        let mut b = Vec::new();
        match rof {
            crate::types::RemoveOnFinish::Bool(val) => {
                write_bool(&mut b, *val).unwrap();
            }
            crate::types::RemoveOnFinish::Count(n) => {
                write_uint(&mut b, *n as u64).unwrap();
            }
            crate::types::RemoveOnFinish::Options(keep) => {
                let mut count = 0u32;
                if keep.age.is_some() {
                    count += 1;
                }
                if keep.count.is_some() {
                    count += 1;
                }
                write_map_len(&mut b, count).unwrap();
                if let Some(age) = keep.age {
                    write_str(&mut b, "age").unwrap();
                    write_uint(&mut b, age).unwrap();
                }
                if let Some(cnt) = keep.count {
                    write_str(&mut b, "count").unwrap();
                    write_uint(&mut b, cnt as u64).unwrap();
                }
            }
        }
        b
    }

    fn encode_backoff(backoff: &crate::types::BackoffStrategy) -> Vec<u8> {
        use rmp::encode::*;
        let mut b = Vec::new();
        match backoff {
            crate::types::BackoffStrategy::Fixed(delay) => {
                write_map_len(&mut b, 2).unwrap();
                write_str(&mut b, "type").unwrap();
                write_str(&mut b, "fixed").unwrap();
                write_str(&mut b, "delay").unwrap();
                write_uint(&mut b, *delay).unwrap();
            }
            crate::types::BackoffStrategy::Exponential(delay) => {
                write_map_len(&mut b, 2).unwrap();
                write_str(&mut b, "type").unwrap();
                write_str(&mut b, "exponential").unwrap();
                write_str(&mut b, "delay").unwrap();
                write_uint(&mut b, *delay).unwrap();
            }
            crate::types::BackoffStrategy::Custom(name) => {
                write_map_len(&mut b, 2).unwrap();
                write_str(&mut b, "type").unwrap();
                write_str(&mut b, name).unwrap();
                write_str(&mut b, "delay").unwrap();
                write_uint(&mut b, 0).unwrap();
            }
        }
        b
    }

    fn parse_added_job_id(result: redis::Value) -> Result<String, Error> {
        match result {
            redis::Value::BulkString(bytes) => Ok(String::from_utf8_lossy(&bytes).to_string()),
            redis::Value::SimpleString(value) => Ok(value),
            redis::Value::Int(code) if code < 0 => Err(Error::from_script_code(code)),
            redis::Value::Int(job_id) => Ok(job_id.to_string()),
            value => Err(Error::InvalidConfig(format!(
                "unexpected add job script result: {:?}",
                value
            ))),
        }
    }

    /// Update queue metadata (version).
    async fn update_meta(&self) -> Result<(), Error> {
        let mut conn = self.conn.conn();
        let meta_key = self.keys.meta();

        redis::cmd("HSET")
            .arg(&meta_key)
            .arg("library")
            .arg(BULLMQ_VERSION)
            .query_async::<()>(&mut conn)
            .await?;

        Ok(())
    }

    /// Pause the queue.
    #[instrument(skip(self), fields(queue = %self.name))]
    pub async fn pause(&self) -> Result<(), Error> {
        let script = self
            .conn
            .scripts()
            .get("pause")
            .ok_or_else(|| Error::InvalidConfig("pause script not found".to_string()))?
            .clone();

        let keys = vec![
            self.keys.wait(),
            self.keys.paused(),
            self.keys.meta(),
            self.keys.prioritized(),
            self.keys.events(),
            self.keys.delayed(),
            self.keys.marker(),
        ];

        let args: Vec<&[u8]> = vec![b"paused"];

        let mut conn = self.conn.conn();
        script.execute(&mut conn, &keys, &args).await?;

        debug!("queue paused");
        Ok(())
    }

    /// Resume the queue.
    #[instrument(skip(self), fields(queue = %self.name))]
    pub async fn resume(&self) -> Result<(), Error> {
        let script = self
            .conn
            .scripts()
            .get("pause")
            .ok_or_else(|| Error::InvalidConfig("pause script not found".to_string()))?
            .clone();

        let keys = vec![
            self.keys.paused(),
            self.keys.wait(),
            self.keys.meta(),
            self.keys.prioritized(),
            self.keys.events(),
            self.keys.delayed(),
            self.keys.marker(),
        ];

        let args: Vec<&[u8]> = vec![b"resumed"];

        let mut conn = self.conn.conn();
        script.execute(&mut conn, &keys, &args).await?;

        debug!("queue resumed");
        Ok(())
    }

    /// Check if the queue is paused.
    pub async fn is_paused(&self) -> Result<bool, Error> {
        let mut conn = self.conn.conn();
        let paused: Option<String> = redis::cmd("HGET")
            .arg(self.keys.meta())
            .arg("paused")
            .query_async(&mut conn)
            .await?;
        Ok(paused.as_deref() == Some("1"))
    }

    /// Get a job by its ID.
    pub async fn get_job(&self, job_id: &str) -> Result<Option<Job>, Error> {
        let job = Job::from_id(&self.conn, &self.keys, job_id).await?;
        Ok(job.map(|mut j| {
            j.set_context(self.make_script_context());
            j
        }))
    }

    /// Get the counts of jobs in each state.
    pub async fn get_job_counts(&self) -> Result<JobCounts, Error> {
        let mut conn = self.conn.conn();
        let mut pipe = redis::pipe();

        pipe.cmd("LLEN").arg(self.keys.wait());
        pipe.cmd("LLEN").arg(self.keys.active());
        pipe.cmd("ZCARD").arg(self.keys.delayed());
        pipe.cmd("ZCARD").arg(self.keys.prioritized());
        pipe.cmd("ZCARD").arg(self.keys.completed());
        pipe.cmd("ZCARD").arg(self.keys.failed());
        pipe.cmd("ZCARD").arg(self.keys.waiting_children());
        pipe.cmd("LLEN").arg(self.keys.paused());

        let result: Vec<u64> = pipe.query_async(&mut conn).await?;

        Ok(JobCounts {
            waiting: result.first().copied().unwrap_or(0),
            active: result.get(1).copied().unwrap_or(0),
            delayed: result.get(2).copied().unwrap_or(0),
            prioritized: result.get(3).copied().unwrap_or(0),
            completed: result.get(4).copied().unwrap_or(0),
            failed: result.get(5).copied().unwrap_or(0),
            waiting_children: result.get(6).copied().unwrap_or(0),
            paused: result.get(7).copied().unwrap_or(0),
        })
    }

    /// Get the state of a specific job.
    pub async fn get_job_state(&self, job_id: &str) -> Result<JobState, Error> {
        let script = self
            .conn
            .scripts()
            .get("getState")
            .ok_or_else(|| Error::InvalidConfig("getState script not found".to_string()))?
            .clone();

        let keys = vec![
            self.keys.completed(),
            self.keys.failed(),
            self.keys.delayed(),
            self.keys.active(),
            self.keys.wait(),
            self.keys.paused(),
            self.keys.waiting_children(),
            self.keys.prioritized(),
        ];

        let job_id_bytes = job_id.as_bytes().to_vec();
        let args: Vec<&[u8]> = vec![&job_id_bytes];

        let mut conn = self.conn.conn();
        let result = script.execute(&mut conn, &keys, &args).await?;

        match result {
            redis::Value::BulkString(bytes) => {
                let state_str = String::from_utf8_lossy(&bytes);
                Ok(JobState::from_redis_str(&state_str))
            }
            redis::Value::SimpleString(s) => Ok(JobState::from_redis_str(&s)),
            _ => Ok(JobState::Unknown),
        }
    }

    /// Remove a job by its ID.
    pub async fn remove(&self, job_id: &str) -> Result<bool, Error> {
        let script = self
            .conn
            .scripts()
            .get("removeJob")
            .ok_or_else(|| Error::InvalidConfig("removeJob script not found".to_string()))?
            .clone();

        let keys = vec![self.keys.job_key(job_id), self.keys.repeat()];
        let prefix = self.keys.key_prefix();
        let args: Vec<&[u8]> = vec![job_id.as_bytes(), b"1", prefix.as_bytes()];

        let mut conn = self.conn.conn();
        let result = script.execute(&mut conn, &keys, &args).await?;

        match result {
            redis::Value::Int(n) => Ok(n == 1),
            _ => Ok(false),
        }
    }

    /// Clean jobs from a specific set (completed, failed, etc.).
    ///
    /// `grace` - Only remove jobs older than this many milliseconds.
    /// `limit` - Maximum number of jobs to remove (0 = unlimited).
    /// `state` - Which state set to clean ("completed", "failed", "wait", "active", "delayed", "prioritized", "paused").
    ///
    /// Returns the IDs of removed jobs.
    pub async fn clean(&self, grace: u64, limit: u32, state: &str) -> Result<Vec<String>, Error> {
        let script = self
            .conn
            .scripts()
            .get("cleanJobsInSet")
            .ok_or_else(|| Error::InvalidConfig("cleanJobsInSet script not found".to_string()))?
            .clone();

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let timestamp = now.saturating_sub(grace);

        // Normalize "waiting" to "wait"
        let normalized = if state == "waiting" { "wait" } else { state };

        let set_key = match normalized {
            "completed" => self.keys.completed(),
            "failed" => self.keys.failed(),
            "wait" => self.keys.wait(),
            "active" => self.keys.active(),
            "delayed" => self.keys.delayed(),
            "paused" => self.keys.paused(),
            "prioritized" => self.keys.prioritized(),
            _ => return Err(Error::InvalidConfig(format!("invalid state: {}", state))),
        };

        let max_per_call = if limit == 0 {
            10000u32
        } else {
            limit.min(10000)
        };
        let max_total = if limit == 0 { u32::MAX } else { limit };
        let mut all_deleted: Vec<String> = Vec::new();

        loop {
            let keys = vec![set_key.clone(), self.keys.events(), self.keys.repeat()];

            let prefix = self.keys.key_prefix();
            let ts_str = timestamp.to_string();
            let limit_str = max_per_call.to_string();

            let args: Vec<&[u8]> = vec![
                prefix.as_bytes(),
                ts_str.as_bytes(),
                limit_str.as_bytes(),
                normalized.as_bytes(),
            ];

            let mut conn = self.conn.conn();
            let result = script.execute(&mut conn, &keys, &args).await?;

            let batch: Vec<String> = match result {
                redis::Value::Array(arr) => arr
                    .into_iter()
                    .filter_map(|v| match v {
                        redis::Value::BulkString(bytes) => {
                            Some(String::from_utf8_lossy(&bytes).to_string())
                        }
                        redis::Value::SimpleString(s) => Some(s),
                        _ => None,
                    })
                    .collect(),
                _ => Vec::new(),
            };

            let batch_len = batch.len() as u32;
            all_deleted.extend(batch);

            if batch_len < max_per_call || all_deleted.len() as u32 >= max_total {
                break;
            }
        }

        Ok(all_deleted)
    }

    /// Drain the queue (remove all waiting and delayed jobs).
    pub async fn drain(&self, delayed: bool) -> Result<(), Error> {
        let script = self
            .conn
            .scripts()
            .get("drain")
            .ok_or_else(|| Error::InvalidConfig("drain script not found".to_string()))?
            .clone();

        let keys = vec![
            self.keys.wait(),
            self.keys.paused(),
            self.keys.delayed(),
            self.keys.prioritized(),
            self.keys.repeat(),
        ];

        let delayed_str = if delayed { "1" } else { "0" };
        let prefix = self.keys.key_prefix();
        let args: Vec<&[u8]> = vec![prefix.as_bytes(), delayed_str.as_bytes()];

        let mut conn = self.conn.conn();
        script.execute(&mut conn, &keys, &args).await?;

        debug!(delayed, "queue drained");
        Ok(())
    }

    /// Retry all failed (or completed) jobs, moving them back to wait.
    ///
    /// - `state`: "failed" or "completed" (default: "failed")
    /// - `count`: max jobs to move per batch (default: 1000)
    /// - `timestamp`: only retry jobs finished before this timestamp in ms (default: now)
    pub async fn retry_jobs(
        &self,
        state: &str,
        count: u32,
        timestamp: Option<u64>,
    ) -> Result<(), Error> {
        let script = self
            .conn
            .scripts()
            .get("moveJobsToWait")
            .ok_or_else(|| Error::InvalidConfig("moveJobsToWait script not found".to_string()))?
            .clone();

        let ts = timestamp.unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64
        });

        let keys = vec![
            self.keys.key_prefix(),
            self.keys.events(),
            self.keys.get(state),
            self.keys.wait(),
            self.keys.paused(),
            self.keys.meta(),
            self.keys.active(),
            self.keys.marker(),
        ];

        let count_str = count.to_string();
        let ts_str = ts.to_string();

        let mut conn = self.conn.conn();
        loop {
            let args: Vec<&[u8]> = vec![count_str.as_bytes(), ts_str.as_bytes(), state.as_bytes()];
            let result = script.execute(&mut conn, &keys, &args).await?;

            match result {
                redis::Value::Int(1) => continue,
                _ => break,
            }
        }

        debug!(state, "retry_jobs completed");
        Ok(())
    }

    /// Promote all delayed jobs to waiting.
    ///
    /// - `count`: max jobs to promote per batch (default: 1000)
    pub async fn promote_jobs(&self, count: u32) -> Result<(), Error> {
        let script = self
            .conn
            .scripts()
            .get("moveJobsToWait")
            .ok_or_else(|| Error::InvalidConfig("moveJobsToWait script not found".to_string()))?
            .clone();

        let keys = vec![
            self.keys.key_prefix(),
            self.keys.events(),
            self.keys.delayed(),
            self.keys.wait(),
            self.keys.paused(),
            self.keys.meta(),
            self.keys.active(),
            self.keys.marker(),
        ];

        let count_str = count.to_string();
        // Use MAX_VALUE equivalent for timestamp so all delayed jobs match
        let ts_str = "9007199254740991".to_string(); // Number.MAX_SAFE_INTEGER

        let mut conn = self.conn.conn();
        loop {
            let args: Vec<&[u8]> = vec![count_str.as_bytes(), ts_str.as_bytes(), b"delayed"];
            let result = script.execute(&mut conn, &keys, &args).await?;

            match result {
                redis::Value::Int(1) => continue,
                _ => break,
            }
        }

        debug!("promote_jobs completed");
        Ok(())
    }

    /// Get logs for a specific job.
    ///
    /// Returns the log entries and total count.
    pub async fn get_job_logs(
        &self,
        job_id: &str,
        start: isize,
        end: isize,
        asc: bool,
    ) -> Result<(Vec<String>, usize), Error> {
        let logs_key = format!("{}{}:logs", self.keys.key_prefix(), job_id);
        let mut conn = self.conn.conn();

        let (logs, count): (Vec<String>, usize) = if asc {
            redis::pipe()
                .cmd("LRANGE")
                .arg(&logs_key)
                .arg(start)
                .arg(end)
                .cmd("LLEN")
                .arg(&logs_key)
                .query_async(&mut conn)
                .await?
        } else {
            let actual_start = -(end + 1);
            let actual_end = -(start + 1);
            let (mut logs, count): (Vec<String>, usize) = redis::pipe()
                .cmd("LRANGE")
                .arg(&logs_key)
                .arg(actual_start)
                .arg(actual_end)
                .cmd("LLEN")
                .arg(&logs_key)
                .query_async(&mut conn)
                .await?;
            logs.reverse();
            (logs, count)
        };

        Ok((logs, count))
    }

    /// Trim the event stream to approximately `max_length` entries.
    pub async fn trim_events(&self, max_length: usize) -> Result<usize, Error> {
        let mut conn = self.conn.conn();
        let trimmed: usize = redis::cmd("XTRIM")
            .arg(self.keys.events())
            .arg("MAXLEN")
            .arg("~")
            .arg(max_length)
            .query_async(&mut conn)
            .await?;
        Ok(trimmed)
    }

    /// Obliterate the queue (remove all keys).
    ///
    /// When `force` is true, automatically pauses the queue first.
    pub async fn obliterate(&self, force: bool, count: usize) -> Result<(), Error> {
        // The script requires the queue to be paused
        if force {
            let _ = self.pause().await;
        }

        let script = self
            .conn
            .scripts()
            .get("obliterate")
            .ok_or_else(|| Error::InvalidConfig("obliterate script not found".to_string()))?
            .clone();

        let keys = vec![self.keys.meta(), self.keys.key_prefix()];
        let count_str = count.to_string();
        let force_str = if force { "1" } else { "0" };

        let mut conn = self.conn.conn();
        loop {
            let args: Vec<&[u8]> = vec![count_str.as_bytes(), force_str.as_bytes()];
            let result = script.execute(&mut conn, &keys, &args).await?;

            match result {
                redis::Value::Nil => break,
                redis::Value::Int(0) => break,
                redis::Value::Int(1) => continue, // more to delete
                redis::Value::Int(code) if code < 0 => {
                    return Err(Error::from_script_code(code));
                }
                _ => break,
            }
        }

        debug!(force, "queue obliterated");
        Ok(())
    }

    /// Close the queue connection.
    pub async fn close(&self) {
        self.conn.close().await;
    }
}
