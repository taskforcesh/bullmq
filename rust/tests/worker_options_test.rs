//! Worker behavioural option tests — `max_started_attempts`,
//! `skip_stalled_check`, `skip_lock_renewal`.
//!
//! Mirrors Node.js `tests/worker.test.ts` (`maxStartedAttempts`) and
//! `tests/stalled_jobs.test.ts` (`skipStalledCheck`). Requires a running Redis
//! instance at `redis://127.0.0.1:6379`.
#![allow(clippy::collapsible_match, clippy::collapsible_if)]

mod common;

use bullmq::error::Error;
use bullmq::worker::{CancellationToken, ProcessorFn, WorkerEvent};
use bullmq::{Job, Queue, QueueOptions, Worker, WorkerOptions};
use common::{cleanup_queue, test_connection, test_queue_name};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
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

/// Wait for the next `Failed` worker event and return its error message.
async fn wait_for_failed(worker: &Worker, secs: u64) -> String {
    tokio::time::timeout(Duration::from_secs(secs), async {
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Failed { error, .. }) => return error,
                Some(_) => continue,
                None => panic!("worker event channel closed"),
            }
        }
    })
    .await
    .expect("timed out waiting for failed event")
}

#[tokio::test]
async fn test_max_started_attempts_fails_after_limit() {
    let name = test_queue_name();
    let conn = test_connection();
    let queue = new_queue(&name).await;

    queue
        .add("test", serde_json::json!({}), None)
        .await
        .unwrap();

    // The processor moves the job to delayed on its first run, so the worker
    // picks it up a second time. On the second pickup attemptsStarted == 2 which
    // exceeds maxStartedAttempts (1), so the job fails before processing.
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        Box::pin(async move {
            job.move_to_delayed(now_ms() + 150).await.unwrap();
            Err(Error::Delayed)
        })
    });

    let worker = Worker::new(
        &name,
        processor,
        WorkerOptions {
            connection: conn,
            autorun: true,
            max_started_attempts: Some(1),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let reason = wait_for_failed(&worker, 15).await;
    assert_eq!(reason, "job started more than allowable limit");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_max_started_attempts_zero_fails_on_first_pickup() {
    let name = test_queue_name();
    let conn = test_connection();
    let queue = new_queue(&name).await;

    queue
        .add("test", serde_json::json!({}), None)
        .await
        .unwrap();

    // With a limit of 0, the very first pickup (attemptsStarted == 1) already
    // exceeds it, so the processor must never run.
    let ran = Arc::new(AtomicU32::new(0));
    let ran_proc = ran.clone();
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let ran = ran_proc.clone();
        Box::pin(async move {
            ran.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::Value::Null)
        })
    });

    let worker = Worker::new(
        &name,
        processor,
        WorkerOptions {
            connection: conn,
            autorun: true,
            max_started_attempts: Some(0),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let reason = wait_for_failed(&worker, 15).await;
    assert_eq!(reason, "job started more than allowable limit");
    assert_eq!(ran.load(Ordering::SeqCst), 0, "processor must not run");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_max_started_attempts_runs_up_to_limit_then_fails() {
    let name = test_queue_name();
    let conn = test_connection();
    let queue = new_queue(&name).await;

    queue
        .add("test", serde_json::json!({}), None)
        .await
        .unwrap();

    // With a limit of 2, the job may start twice (attemptsStarted 1 and 2). The
    // processor re-delays itself each run; the third pickup (attemptsStarted 3)
    // exceeds the limit and fails before running.
    let runs = Arc::new(AtomicU32::new(0));
    let runs_proc = runs.clone();
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let runs = runs_proc.clone();
        Box::pin(async move {
            runs.fetch_add(1, Ordering::SeqCst);
            job.move_to_delayed(now_ms() + 100).await.unwrap();
            Err(Error::Delayed)
        })
    });

    let worker = Worker::new(
        &name,
        processor,
        WorkerOptions {
            connection: conn,
            autorun: true,
            max_started_attempts: Some(2),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let reason = wait_for_failed(&worker, 20).await;
    assert_eq!(reason, "job started more than allowable limit");
    assert_eq!(
        runs.load(Ordering::SeqCst),
        2,
        "processor should have run exactly up to the limit"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_skip_stalled_check_processes_all_jobs() {
    let name = test_queue_name();
    let conn = test_connection();
    let queue = new_queue(&name).await;

    let concurrency = 4;
    for i in 0..concurrency {
        queue
            .add("test", serde_json::json!({ "i": i }), None)
            .await
            .unwrap();
    }

    let completed = Arc::new(AtomicU32::new(0));
    let completed_proc = completed.clone();
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let completed = completed_proc.clone();
        Box::pin(async move {
            tokio::time::sleep(Duration::from_millis(400)).await;
            completed.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::Value::Null)
        })
    });

    let worker = Worker::new(
        &name,
        processor,
        WorkerOptions {
            connection: conn,
            autorun: true,
            concurrency: concurrency as usize,
            stalled_interval: 50,
            skip_stalled_check: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let ok = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if completed.load(Ordering::SeqCst) >= concurrency {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timed out waiting for all jobs to complete");
    assert!(ok);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_skip_lock_renewal_still_processes() {
    let name = test_queue_name();
    let conn = test_connection();
    let queue = new_queue(&name).await;

    queue
        .add("test", serde_json::json!({}), None)
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        Box::pin(async move {
            // Longer than the default lock_renew_time but well within lock_duration.
            tokio::time::sleep(Duration::from_millis(300)).await;
            Ok(serde_json::Value::Null)
        })
    });

    let worker = Worker::new(
        &name,
        processor,
        WorkerOptions {
            connection: conn,
            autorun: true,
            lock_duration: 30_000,
            skip_lock_renewal: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let completed = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => return true,
                Some(_) => continue,
                None => return false,
            }
        }
    })
    .await
    .expect("timed out waiting for completion");
    assert!(completed);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}
