---
description: BullMQ is available as a native Rust crate with full async/await support.
---

# Introduction

## Installation

Add BullMQ to your project via Cargo:

```bash
cargo add bullmq
```

Or add it to your `Cargo.toml`:

```toml
[dependencies]
bullmq = "0.1"
```

BullMQ for Rust requires:

- Rust 1.85+
- Tokio runtime
- Redis 6.2+

## Get Started

BullMQ uses [Tokio](https://tokio.rs) for async processing. All operations are non-blocking and designed for high-throughput concurrent workloads.

### Adding Jobs to a Queue

```rust
use bullmq::{Queue, QueueOptions};

#[tokio::main]
async fn main() -> bullmq::Result<()> {
    let queue = Queue::new("my-queue", QueueOptions::default()).await?;

    // Add a job with JSON data
    queue.add("my-job", serde_json::json!({
        "foo": "bar"
    }), None).await?;

    Ok(())
}
```

### Processing Jobs with a Worker

```rust
use bullmq::{Worker, WorkerOptions, Job};
use bullmq::worker::{ProcessorFn, CancellationToken};
use std::sync::Arc;

#[tokio::main]
async fn main() -> bullmq::Result<()> {
    let processor: ProcessorFn = Arc::new(|job: Job, _token: CancellationToken| {
        Box::pin(async move {
            println!("Processing job: {} - {}", job.id(), job.name());
            // Access job data
            let data = job.data();
            println!("Data: {}", data);
            // Return a result value
            Ok(serde_json::json!({"processed": true}))
        })
    });

    let worker = Worker::new("my-queue", processor, WorkerOptions::default()).await?;

    // Worker processes jobs automatically in the background.
    // Wait for a signal or condition to shut down.
    tokio::signal::ctrl_c().await.unwrap();

    // Graceful shutdown with 5-second timeout
    worker.close(5000).await?;
    Ok(())
}
```

### Listening to Worker Events

```rust
use bullmq::{Worker, WorkerOptions, Job};
use bullmq::worker::{ProcessorFn, CancellationToken};
use std::sync::Arc;

#[tokio::main]
async fn main() -> bullmq::Result<()> {
    let processor: ProcessorFn = Arc::new(|job: Job, _token: CancellationToken| {
        Box::pin(async move {
            Ok(serde_json::json!(null))
        })
    });

    let worker = Worker::new("my-queue", processor, WorkerOptions::default()).await?;

    // Consume events from the worker
    while let Some(event) = worker.next_event().await {
        match event {
            bullmq::worker::WorkerEvent::Completed { job_id, result } => {
                println!("Job {} completed with: {}", job_id, result);
            }
            bullmq::worker::WorkerEvent::Failed { job_id, error } => {
                println!("Job {} failed: {}", job_id, error);
            }
            bullmq::worker::WorkerEvent::Active { job_id } => {
                println!("Job {} started processing", job_id);
            }
            _ => {}
        }
    }

    Ok(())
}
```

## Concurrency

Configure how many jobs are processed simultaneously:

```rust
let worker = Worker::new("my-queue", processor, WorkerOptions {
    concurrency: 10,
    ..Default::default()
}).await?;
```

The concurrency can be changed dynamically at runtime:

```rust
worker.set_concurrency(20);
```

## Progress Tracking

Report progress from inside the processor:

```rust
let processor: ProcessorFn = Arc::new(|mut job: Job, _token: CancellationToken| {
    Box::pin(async move {
        for i in 0..100 {
            // Do work...
            job.update_progress(bullmq::JobProgress::Number(i as f64)).await?;
        }
        Ok(serde_json::json!(null))
    })
});
```

## Job Retries with Backoff

```rust
use bullmq::{Queue, QueueOptions, JobOptions};
use bullmq::types::BackoffStrategy;

let queue = Queue::new("my-queue", QueueOptions::default()).await?;

queue.add("flaky-job", serde_json::json!({}), Some(JobOptions {
    attempts: Some(5),
    backoff: Some(BackoffStrategy::Exponential(1000)), // 1s, 2s, 4s, 8s, 16s
    ..Default::default()
})).await?;
```

## Connection Configuration

```rust
use bullmq::{QueueOptions, WorkerOptions};
use bullmq::options::RedisConnectionOptions;

let conn = RedisConnectionOptions {
    url: "redis://user:password@redis.example.com:6380".to_string(),
    ..Default::default()
};

let queue = Queue::new("my-queue", QueueOptions {
    connection: conn.clone(),
    ..Default::default()
}).await?;

let worker = Worker::new("my-queue", processor, WorkerOptions {
    connection: conn,
    ..Default::default()
}).await?;
```

## Key Differences from Node.js

| Aspect         | Node.js                            | Rust                                                   |
| -------------- | ---------------------------------- | ------------------------------------------------------ |
| Runtime        | Event loop (single-threaded)       | Tokio (multi-threaded async)                           |
| Processor      | `async function` or sandboxed file | `Arc<dyn Fn(Job, CancellationToken) -> Pin<Box<...>>>` |
| Events         | EventEmitter pattern               | `mpsc::UnboundedReceiver<WorkerEvent>`                 |
| Error handling | Exceptions                         | `Result<T, Error>` types                               |
| Cancellation   | AbortSignal                        | `CancellationToken`                                    |
| Concurrency    | Cooperative (single core)          | True parallelism across all CPU cores                  |

## Compatibility

The Rust implementation uses the same Lua scripts and Redis data structures as the Node.js and Python versions. This means:

- Jobs added by Node.js workers can be processed by Rust workers (and vice versa)
- Queue state is fully shared across all language implementations
- You can mix languages in a single deployment
