use serde::{Deserialize, Serialize};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
#[derive(Clone)]
pub struct RedisConnectionOptions {
    /// Redis connection URL (e.g., `redis://127.0.0.1:6379`).
    ///
    /// Used when [`host`](Self::host) is not set. For TLS, use a `rediss://`
    /// URL (requires the crate to be built with TLS support, which is enabled
    /// by default).
    pub url: String,
    /// Maximum number of connections in the pool.
    pub max_connections: usize,
    /// Redis host. When set, the connection URL is built from the typed fields
    /// below instead of [`url`](Self::url).
    pub host: Option<String>,
    /// Redis port (defaults to `6379` when [`host`](Self::host) is set).
    pub port: Option<u16>,
    /// Username for ACL authentication.
    pub username: Option<String>,
    /// Password for authentication.
    pub password: Option<String>,
    /// Database index to select.
    pub db: Option<u8>,
    /// Whether to connect over TLS (uses the `rediss://` scheme).
    pub tls: bool,
}

pub(crate) fn redact_url_userinfo(url: &str) -> String {
    let Some((scheme, rest)) = url.split_once("://") else {
        return url.to_string();
    };

    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];

    let Some(at_pos) = authority.rfind('@') else {
        return url.to_string();
    };

    let host_part = &authority[at_pos + 1..];
    let suffix = &rest[authority_end..];
    format!("{}://***@{}{}", scheme, host_part, suffix)
}

impl Default for RedisConnectionOptions {
    fn default() -> Self {
        Self {
            url: "redis://127.0.0.1:6379".to_string(),
            max_connections: 4,
            host: None,
            port: None,
            username: None,
            password: None,
            db: None,
            tls: false,
        }
    }
}

impl RedisConnectionOptions {
    /// Build the effective connection URL.
    ///
    /// When [`host`](Self::host) is set, a URL is constructed from the typed
    /// fields (`scheme://[user][:pass]@host:port[/db]`); otherwise
    /// [`url`](Self::url) is returned as-is.
    pub fn effective_url(&self) -> String {
        let Some(host) = &self.host else {
            return self.url.clone();
        };

        let scheme = if self.tls { "rediss" } else { "redis" };
        let encoded_username = self
            .username
            .as_deref()
            .map(Self::encode_userinfo_component);
        let encoded_password = self
            .password
            .as_deref()
            .map(Self::encode_userinfo_component);
        let auth = match (&self.username, &self.password) {
            (Some(_), Some(_)) => format!(
                "{}:{}@",
                encoded_username.as_deref().unwrap_or(""),
                encoded_password.as_deref().unwrap_or("")
            ),
            (None, Some(_)) => format!(":{}@", encoded_password.as_deref().unwrap_or("")),
            (Some(_), None) => format!("{}@", encoded_username.as_deref().unwrap_or("")),
            (None, None) => String::new(),
        };
        let port = self.port.unwrap_or(6379);
        let db = self.db.map(|d| format!("/{}", d)).unwrap_or_default();
        let host = Self::normalize_host_for_url(host);
        format!("{}://{}{}:{}{}", scheme, auth, host, port, db)
    }

    fn normalize_host_for_url(host: &str) -> String {
        // Bracket IPv6 host literals so host:port parsing is unambiguous.
        if host.contains(':') && !(host.starts_with('[') && host.ends_with(']')) {
            format!("[{}]", host)
        } else {
            host.to_string()
        }
    }

    fn encode_userinfo_component(input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        for b in input.bytes() {
            if Self::is_unreserved_userinfo_byte(b) {
                out.push(b as char);
            } else {
                out.push('%');
                out.push(Self::hex_upper((b >> 4) & 0x0F));
                out.push(Self::hex_upper(b & 0x0F));
            }
        }
        out
    }

    fn is_unreserved_userinfo_byte(b: u8) -> bool {
        b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~')
    }

    fn hex_upper(nibble: u8) -> char {
        match nibble {
            0..=9 => (b'0' + nibble) as char,
            10..=15 => (b'A' + (nibble - 10)) as char,
            _ => unreachable!("hex nibble out of range"),
        }
    }
}

