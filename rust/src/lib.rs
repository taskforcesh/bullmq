#![warn(missing_docs)]

//! # BullMQ - Rust Port
//!
//! A powerful, fast, and robust job queue backed by Redis.
//!
//! This crate provides a Rust implementation of the BullMQ job queue system,
//! fully compatible with the Node.js and Elixir implementations.
//!
//! ## Architecture
//!
//! - [`Queue`] - Add jobs to a queue and manage queue state.
//! - [`Worker`] - Process jobs from a queue with configurable concurrency.
//! - [`Job`] - Represents a unit of work in the queue.
//!
//! ## Example
//!
//! ```rust,no_run
//! use bullmq::{Queue, Worker, Job, QueueOptions, WorkerOptions};
//! use std::sync::Arc;
//!
//! #[tokio::main]
//! async fn main() -> Result<(), bullmq::Error> {
//!     let queue = Queue::new("my-queue", QueueOptions::default()).await?;
//!
//!     queue.add("my-job", serde_json::json!({"foo": "bar"}), None).await?;
//!
//!     let worker = Worker::new("my-queue", Arc::new(|job: Job, _token| Box::pin(async move {
//!         println!("Processing job: {}", job.id());
//!         Ok(serde_json::Value::Null)
//!     })), WorkerOptions::default()).await?;
//!
//!     Ok(())
//! }
//! ```

/// Error types for BullMQ operations.
pub mod error;
/// Job representation and lifecycle management.
pub mod job;
/// Redis key generation for queue data structures.
pub mod keys;
/// Configuration options for queues, workers, and jobs.
pub mod options;
/// Queue management and job submission.
pub mod queue;
/// Redis connection handling.
pub mod redis_connection;
/// Lua script registry and execution.
pub mod scripts;
/// Shared types: job state, progress, backoff strategies.
pub mod types;
/// Worker implementation for processing jobs...
pub mod worker;

pub use error::Error;
pub use job::Job;
pub use keys::QueueKeys;
pub use options::{BackoffStrategyFn, JobOptions, QueueOptions, WorkerOptions};
pub use queue::Queue;
pub use types::{JobProgress, JobState, RetryOptions};
pub use worker::Worker;

/// Result type alias for BullMQ operations.
pub type Result<T> = std::result::Result<T, Error>;
