//! Delayed job processing tests.

mod common;

use bullmq::worker::{CancellationToken, ProcessorFn};
use bullmq::{Job, JobOptions, Queue, QueueOptions, Worker, WorkerOptions};
use common::{cleanup_queue, test_connection, test_queue_name};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

#[tokio::test]
async fn test_delayed_job_processed_after_delay() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let delay_ms = 500;
    let job_opts = JobOptions {
        delay: Some(delay_ms),
        ..Default::default()
    };

    let start = std::time::Instant::now();
    queue
        .add(
            "delayed-test",
            serde_json::json!({"delayed": "foobar"}),
            Some(job_opts),
        )
        .await
        .unwrap();

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.delayed, 1);
    assert_eq!(counts.waiting, 0);

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::Value::Null) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Completed { .. }) {
                    break;
                }
            }
        }
    })
    .await
    .expect("timeout waiting for delayed job to complete");

    let elapsed = start.elapsed();
    assert!(
        elapsed >= Duration::from_millis(delay_ms),
        "Job processed too early: {:?} < {}ms",
        elapsed,
        delay_ms
    );
    assert!(
        elapsed < Duration::from_millis(delay_ms * 3),
        "Job processed too late: {:?}",
        elapsed
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_delayed_job_correct_order() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Add jobs with different delays: 300ms, 100ms, 200ms
    // Should be processed in order: 100, 200, 300
    for (idx, delay) in [(1, 300u64), (2, 100), (3, 200)] {
        let job_opts = JobOptions {
            delay: Some(delay),
            ..Default::default()
        };
        queue
            .add("test", serde_json::json!({"idx": idx}), Some(job_opts))
            .await
            .unwrap();
    }

    let (tx, mut rx) = mpsc::channel(10);
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            let idx = job.data()["idx"].as_u64().unwrap();
            tx.send(idx).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    let mut order = Vec::new();
    tokio::time::timeout(Duration::from_secs(5), async {
        while order.len() < 3 {
            if let Some(idx) = rx.recv().await {
                order.push(idx);
            }
        }
    })
    .await
    .expect("timeout waiting for all delayed jobs");

    // Should be processed in delay order: 100ms first (idx=2), 200ms (idx=3), 300ms (idx=1)
    assert_eq!(order, vec![2, 3, 1]);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}