impl std::fmt::Debug for RedisConnectionOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let redacted_url = redact_url_userinfo(&self.url);
        let redacted_username = self.username.as_ref().map(|_| "***");
        let redacted_password = self.password.as_ref().map(|_| "***");

        f.debug_struct("RedisConnectionOptions")
            .field("url", &redacted_url)
            .field("max_connections", &self.max_connections)
            .field("host", &self.host)
            .field("port", &self.port)
            .field("username", &redacted_username)
            .field("password", &redacted_password)
            .field("db", &self.db)
            .field("tls", &self.tls)
            .finish()
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

impl QueueOptions {
    /// Create default queue options.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the Redis connection configuration.
    pub fn connection(mut self, connection: RedisConnectionOptions) -> Self {
        self.connection = connection;
        self
    }

    /// Set the key prefix for all queue keys.
    pub fn prefix(mut self, prefix: impl Into<String>) -> Self {
        self.prefix = prefix.into();
        self
    }

    /// Set the default job options merged into every job added to this queue.
    ///
    /// Only `attempts`, `backoff`, `remove_on_complete`, `remove_on_fail`,
    /// `delay`, `priority`, and `lifo` are applied as queue-level defaults.
    pub fn default_job_options(mut self, options: JobOptions) -> Self {
        self.default_job_options = options;
        self
    }

    /// Skip the Redis server version compatibility check on startup.
    pub fn skip_version_check(mut self) -> Self {
        self.skip_version_check = true;
        self
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
    /// Maximum number of times a job may *start* processing (regardless of
    /// completion/failure) before it is moved to `failed` with an
    /// unrecoverable error. Each pickup increments the job's `attemptsStarted`
    /// counter. `None` disables the check. Mirrors Node.js `maxStartedAttempts`.
    pub max_started_attempts: Option<u32>,
    /// Skip the stalled-job check for this worker. Other workers may still
    /// perform stalled checks. Mirrors Node.js `skipStalledCheck`.
    pub skip_stalled_check: bool,
    /// Skip lock renewal for this worker. When `true`, locks expire after
    /// `lock_duration` and the job is moved back to wait (if the stalled check
    /// is not also disabled). Mirrors Node.js `skipLockRenewal`.
    pub skip_lock_renewal: bool,
    /// Time-series metrics collection. When set, the worker records
    /// completed/failed counts per minute, readable via `Queue::get_metrics`.
    pub metrics: Option<MetricsOptions>,
}

/// Configuration for time-series metrics collection.
#[derive(Debug, Clone)]
pub struct MetricsOptions {
    /// Maximum number of per-minute data points to keep (older points are
    /// trimmed). One data point covers one minute, so 2 weeks ≈ `2 * 7 * 24 * 60`.
    pub max_data_points: usize,
}

impl Default for MetricsOptions {
    fn default() -> Self {
        // Two weeks of minute-resolution data points.
        Self {
            max_data_points: 2 * 7 * 24 * 60,
        }
    }
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
            metrics: None,
            max_started_attempts: None,
            skip_stalled_check: false,
            skip_lock_renewal: false,
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
    /// Create default worker options.
    ///
    /// ```
    /// use std::time::Duration;
    /// use bullmq::{RateLimiterOptions, WorkerOptions};
    ///
    /// let opts = WorkerOptions::new()
    ///     .concurrency(8)
    ///     .lock_duration(Duration::from_secs(30))
    ///     .limiter(RateLimiterOptions::new(100, Duration::from_secs(1)))
    ///     .manual_start();
    /// assert_eq!(opts.concurrency, 8);
    /// assert_eq!(opts.lock_duration, 30_000);
    /// assert!(!opts.autorun);
    /// ```
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the Redis connection configuration.
    pub fn connection(mut self, connection: RedisConnectionOptions) -> Self {
        self.connection = connection;
        self
    }

    /// Set the key prefix for all queue keys.
    pub fn prefix(mut self, prefix: impl Into<String>) -> Self {
        self.prefix = prefix.into();
        self
    }

    /// Set the worker name (stored on processed jobs).
    pub fn name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    /// Set how many jobs are processed concurrently.
    pub fn concurrency(mut self, concurrency: usize) -> Self {
        self.concurrency = concurrency;
        self
    }

    /// Set the job lock duration.
    pub fn lock_duration(mut self, duration: Duration) -> Self {
        self.lock_duration = duration_to_millis(duration);
        self
    }

    /// Set the lock renewal interval (defaults to half the lock duration).
    pub fn lock_renew_time(mut self, duration: Duration) -> Self {
        self.lock_renew_time = Some(duration_to_millis(duration));
        self
    }

