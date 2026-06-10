//! Job-level method tests — clearLogs, discard, state checks.

mod common;

use bullmq::worker::{CancellationToken, ProcessorFn};
use bullmq::{Job, JobOptions, Queue, QueueOptions, Worker, WorkerOptions};
use common::{cleanup_queue, test_connection, test_queue_name};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

// ═══════════════════════════════════════════════════════════════════════════
// Job.clear_logs
// ═══════════════════════════════════════════════════════════════════════════

// Node.js: ".clearLogs > can clear the log"
#[tokio::test]
async fn test_clear_logs() {
    let name = test_queue_name();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let job = queue.add("test", serde_json::json!({"foo": "bar"}), None).await.unwrap();

    job.log("some log text 1").await.unwrap();
    job.log("some log text 2").await.unwrap();

    let (logs, count) = queue.get_job_logs(job.id(), 0, -1, true).await.unwrap();
    assert_eq!(count, 2);
    assert_eq!(logs, vec!["some log text 1", "some log text 2"]);

    job.clear_logs(None).await.unwrap();

    let (logs, count) = queue.get_job_logs(job.id(), 0, -1, true).await.unwrap();
    assert_eq!(count, 0);
    assert!(logs.is_empty());

    cleanup_queue(&queue).await;
}

// Node.js: ".clearLogs > can preserve up to keepLogs latest entries"
#[tokio::test]
async fn test_clear_logs_keep_latest() {
    let name = test_queue_name();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let job = queue.add("test", serde_json::json!({"foo": "bar"}), None).await.unwrap();

    job.log("some log text 1").await.unwrap();
    job.log("some log text 2").await.unwrap();
    job.log("some log text 3").await.unwrap();

    let (logs, count) = queue.get_job_logs(job.id(), 0, -1, true).await.unwrap();
    assert_eq!(count, 3);
    assert_eq!(
        logs,
        vec!["some log text 1", "some log text 2", "some log text 3"]
    );

    // keepLogs larger than count is a no-op.
    job.clear_logs(Some(4)).await.unwrap();
    let (logs, count) = queue.get_job_logs(job.id(), 0, -1, true).await.unwrap();
    assert_eq!(count, 3);

    // keepLogs equal to count is a no-op.
    job.clear_logs(Some(3)).await.unwrap();
    let (logs2, count) = queue.get_job_logs(job.id(), 0, -1, true).await.unwrap();
    assert_eq!(count, 3);
    assert_eq!(logs2, logs);

    // Keep only the latest 2.
    job.clear_logs(Some(2)).await.unwrap();
    let (logs, count) = queue.get_job_logs(job.id(), 0, -1, true).await.unwrap();
    assert_eq!(count, 2);
    assert_eq!(logs, vec!["some log text 2", "some log text 3"]);

    // keepLogs = 0 removes all.
    job.clear_logs(Some(0)).await.unwrap();
    let (logs, count) = queue.get_job_logs(job.id(), 0, -1, true).await.unwrap();
    assert_eq!(count, 0);
    assert!(logs.is_empty());

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Job.discard
// ═══════════════════════════════════════════════════════════════════════════

// A discarded job that fails is NOT retried, even with attempts > 1.
#[tokio::test]
async fn test_discard_prevents_retry() {
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

    queue
        .add(
            "test",
            serde_json::json!({}),
            Some(JobOptions {
                attempts: Some(5),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

    let attempts = Arc::new(AtomicUsize::new(0));
    let attempts_clone = attempts.clone();
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let attempts = attempts_clone.clone();
        Box::pin(async move {
            attempts.fetch_add(1, Ordering::SeqCst);
            // Discard so the failure is not retried.
            job.discard();
            assert!(job.is_discarded());
            Err(bullmq::Error::ProcessingError("boom".to_string()))
        })
    });

    let worker = Worker::new(
        &name,
        processor,
        WorkerOptions {
            connection: conn.clone(),
            autorun: true,
            drain_delay: 1,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // Wait for the job to permanently fail.
    let settled = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if queue.get_failed_count().await.unwrap() >= 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await;
    assert!(settled.is_ok(), "job did not fail");

    // Give any (erroneous) retry a chance to run.
    tokio::time::sleep(Duration::from_millis(300)).await;

    // The processor must have run exactly once (no retry).
    assert_eq!(attempts.load(Ordering::SeqCst), 1);
    assert_eq!(queue.get_failed_count().await.unwrap(), 1);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}
