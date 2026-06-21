//! Job option tests — `size_limit` and `KeepJobs.limit`.
//!
//! Mirrors Node.js `tests/job.test.ts` size-limit cases. Requires a running
//! Redis instance at `redis://127.0.0.1:6379`.
#![allow(clippy::collapsible_match, clippy::collapsible_if)]

mod common;

use bullmq::types::{KeepJobs, RemoveOnFinish};
use bullmq::worker::{CancellationToken, ProcessorFn};
use bullmq::{Job, JobOptions, Queue, QueueOptions, Worker, WorkerOptions};
use common::{cleanup_queue, test_connection, test_queue_name};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

async fn new_queue(name: &str) -> Queue {
    Queue::new(
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
async fn test_size_limit_allows_small_payload() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    // {"foo":"bar"} is 13 bytes; limit 20 → accepted.
    let job = queue
        .add(
            "test",
            serde_json::json!({"foo": "bar"}),
            Some(JobOptions {
                size_limit: Some(20),
                ..Default::default()
            }),
        )
        .await
        .unwrap();
    assert!(!job.id().is_empty());

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_size_limit_rejects_large_payload() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    // {"foo":"bar"} is 13 bytes; limit 12 → rejected.
    let err = queue
        .add(
            "test",
            serde_json::json!({"foo": "bar"}),
            Some(JobOptions {
                size_limit: Some(12),
                ..Default::default()
            }),
        )
        .await
        .unwrap_err();
    assert_eq!(
        err.to_string(),
        "invalid configuration: The size of job test exceeds the limit 12 bytes"
    );

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_size_limit_counts_utf8_bytes() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    // {"foo":"βÅ®"} is 16 UTF-8 bytes; limit 15 → rejected.
    let err = queue
        .add(
            "test",
            serde_json::json!({"foo": "βÅ®"}),
            Some(JobOptions {
                size_limit: Some(15),
                ..Default::default()
            }),
        )
        .await
        .unwrap_err();
    assert!(err
        .to_string()
        .contains("The size of job test exceeds the limit 15 bytes"));

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_size_limit_rejects_even_with_custom_job_id() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    let err = queue
        .add(
            "test",
            serde_json::json!({"foo": "bar"}),
            Some(JobOptions {
                size_limit: Some(12),
                job_id: Some("customJobId".to_string()),
                ..Default::default()
            }),
        )
        .await
        .unwrap_err();
    assert!(err
        .to_string()
        .contains("The size of job test exceeds the limit 12 bytes"));

    // The rejected job must not have been added.
    assert_eq!(queue.get_waiting_count().await.unwrap(), 0);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_size_limit_enforced_in_add_bulk() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    // One job fits (limit 20), one is too large (limit 12) → add_bulk fails.
    let err = queue
        .add_bulk(vec![
            (
                "small".to_string(),
                serde_json::json!({"foo": "bar"}),
                Some(JobOptions {
                    size_limit: Some(20),
                    ..Default::default()
                }),
            ),
            (
                "big".to_string(),
                serde_json::json!({"foo": "bar"}),
                Some(JobOptions {
                    size_limit: Some(12),
                    ..Default::default()
                }),
            ),
        ])
        .await
        .unwrap_err();
    assert!(err
        .to_string()
        .contains("The size of job big exceeds the limit 12 bytes"));
    assert_eq!(queue.get_waiting_count().await.unwrap(), 0);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_keep_jobs_limit_is_accepted_and_trims() {
    let name = test_queue_name();
    let conn = test_connection();
    let queue = new_queue(&name).await;

    let num_jobs = 5u32;
    for i in 0..num_jobs {
        queue
            .add("test", serde_json::json!({ "i": i }), None)
            .await
            .unwrap();
    }

    let processed = Arc::new(AtomicU32::new(0));
    let processed_proc = processed.clone();
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let processed = processed_proc.clone();
        Box::pin(async move {
            processed.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::Value::Null)
        })
    });

    // Keep at most 1 completed job, removing up to 10 excess jobs per finish.
    let worker = Worker::new(
        &name,
        processor,
        WorkerOptions {
            connection: conn,
            autorun: true,
            concurrency: 1,
            remove_on_complete: Some(RemoveOnFinish::Options(KeepJobs {
                age: None,
                count: Some(1),
                limit: Some(10),
            })),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // Wait until all jobs have been processed.
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if processed.load(Ordering::SeqCst) >= num_jobs {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timed out processing jobs");

    // Give eviction a moment to settle, then assert the completed set was
    // trimmed toward the keep-count (best-effort eviction, so allow a little lag).
    tokio::time::sleep(Duration::from_millis(200)).await;
    let completed = queue.get_completed_count().await.unwrap();
    assert!(
        completed <= 2,
        "expected completed set trimmed to ~1, got {completed}"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}
