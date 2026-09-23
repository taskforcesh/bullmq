use serde::{Deserialize, Serialize};

/// The state a job can be in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobState {
    /// Job is waiting to be picked up by a worker.
    Waiting,
    /// Job is currently being processed.
    Active,
    /// Job is delayed and will become available after its delay expires.
    Delayed,
    /// Job is in the priority queue awaiting processing.
    Prioritized,
    /// Job completed successfully.
    Completed,
    /// Job has permanently failed.
    Failed,
    /// Job is waiting for its child jobs to complete.
    WaitingChildren,
    /// Unknown state (should not normally occur).
    #[serde(other)]
    Unknown,
}

impl JobState {
    /// Returns the Redis key suffix for this state.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Waiting => "wait",
            Self::Active => "active",
            Self::Delayed => "delayed",
            Self::Prioritized => "prioritized",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::WaitingChildren => "waiting-children",
            Self::Unknown => "unknown",
        }
    }

    /// Parse a state from its Redis string representation.
    pub fn from_redis_str(s: &str) -> Self {
        match s {
            "wait" | "waiting" => Self::Waiting,
            "active" => Self::Active,
            "delayed" => Self::Delayed,
            "prioritized" => Self::Prioritized,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "waiting-children" => Self::WaitingChildren,
            _ => Self::Unknown,
        }
    }
}

impl std::fmt::Display for JobState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Options for retrying a job.
#[derive(Debug, Clone, Default)]
pub struct RetryOptions {
    /// Reset the `attemptsMade` counter when retrying.
    pub reset_attempts_made: bool,
    /// Reset the `attemptsStarted` counter when retrying.
    pub reset_attempts_started: bool,
}

/// Job progress - can be a number or arbitrary JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum JobProgress {
    /// Numeric progress (0.0–100.0 by convention).
    Number(f64),
    /// Arbitrary JSON progress payload.
    Object(serde_json::Value),
}

impl Default for JobProgress {
    fn default() -> Self {
        Self::Number(0.0)
    }
}

/// How many completed/failed jobs to keep.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeepJobs {
    /// Maximum age in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub age: Option<u64>,
    /// Maximum count.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<usize>,
    /// Maximum quantity of jobs to remove in a single eviction pass.
    ///
    /// Bounds how many aged jobs are trimmed when a job finishes (the Lua
    /// script defaults to `1000` when unset). Mirrors Node.js `KeepJobs.limit`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

/// Backoff strategy for job retries.
///
/// In Redis/JSON, stored as `{"type": "<name>", "delay": <ms>}`.
/// "fixed" and "exponential" are built-in; anything else is custom.
#[derive(Debug, Clone)]
pub enum BackoffStrategy {
    /// Fixed delay in milliseconds.
    Fixed(u64),
    /// Exponential backoff with base delay in milliseconds.
    Exponential(u64),
    /// Custom backoff (strategy name).
    Custom(String),
}

impl Serialize for BackoffStrategy {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = serializer.serialize_map(Some(2))?;
        match self {
            BackoffStrategy::Fixed(delay) => {
                map.serialize_entry("type", "fixed")?;
                map.serialize_entry("delay", delay)?;
            }
            BackoffStrategy::Exponential(delay) => {
                map.serialize_entry("type", "exponential")?;
                map.serialize_entry("delay", delay)?;
            }
            BackoffStrategy::Custom(name) => {
                map.serialize_entry("type", name)?;
                map.serialize_entry("delay", &0u64)?;
            }
        }
        map.end()
    }
}

impl<'de> Deserialize<'de> for BackoffStrategy {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct BackoffRaw {
            #[serde(rename = "type")]
            type_name: String,
            #[serde(default)]
            delay: u64,
        }

        let raw = BackoffRaw::deserialize(deserializer)?;
        match raw.type_name.as_str() {
            "fixed" => Ok(BackoffStrategy::Fixed(raw.delay)),
            "exponential" => Ok(BackoffStrategy::Exponential(raw.delay)),
            other => Ok(BackoffStrategy::Custom(other.to_string())),
        }
    }
}

/// Metrics collected for the queue.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct QueueMetrics {
    /// Number of completed jobs.
    pub completed: u64,
    /// Number of failed jobs.
    pub failed: u64,
}

/// Counts of jobs by state.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct JobCounts {
    /// Jobs waiting to be processed.
    pub waiting: u64,
    /// Jobs currently being processed.
    pub active: u64,
    /// Jobs scheduled for future processing.
    pub delayed: u64,
    /// Jobs ordered by priority.
    pub prioritized: u64,
    /// Jobs that completed successfully.
    pub completed: u64,
    /// Jobs that permanently failed.
    pub failed: u64,
    /// Jobs waiting for child jobs to finish.
    pub waiting_children: u64,
    /// Jobs in paused queue.
    pub paused: u64,
}

