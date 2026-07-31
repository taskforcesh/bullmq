//! Queue meta/version tests — `get_meta`, `get_version`, `is_maxed`.
//!
//! Requires a running Redis instance at `redis://127.0.0.1:6379`.
#![allow(clippy::collapsible_match, clippy::collapsible_if)]

mod common;

use bullmq::worker::{CancellationToken, ProcessorFn};
use bullmq::{Job, Queue, QueueOptions, Worker, WorkerOptions};
use common::{cleanup_queue, test_connection, test_queue_name};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;

async fn new_queue(name: &str) -> Queue {
    Queue::with_options(
        name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn test_get_version_records_library() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    let version = queue.get_version().await.unwrap();
    let version = version.expect("library version should be recorded on create");
    assert!(
        version.starts_with("bullmq-official:"),
        "unexpected version: {version}"
    );

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_meta_defaults() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    let meta = queue.get_meta().await.unwrap();
    assert_eq!(meta.concurrency, None);
    assert_eq!(meta.max, None);
    assert_eq!(meta.duration, None);
    assert!(!meta.paused);
    // The library field is preserved among the "other" entries.
    assert!(meta.other.contains_key("library"));

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_meta_reflects_global_concurrency_and_rate_limit() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    queue.set_global_concurrency(5).await.unwrap();
    queue.set_global_rate_limit(10, 1000).await.unwrap();

    let meta = queue.get_meta().await.unwrap();
    assert_eq!(meta.concurrency, Some(5));
    assert_eq!(meta.max, Some(10));
    assert_eq!(meta.duration, Some(1000));

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_meta_reflects_paused() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    queue.pause().await.unwrap();
    let meta = queue.get_meta().await.unwrap();
    assert!(meta.paused);

    queue.resume().await.unwrap();
    let meta = queue.get_meta().await.unwrap();
    assert!(!meta.paused);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_is_maxed() {
    let name = test_queue_name();
    let conn = test_connection();
    let queue = new_queue(&name).await;

    // No global concurrency configured → never maxed.
    assert!(!queue.is_maxed().await.unwrap());

    // With a global concurrency of 1 and one job held active, the queue is maxed.
    queue.set_global_concurrency(1).await.unwrap();
    queue.add("hold", serde_json::json!({})).await.unwrap();

    let release = Arc::new(Notify::new());
    let release_proc = release.clone();
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let release = release_proc.clone();
        Box::pin(async move {
            release.notified().await;
            Ok(serde_json::Value::Null)
        })
    });
    let worker = Worker::with_options(
        &name,
        processor,
        WorkerOptions {
            connection: conn,
            autorun: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // Wait until the job is active (queue becomes maxed).
    let maxed = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if queue.is_maxed().await.unwrap() {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timed out waiting for queue to become maxed");
    assert!(maxed);

    release.notify_waiters();
    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}
