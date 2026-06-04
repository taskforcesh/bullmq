use serde::{Deserialize, Serialize};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use crate::types::{BackoffStrategy, KeepJobs, RemoveOnFinish};

/// Repeat options stored within a job's options (parsed from Redis).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepeatJobOptions {
    /// Cron pattern.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,

    /// Repeat every N milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub every: Option<u64>,

    /// Current iteration count.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u64>,

    /// Offset in ms.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<u64>,

    /// Start date (Unix timestamp in ms).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<u64>,

    /// End date (Unix timestamp in ms).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<u64>,

    /// IANA timezone string.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tz: Option<String>,

    /// Maximum iterations before stopping.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
}

/// Custom backoff strategy function type.
///
/// Arguments: (attempts_made, backoff_type, error_message, job_data)
/// Returns: delay in ms, or -1 to not retry.
pub type BackoffStrategyFn = Arc<
    dyn Fn(u32, &str, &str, &serde_json::Value) -> Pin<Box<dyn Future<Output = i64> + Send>>
        + Send
        + Sync,
>;

/// Options for connecting to Redis.
#[derive(Debug, Clone)]
pub struct RedisConnectionOptions {
    /// Redis connection URL (e.g., `redis://127.0.0.1:6379`).
    pub url: String,
    /// Maximum number of connections in the pool.
    pub max_connections: usize,
}

impl Default for RedisConnectionOptions {
    fn default() -> Self {
        Self {
            url: "redis://127.0.0.1:6379".to_string(),
            max_connections: 4,
        }
    }
}

/// Options for creating a Queue.
#[derive(Debug, Clone)]
pub struct QueueOptions {
    /// Redis connection configuration.
    pub connection: RedisConnectionOptions,
    /// Key prefix for all queue keys.
    pub prefix: String,
    /// Default job options applied to all jobs added to this queue.
    pub default_job_options: JobOptions,
    /// Skip Redis version validation.
    pub skip_version_check: bool,
}

impl Default for QueueOptions {
    fn default() -> Self {
        Self {
            connection: RedisConnectionOptions::default(),
            prefix: "bull".to_string(),
            default_job_options: JobOptions::default(),
            skip_version_check: false,
        }
    }
}

/// Options for creating a Worker.
#[derive(Clone)]
pub struct WorkerOptions {
    /// Redis connection configuration.
    pub connection: RedisConnectionOptions,
    /// Key prefix for all queue keys.
    pub prefix: String,
    /// Optional worker name (stored on processed jobs).
    pub name: Option<String>,
    /// Number of jobs processed concurrently.
    pub concurrency: usize,
    /// Lock duration in milliseconds.
    pub lock_duration: u64,
    /// Lock renewal interval in milliseconds (defaults to lock_duration / 2).
    pub lock_renew_time: Option<u64>,
    /// Maximum number of times a stalled job is re-queued before failing.
    pub max_stalled_count: u32,
    /// Interval in milliseconds between stalled job checks.
    pub stalled_interval: u64,
    /// Delay in seconds when the queue is drained (no jobs available).
    pub drain_delay: u64,
    /// Whether to start processing automatically.
    pub autorun: bool,
    /// Skip Redis version validation.
    pub skip_version_check: bool,
    /// Remove completed jobs according to this policy.
    pub remove_on_complete: Option<RemoveOnFinish>,
    /// Remove failed jobs according to this policy.
    pub remove_on_fail: Option<RemoveOnFinish>,
    /// Delay in milliseconds before retrying after a transient error.
    pub run_retry_delay: u64,
    /// Custom backoff strategy function for job retries.
    pub backoff_strategy: Option<BackoffStrategyFn>,
    /// Rate limiter options (max jobs per duration window).
    pub limiter: Option<RateLimiterOptions>,
    /// Maximum delay in ms to wait when rate limited (default 30_000).
    pub maximum_rate_limit_delay: u64,
}