    /// Set the maximum number of times a stalled job is re-queued before failing.
    pub fn max_stalled_count(mut self, count: u32) -> Self {
        self.max_stalled_count = count;
        self
    }

    /// Set the interval between stalled-job checks.
    pub fn stalled_interval(mut self, duration: Duration) -> Self {
        self.stalled_interval = duration_to_millis(duration);
        self
    }

    /// Set the delay applied when the queue is drained (no jobs available).
    ///
    /// Resolution is whole seconds.
    pub fn drain_delay(mut self, duration: Duration) -> Self {
        self.drain_delay = duration.as_secs();
        self
    }

    /// Set whether processing starts automatically (defaults to `true`).
    pub fn autorun(mut self, autorun: bool) -> Self {
        self.autorun = autorun;
        self
    }

    /// Do not start processing automatically; the worker must be started manually.
    pub fn manual_start(mut self) -> Self {
        self.autorun = false;
        self
    }

    /// Skip the Redis server version compatibility check on startup.
    pub fn skip_version_check(mut self) -> Self {
        self.skip_version_check = true;
        self
    }

    /// Set the completed-job retention policy.
    pub fn remove_on_complete(mut self, policy: RemoveOnFinish) -> Self {
        self.remove_on_complete = Some(policy);
        self
    }

    /// Set the failed-job retention policy.
    pub fn remove_on_fail(mut self, policy: RemoveOnFinish) -> Self {
        self.remove_on_fail = Some(policy);
        self
    }

    /// Set the delay before retrying after a transient processing error.
    pub fn run_retry_delay(mut self, duration: Duration) -> Self {
        self.run_retry_delay = duration_to_millis(duration);
        self
    }

    /// Enable rate limiting (maximum jobs per window).
    pub fn limiter(mut self, limiter: RateLimiterOptions) -> Self {
        self.limiter = Some(limiter);
        self
    }

    /// Set the maximum time to wait when rate limited.
    pub fn maximum_rate_limit_delay(mut self, duration: Duration) -> Self {
        self.maximum_rate_limit_delay = duration_to_millis(duration);
        self
    }

    /// Limit how many times a job may start processing before it is failed.
    pub fn max_started_attempts(mut self, attempts: u32) -> Self {
        self.max_started_attempts = Some(attempts);
        self
    }

    /// Skip the stalled-job check for this worker.
    pub fn skip_stalled_check(mut self) -> Self {
        self.skip_stalled_check = true;
        self
    }

    /// Skip lock renewal for this worker.
    pub fn skip_lock_renewal(mut self) -> Self {
        self.skip_lock_renewal = true;
        self
    }

    /// Enable time-series metrics collection.
    pub fn metrics(mut self, metrics: MetricsOptions) -> Self {
        self.metrics = Some(metrics);
        self
    }

    /// Set a custom backoff-strategy function used to compute retry delays.
    pub fn backoff_strategy(mut self, strategy: BackoffStrategyFn) -> Self {
        self.backoff_strategy = Some(strategy);
        self
    }

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
    pub parent: Option<ParentOptions>,

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

    /// If true, the parent job will fail when this child fails.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fail_parent_on_failure: Option<bool>,

    /// If true, the dependency on this child is ignored when it fails.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignore_dependency_on_failure: Option<bool>,

    /// If true, the dependency on this child is removed when it fails.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remove_dependency_on_failure: Option<bool>,

    /// If true, the parent continues processing even if this child fails.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continue_parent_on_failure: Option<bool>,

    /// Reject the job if its serialized (JSON) data exceeds this many UTF-8
    /// bytes. Enforced client-side when the job is added. Mirrors Node.js
    /// `sizeLimit`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_limit: Option<usize>,
}

impl JobOptions {
    /// Create an empty set of job options.
    ///
    /// Every field is unset; use the chainable setters below to configure only
    /// what you need. Fields are public, so a struct literal with
    /// `..Default::default()` works equally well.
    ///
    /// ```
    /// use std::time::Duration;
    /// use bullmq::JobOptions;
    ///
    /// let opts = JobOptions::new()
    ///     .delay(Duration::from_secs(30))
    ///     .attempts(3)
    ///     .priority(5);
    /// assert_eq!(opts.delay, Some(30_000));
    /// assert_eq!(opts.attempts, Some(3));
    /// ```
    pub fn new() -> Self {
        Self::default()
    }

