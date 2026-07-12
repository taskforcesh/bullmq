# BullMQ Rust

A high-performance Rust port of [BullMQ](https://bullmq.io) — a robust job queue backed by Redis.

Fully compatible with Node.js and Elixir BullMQ queues (same Lua scripts and Redis data structures).

## Features

- **Queue** — Add jobs with delay, priority, deduplication, custom IDs, and a
  per-job `size_limit`; rich getters (`get_jobs`, `get_waiting`, `count`,
  `get_counts_per_priority`, `get_meta`, `get_version`, `is_maxed`,
  `get_workers`/`get_workers_count`, …), global concurrency/rate-limit,
  time-series metrics (`get_metrics`) and Prometheus export
  (`export_prometheus_metrics`).
- **Worker** — Process jobs with configurable concurrency, stalled job detection,
  lock renewal, rate limiting, cancellation, optional metrics collection, and
  behavioural flags (`max_started_attempts`, `skip_stalled_check`,
  `skip_lock_renewal`).
- **QueueEvents** — Cross-process, Redis-stream-based event listener observing
  `completed`/`failed`/`progress`/`added`/`delayed`/`drained`/… events from any
  process connected to the same Redis.
- **Job** — First-class job lifecycle: progress tracking, retries, backoff,
  logs (`log`/`clear_logs`), `discard`, and parent/child relationships.
- **FlowProducer** — Atomically add trees of dependent jobs, with `get_flow` and
  per-queue default options.
- **JobScheduler** — Cron/interval repeatable jobs (managed via the `Queue` API).
- **Connections** — URL or typed options (host/port/username/password/db) with
  TLS (`rediss://`) support.
- **FFI-ready** — Clean trait-based API designed for straightforward bindings to
  Go, C#, Python, etc.
- **Zero-copy Lua scripts** — Scripts are embedded at compile time via `include_str!`.

> See [FEATURE_PARITY.md](./FEATURE_PARITY.md) for a detailed comparison with the
> Node.js implementation. Remaining gaps are intentionally scoped: legacy
> maintenance methods (`remove_orphaned_jobs`, legacy repeatable API),
> `Job.wait_until_finished`, Redis Cluster/Sentinel, and telemetry.

## Quick Start

```rust
use bullmq::{Queue, Worker, Job, QueueOptions, WorkerOptions};
use bullmq::worker::{ProcessorFn, CancellationToken};
use std::sync::Arc;

#[tokio::main]
async fn main() -> bullmq::Result<()> {
    // Create a queue
    let queue = Queue::new("my-queue", QueueOptions::default()).await?;

    // Add a job
    queue.add("send-email", serde_json::json!({
        "to": "user@example.com",
        "subject": "Hello!"
    }), None).await?;

    // Create a worker
    let processor: ProcessorFn = Arc::new(|job: Job, _token: CancellationToken| {
        Box::pin(async move {
            println!("Processing job: {} - {}", job.id(), job.name());
            Ok(serde_json::json!({"sent": true}))
        })
    });

    let worker = Worker::new("my-queue", processor, WorkerOptions::default()).await?;

    // Worker processes jobs automatically...
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;

    worker.close(5000).await?;
    Ok(())
}
```

## Listening to events (QueueEvents)

`QueueEvents` consumes the queue's Redis event stream, so you can observe job
lifecycle events from any process connected to the same Redis server:

```rust
use bullmq::{QueueEvents, QueueEventsOptions, QueueEvent};

#[tokio::main]
async fn main() -> bullmq::Result<()> {
    let events = QueueEvents::new("my-queue", QueueEventsOptions::default()).await?;

    while let Some(entry) = events.next_event().await {
        match entry.event {
            QueueEvent::Completed { job_id, return_value, .. } => {
                println!("job {job_id} completed: {return_value}");
            }
            QueueEvent::Failed { job_id, failed_reason, .. } => {
                println!("job {job_id} failed: {failed_reason}");
            }
            QueueEvent::Progress { job_id, data } => {
                println!("job {job_id} progress: {data}");
            }
            _ => {}
        }
    }

    events.close().await;
    Ok(())
}
```

## Requirements

- Rust 1.85+
- Redis 6.2+
- Tokio runtime

## Running Tests

```bash
# Ensure Redis is running on localhost:6379
yarn generate:raw:scripts
yarn copy:lua:rust
cargo test

# Or specify a custom Redis URL
REDIS_URL=redis://myhost:6379 cargo test
```

## Architecture

```
src/
├── lib.rs              # Public API re-exports
├── error.rs            # Error types and BullMQ protocol codes
├── types.rs            # Shared types (JobState, JobProgress, Metrics, etc.)
├── keys.rs             # Redis key generation
├── options.rs          # Configuration options (Queue/Worker/Job/Connection)
├── redis_connection.rs # Redis connection management (URL or typed options, TLS)
├── scripts.rs          # Lua script registry (compile-time embedded)
├── job.rs              # Job struct and Redis serialization
├── queue.rs            # Queue operations, getters, metrics, schedulers
├── flow_producer.rs    # Parent/child job trees (flows)
├── job_scheduler.rs    # Cron/interval scheduling helpers
└── worker.rs           # Worker processing loop
src/commands/           # Generated Lua scripts embedded with include_str!
tests/                  # Integration test suites (queue, worker, job, flow,
                        # metrics, connection, rate limit, schedulers, …)
```

## Design Principles

1. **Idiomatic Rust** — Uses `async/await`, `Arc` for sharing, `tokio` for concurrency, `thiserror` for errors.
2. **FFI-friendly** — All public types are `Send + Sync`. The `ProcessorFn` is a simple trait object that can be wrapped for C FFI.
3. **Compatible** — Uses the exact same Lua scripts as Node.js BullMQ, ensuring full wire compatibility.
4. **Fast** — Zero-copy script embedding, multiplexed Redis connections, lock-free atomics where possible.

## License

MIT
