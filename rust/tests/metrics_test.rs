//! Metrics (time-series) tests.

mod common;

use bullmq::options::MetricsOptions;
use bullmq::worker::{CancellationToken, ProcessorFn};
use bullmq::{Job, Queue, QueueOptions, Worker, WorkerOptions};
use common::{cleanup_queue, test_connection, test_queue_name};
use std::sync::Arc;
use std::time::Duration;

// A worker configured with the metrics option records completed-job counts.
#[tokio::test]
async fn test_gather_metrics_for_completed_jobs() {
    let name = test_queue_name();
    let conn = test_connection();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: conn.clone(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let num_jobs = 5u64;
    for i in 0..num_jobs {
        queue
            .add("test", serde_json::json!({"index": i}), None)
            .await
            .unwrap();
    }

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::Value::Null) })
    });
    let worker = Worker::new(
        &name,
        processor,
        WorkerOptions {
            connection: conn.clone(),
            autorun: true,
            drain_delay: 1,
            metrics: Some(MetricsOptions {
                max_data_points: 2 * 60, // two hours of minute points
            }),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // Wait for all jobs to complete.
    let done = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if queue.get_completed_count().await.unwrap() >= num_jobs {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await;
    assert!(done.is_ok(), "jobs did not complete");

    let metrics = queue.get_metrics("completed", 0, -1).await.unwrap();
    // The metrics meta `count` is incremented once per completed job.
    assert_eq!(metrics.meta.count, num_jobs);
    // `count` equals the number of recorded data points (== data length).
    assert_eq!(metrics.count as usize, metrics.data.len());

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// A worker WITHOUT the metrics option records nothing.
#[tokio::test]
async fn test_no_metrics_when_disabled() {
    let name = test_queue_name();
    let conn = test_connection();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: conn.clone(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    for i in 0..3 {
        queue
            .add("test", serde_json::json!({"index": i}), None)
            .await
            .unwrap();
    }

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::Value::Null) })
    });
    let worker = Worker::new(
        &name,
        processor,
        WorkerOptions {
            connection: conn.clone(),
            autorun: true,
            drain_delay: 1,
            // No metrics option.
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let done = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if queue.get_completed_count().await.unwrap() >= 3 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await;
    assert!(done.is_ok(), "jobs did not complete");

    let metrics = queue.get_metrics("completed", 0, -1).await.unwrap();
    assert_eq!(metrics.meta.count, 0);
    assert_eq!(metrics.count, 0);
    assert!(metrics.data.is_empty());

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// Metrics are gathered for failed jobs too.
#[tokio::test]
async fn test_gather_metrics_for_failed_jobs() {
    let name = test_queue_name();
    let conn = test_connection();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: conn.clone(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let num_jobs = 4u64;
    for i in 0..num_jobs {
        queue
            .add(
                "test",
                serde_json::json!({"index": i}),
                Some(bullmq::JobOptions {
                    attempts: Some(1),
                    ..Default::default()
                }),
            )
            .await
            .unwrap();
    }

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(bullmq::Error::ProcessingError("boom".to_string())) })
    });
    let worker = Worker::new(
        &name,
        processor,
        WorkerOptions {
            connection: conn.clone(),
            autorun: true,
            drain_delay: 1,
            metrics: Some(MetricsOptions::default()),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let done = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if queue.get_failed_count().await.unwrap() >= num_jobs {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await;
    assert!(done.is_ok(), "jobs did not fail");

    let metrics = queue.get_metrics("failed", 0, -1).await.unwrap();
    assert_eq!(metrics.meta.count, num_jobs);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}
