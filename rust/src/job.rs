use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;

use crate::error::Error;
use crate::keys::QueueKeys;
use crate::options::JobOptions;
use crate::redis_connection::RedisConnection;
use crate::types::{JobProgress, JobState, ParentKeys, RetryOptions};

/// Internal event sent from Job to Worker when progress is updated.
#[derive(Debug, Clone)]
pub(crate) struct JobProgressEvent {
    pub job_id: String,
    pub progress: JobProgress,
}

/// Context for executing Redis scripts from within a Job.
#[derive(Clone)]
pub struct ScriptContext {
    pub(crate) conn: RedisConnection,
    pub(crate) keys: QueueKeys,
    pub(crate) progress_tx: broadcast::Sender<JobProgressEvent>,
    pub(crate) token: String,
    pub(crate) lock_duration: u64,
}

impl std::fmt::Debug for ScriptContext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ScriptContext").finish_non_exhaustive()
    }
}

/// Represents a job in the queue.
///
/// A `Job` holds the data to be processed and all associated metadata.
/// Jobs are serialized to Redis as hash fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    /// Unique job identifier.
    id: String,
    /// Job name (used for routing to specific processors).
    name: String,
    /// The job's payload (arbitrary JSON).
    data: serde_json::Value,
    /// Job options.
    #[serde(default)]
    opts: JobOptions,
    /// Processing progress.
    #[serde(default)]
    progress: JobProgress,
    /// Number of attempts made.
    #[serde(default)]
    attempts_made: u32,
    /// Number of times processing was started.
    #[serde(default)]
    attempts_started: u32,
    /// Timestamp when the job was created (ms since epoch).
    timestamp: u64,
    /// Timestamp when processing started (ms since epoch).
    #[serde(skip_serializing_if = "Option::is_none")]
    processed_on: Option<u64>,
    /// Timestamp when the job finished (ms since epoch).
    #[serde(skip_serializing_if = "Option::is_none")]
    finished_on: Option<u64>,
    /// Reason the job failed (if applicable).
    #[serde(default)]
    failed_reason: String,
    /// Stack trace of the failure.
    #[serde(default)]
    stacktrace: String,
    /// Return value from processing.
    #[serde(default)]
    returnvalue: String,
    /// Parent job info.
    #[serde(skip_serializing_if = "Option::is_none")]
    parent: Option<ParentKeys>,
    /// Parent key (derived).
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_key: Option<String>,
    /// Worker name that processed this job.
    #[serde(skip_serializing_if = "Option::is_none")]
    processed_by: Option<String>,
    /// Counter for stalled detections.
    #[serde(default)]
    stalled_counter: u32,
    /// Current delay value (may be updated by backoff retries).
    #[serde(default)]
    delay: u64,
    /// Script execution context (set by the worker, not serialized).
    #[serde(skip)]
    ctx: Option<ScriptContext>,
}

