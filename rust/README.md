# BullMQ Rust

A high-performance Rust port of [BullMQ](https://bullmq.io) — a robust job queue backed by Redis.

Fully compatible with Node.js and Elixir BullMQ queues (same Lua scripts and Redis data structures).

## Features

- **Queue** — Add jobs with delay, priority, deduplication, and custom IDs.
- **Worker** — Process jobs with configurable concurrency, stalled job detection, lock renewal, and cancellation support.
- **Job** — First-class job lifecycle: progress tracking, retries, backoff, parent/child relationships.
- **FFI-ready** — Clean trait-based API designed for straightforward bindings to Go, C#, Python, etc.
- **Zero-copy Lua scripts** — Scripts are embedded at compile time via `include_str!`.

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
├── types.rs            # Shared types (JobState, JobProgress, etc.)
├── keys.rs             # Redis key generation
├── options.rs          # Configuration options
├── redis_connection.rs # Redis connection management
├── scripts.rs          # Lua script registry (compile-time embedded)
├── job.rs              # Job struct and Redis serialization
├── queue.rs            # Queue operations
└── worker.rs           # Worker processing loop
src/commands/           # Generated Lua scripts embedded with include_str!
tests/
└── integration_test.rs # Full integration test suite
```

## Design Principles

1. **Idiomatic Rust** — Uses `async/await`, `Arc` for sharing, `tokio` for concurrency, `thiserror` for errors.
2. **FFI-friendly** — All public types are `Send + Sync`. The `ProcessorFn` is a simple trait object that can be wrapped for C FFI.
3. **Compatible** — Uses the exact same Lua scripts as Node.js BullMQ, ensuring full wire compatibility.
4. **Fast** — Zero-copy script embedding, multiplexed Redis connections, lock-free atomics where possible.

## License

MIT
