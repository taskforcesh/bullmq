//! Worker discovery tests — `Queue::get_workers` / `get_workers_count`.
//!
//! Mirrors Node.js `tests/getters.test.ts` `.getWorkers` cases. Requires a
//! running Redis instance at `redis://127.0.0.1:6379`.
#![allow(clippy::collapsible_match, clippy::collapsible_if)]

mod common;

use bullmq::worker::{CancellationToken, ProcessorFn};
use bullmq::{Job, Queue, QueueOptions, Worker, WorkerOptions};
use common::{cleanup_queue, test_connection, test_queue_name};
use std::sync::Arc;

fn noop_processor() -> ProcessorFn {
    Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::Value::Null) })
    })
}

#[tokio::test]
async fn test_get_workers_for_queue_only() {
    let name = test_queue_name();
    let conn = test_connection();
    let queue = Queue::with_options(
        &name,
        QueueOptions {
            connection: conn.clone(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    assert_eq!(queue.get_workers_count().await.unwrap(), 0);

    let worker = Worker::with_options(
        &name,
        noop_processor(),
        WorkerOptions {
            connection: conn.clone(),
            autorun: false,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let workers = queue.get_workers().await.unwrap();
    assert_eq!(workers.len(), 1);

    let worker2 = Worker::with_options(
        &name,
        noop_processor(),
        WorkerOptions {
            connection: conn,
            autorun: false,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let next_workers = queue.get_workers().await.unwrap();
    assert_eq!(next_workers.len(), 2);
    assert_eq!(queue.get_workers_count().await.unwrap(), 2);

    // Every returned client's name is normalized to the queue name.
    for w in &next_workers {
        assert_eq!(w.get("name"), Some(&name));
        assert!(w.contains_key("rawname"));
    }

    worker.close(5000).await.unwrap();
    worker2.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_workers_including_their_names() {
    let name = test_queue_name();
    let conn = test_connection();
    let queue = Queue::with_options(
        &name,
        QueueOptions {
            connection: conn.clone(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let worker = Worker::with_options(
        &name,
        noop_processor(),
        WorkerOptions {
            connection: conn.clone(),
            autorun: false,
            name: Some("worker1".to_string()),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    assert_eq!(queue.get_workers().await.unwrap().len(), 1);
    assert_eq!(queue.get_workers_count().await.unwrap(), 1);

    let worker2 = Worker::with_options(
        &name,
        noop_processor(),
        WorkerOptions {
            connection: conn,
            autorun: false,
            name: Some("worker2".to_string()),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let next_workers = queue.get_workers().await.unwrap();
    assert_eq!(next_workers.len(), 2);

    let mut names: Vec<String> = next_workers
        .iter()
        .map(|w| {
            w.get("rawname")
                .map(|r| r.rsplit(':').next().unwrap_or("").to_string())
                .unwrap_or_default()
        })
        .collect();
    names.sort();
    assert_eq!(names, vec!["worker1".to_string(), "worker2".to_string()]);

    worker.close(5000).await.unwrap();
    worker2.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_workers_isolated_between_queues() {
    let name_a = test_queue_name();
    let name_b = test_queue_name();
    let conn = test_connection();

    let queue_a = Queue::with_options(
        &name_a,
        QueueOptions {
            connection: conn.clone(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let queue_b = Queue::with_options(
        &name_b,
        QueueOptions {
            connection: conn.clone(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // One worker on each queue.
    let worker_a = Worker::with_options(
        &name_a,
        noop_processor(),
        WorkerOptions {
            connection: conn.clone(),
            autorun: false,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let worker_b = Worker::with_options(
        &name_b,
        noop_processor(),
        WorkerOptions {
            connection: conn,
            autorun: false,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // Each queue must only see its own worker.
    assert_eq!(queue_a.get_workers_count().await.unwrap(), 1);
    assert_eq!(queue_b.get_workers_count().await.unwrap(), 1);

    let a_raw = queue_a.get_workers().await.unwrap()[0]
        .get("rawname")
        .cloned()
        .unwrap();
    let b_raw = queue_b.get_workers().await.unwrap()[0]
        .get("rawname")
        .cloned()
        .unwrap();
    assert_ne!(a_raw, b_raw);

    worker_a.close(5000).await.unwrap();
    worker_b.close(5000).await.unwrap();
    cleanup_queue(&queue_a).await;
    cleanup_queue(&queue_b).await;
}