impl Job {
    /// Create a new job with the given name, data, and options.
    pub fn new(name: &str, data: serde_json::Value, opts: Option<JobOptions>) -> Self {
        let opts = opts.unwrap_or_default();
        let timestamp = opts.timestamp.unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64
        });

        Self {
            id: String::new(), // Assigned by Redis
            name: name.to_string(),
            data,
            opts: opts.clone(),
            progress: JobProgress::default(),
            attempts_made: 0,
            attempts_started: 0,
            timestamp,
            processed_on: None,
            finished_on: None,
            failed_reason: String::new(),
            stacktrace: String::new(),
            returnvalue: String::new(),
            parent: None,
            parent_key: None,
            processed_by: None,
            stalled_counter: 0,
            delay: opts.delay.unwrap_or(0),
            ctx: None,
        }
    }

    // ── Accessors ────────────────────────────────────────────────────────

    /// The job's unique ID.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The job's name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The job's data payload.
    pub fn data(&self) -> &serde_json::Value {
        &self.data
    }

    /// The job's options.
    pub fn opts(&self) -> &JobOptions {
        &self.opts
    }

    /// Current progress.
    pub fn progress(&self) -> &JobProgress {
        &self.progress
    }

    /// Number of attempts made so far.
    pub fn attempts_made(&self) -> u32 {
        self.attempts_made
    }

    /// Timestamp when the job was created.
    pub fn timestamp(&self) -> u64 {
        self.timestamp
    }

    /// Timestamp when processing finished.
    pub fn finished_on(&self) -> Option<u64> {
        self.finished_on
    }

    /// Timestamp when processing started.
    pub fn processed_on(&self) -> Option<u64> {
        self.processed_on
    }

    /// The reason the job failed.
    pub fn failed_reason(&self) -> &str {
        &self.failed_reason
    }

    /// The return value from processing.
    pub fn returnvalue(&self) -> &str {
        &self.returnvalue
    }

    /// The parent job information.
    pub fn parent(&self) -> Option<&ParentKeys> {
        self.parent.as_ref()
    }

    /// The worker name that processed this job.
    pub fn processed_by(&self) -> Option<&str> {
        self.processed_by.as_deref()
    }

    /// The lock token for this job (set by the worker).
    pub fn token(&self) -> Option<&str> {
        self.ctx.as_ref().map(|ctx| ctx.token.as_str())
    }

    /// The delay before this job becomes available.
    pub fn delay(&self) -> u64 {
        self.delay
    }

    /// The job priority.
    pub fn priority(&self) -> u32 {
        self.opts.priority.unwrap_or(0)
    }

    // ── Setters (for internal use) ───────────────────────────────────────

    pub(crate) fn set_id(&mut self, id: String) {
        self.id = id;
    }

    /// Attach a script execution context (set by the worker before processing).
    pub(crate) fn set_context(&mut self, ctx: ScriptContext) {
        self.ctx = Some(ctx);
    }

    // ── Script-backed methods ────────────────────────────────────────────

    /// Update job progress in Redis.
    ///
    /// This calls the updateProgress Lua script which:
    /// - Sets the `progress` field on the job hash
    /// - Publishes a progress event to the event stream
    pub async fn update_progress(&mut self, progress: JobProgress) -> Result<(), Error> {
        let ctx = self
            .ctx
            .as_ref()
            .ok_or_else(|| Error::InvalidConfig("Job has no script context".to_string()))?;

        let script = ctx
            .conn
            .scripts()
            .get("updateProgress")
            .ok_or_else(|| Error::InvalidConfig("updateProgress script not found".to_string()))?
            .clone();

        let job_key = ctx.keys.job_key(&self.id);
        let events_key = ctx.keys.events();
        let meta_key = ctx.keys.meta();

        let progress_json = serde_json::to_string(&progress).unwrap_or_default();

        let keys = vec![job_key, events_key, meta_key];
        let args: Vec<&[u8]> = vec![self.id.as_bytes(), progress_json.as_bytes()];

        let mut redis_conn = ctx.conn.conn();
        let result: redis::Value = script.execute(&mut redis_conn, &keys, &args).await?;

        match result {
            redis::Value::Int(code) if code < 0 => Err(Error::InvalidConfig(format!(
                "updateProgress failed with code {}",
                code
            ))),
            _ => {
                self.progress = progress.clone();
                // Notify the worker about the progress update
                let _ = ctx.progress_tx.send(JobProgressEvent {
                    job_id: self.id.clone(),
                    progress,
                });
                Ok(())
            }
        }
    }

    /// Update job data in Redis.
    pub async fn update_data(&mut self, data: serde_json::Value) -> Result<(), Error> {
        let ctx = self
            .ctx
            .as_ref()
            .ok_or_else(|| Error::InvalidConfig("Job has no script context".to_string()))?;

        let script = ctx
            .conn
            .scripts()
            .get("updateData")
            .ok_or_else(|| Error::InvalidConfig("updateData script not found".to_string()))?
            .clone();

        let job_key = ctx.keys.job_key(&self.id);
        let data_json = serde_json::to_string(&data).unwrap_or_default();

        let keys = vec![job_key];
        let args: Vec<&[u8]> = vec![data_json.as_bytes()];

        let mut redis_conn = ctx.conn.conn();
        let result: redis::Value = script.execute(&mut redis_conn, &keys, &args).await?;

        match result {
            redis::Value::Int(code) if code < 0 => Err(Error::InvalidConfig(format!(
                "updateData failed with code {}",
                code
            ))),
            _ => {
                self.data = data;
                Ok(())
            }
        }
    }

    /// Add a log entry to the job.
    pub async fn log(&self, log_row: &str) -> Result<u64, Error> {
        let ctx = self
            .ctx
            .as_ref()
            .ok_or_else(|| Error::InvalidConfig("Job has no script context".to_string()))?;

        let script = ctx
            .conn
            .scripts()
            .get("addLog")
            .ok_or_else(|| Error::InvalidConfig("addLog script not found".to_string()))?
            .clone();

        let job_key = ctx.keys.job_key(&self.id);
        let logs_key = format!("{}:logs", job_key);

        let keep_logs = match self.opts.keep_logs {
            Some(n) if n > 0 => n.to_string(),
            _ => String::new(),
        };

        let keys = vec![job_key, logs_key];
        let args: Vec<&[u8]> = vec![self.id.as_bytes(), log_row.as_bytes(), keep_logs.as_bytes()];

        let mut redis_conn = ctx.conn.conn();
        let result: redis::Value = script.execute(&mut redis_conn, &keys, &args).await?;

        match result {
            redis::Value::Int(count) => Ok(count as u64),
            _ => Ok(0),
        }
    }

    /// Retry a completed or failed job by moving it back to the wait queue.
    ///
    /// `state` should be `"failed"` or `"completed"`.
    pub async fn retry(&mut self, state: &str, opts: Option<RetryOptions>) -> Result<(), Error> {
        let ctx = self
            .ctx
            .as_ref()
            .ok_or_else(|| Error::InvalidConfig("Job has no script context".to_string()))?;

        let script = ctx
            .conn
            .scripts()
            .get("reprocessJob")
            .ok_or_else(|| Error::InvalidConfig("reprocessJob script not found".to_string()))?
            .clone();

        let retry_opts = opts.unwrap_or_default();

        let job_key = ctx.keys.job_key(&self.id);
        let events_key = ctx.keys.events();
        let state_key = ctx.keys.get(state);
        let wait_key = ctx.keys.wait();
        let meta_key = ctx.keys.meta();
        let paused_key = ctx.keys.paused();
        let active_key = ctx.keys.active();
        let marker_key = ctx.keys.marker();

        let push_cmd = if self.opts.lifo.unwrap_or(false) {
            "RPUSH"
        } else {
            "LPUSH"
        };
        let prop_val = if state == "failed" {
            "failedReason"
        } else {
            "returnvalue"
        };
        let reset_atm = if retry_opts.reset_attempts_made {
            "1"
        } else {
            "0"
        };
        let reset_ats = if retry_opts.reset_attempts_started {
            "1"
        } else {
            "0"
        };

        let keys = vec![
            job_key, events_key, state_key, wait_key, meta_key, paused_key, active_key, marker_key,
        ];
        let args: Vec<&[u8]> = vec![
            self.id.as_bytes(),
            push_cmd.as_bytes(),
            prop_val.as_bytes(),
            state.as_bytes(),
            reset_atm.as_bytes(),
            reset_ats.as_bytes(),
        ];

        let mut redis_conn = ctx.conn.conn();
        let result: redis::Value = script.execute(&mut redis_conn, &keys, &args).await?;

        match result {
            redis::Value::Int(1) => {
                self.failed_reason = String::new();
                self.finished_on = None;
                self.processed_on = None;
                self.returnvalue = String::new();
                if retry_opts.reset_attempts_made {
                    self.attempts_made = 0;
                }
                Ok(())
            }
            redis::Value::Int(code) => Err(Error::InvalidConfig(format!(
                "reprocessJob failed with code {}",
                code
            ))),
            _ => Err(Error::InvalidConfig(
                "reprocessJob: unexpected response".to_string(),
            )),
        }
    }

    /// Get the current state of this job.
    pub async fn get_state(&self) -> Result<JobState, Error> {
        let ctx = self
            .ctx
            .as_ref()
            .ok_or_else(|| Error::InvalidConfig("Job has no script context".to_string()))?;

        let script = ctx
            .conn
            .scripts()
            .get("getState")
            .ok_or_else(|| Error::InvalidConfig("getState script not found".to_string()))?
            .clone();

        let keys = vec![
            ctx.keys.completed(),
            ctx.keys.failed(),
            ctx.keys.delayed(),
            ctx.keys.active(),
            ctx.keys.wait(),
            ctx.keys.paused(),
            ctx.keys.waiting_children(),
            ctx.keys.prioritized(),
        ];

        let job_id_bytes = self.id.as_bytes().to_vec();
        let args: Vec<&[u8]> = vec![&job_id_bytes];

        let mut conn = ctx.conn.conn();
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

    /// Check if the job is completed.
    pub async fn is_completed(&self) -> Result<bool, Error> {
        Ok(self.get_state().await? == JobState::Completed)
    }

    /// Check if the job has failed.
    pub async fn is_failed(&self) -> Result<bool, Error> {
        Ok(self.get_state().await? == JobState::Failed)
    }

    /// Check if the job is active (being processed).
    pub async fn is_active(&self) -> Result<bool, Error> {
        Ok(self.get_state().await? == JobState::Active)
    }

    /// Check if the job is waiting.
    pub async fn is_waiting(&self) -> Result<bool, Error> {
        Ok(self.get_state().await? == JobState::Waiting)
    }

    /// Check if the job is delayed.
    pub async fn is_delayed(&self) -> Result<bool, Error> {
        Ok(self.get_state().await? == JobState::Delayed)
    }

    /// Extend the lock on this job.
    ///
    /// Useful for long-running jobs in manual processing mode to prevent
    /// the job from being considered stalled.
    pub async fn extend_lock(&self, token: &str, duration: u64) -> Result<(), Error> {
        let ctx = self
            .ctx
            .as_ref()
            .ok_or_else(|| Error::InvalidConfig("Job has no script context".to_string()))?;

        let script = ctx
            .conn
            .scripts()
            .get("extendLock")
            .ok_or_else(|| Error::InvalidConfig("extendLock script not found".to_string()))?
            .clone();

        let job_key = ctx.keys.job_key(&self.id);
        let lock_key = format!("{}:lock", job_key);
        let stalled_key = ctx.keys.stalled();

        let script_keys = vec![lock_key, stalled_key];
        let dur_str = duration.to_string();
        let args: Vec<&[u8]> = vec![token.as_bytes(), dur_str.as_bytes(), self.id.as_bytes()];

        let mut conn = ctx.conn.conn();
        let result = script.execute(&mut conn, &script_keys, &args).await?;

        match result {
            redis::Value::Int(1) => Ok(()),
            _ => Err(Error::JobLocked(format!(
                "could not extend lock for job {}",
                self.id
            ))),
        }
    }

    /// Promote a delayed job to the waiting state immediately.
    pub async fn promote(&self) -> Result<(), Error> {
        let ctx = self
            .ctx
            .as_ref()
            .ok_or_else(|| Error::InvalidConfig("Job has no script context".to_string()))?;

        let script = ctx
            .conn
            .scripts()
            .get("promote")
            .ok_or_else(|| Error::InvalidConfig("promote script not found".to_string()))?
            .clone();

        let keys = &ctx.keys;
        let script_keys = vec![
            keys.delayed(),
            keys.wait(),
            keys.paused(),
            keys.meta(),
            keys.prioritized(),
            keys.active(),
            keys.pc(),
            keys.events(),
            keys.marker(),
        ];

        let prefix = keys.key_prefix();
        let args: Vec<&[u8]> = vec![prefix.as_bytes(), self.id.as_bytes()];

        let mut conn = ctx.conn.conn();
        let result = script.execute(&mut conn, &script_keys, &args).await?;

        match result {
            redis::Value::Int(code) if code < 0 => Err(Error::from_script_code(code)),
            _ => Ok(()),
        }
    }

    /// Change the delay of a delayed job.
    ///
    /// `delay` is the new delay in milliseconds from now.
    pub async fn change_delay(&self, delay: u64) -> Result<(), Error> {
        let ctx = self
            .ctx
            .as_ref()
            .ok_or_else(|| Error::InvalidConfig("Job has no script context".to_string()))?;

        let script = ctx
            .conn
            .scripts()
            .get("changeDelay")
            .ok_or_else(|| Error::InvalidConfig("changeDelay script not found".to_string()))?
            .clone();

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let keys = &ctx.keys;
        let job_key = keys.job_key(&self.id);
        let script_keys = vec![keys.delayed(), keys.meta(), keys.marker(), keys.events()];

        let delay_str = delay.to_string();
        let now_str = now.to_string();
        let args: Vec<&[u8]> = vec![
            delay_str.as_bytes(),
            now_str.as_bytes(),
            self.id.as_bytes(),
            job_key.as_bytes(),
        ];

        let mut conn = ctx.conn.conn();
        let result = script.execute(&mut conn, &script_keys, &args).await?;

        match result {
            redis::Value::Int(code) if code < 0 => Err(Error::from_script_code(code)),
            _ => Ok(()),
        }
    }

    /// Change the priority of a waiting job.
    ///
    /// `priority` - New priority value (0 = no priority).
    /// `lifo` - If true, use LIFO ordering within the same priority.
    pub async fn change_priority(&self, priority: u32, lifo: bool) -> Result<(), Error> {
        let ctx = self
            .ctx
            .as_ref()
            .ok_or_else(|| Error::InvalidConfig("Job has no script context".to_string()))?;

        let script = ctx
            .conn
            .scripts()
            .get("changePriority")
            .ok_or_else(|| Error::InvalidConfig("changePriority script not found".to_string()))?
            .clone();

        let keys = &ctx.keys;
        let script_keys = vec![
            keys.wait(),
            keys.paused(),
            keys.meta(),
            keys.prioritized(),
            keys.active(),
            keys.pc(),
            keys.marker(),
        ];

        let priority_str = priority.to_string();
        let prefix = keys.key_prefix();
        let lifo_str = if lifo { "1" } else { "0" };
        let args: Vec<&[u8]> = vec![
            priority_str.as_bytes(),
            prefix.as_bytes(),
            self.id.as_bytes(),
            lifo_str.as_bytes(),
        ];

        let mut conn = ctx.conn.conn();
        let result = script.execute(&mut conn, &script_keys, &args).await?;

        match result {
            redis::Value::Int(code) if code < 0 => Err(Error::from_script_code(code)),
            _ => Ok(()),
        }
    }

    /// Move the job to completed state (manual processing).
    ///
    /// Used when processing jobs manually via `worker.get_next_job()`.
    pub async fn move_to_completed(
        &mut self,
        return_value: &str,
        token: &str,
    ) -> Result<(), Error> {
        self.move_to_finished("completed", return_value, token)
            .await
    }

    /// Move the job to failed state (manual processing).
    ///
    /// Used when processing jobs manually via `worker.get_next_job()`.
    pub async fn move_to_failed(&mut self, error: &str, token: &str) -> Result<(), Error> {
        self.move_to_finished("failed", error, token).await
    }

    /// Internal: move job to completed or failed.
    async fn move_to_finished(
        &mut self,
        target: &str,
        value: &str,
        token: &str,
    ) -> Result<(), Error> {
        let ctx = self
            .ctx
            .as_ref()
            .ok_or_else(|| Error::InvalidConfig("Job has no script context".to_string()))?;

        let script = ctx
            .conn
            .scripts()
            .get("moveToFinished")
            .ok_or_else(|| Error::InvalidConfig("moveToFinished script not found".to_string()))?
            .clone();

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let keys = &ctx.keys;

        // Base keys (same order as worker)
        let wait = keys.wait();
        let active = keys.active();
        let prioritized = keys.prioritized();
        let events = keys.events();
        let stalled = keys.stalled();
        let limiter = keys.limiter();
        let delayed = keys.delayed();
        let paused = keys.paused();
        let meta = keys.meta();
        let pc = keys.pc();

        let target_set = if target == "completed" {
            keys.completed()
        } else {
            keys.failed()
        };
        let job_key = keys.job_key(&self.id);
        let metrics_key = if target == "completed" {
            keys.get("metrics:completed")
        } else {
            keys.get("metrics:failed")
        };
        let marker = keys.marker();

        let script_keys: Vec<&str> = vec![
            &wait,        // KEYS[1]
            &active,      // KEYS[2]
            &prioritized, // KEYS[3]
            &events,      // KEYS[4]
            &stalled,     // KEYS[5]
            &limiter,     // KEYS[6]
            &delayed,     // KEYS[7]
            &paused,      // KEYS[8]
            &meta,        // KEYS[9]
            &pc,          // KEYS[10]
            &target_set,  // KEYS[11]
            &job_key,     // KEYS[12]
            &metrics_key, // KEYS[13]
            &marker,      // KEYS[14]
        ];

        let (field_name, field_value): (&[u8], &[u8]) = if target == "completed" {
            (b"returnvalue", value.as_bytes())
        } else {
            (b"failedReason", value.as_bytes())
        };

        // Pack opts
        use rmp::encode::{write_bool, write_map_len, write_sint, write_str, write_uint};
        let mut opts_buf: Vec<u8> = Vec::with_capacity(128);
        write_map_len(&mut opts_buf, 9).unwrap();
        write_str(&mut opts_buf, "token").unwrap();
        write_str(&mut opts_buf, token).unwrap();
        write_str(&mut opts_buf, "keepJobs").unwrap();
        // Keep all jobs (count=-1 means don't remove)
        write_map_len(&mut opts_buf, 1).unwrap();
        write_str(&mut opts_buf, "count").unwrap();
        write_sint(&mut opts_buf, -1).unwrap();
        write_str(&mut opts_buf, "lockDuration").unwrap();
        write_uint(&mut opts_buf, ctx.lock_duration).unwrap();
        write_str(&mut opts_buf, "attempts").unwrap();
        write_uint(&mut opts_buf, self.attempts_made as u64 + 1).unwrap();
        write_str(&mut opts_buf, "maxMetricsSize").unwrap();
        write_str(&mut opts_buf, "").unwrap();
        for key in ["fpof", "cpof", "idof", "rdof"] {
            write_str(&mut opts_buf, key).unwrap();
            write_bool(&mut opts_buf, false).unwrap();
        }

        let job_id_bytes = self.id.as_bytes();
        let now_bytes = now.to_string().into_bytes();
        let prefix = keys.key_prefix();
        let fields_to_update: Vec<u8> = Vec::new();
        let args: Vec<&[u8]> = vec![
            job_id_bytes,
            &now_bytes,
            field_name,
            field_value,
            target.as_bytes(),
            b"0",
            prefix.as_bytes(),
            &opts_buf,
            &fields_to_update,
        ];

        let mut conn = ctx.conn.conn();
        let result = script.execute(&mut conn, &script_keys, &args).await?;

        match result {
            redis::Value::Int(code) if code < 0 => Err(Error::from_script_code(code)),
            _ => {
                self.attempts_made += 1;
                if target == "completed" {
                    self.returnvalue = value.to_string();
                }
                Ok(())
            }
        }
    }

    /// Move the job to delayed state.
    ///
    /// This should be called from within a processor, followed by
    /// returning `Err(Error::Delayed)` to signal the worker not to
    /// move the job to completed/failed.
    ///
    /// `timestamp` is the Unix timestamp (in ms) when the job should
    /// become available again.
    pub async fn move_to_delayed(&self, timestamp: u64) -> Result<(), Error> {
        let ctx = self
            .ctx
            .as_ref()
            .ok_or_else(|| Error::InvalidConfig("Job has no script context".to_string()))?;

        let script = ctx
            .conn
            .scripts()
            .get("moveToDelayed")
            .ok_or_else(|| Error::InvalidConfig("moveToDelayed script not found".to_string()))?
            .clone();

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let delay = timestamp.saturating_sub(now);

        let job_key = ctx.keys.job_key(&self.id);
        let marker = ctx.keys.marker();
        let active = ctx.keys.active();
        let prioritized = ctx.keys.prioritized();
        let delayed = ctx.keys.delayed();
        let events = ctx.keys.events();
        let meta = ctx.keys.meta();
        let stalled = ctx.keys.stalled();
        let wait = ctx.keys.wait();
        let limiter = ctx.keys.limiter();
        let paused = ctx.keys.paused();
        let pc = ctx.keys.pc();

        let script_keys: Vec<&str> = vec![
            &marker,      // KEYS[1]
            &active,      // KEYS[2]
            &prioritized, // KEYS[3]
            &delayed,     // KEYS[4]
            &job_key,     // KEYS[5]
            &events,      // KEYS[6]
            &meta,        // KEYS[7]
            &stalled,     // KEYS[8]
            &wait,        // KEYS[9]
            &limiter,     // KEYS[10]
            &paused,      // KEYS[11]
            &pc,          // KEYS[12]
        ];

        let prefix = ctx.keys.key_prefix();
        let now_str = now.to_string();
        let delay_str = delay.to_string();
        let skip_attempt = b"1"; // Skip attempt increment (like Node.js moveToDelayed)
        let fields_to_update: Vec<u8> = Vec::new();
        let fetch_next = b"0";

        // Pack minimal opts (script requires it but we just need token and lockDuration)
        let mut opts_buf: Vec<u8> = Vec::new();
        use rmp::encode::{write_map_len, write_str, write_uint};
        write_map_len(&mut opts_buf, 2).unwrap();
        write_str(&mut opts_buf, "token").unwrap();
        write_str(&mut opts_buf, &ctx.token).unwrap();
        write_str(&mut opts_buf, "lockDuration").unwrap();
        write_uint(&mut opts_buf, ctx.lock_duration).unwrap();

        let args: Vec<&[u8]> = vec![
            prefix.as_bytes(),    // ARGV[1]
            now_str.as_bytes(),   // ARGV[2]
            self.id.as_bytes(),   // ARGV[3]
            ctx.token.as_bytes(), // ARGV[4]
            delay_str.as_bytes(), // ARGV[5]
            skip_attempt,         // ARGV[6]
            &fields_to_update,    // ARGV[7]
            fetch_next,           // ARGV[8]
            &opts_buf,            // ARGV[9]
        ];

        let mut conn = ctx.conn.conn();
        let result = script.execute(&mut conn, &script_keys, &args).await?;

        match result {
            redis::Value::Int(code) if code < 0 => Err(Error::from_script_code(code)),
            _ => Ok(()),
        }
    }

    // ── Redis serialization ──────────────────────────────────────────────

    /// Serialize this job to a flat list of (field, value) pairs for HSET.
    pub fn to_redis_hash(&self) -> Vec<(String, String)> {
        let mut fields = Vec::with_capacity(16);

        fields.push(("name".to_string(), self.name.clone()));
        fields.push((
            "data".to_string(),
            serde_json::to_string(&self.data).unwrap_or_default(),
        ));
        fields.push((
            "opts".to_string(),
            serde_json::to_string(&self.opts).unwrap_or_default(),
        ));
        fields.push(("timestamp".to_string(), self.timestamp.to_string()));
        fields.push(("delay".to_string(), self.delay().to_string()));
        fields.push(("priority".to_string(), self.priority().to_string()));
        fields.push(("atm".to_string(), self.attempts_made.to_string()));
        fields.push(("ats".to_string(), self.attempts_started.to_string()));
        fields.push(("stc".to_string(), self.stalled_counter.to_string()));

        if let Ok(progress_str) = serde_json::to_string(&self.progress) {
            fields.push(("progress".to_string(), progress_str));
        }

        if let Some(ref parent) = self.parent {
            if let Ok(parent_str) = serde_json::to_string(parent) {
                fields.push(("parent".to_string(), parent_str));
            }
        }

        if let Some(ref parent_key) = self.parent_key {
            fields.push(("parentKey".to_string(), parent_key.clone()));
        }

        if let Some(ref dedup_id) = self.opts.deduplication_id {
            fields.push(("deid".to_string(), dedup_id.clone()));
        }

        fields
    }

    /// Deserialize a job from Redis hash fields.
    pub fn from_redis_hash(id: &str, fields: &HashMap<String, String>) -> Result<Self, Error> {
        let name = fields.get("name").cloned().unwrap_or_default();
        let data: serde_json::Value = fields
            .get("data")
            .and_then(|d| serde_json::from_str(d).ok())
            .unwrap_or(serde_json::Value::Null);
        let opts: JobOptions = fields
            .get("opts")
            .and_then(|o| serde_json::from_str(o).ok())
            .unwrap_or_default();
        let progress: JobProgress = fields
            .get("progress")
            .and_then(|p| serde_json::from_str(p).ok())
            .unwrap_or_default();
        let timestamp: u64 = fields
            .get("timestamp")
            .and_then(|t| t.parse().ok())
            .unwrap_or(0);
        let attempts_made: u32 = fields.get("atm").and_then(|a| a.parse().ok()).unwrap_or(0);
        let attempts_started: u32 = fields.get("ats").and_then(|a| a.parse().ok()).unwrap_or(0);
        let processed_on: Option<u64> = fields.get("processedOn").and_then(|t| t.parse().ok());
        let finished_on: Option<u64> = fields.get("finishedOn").and_then(|t| t.parse().ok());
        let failed_reason = fields.get("failedReason").cloned().unwrap_or_default();
        let stacktrace = fields.get("stacktrace").cloned().unwrap_or_default();
        let returnvalue = fields.get("returnvalue").cloned().unwrap_or_default();
        let parent: Option<ParentKeys> = fields
            .get("parent")
            .and_then(|p| serde_json::from_str(p).ok());
        let parent_key = fields.get("parentKey").cloned();
        let processed_by = fields.get("pb").cloned();
        let stalled_counter: u32 = fields.get("stc").and_then(|s| s.parse().ok()).unwrap_or(0);
        let delay: u64 = fields
            .get("delay")
            .and_then(|d| d.parse().ok())
            .unwrap_or_else(|| opts.delay.unwrap_or(0));

        Ok(Self {
            id: id.to_string(),
            name,
            data,
            opts,
            progress,
            attempts_made,
            attempts_started,
            timestamp,
            processed_on,
            finished_on,
            failed_reason,
            stacktrace,
            returnvalue,
            parent,
            parent_key,
            processed_by,
            stalled_counter,
            delay,
            ctx: None,
        })
    }

    /// Fetch a job from Redis by ID.
    pub async fn from_id(
        conn: &RedisConnection,
        keys: &QueueKeys,
        job_id: &str,
    ) -> Result<Option<Self>, Error> {
        let job_key = keys.job_key(job_id);
        let mut redis_conn = conn.conn();
        let fields: HashMap<String, String> = redis::cmd("HGETALL")
            .arg(&job_key)
            .query_async(&mut redis_conn)
            .await?;

        if fields.is_empty() {
            return Ok(None);
        }

        Ok(Some(Self::from_redis_hash(job_id, &fields)?))
    }
}
