//! Rate limiting tests.

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use bullmq::worker::{CancellationToken, ProcessorFn};
use bullmq::{Job, JobOptions, Queue, QueueOptions, RateLimiterOptions, Worker, WorkerOptions};
use common::{cleanup_queue, test_connection, test_queue_name};
use tokio::sync::mpsc;

// ═══════════════════════════════════════════════════════════════════════════
// Worker-level rate limiting
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_worker_rate_limits_jobs() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add 4 jobs
    for i in 0..4 {
        queue
            .add("rate-test", serde_json::json!({"idx": i}))
            .options(JobOptions::default())
            .await
            .unwrap();
    }

    // Worker with rate limit: max 2 jobs per 1000ms
    let (tx, mut rx) = mpsc::channel(10);
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send(std::time::Instant::now()).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        limiter: Some(RateLimiterOptions {
            max: 2,
            duration: 1000,
        }),
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Collect timestamps of all 4 processed jobs
    let mut timestamps = Vec::new();
    for _ in 0..4 {
        let ts = tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("Timed out waiting for job")
            .unwrap();
        timestamps.push(ts);
    }

    // First 2 should be processed quickly, next 2 should be after ~1s
    let first_batch_end = timestamps[1];
    let second_batch_start = timestamps[2];
    let gap = second_batch_start.duration_since(first_batch_end);

    // The gap should be at least 800ms (allowing some tolerance)
    assert!(
        gap >= Duration::from_millis(800),
        "Rate limit gap should be >= 800ms, got {:?}",
        gap
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_worker_rate_limit_does_not_block_without_limiter() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add 4 jobs
    for i in 0..4 {
        queue
            .add("no-limit", serde_json::json!({"idx": i}))
            .options(JobOptions::default())
            .await
            .unwrap();
    }

    let (tx, mut rx) = mpsc::channel(10);
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send(std::time::Instant::now()).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    // No limiter set
    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut timestamps = Vec::new();
    for _ in 0..4 {
        let ts = tokio::time::timeout(Duration::from_secs(3), rx.recv())
            .await
            .expect("Timed out")
            .unwrap();
        timestamps.push(ts);
    }

    // All 4 should still be processed quickly without rate limiting.
    let total = timestamps[3].duration_since(timestamps[0]);
    assert!(
        total < Duration::from_millis(1500),
        "Without limiter, all jobs should process fast, took {:?}",
        total
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_worker_fetch_next_respects_limiter() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    for i in 0..3 {
        queue
            .add("fetch-next-rate-test", serde_json::json!({"idx": i}))
            .options(JobOptions::default())
            .await
            .unwrap();
    }

    let processed = Arc::new(AtomicUsize::new(0));
    let processed_counter = processed.clone();
    let (tx, mut rx) = mpsc::channel(10);
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        let processed = processed_counter.clone();
        Box::pin(async move {
            processed.fetch_add(1, Ordering::SeqCst);
            tx.send(std::time::Instant::now()).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        limiter: Some(RateLimiterOptions {
            max: 1,
            duration: 1000,
        }),
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut timestamps = Vec::new();
    for _ in 0..3 {
        let ts = tokio::time::timeout(Duration::from_secs(8), rx.recv())
            .await
            .expect("Timed out waiting for rate-limited job")
            .unwrap();
        timestamps.push(ts);
    }

    let first_gap = timestamps[1].duration_since(timestamps[0]);
    let second_gap = timestamps[2].duration_since(timestamps[1]);
    assert!(
        first_gap >= Duration::from_millis(800),
        "First fetch-next limiter gap should be >= 800ms, got {:?}",
        first_gap
    );
    assert!(
        second_gap >= Duration::from_millis(800),
        "Second fetch-next limiter gap should be >= 800ms, got {:?}",
        second_gap
    );
    assert_eq!(processed.load(Ordering::SeqCst), 3);

    worker.close(5000).await.unwrap();

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 3);
    assert_eq!(counts.active, 0);

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Queue-level rate limiting
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_queue_rate_limit_blocks_processing() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add a job
    queue
        .add("test", serde_json::json!({"v": 1}))
        .await
        .unwrap();

    // Set global rate limit (needed for queue.rate_limit to take effect)
    // and then override with queue.rate_limit for 1.5s
    queue.set_global_rate_limit(1, 60_000).await.unwrap();
    queue.rate_limit(1500).await.unwrap();

    let (tx, mut rx) = mpsc::channel(5);
    let start = std::time::Instant::now();
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send(()).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Job should be processed after rate limit expires (~1.5s)
    tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("Timed out")
        .unwrap();

    let elapsed = start.elapsed();
    assert!(
        elapsed >= Duration::from_millis(1200),
        "Job should be delayed by rate limit, processed after {:?}",
        elapsed
    );

    worker.close(5000).await.unwrap();
    queue.remove_global_rate_limit().await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_queue_remove_rate_limit_key() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Set rate limit
    queue.rate_limit(60_000).await.unwrap();

    // Remove it
    let removed = queue.remove_rate_limit_key().await.unwrap();
    assert!(removed);

    // Second removal should return false
    let removed2 = queue.remove_rate_limit_key().await.unwrap();
    assert!(!removed2);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_queue_set_global_rate_limit() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Set global rate limit
    queue.set_global_rate_limit(5, 2000).await.unwrap();

    // Add 6 jobs
    for i in 0..6 {
        queue
            .add("test", serde_json::json!({"idx": i}))
            .await
            .unwrap();
    }

    let (tx, mut rx) = mpsc::channel(10);
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send(std::time::Instant::now()).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Collect first 6 processing timestamps
    let mut timestamps = Vec::new();
    for _ in 0..6 {
        let ts = tokio::time::timeout(Duration::from_secs(8), rx.recv())
            .await
            .expect("Timed out")
            .unwrap();
        timestamps.push(ts);
    }

    // The 6th job should start at least ~2s after the 1st (rate limit window)
    let gap = timestamps[5].duration_since(timestamps[0]);
    assert!(
        gap >= Duration::from_millis(1500),
        "Global rate limit should enforce delay, gap was {:?}",
        gap
    );

    worker.close(5000).await.unwrap();

    // Cleanup
    queue.remove_global_rate_limit().await.unwrap();
    cleanup_queue(&queue).await;
}
