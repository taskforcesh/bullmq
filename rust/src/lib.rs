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
//! use bullmq::{Queue, Worker, Job};
//! use std::sync::Arc;
//!
//! #[tokio::main]
//! async fn main() -> Result<(), bullmq::Error> {
//!     let queue = Queue::new("my-queue").await?;
//!
//!     queue.add("my-job", serde_json::json!({"foo": "bar"})).await?;
//!
//!     let worker = Worker::new("my-queue", Arc::new(|job: Job, _token| Box::pin(async move {
//!         println!("Processing job: {}", job.id());
//!         Ok(serde_json::Value::Null)
//!     }))).await?;
//!
//!     Ok(())
//! }
//! ```

/// Error types for BullMQ operations.
pub mod error;
/// FlowProducer — atomically add trees of dependent jobs (flows).
pub mod flow_producer;
/// Job representation and lifecycle management.
pub mod job;
/// Job Scheduler — repeatable/cron-based job scheduling.
pub mod job_scheduler;
/// Redis key generation for queue data structures.
pub mod keys;
/// Configuration options for queues, workers, and jobs.
pub mod options;
/// Queue management and job submission.
pub mod queue;
/// Cross-process queue event listener (stream-based).
pub mod queue_events;
/// Redis connection handling.
pub mod redis_connection;
/// Lua script registry and execution.
pub mod scripts;
/// Shared types: job state, progress, backoff strategies.
pub mod types;
/// Worker implementation for processing jobs...
pub mod worker;

pub use error::Error;
pub use flow_producer::{
    FlowJob, FlowOptions, FlowProducer, FlowProducerOptions, FlowQueueOptions, GetFlowOptions,
    JobNode,
};
pub use job::Job;
pub use keys::QueueKeys;
pub use options::{
    BackoffStrategyFn, DeduplicationOptions, JobOptions, MetricsOptions, ParentOptions,
    QueueOptions, RateLimiterOptions, WorkerOptions,
};
pub use queue::AddJob;
pub use queue::BulkJob;
pub use queue::JobCountRecorder;
pub use queue::Queue;
pub use queue_events::{QueueEvent, QueueEventEntry, QueueEvents, QueueEventsOptions};
pub use types::{
    DependenciesCount, DependenciesResult, JobProgress, JobState, Metrics, MetricsMeta, QueueMeta,
    RetryOptions,
};
pub use worker::{IntoProcessor, Worker};

/// Result type alias for BullMQ operations.
pub type Result<T> = std::result::Result<T, Error>;
