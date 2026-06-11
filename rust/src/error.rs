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
    ///
    /// The Display is just the raw message (no prefix), matching the behaviour
    /// of Node.js `UnrecoverableError`, so it can be stored verbatim as a job's
    /// `failedReason`.
    #[error("{0}")]
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

    /// The job does not exist in Redis.
    #[error("job {0} does not exist")]
    JobNotExist(String),

    /// The job's lock does not exist or was lost.
    #[error("job {0} lock does not exist")]
    JobLockNotExist(String),

    /// The job is not in the expected state.
    #[error("job {0} is not in state {1}")]
    JobNotInState(String, String),

    /// The job has failed children (cannot move to waiting-children).
    #[error("job {0} has failed children")]
    JobHasFailedChildren(String),
}

/// BullMQ protocol error codes returned by Lua scripts.
pub mod error_code {
    /// Job not found.
    pub const JOB_NOT_EXIST: i64 = -1;
    /// Job lock does not exist (missing lock).
    pub const JOB_LOCK_NOT_EXIST: i64 = -2;
    /// Job not in expected state.
    pub const JOB_NOT_IN_STATE: i64 = -3;
    /// Job pending dependencies.
    pub const JOB_PENDING_DEPENDENCIES: i64 = -4;
    /// Parent job not found.
    pub const PARENT_JOB_NOT_EXIST: i64 = -5;
    /// Job lock mismatch (lock not owned).
    pub const JOB_LOCK_MISMATCH: i64 = -6;
    /// Parent job cannot be replaced.
    pub const PARENT_JOB_CANNOT_BE_REPLACED: i64 = -7;
    /// Job belongs to a job scheduler.
    pub const JOB_BELONGS_TO_JOB_SCHEDULER: i64 = -8;
    /// Job has failed children.
    pub const JOB_HAS_FAILED_CHILDREN: i64 = -9;
    /// Scheduler job id collision.
    pub const SCHEDULER_JOB_ID_COLLISION: i64 = -10;
    /// Scheduler job slots are busy.
    pub const SCHEDULER_JOB_SLOTS_BUSY: i64 = -11;

    // Legacy aliases kept for backwards compatibility with older Rust constants.
    /// Legacy alias for parent job not found.
    pub const JOB_LOCK_NOT_EXIST_OLD: i64 = PARENT_JOB_NOT_EXIST;
    /// Legacy alias name used in early Rust parity work.
    pub const JOB_MAX_ATTEMPTS: i64 = JOB_LOCK_MISMATCH;
}

impl Error {
    /// Create a script error from an error code returned by Lua.
    pub fn from_script_code(code: i64) -> Self {
        let message = match code {
            error_code::JOB_NOT_EXIST => "Job does not exist",
            error_code::JOB_LOCK_NOT_EXIST => "Job lock does not exist",
            error_code::JOB_NOT_IN_STATE => "Job is not in the expected state",
            error_code::JOB_PENDING_DEPENDENCIES => "Job has pending dependencies",
            error_code::PARENT_JOB_NOT_EXIST => "Parent job does not exist",
            error_code::JOB_LOCK_MISMATCH => "Job lock mismatch",
            error_code::PARENT_JOB_CANNOT_BE_REPLACED => "Parent job cannot be replaced",
            error_code::JOB_BELONGS_TO_JOB_SCHEDULER => "Job belongs to a job scheduler",
            error_code::JOB_HAS_FAILED_CHILDREN => "Job has failed children",
            error_code::SCHEDULER_JOB_ID_COLLISION => "Scheduler job id collision",
            error_code::SCHEDULER_JOB_SLOTS_BUSY => "Scheduler job slots are busy",
            _ => "Unknown script error",
        };
        Error::Script {
            code,
            message: message.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{error_code, Error};

    #[test]
    fn maps_missing_lock_code() {
        let err = Error::from_script_code(error_code::JOB_LOCK_NOT_EXIST);
        match err {
            Error::Script { code, message } => {
                assert_eq!(code, -2);
                assert_eq!(message, "Job lock does not exist");
            }
            _ => panic!("expected Error::Script"),
        }
    }

    #[test]
    fn maps_lock_mismatch_code() {
        let err = Error::from_script_code(error_code::JOB_LOCK_MISMATCH);
        match err {
            Error::Script { code, message } => {
                assert_eq!(code, -6);
                assert_eq!(message, "Job lock mismatch");
            }
            _ => panic!("expected Error::Script"),
        }
    }
}
