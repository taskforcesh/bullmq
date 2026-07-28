//! Job-level method tests — clearLogs, discard, state checks.

mod common;

use bullmq::{Queue, QueueOptions};
use common::{cleanup_queue, test_connection, test_queue_name};

// ═══════════════════════════════════════════════════════════════════════════
// Job.clear_logs
// ═══════════════════════════════════════════════════════════════════════════

// Node.js: ".clearLogs > can clear the log"
#[tokio::test]
async fn test_clear_logs() {
    let name = test_queue_name();
    let queue = Queue::with_options(
        &name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

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
    let queue = Queue::with_options(
        &name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

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