/// Metadata for a queue's time-series metrics.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MetricsMeta {
    /// Total number of jobs counted since metrics collection began.
    pub count: u64,
    /// Timestamp (ms) of the previous recorded data point.
    pub prev_ts: u64,
    /// Cumulative count at the previous data point.
    pub prev_count: u64,
}

/// Time-series metrics for a queue (completed or failed jobs per minute).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Metrics {
    /// Metrics metadata.
    pub meta: MetricsMeta,
    /// Per-minute data points (newest first), each the number of jobs in that minute.
    pub data: Vec<u64>,
    /// Total number of data points available.
    pub count: u64,
}

/// Information about a parent job relationship.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParentKeys {
    /// The parent job's queue qualified key.
    pub queue_key: String,
    /// The parent job's ID.
    pub id: String,
}

/// Public queue metadata read from the `meta` hash.
///
/// Mirrors the Node.js `QueueMeta` interface: well-known numeric/boolean fields
/// are parsed into typed fields, and any remaining hash entries are preserved
/// in [`other`](Self::other).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueueMeta {
    /// Global concurrency limit, when set via `set_global_concurrency`.
    pub concurrency: Option<u64>,
    /// Rate-limit `max` (jobs per `duration` window), when set.
    pub max: Option<u64>,
    /// Rate-limit window length in milliseconds, paired with `max`.
    pub duration: Option<u64>,
    /// Maximum length of the events stream (`opts.maxLenEvents`), when set.
    pub max_len_events: Option<u64>,
    /// Whether the queue is paused.
    pub paused: bool,
    /// Any other meta-hash fields not parsed above (e.g. `library`).
    pub other: std::collections::HashMap<String, String>,
}

/// Counts of dependencies by type for a parent job.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DependenciesCount {
    /// Number of children that completed successfully.
    pub processed: u64,
    /// Number of children still pending (in dependencies set).
    pub unprocessed: u64,
    /// Number of children that failed with ignoreDependencyOnFailure.
    pub ignored: u64,
    /// Number of children that failed (in unsuccessful zset).
    pub failed: u64,
}

/// Paginated result of a parent job's dependencies.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DependenciesResult {
    /// Map of processed child job key -> return value (JSON).
    pub processed: std::collections::HashMap<String, serde_json::Value>,
    /// Cursor for the next page of processed children (0 = no more).
    pub next_processed_cursor: u64,
    /// Set of unprocessed (pending) child job keys.
    pub unprocessed: Vec<String>,
    /// Cursor for the next page of unprocessed children (0 = no more).
    pub next_unprocessed_cursor: u64,
}

/// Remove-on-complete/fail policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RemoveOnFinish {
    /// Boolean: true removes immediately, false keeps.
    Bool(bool),
    /// Keep at most this many jobs.
    Count(usize),
    /// Keep jobs matching these criteria.
    Options(KeepJobs),
}

impl Default for RemoveOnFinish {
    fn default() -> Self {
        Self::Bool(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backoff_strategy_serialization() {
        let custom = BackoffStrategy::Custom("myType".to_string());
        let json = serde_json::to_string(&custom).unwrap();
        assert!(json.contains("\"type\":\"myType\""));
        assert!(json.contains("\"delay\":0"));

        let fixed = BackoffStrategy::Fixed(1000);
        let json2 = serde_json::to_string(&fixed).unwrap();
        assert!(json2.contains("\"type\":\"fixed\""));
        assert!(json2.contains("\"delay\":1000"));

        // Test round-trip for custom
        let parsed: BackoffStrategy = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, BackoffStrategy::Custom(ref n) if n == "myType"));

        // Test deserialization of what Lua stores (type=custom name, delay=number)
        let from_lua = r#"{"type":"myCustom","delay":500}"#;
        let parsed2: BackoffStrategy = serde_json::from_str(from_lua).unwrap();
        assert!(matches!(parsed2, BackoffStrategy::Custom(ref n) if n == "myCustom"));

        // Test deserialization of fixed
        let from_lua_fixed = r#"{"type":"fixed","delay":1000}"#;
        let parsed3: BackoffStrategy = serde_json::from_str(from_lua_fixed).unwrap();
        assert!(matches!(parsed3, BackoffStrategy::Fixed(1000)));
    }
}
