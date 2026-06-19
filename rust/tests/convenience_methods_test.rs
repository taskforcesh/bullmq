//! Convenience-method tests — `Queue::update_job_progress`,
//! `Job::move_to_wait`, `Queue::record_job_counts_metric`.
//!
//! Mirror the corresponding Node.js `Queue.updateJobProgress`, `Job.moveToWait`
//! and `Queue.recordJobCountsMetric`. Require a running Redis instance at
//! `redis://127.0.0.1:6379`.
#![allow(clippy::collapsible_match, clippy::collapsible_if)]

mod common;

use bullmq::types::{JobProgress, JobState};
use bullmq::worker::{CancellationToken, ProcessorFn};
use bullmq::{
    Job, Queue, QueueEvent, QueueEvents, QueueEventsOptions, QueueOptions, Worker, WorkerOptions,
};
use common::{cleanup_queue, test_connection, test_queue_name};
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn noop_processor() -> ProcessorFn {
    Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::Value::Null) })
    })
}

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

// ── Queue::update_job_progress ──────────────────────────────────────────────

#[tokio::test]
async fn test_update_job_progress_number() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    let job = queue
        .add("test", serde_json::json!({}), None)
        .await
        .unwrap();
    queue
        .update_job_progress(job.id(), JobProgress::Number(42.0))
        .await
        .unwrap();

    let reloaded = queue.get_job(job.id()).await.unwrap().unwrap();
    match reloaded.progress() {
        JobProgress::Number(n) => assert_eq!(*n, 42.0),
        other => panic!("expected number progress, got {other:?}"),
    }

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_update_job_progress_object() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    let job = queue
        .add("test", serde_json::json!({}), None)
        .await
        .unwrap();
    queue
        .update_job_progress(
            job.id(),
            JobProgress::Object(serde_json::json!({"pct": 10})),
        )
        .await
        .unwrap();

    let reloaded = queue.get_job(job.id()).await.unwrap().unwrap();
    match reloaded.progress() {
        JobProgress::Object(v) => assert_eq!(v, &serde_json::json!({"pct": 10})),
        other => panic!("expected object progress, got {other:?}"),
    }

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_update_job_progress_emits_event() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    let events = QueueEvents::new(
        &name,
        QueueEventsOptions {
            connection: test_connection(),
            last_event_id: Some("0".to_string()),
            blocking_timeout: 1000,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let job = queue
        .add("test", serde_json::json!({}), None)
        .await
        .unwrap();
    queue
        .update_job_progress(job.id(), JobProgress::Number(75.0))
        .await
        .unwrap();

    let event = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(entry) = events.next_event().await {
                if let QueueEvent::Progress { .. } = entry.event {
                    return entry.event;
                }
            }
        }
    })
    .await
    .expect("timed out waiting for progress event");

    match event {
        QueueEvent::Progress { job_id, data } => {
            assert_eq!(job_id, job.id());
            assert_eq!(data, serde_json::json!(75.0));
        }
        other => panic!("expected progress, got {other:?}"),
    }

    events.close().await;
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_update_job_progress_nonexistent_errors() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    let err = queue
        .update_job_progress("does-not-exist", JobProgress::Number(1.0))
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains("updateProgress failed"),
        "unexpected error: {err}"
    );

    cleanup_queue(&queue).await;
}

// ── Job::move_to_wait ───────────────────────────────────────────────────────

#[tokio::test]
async fn test_move_to_wait_returns_active_job_to_wait() {
    let name = test_queue_name();
    let conn = test_connection();
    let queue = new_queue(&name).await;

    queue
        .add("test", serde_json::json!({}), None)
        .await
        .unwrap();

    // A non-autorun worker lets us fetch the job manually and hold it active.
    let worker = Worker::new(
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

    let job = worker
        .get_next_job("token-1")
        .await
        .unwrap()
        .expect("a job should be available");
    assert_eq!(queue.get_active_count().await.unwrap(), 1);

    // Move it back to wait using the job's lock token (ctx default).
    let pttl = job.move_to_wait(None).await.unwrap();
    assert_eq!(pttl, 0, "no rate limit configured");

    assert_eq!(queue.get_active_count().await.unwrap(), 0);
    assert_eq!(queue.get_waiting_count().await.unwrap(), 1);
    assert_eq!(
        queue.get_job_state(job.id()).await.unwrap(),
        JobState::Waiting
    );

    worker.close(2000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_move_to_wait_with_wrong_token_errors() {
    let name = test_queue_name();
    let conn = test_connection();
    let queue = new_queue(&name).await;

    queue
        .add("test", serde_json::json!({}), None)
        .await
        .unwrap();

    let worker = Worker::new(
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

    let job = worker
        .get_next_job("the-real-token")
        .await
        .unwrap()
        .expect("a job should be available");

    // A token that does not match the lock must be rejected.
    let err = job.move_to_wait(Some("wrong-token")).await.unwrap_err();
    let _ = err; // any error is acceptable; the job must remain active.
    assert_eq!(queue.get_active_count().await.unwrap(), 1);

    worker.close(2000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ── Queue::record_job_counts_metric ─────────────────────────────────────────

#[tokio::test]
async fn test_record_job_counts_metric_returns_counts() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    for _ in 0..3 {
        queue
            .add("test", serde_json::json!({}), None)
            .await
            .unwrap();
    }

    let counts = queue
        .record_job_counts_metric(&["waiting", "completed"], None)
        .await
        .unwrap();
    assert_eq!(counts.get("waiting"), Some(&3));
    assert_eq!(counts.get("completed"), Some(&0));

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_record_job_counts_metric_invokes_recorder() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    for _ in 0..2 {
        queue
            .add("test", serde_json::json!({}), None)
            .await
            .unwrap();
    }

    let collected: Arc<Mutex<Vec<(String, u64)>>> = Arc::new(Mutex::new(Vec::new()));
    let collected_cb = collected.clone();
    let recorder = move |state: &str, count: u64| {
        collected_cb
            .lock()
            .unwrap()
            .push((state.to_string(), count));
    };

    let counts = queue
        .record_job_counts_metric(&["waiting", "active", "failed"], Some(&recorder))
        .await
        .unwrap();

    let recorded = collected.lock().unwrap().clone();
    // The recorder is invoked once per requested state.
    assert_eq!(recorded.len(), counts.len());
    let waiting = recorded.iter().find(|(s, _)| s == "waiting").unwrap();
    assert_eq!(waiting.1, 2);
    for (state, count) in &recorded {
        assert_eq!(counts.get(state), Some(count));
    }

    cleanup_queue(&queue).await;
}
