//! Global concurrency tests.

mod common;

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use bullmq::worker::{CancellationToken, ProcessorFn};
use bullmq::{Job, Queue, QueueOptions, Worker, WorkerOptions};
use common::{cleanup_queue, test_connection, test_queue_name};
use tokio::sync::mpsc;

#[tokio::test]
async fn test_global_concurrency_limits_active_jobs() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Set global concurrency to 1
    queue.set_global_concurrency(1).await.unwrap();

    // Add 3 jobs
    for i in 0..3 {
        queue
            .add("test", serde_json::json!({"n": i}))
            .await
            .unwrap();
    }

    let max_concurrent = Arc::new(AtomicU32::new(0));
    let current_active = Arc::new(AtomicU32::new(0));
    let (tx, mut rx) = mpsc::channel(10);

    let max_concurrent_clone = max_concurrent.clone();
    let current_active_clone = current_active.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let max_concurrent = max_concurrent_clone.clone();
        let current_active = current_active_clone.clone();
        let tx = tx.clone();
        Box::pin(async move {
            let prev = current_active.fetch_add(1, Ordering::SeqCst);
            let active_now = prev + 1;
            // Update max if we see more concurrent than before
            max_concurrent.fetch_max(active_now, Ordering::SeqCst);

            // Hold the job for a bit to allow overlap detection
            tokio::time::sleep(Duration::from_millis(100)).await;

            current_active.fetch_sub(1, Ordering::SeqCst);
            tx.send(()).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    // Worker with local concurrency of 5 (higher than global)
    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        concurrency: 5,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for all 3 jobs to complete
    for _ in 0..3 {
        tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("Timed out waiting for job")
            .unwrap();
    }

    let observed_max = max_concurrent.load(Ordering::SeqCst);
    assert_eq!(
        observed_max, 1,
        "Global concurrency should limit to 1 active job at a time, but saw {}",
        observed_max
    );

    worker.close(5000).await.unwrap();
    queue.remove_global_concurrency().await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_global_concurrency_allows_multiple_when_set_higher() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Set global concurrency to 3
    queue.set_global_concurrency(3).await.unwrap();

    // Add 5 jobs
    for i in 0..5 {
        queue
            .add("test", serde_json::json!({"n": i}))
            .await
            .unwrap();
    }

    let max_concurrent = Arc::new(AtomicU32::new(0));
    let current_active = Arc::new(AtomicU32::new(0));
    let (tx, mut rx) = mpsc::channel(10);

    let max_concurrent_clone = max_concurrent.clone();
    let current_active_clone = current_active.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let max_concurrent = max_concurrent_clone.clone();
        let current_active = current_active_clone.clone();
        let tx = tx.clone();
        Box::pin(async move {
            let prev = current_active.fetch_add(1, Ordering::SeqCst);
            let active_now = prev + 1;
            max_concurrent.fetch_max(active_now, Ordering::SeqCst);

            tokio::time::sleep(Duration::from_millis(200)).await;

            current_active.fetch_sub(1, Ordering::SeqCst);
            tx.send(()).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    // Worker with concurrency 10 (higher than global limit)
    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        concurrency: 10,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for all 5 jobs
    for _ in 0..5 {
        tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .expect("Timed out waiting for job")
            .unwrap();
    }

    let observed_max = max_concurrent.load(Ordering::SeqCst);
    assert!(
        observed_max <= 3,
        "Global concurrency should limit to at most 3, but saw {}",
        observed_max
    );
    // Should actually hit the limit (at least 2 concurrent)
    assert!(
        observed_max >= 2,
        "Expected at least 2 concurrent jobs given concurrency=3 and 5 jobs, but saw {}",
        observed_max
    );

    worker.close(5000).await.unwrap();
    queue.remove_global_concurrency().await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_remove_global_concurrency_restores_unlimited() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Set then remove global concurrency
    queue.set_global_concurrency(1).await.unwrap();
    queue.remove_global_concurrency().await.unwrap();

    // Add 3 jobs
    for i in 0..3 {
        queue
            .add("test", serde_json::json!({"n": i}))
            .await
            .unwrap();
    }

    let max_concurrent = Arc::new(AtomicU32::new(0));
    let current_active = Arc::new(AtomicU32::new(0));
    let (tx, mut rx) = mpsc::channel(10);

    let max_concurrent_clone = max_concurrent.clone();
    let current_active_clone = current_active.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let max_concurrent = max_concurrent_clone.clone();
        let current_active = current_active_clone.clone();
        let tx = tx.clone();
        Box::pin(async move {
            let prev = current_active.fetch_add(1, Ordering::SeqCst);
            let active_now = prev + 1;
            max_concurrent.fetch_max(active_now, Ordering::SeqCst);

            tokio::time::sleep(Duration::from_millis(200)).await;

            current_active.fetch_sub(1, Ordering::SeqCst);
            tx.send(()).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    // Worker with concurrency 5
    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        concurrency: 5,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for all 3 jobs
    for _ in 0..3 {
        tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("Timed out waiting for job")
            .unwrap();
    }

    let observed_max = max_concurrent.load(Ordering::SeqCst);
    // With no global concurrency, all 3 should run concurrently (worker concurrency=5)
    assert!(
        observed_max >= 2,
        "Without global concurrency, expected multiple concurrent jobs, but saw {}",
        observed_max
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}