impl Default for WorkerOptions {
    fn default() -> Self {
        Self {
            connection: RedisConnectionOptions::default(),
            prefix: "bull".to_string(),
            name: None,
            concurrency: 1,
            lock_duration: 30_000,
            lock_renew_time: None,
            max_stalled_count: 1,
            stalled_interval: 30_000,
            drain_delay: 5,
            autorun: true,
            skip_version_check: false,
            remove_on_complete: None,
            remove_on_fail: None,
            run_retry_delay: 15_000,
            backoff_strategy: None,
            limiter: None,
            maximum_rate_limit_delay: 30_000,
        }
    }
}

impl std::fmt::Debug for WorkerOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkerOptions")
            .field("concurrency", &self.concurrency)
            .field("lock_duration", &self.lock_duration)
            .field("drain_delay", &self.drain_delay)
            .field("autorun", &self.autorun)
            .field("backoff_strategy", &self.backoff_strategy.is_some())
            .finish_non_exhaustive()
    }
}

impl WorkerOptions {
    /// Effective lock renewal time.
    pub fn effective_lock_renew_time(&self) -> u64 {
        self.lock_renew_time
            .unwrap_or(self.lock_duration / 2)
            .max(1)
    }
}

/// Options for a job.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobOptions {
    /// Delay before the job becomes available (milliseconds).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay: Option<u64>,

    /// Job priority (0 = highest, 2_097_152 = lowest).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<u32>,

    /// Total number of attempts before the job permanently fails.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempts: Option<u32>,

    /// Backoff strategy for retries.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backoff: Option<BackoffStrategy>,

    /// If true, adds job to the right (end) of the queue (LIFO).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifo: Option<bool>,

    /// Remove-on-complete policy.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remove_on_complete: Option<RemoveOnFinish>,

    /// Remove-on-fail policy.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remove_on_fail: Option<RemoveOnFinish>,

    /// Maximum log entries to keep.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_logs: Option<u32>,

    /// Override the job ID (must be unique).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,

    /// Timestamp for the job (defaults to now).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<u64>,

    /// Maximum stack trace lines to store.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack_trace_limit: Option<u32>,

    /// Parent job information.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<ParentOpts>,

    /// Deduplication options.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "de", alias = "deduplication")]
    pub deduplication: Option<DeduplicationOptions>,

    /// Repeat options (present on jobs produced by schedulers).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat: Option<RepeatJobOptions>,

    /// Previous millis timestamp (used by scheduler iteration).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prev_millis: Option<u64>,

    /// Repeat job key (scheduler ID).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat_job_key: Option<String>,
}

/// Parent job options (for flow/dependency chains).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParentOpts {
    /// Parent queue name.
    pub queue: String,
    /// Parent job ID.
    pub id: String,
    /// Whether to wait for this child before processing the parent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wait_children: Option<bool>,
}

/// Options for the KeepJobs policy when serialized to Redis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisKeepJobs {
    /// Maximum age in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub age: Option<u64>,
    /// Maximum count of jobs to keep.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<usize>,
}

impl From<KeepJobs> for RedisKeepJobs {
    fn from(k: KeepJobs) -> Self {
        Self {
            age: k.age,
            count: k.count,
        }
    }
}

/// Deduplication options for a job.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeduplicationOptions {
    /// Unique deduplication identifier.
    pub id: String,

    /// TTL in milliseconds for the dedup key.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl: Option<u64>,

    /// Whether to extend the TTL on duplicate.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extend: Option<bool>,

    /// Replace the existing delayed job with the new one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replace: Option<bool>,

    /// If true, store new job data when the deduplicated job is active,
    /// and create a new job automatically when the active one finishes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_last_if_active: Option<bool>,
}

/// Rate limiter options for the worker.
#[derive(Debug, Clone)]
pub struct RateLimiterOptions {
    /// Maximum number of jobs processed within the duration window.
    pub max: u64,
    /// Duration of the rate limit window in milliseconds.
    pub duration: u64,
}
