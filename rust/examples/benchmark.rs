//! BullMQ Rust Benchmark
//!
//! Measures throughput for adding and processing jobs.
//! Mirrors the Node.js/Bun benchmark for direct comparison.
//!
//! Usage:
//!   cargo run --release --example benchmark
//!
//! Environment variables:
//!   REDIS_URL - Redis connection URL (default: redis://127.0.0.1:6379)

use bullmq::options::RedisConnectionOptions;
use bullmq::worker::{CancellationToken, ProcessorFn};
use bullmq::{Job, JobOptions, Queue, QueueOptions, Worker, WorkerOptions};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Notify;

fn connection_opts() -> RedisConnectionOptions {
    RedisConnectionOptions {
        url: std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into()),
        max_connections: 8,
    }
}

fn format_duration(ms: f64) -> String {
    if ms < 1000.0 {
        format!("{:.2}ms", ms)
    } else {
        format!("{:.2}s", ms / 1000.0)
    }
}

fn format_number(n: f64) -> String {
    if n >= 1_000_000.0 {
        format!("{:.2}M", n / 1_000_000.0)
    } else if n >= 1_000.0 {
        format!("{:.2}K", n / 1_000.0)
    } else {
        format!("{:.2}", n)
    }
}

/// Benchmark: Adding jobs one by one (sequential).
async fn benchmark_add_jobs(count: usize) -> (f64, f64) {
    let queue_name = format!("bench-add-{}", uuid::Uuid::new_v4().simple());
    let queue = Queue::new(
        &queue_name,
        QueueOptions {
            connection: connection_opts(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let data = serde_json::json!({"index": 0, "payload": "x".repeat(100)});

    let start = Instant::now();
    for i in 0..count {
        let d = serde_json::json!({"index": i, "payload": "x".repeat(100)});
        queue.add("test-job", d, None).await.unwrap();
    }
    let duration_ms = start.elapsed().as_secs_f64() * 1000.0;
    let jobs_per_sec = (count as f64 / duration_ms) * 1000.0;

    queue.obliterate(true, 1000).await.unwrap();
    drop(data);
    (duration_ms, jobs_per_sec)
}

/// Benchmark: Adding jobs in parallel batches (tokio::spawn).
async fn benchmark_add_jobs_parallel(count: usize, batch_size: usize) -> (f64, f64) {
    let queue_name = format!("bench-add-par-{}", uuid::Uuid::new_v4().simple());
    let queue = Arc::new(
        Queue::new(
            &queue_name,
            QueueOptions {
                connection: connection_opts(),
                ..Default::default()
            },
        )
        .await
        .unwrap(),
    );

    let start = Instant::now();

    for batch_start in (0..count).step_by(batch_size) {
        let current_batch = std::cmp::min(batch_size, count - batch_start);
        let mut handles = Vec::with_capacity(current_batch);

        for j in 0..current_batch {
            let q = queue.clone();
            let idx = batch_start + j;
            handles.push(tokio::spawn(async move {
                let data = serde_json::json!({"index": idx, "payload": "x".repeat(100)});
                q.add("test-job", data, None).await.unwrap();
            }));
        }

        for h in handles {
            h.await.unwrap();
        }
    }

    let duration_ms = start.elapsed().as_secs_f64() * 1000.0;
    let jobs_per_sec = (count as f64 / duration_ms) * 1000.0;

    queue.obliterate(true, 1000).await.unwrap();
    (duration_ms, jobs_per_sec)
}

/// Benchmark: Bulk adding jobs.
async fn benchmark_bulk_add(count: usize) -> (f64, f64) {
    let queue_name = format!("bench-bulk-{}", uuid::Uuid::new_v4().simple());
    let queue = Queue::new(
        &queue_name,
        QueueOptions {
            connection: connection_opts(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let jobs: Vec<(String, serde_json::Value, Option<JobOptions>)> = (0..count)
        .map(|i| {
            (
                "test-job".to_string(),
                serde_json::json!({"index": i, "payload": "x".repeat(100)}),
                None,
            )
        })
        .collect();

    let start = Instant::now();
    queue.add_bulk(jobs).await.unwrap();
    let duration_ms = start.elapsed().as_secs_f64() * 1000.0;
    let jobs_per_sec = (count as f64 / duration_ms) * 1000.0;

    queue.obliterate(true, 1000).await.unwrap();
    (duration_ms, jobs_per_sec)
}

/// Benchmark: Processing jobs with a worker.
async fn benchmark_processing(count: usize, concurrency: usize) -> (f64, f64) {
    let queue_name = format!("bench-proc-{}", uuid::Uuid::new_v4().simple());
    let conn_opts = connection_opts();

    let queue = Queue::new(
        &queue_name,
        QueueOptions {
            connection: conn_opts.clone(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // Add all jobs first using bulk
    let jobs: Vec<(String, serde_json::Value, Option<JobOptions>)> = (0..count)
        .map(|i| {
            (
                "test-job".to_string(),
                serde_json::json!({"index": i}),
                None,
            )
        })
        .collect();
    queue.add_bulk(jobs).await.unwrap();

    let processed = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let done = Arc::new(Notify::new());

    let processed_clone = processed.clone();
    let done_clone = done.clone();
    let target = count;

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let processed = processed_clone.clone();
        let done = done_clone.clone();
        Box::pin(async move {
            let val = processed.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            if val >= target {
                done.notify_one();
            }
            Ok(serde_json::Value::Null)
        })
    });

    // Start timer and create worker at the same time
    let start = Instant::now();

    let worker = Worker::new(
        &queue_name,
        processor,
        WorkerOptions {
            connection: conn_opts,
            concurrency,
            autorun: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    done.notified().await;
    let duration_ms = start.elapsed().as_secs_f64() * 1000.0;
    let jobs_per_sec = (count as f64 / duration_ms) * 1000.0;

    worker.close(5000).await.unwrap();
    queue.obliterate(true, 1000).await.unwrap();
    (duration_ms, jobs_per_sec)
}

#[tokio::main]
async fn main() {
    println!("\n🚀 BullMQ Rust Benchmark\n");
    println!("{}", "=".repeat(50));

    // 1. Sequential add
    println!("\n📝 Benchmark: Adding jobs sequentially (1000 jobs)");
    let (dur, throughput) = benchmark_add_jobs(1000).await;
    println!("   Duration: {}", format_duration(dur));
    println!("   Throughput: {} jobs/sec", format_number(throughput));
    let seq_throughput = throughput;

    // 2. Parallel add
    println!("\n🧵 Benchmark: Adding jobs in parallel (100,000 jobs, batch=1000)");
    let (dur, throughput) = benchmark_add_jobs_parallel(100_000, 1000).await;
    println!("   Duration: {}", format_duration(dur));
    println!("   Throughput: {} jobs/sec", format_number(throughput));
    let par_throughput = throughput;

    // 3. Bulk add
    println!("\n📦 Benchmark: Bulk adding jobs (5000 jobs)");
    let (dur, throughput) = benchmark_bulk_add(5000).await;
    println!("   Duration: {}", format_duration(dur));
    println!("   Throughput: {} jobs/sec", format_number(throughput));
    let bulk_throughput = throughput;

    // 4. Processing
    println!("\n⚙️  Benchmark: Processing jobs (1000 jobs, concurrency=10)");
    let (dur, throughput) = benchmark_processing(1000, 10).await;
    println!("   Duration: {}", format_duration(dur));
    println!("   Throughput: {} jobs/sec", format_number(throughput));
    let proc_throughput = throughput;

    // 5. Processing high concurrency
    println!("\n⚙️  Benchmark: Processing jobs (10,000 jobs, concurrency=100)");
    let (dur, throughput) = benchmark_processing(10_000, 100).await;
    println!("   Duration: {}", format_duration(dur));
    println!("   Throughput: {} jobs/sec", format_number(throughput));
    let proc_high_throughput = throughput;

    // Summary
    println!("\n{}", "=".repeat(50));
    println!("📊 Summary");
    println!("{}", "=".repeat(50));
    println!(
        "Add Sequential:  {} jobs/sec",
        format_number(seq_throughput)
    );
    println!(
        "Add Parallel:    {} jobs/sec",
        format_number(par_throughput)
    );
    println!(
        "Bulk Add:        {} jobs/sec",
        format_number(bulk_throughput)
    );
    println!(
        "Processing (10): {} jobs/sec",
        format_number(proc_throughput)
    );
    println!(
        "Processing (100):{} jobs/sec",
        format_number(proc_high_throughput)
    );
    println!();
}
