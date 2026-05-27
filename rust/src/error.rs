use thiserror::Error as ThisError;

/// Errors that can occur during BullMQ operations.
#[derive(Debug, ThisError)]
pub enum Error {
    /// Redis connection or command error.
    #[error("redis error: {0}")]
    Redis(#[from] redis::RedisError),

    /// JSON serialization/deserialization error.
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    /// A Lua script returned an error code from BullMQ protocol.
    #[error("script error: {message} (code: {code})")]
    Script {
        /// BullMQ protocol error code.
        code: i64,
        /// Human-readable error message.
        message: String,
    },

    /// The job was not found in Redis.
    #[error("job not found: {0}")]
    JobNotFound(String),

    /// The job is locked by another worker.
    #[error("job is locked: {0}")]
    JobLocked(String),

    /// The worker was closed while processing.
    #[error("worker closed")]
    WorkerClosed,

    /// Rate limited - caller should wait.
    #[error("rate limited (wait {delay_ms}ms)")]
    RateLimited {
        /// Milliseconds to wait before retrying.
        delay_ms: u64,
    },

    /// Invalid configuration.
    #[error("invalid configuration: {0}")]
    InvalidConfig(String),

    /// The queue connection is closed.
    #[error("connection closed")]
    ConnectionClosed,

    /// MessagePack encoding/decoding error.
    #[error("msgpack error: {0}")]
    MsgPack(String),

    /// Job processing failed with an unrecoverable error (skips retries).
    #[error("unrecoverable error: {0}")]
    Unrecoverable(String),

    /// Job processing failed with a retryable error.
    #[error("{0}")]
    ProcessingError(String),

    /// The job was moved to delayed (not a real failure).
    /// Throw this after calling `job.move_to_delayed()` in the processor.
    #[error("delayed")]
    Delayed,

    /// The job is waiting for children (not a real failure).
    /// Throw this after moving the job to waiting-children state.
    #[error("waiting-children")]
    WaitingChildren,
}

/// BullMQ protocol error codes returned by Lua scripts.
pub mod error_code {
    /// Job not found.
    pub const JOB_NOT_EXIST: i64 = -1;
    /// Job lock mismatch.
    pub const JOB_LOCK_MISMATCH: i64 = -2;
    /// Job not in expected state.
    pub const JOB_NOT_IN_STATE: i64 = -3;
    /// Job pending dependencies.
    pub const JOB_PENDING_DEPENDENCIES: i64 = -4;
    /// Job lock not found.
    pub const JOB_LOCK_NOT_EXIST: i64 = -5;
    /// Job max attempts reached.
    pub const JOB_MAX_ATTEMPTS: i64 = -6;
}

impl Error {
    /// Create a script error from an error code returned by Lua.
    pub fn from_script_code(code: i64) -> Self {
        let message = match code {
            error_code::JOB_NOT_EXIST => "Job does not exist",
            error_code::JOB_LOCK_MISMATCH => "Job lock mismatch",
            error_code::JOB_NOT_IN_STATE => "Job is not in the expected state",
            error_code::JOB_PENDING_DEPENDENCIES => "Job has pending dependencies",
            error_code::JOB_LOCK_NOT_EXIST => "Job lock does not exist",
            error_code::JOB_MAX_ATTEMPTS => "Job has reached max attempts",
            _ => "Unknown script error",
        };
        Error::Script {
            code,
            message: message.to_string(),
        }
    }
}
