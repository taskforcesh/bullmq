//! Stalled jobs detection and retry/backoff tests.

mod common;

use bullmq::error::Error;
use bullmq::types::JobState;
use bullmq::worker::{CancellationToken, ProcessorFn};
use bullmq::{Job, JobOptions, Queue, QueueOptions, Worker, WorkerOptions};
use common::{cleanup_queue, test_connection, test_queue_name};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

// ═══════════════════════════════════════════════════════════════════════════
// Stalled Jobs
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_stalled_jobs_moved_to_wait() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    for _ in 0..4 {
        queue
            .add("test", serde_json::json!({"bar": "baz"}), None)
            .await
            .unwrap();
    }

    // Worker 1: picks up jobs but "stalls" (very long processing, short lock)
    let processor1: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move {
            tokio::time::sleep(Duration::from_secs(60)).await;
            Ok(serde_json::Value::Null)
        })
    });

    let worker1_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        concurrency: 4,
        lock_duration: 500,
        stalled_interval: 100,
        ..Default::default()
    };
    let worker1 = Worker::new(&name, processor1, worker1_opts).await.unwrap();

    // Wait for all jobs to be active
    tokio::time::sleep(Duration::from_millis(300)).await;

    // Force close worker1 (simulates crash)
    worker1.close(0).await.unwrap();

    // Worker 2: picks up stalled jobs and processes them
    let (tx, mut rx) = mpsc::channel(10);
    let processor2: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send(()).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    let worker2_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        concurrency: 4,
        stalled_interval: 100,
        ..Default::default()
    };
    let worker2 = Worker::new(&name, processor2, worker2_opts).await.unwrap();

    // All 4 stalled jobs should be processed by worker2
    let mut count = 0;
    tokio::time::timeout(Duration::from_secs(10), async {
        while count < 4 {
            rx.recv().await.expect("channel closed before all stalled jobs were reprocessed");
            count += 1;
        }
    })
    .await
    .expect("timeout waiting for stalled jobs to be reprocessed");

    assert_eq!(count, 4);

    worker2.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
#[ignore = "requires stalled event emission feature"]
async fn test_stalled_event_emitted() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    queue
        .add("test", serde_json::json!({"bar": "baz"}), None)
        .await
        .unwrap();

    // Worker 1: picks up the job and stalls
    let processor1: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move {
            tokio::time::sleep(Duration::from_secs(60)).await;
            Ok(serde_json::Value::Null)
        })
    });

    let worker1_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        lock_duration: 500,
        stalled_interval: 100,
        ..Default::default()
    };
    let worker1 = Worker::new(&name, processor1, worker1_opts).await.unwrap();

    // Wait for job to be active
    tokio::time::sleep(Duration::from_millis(200)).await;
    worker1.close(0).await.unwrap();

    // Worker 2: should emit stalled event
    let processor2: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::Value::Null) })
    });

    let worker2_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        stalled_interval: 100,
        ..Default::default()
    };
    let worker2 = Worker::new(&name, processor2, worker2_opts).await.unwrap();

    let got_stalled = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(ev) = worker2.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Stalled { .. }) {
                    return true;
                }
            }
        }
    })
    .await;

    assert!(got_stalled.is_ok(), "Expected stalled event");

    worker2.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Retry / Backoff
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_worker_retries_with_fixed_backoff() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(3),
        backoff: Some(bullmq::types::BackoffStrategy::Fixed(200)),
        ..Default::default()
    };
    queue
        .add("test", serde_json::json!({"foo": "bar"}), Some(job_opts))
        .await
        .unwrap();

    let attempt_count = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let attempt_count_clone = attempt_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let count = attempt_count_clone.clone();
        Box::pin(async move {
            let attempt = count.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            if attempt < 3 {
                Err(Error::ProcessingError(format!("fail attempt {}", attempt)))
            } else {
                Ok(serde_json::json!("success"))
            }
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Completed { .. }) {
                    break;
                }
            }
        }
    })
    .await
    .expect("timeout waiting for job to complete after retries");

    assert_eq!(attempt_count.load(std::sync::atomic::Ordering::Relaxed), 3);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_worker_moves_to_failed_after_max_attempts() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(2),
        backoff: Some(bullmq::types::BackoffStrategy::Fixed(100)),
        ..Default::default()
    };
    let job = queue
        .add("test", serde_json::json!({}), Some(job_opts))
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::ProcessingError("always fails".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Wait for final failed event (after all attempts exhausted)
    let mut failed_count = 0;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Failed { .. }) {
                    failed_count += 1;
                    if failed_count >= 2 {
                        break;
                    }
                }
            }
        }
    })
    .await
    .expect("timeout waiting for job to exhaust retries");

    tokio::time::sleep(Duration::from_millis(200)).await;

    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    assert_eq!(fetched.attempts_made(), 2);

    let state = queue.get_job_state(&job_id).await.unwrap();
    assert_eq!(state, JobState::Failed);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}