    /// Delay before the job becomes available for processing.
    pub fn delay(mut self, delay: Duration) -> Self {
        self.delay = Some(duration_to_millis(delay));
        self
    }

    /// Job priority. Lower values are processed first; unset (or `0`) means the
    /// job is not prioritized and follows normal FIFO/LIFO ordering.
    pub fn priority(mut self, priority: u32) -> Self {
        self.priority = Some(priority);
        self
    }

    /// Total number of attempts before the job permanently fails.
    pub fn attempts(mut self, attempts: u32) -> Self {
        self.attempts = Some(attempts);
        self
    }

    /// Backoff strategy applied between retries.
    pub fn backoff(mut self, backoff: BackoffStrategy) -> Self {
        self.backoff = Some(backoff);
        self
    }

    /// Add the job to the back of the queue (last-in-first-out ordering).
    pub fn lifo(mut self) -> Self {
        self.lifo = Some(true);
        self
    }

    /// Completed-job retention policy.
    pub fn remove_on_complete(mut self, policy: RemoveOnFinish) -> Self {
        self.remove_on_complete = Some(policy);
        self
    }

    /// Failed-job retention policy.
    pub fn remove_on_fail(mut self, policy: RemoveOnFinish) -> Self {
        self.remove_on_fail = Some(policy);
        self
    }

    /// Maximum number of log entries to retain for the job.
    pub fn keep_logs(mut self, count: u32) -> Self {
        self.keep_logs = Some(count);
        self
    }

    /// Use a custom, unique job id instead of an auto-generated one.
    pub fn job_id(mut self, id: impl Into<String>) -> Self {
        self.job_id = Some(id.into());
        self
    }

    /// Logical creation timestamp for the job (defaults to now). Times before
    /// the Unix epoch are clamped to `0`.
    pub fn timestamp(mut self, timestamp: SystemTime) -> Self {
        let millis = timestamp
            .duration_since(UNIX_EPOCH)
            .map(duration_to_millis)
            .unwrap_or(0);
        self.timestamp = Some(millis);
        self
    }

    /// Maximum number of stack-trace lines to store on failure.
    pub fn stack_trace_limit(mut self, limit: u32) -> Self {
        self.stack_trace_limit = Some(limit);
        self
    }

    /// Attach this job to a parent job (flow / dependency chains).
    pub fn parent(mut self, parent: ParentOptions) -> Self {
        self.parent = Some(parent);
        self
    }

    /// Deduplicate the job using the given options.
    pub fn deduplication(mut self, deduplication: DeduplicationOptions) -> Self {
        self.deduplication = Some(deduplication);
        self
    }

    /// Reject the job if its serialized payload exceeds `bytes` UTF-8 bytes.
    pub fn size_limit(mut self, bytes: usize) -> Self {
        self.size_limit = Some(bytes);
        self
    }

    /// Fail the parent job when this child fails.
    pub fn fail_parent_on_failure(mut self) -> Self {
        self.fail_parent_on_failure = Some(true);
        self
    }

    /// Ignore this child's dependency on the parent when it fails.
    pub fn ignore_dependency_on_failure(mut self) -> Self {
        self.ignore_dependency_on_failure = Some(true);
        self
    }

    /// Remove this child's dependency from the parent when it fails.
    pub fn remove_dependency_on_failure(mut self) -> Self {
        self.remove_dependency_on_failure = Some(true);
        self
    }

    /// Let the parent continue processing even if this child fails.
    pub fn continue_parent_on_failure(mut self) -> Self {
        self.continue_parent_on_failure = Some(true);
        self
    }
}

/// Convert a [`Duration`] to whole milliseconds, saturating at [`u64::MAX`].
fn duration_to_millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

/// Parent job options (for flow/dependency chains).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParentOptions {
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
    /// Maximum quantity of jobs to remove per eviction pass.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

impl From<KeepJobs> for RedisKeepJobs {
    fn from(k: KeepJobs) -> Self {
        Self {
            age: k.age,
            count: k.count,
            limit: k.limit,
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

impl RateLimiterOptions {
    /// Create rate limiter options allowing `max` jobs per `duration` window.
    pub fn new(max: u64, duration: Duration) -> Self {
        Self {
            max,
            duration: duration_to_millis(duration),
        }
    }
}
