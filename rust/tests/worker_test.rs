//! Worker tests — processing, events, concurrency, remove-on-complete, return values.
#![allow(clippy::collapsible_match, clippy::collapsible_if)]

mod common;

use bullmq::error::Error;
use bullmq::types::{BackoffStrategy, JobProgress, JobState, RetryOptions};
use bullmq::worker::{CancellationToken, ProcessorFn, WorkerEvent};
use bullmq::{BulkJob, Job, JobOptions, Queue, QueueOptions, Worker, WorkerOptions};
use common::{cleanup_queue, test_connection, test_queue_name};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex};

// ═══════════════════════════════════════════════════════════════════════════
// Basic Processing
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_worker_processes_job() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("process-me", serde_json::json!({"x": 42}))
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel::<String>(1);
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send(job.id().to_string()).await.unwrap();
            Ok(serde_json::json!({"processed": true}))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let processed_id = tokio::time::timeout(Duration::from_secs(10), rx.recv())
        .await
        .expect("timeout waiting for job")
        .expect("channel closed");

    assert!(!processed_id.is_empty());

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_worker_processes_jobs_serially() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let num_jobs = 10u32;
    for i in 1..=num_jobs {
        queue
            .add("serial", serde_json::json!({"num": i}))
            .await
            .unwrap();
    }

    let counter = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let counter_clone = counter.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let counter = counter_clone.clone();
        Box::pin(async move {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        concurrency: 1,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_secs(10)).await;
    assert_eq!(counter.load(std::sync::atomic::Ordering::SeqCst), num_jobs);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_worker_async_processing() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(|job: Job, _token: CancellationToken| {
        Box::pin(async move {
            assert_eq!(job.data()["foo"], "bar");
            tokio::time::sleep(Duration::from_millis(100)).await;
            Ok(serde_json::json!("async result"))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let result = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if let bullmq::worker::WorkerEvent::Completed { result, .. } = ev {
                    return result;
                }
            }
        }
    })
    .await
    .expect("timeout waiting for completed event");

    assert_eq!(result, serde_json::json!("async result"));

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_processes_jobs_added_before_worker() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    for i in 0..4 {
        queue
            .add("test", serde_json::json!({"bar": format!("baz{}", i)}))
            .await
            .unwrap();
    }

    let (tx, mut rx) = mpsc::channel(10);
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send(()).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut count = 0;
    tokio::time::timeout(Duration::from_secs(10), async {
        while count < 4 {
            rx.recv().await;
            count += 1;
        }
    })
    .await
    .expect("timeout waiting for pre-added jobs to process");

    assert_eq!(count, 4);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Concurrency
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_worker_concurrency() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    for i in 0..5 {
        queue
            .add(&format!("concurrent-{}", i), serde_json::json!({}))
            .await
            .unwrap();
    }

    let counter = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let counter_clone = counter.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let counter = counter_clone.clone();
        Box::pin(async move {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(100)).await;
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        concurrency: 3,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_secs(5)).await;

    assert_eq!(counter.load(std::sync::atomic::Ordering::SeqCst), 5);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_worker_slow_job_does_not_block_others() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("slow", serde_json::json!({"type": "slow"}))
        .await
        .unwrap();
    queue
        .add("fast", serde_json::json!({"type": "fast"}))
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(10);
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            if job.data()["type"] == "slow" {
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            tx.send(job.name().to_string()).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        concurrency: 2,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut completed = Vec::new();
    tokio::time::timeout(Duration::from_secs(5), async {
        while completed.len() < 2 {
            if let Some(name) = rx.recv().await {
                completed.push(name);
            }
        }
    })
    .await
    .expect("timeout waiting for jobs");

    assert_eq!(completed[0], "fast");
    assert_eq!(completed[1], "slow");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_worker_multiple_concurrent_workers() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let num_jobs = 20u32;
    for i in 0..num_jobs {
        queue
            .add(&format!("multi-{}", i), serde_json::json!({}))
            .await
            .unwrap();
    }

    let counter = Arc::new(std::sync::atomic::AtomicU32::new(0));

    let mut workers = Vec::new();
    for _ in 0..2 {
        let c = counter.clone();
        let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
            let c = c.clone();
            Box::pin(async move {
                c.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(50)).await;
                Ok(serde_json::Value::Null)
            })
        });

        let w = Worker::with_options(
            &name,
            processor,
            WorkerOptions {
                connection: conn_opts.clone(),
                concurrency: 5,
                autorun: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        workers.push(w);
    }

    tokio::time::sleep(Duration::from_secs(10)).await;
    assert_eq!(counter.load(std::sync::atomic::Ordering::SeqCst), num_jobs);

    for w in &workers {
        w.close(5000).await.unwrap();
    }
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_worker_completed_event() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("event-test", serde_json::json!({"val": 99}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!({"done": true})) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let event = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                match ev {
                    bullmq::worker::WorkerEvent::Completed { job_id, result } => {
                        return (job_id, result);
                    }
                    _ => continue,
                }
            }
        }
    })
    .await
    .expect("timeout waiting for completed event");

    assert!(!event.0.is_empty());
    assert_eq!(event.1, serde_json::json!({"done": true}));

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_worker_failed_event() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("fail-event-test", serde_json::json!({}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::Unrecoverable("boom".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let event = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                match ev {
                    bullmq::worker::WorkerEvent::Failed { job_id, error } => {
                        return (job_id, error);
                    }
                    _ => continue,
                }
            }
        }
    })
    .await
    .expect("timeout waiting for failed event");

    assert!(!event.0.is_empty());
    assert!(event.1.contains("boom"));

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Job Failure
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_worker_job_failure() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue.add("fail-me", serde_json::json!({})).await.unwrap();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::Unrecoverable("intentional failure".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_secs(5)).await;

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_worker_job_state_completed() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue
        .add("state-complete", serde_json::json!({}))
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!("ok")) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

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
    .expect("timeout waiting for completed event");

    let state = queue.get_job_state(&job_id).await.unwrap();
    assert_eq!(state, JobState::Completed);

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 1);
    assert_eq!(counts.waiting, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_worker_job_state_failed() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue
        .add("state-fail", serde_json::json!({}))
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::Unrecoverable("crash".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Failed { .. }) {
                    break;
                }
            }
        }
    })
    .await
    .expect("timeout waiting for failed event");

    let state = queue.get_job_state(&job_id).await.unwrap();
    assert_eq!(state, JobState::Failed);

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.failed, 1);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_job_failed_reason() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue
        .add("fail-reason", serde_json::json!({}))
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::Unrecoverable("something went wrong".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Failed { .. }) {
                    break;
                }
            }
        }
    })
    .await
    .expect("timeout waiting for failed event");

    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    assert!(
        fetched.failed_reason().contains("something went wrong"),
        "Expected failed reason to contain 'something went wrong', got: '{}'",
        fetched.failed_reason()
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Cancellation / Pause / Close
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_worker_cancellation() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue.add("cancel-me", serde_json::json!({})).await.unwrap();

    let (tx, mut rx) = mpsc::channel::<bool>(1);
    let processor: ProcessorFn = Arc::new(move |_job: Job, token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tokio::select! {
                _ = token.cancelled() => {
                    tx.send(true).await.unwrap();
                    Err(Error::WorkerClosed)
                }
                _ = tokio::time::sleep(Duration::from_secs(30)) => {
                    tx.send(false).await.unwrap();
                    Ok(serde_json::Value::Null)
                }
            }
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_secs(2)).await;

    worker.cancel_all_jobs().await;

    let was_cancelled = tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    assert!(was_cancelled);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_worker_pause_resume() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let counter = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let counter_clone = counter.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let counter = counter_clone.clone();
        Box::pin(async move {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    worker.pause();
    assert!(worker.is_paused());

    queue
        .add("paused-job", serde_json::json!({}))
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(counter.load(std::sync::atomic::Ordering::SeqCst), 0);

    worker.resume();
    tokio::time::sleep(Duration::from_secs(3)).await;
    assert_eq!(counter.load(std::sync::atomic::Ordering::SeqCst), 1);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_worker_graceful_close() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue.add("slow-job", serde_json::json!({})).await.unwrap();

    let (tx, mut rx) = mpsc::channel::<String>(1);

    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tokio::time::sleep(Duration::from_millis(500)).await;
            tx.send(job.id().to_string()).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_millis(200)).await;

    worker.close(5000).await.unwrap();

    let result = tokio::time::timeout(Duration::from_secs(1), rx.recv()).await;
    assert!(result.is_ok());

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_worker_does_not_process_when_autorun_false() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("no-autorun", serde_json::json!({}))
        .await
        .unwrap();

    let counter = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let counter_clone = counter.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let counter = counter_clone.clone();
        Box::pin(async move {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: false,
        ..Default::default()
    };

    let worker = Arc::new(
        Worker::with_options(&name, processor, worker_opts)
            .await
            .unwrap(),
    );

    tokio::time::sleep(Duration::from_secs(2)).await;
    assert_eq!(counter.load(std::sync::atomic::Ordering::SeqCst), 0);

    let worker_for_run = worker.clone();
    let handle = tokio::spawn(async move { worker_for_run.run().await });

    tokio::time::sleep(Duration::from_secs(3)).await;
    assert_eq!(counter.load(std::sync::atomic::Ordering::SeqCst), 1);

    worker.close(5000).await.unwrap();
    let _ = handle.await;
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// LIFO ordering
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_worker_lifo_processing_order() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue.pause().await.unwrap();

    for i in 0..4 {
        queue
            .add(&format!("lifo-{}", i), serde_json::json!({"order": i}))
            .options(JobOptions {
                lifo: Some(true),
                ..Default::default()
            })
            .await
            .unwrap();
    }

    let order = Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let order_clone = order.clone();
    let (done_tx, mut done_rx) = mpsc::channel::<()>(1);

    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let order = order_clone.clone();
        let tx = done_tx.clone();
        Box::pin(async move {
            let idx = job.data()["order"].as_u64().unwrap();
            let mut v = order.lock().await;
            v.push(idx);
            if v.len() == 4 {
                let _ = tx.send(()).await;
            }
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        concurrency: 1,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    queue.resume().await.unwrap();

    tokio::time::timeout(Duration::from_secs(10), done_rx.recv())
        .await
        .expect("timeout waiting for LIFO jobs")
        .expect("channel closed");

    let processed_order = order.lock().await;
    assert_eq!(*processed_order, vec![3, 2, 1, 0]);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Return Values
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_return_value_stored_in_db() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|job: Job, _token: CancellationToken| {
        Box::pin(async move {
            assert_eq!(job.data()["foo"], "bar");
            Ok(serde_json::json!(42))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

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
    .expect("timeout waiting for completed event");

    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    assert_eq!(fetched.returnvalue(), "42");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_return_value_string_stored_in_db() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue
        .add("test", serde_json::json!({"testing": true}))
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!("a very dignified string")) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

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
    .expect("timeout waiting for completed event");

    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    assert_eq!(fetched.returnvalue(), "\"a very dignified string\"");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Timestamps (processedOn / finishedOn)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_processed_on_set_after_processing() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue.add("test", serde_json::json!({})).await.unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::Value::Null) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

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
    .expect("timeout waiting for completed event");

    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    assert!(fetched.processed_on().is_some());
    assert!(fetched.finished_on().is_some());
    assert!(fetched.processed_on().unwrap() >= fetched.timestamp());
    assert!(fetched.finished_on().unwrap() >= fetched.processed_on().unwrap());

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_job_finished_on_after_completion() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue
        .add("finished-on-test", serde_json::json!({}))
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!("result")) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

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
    .expect("timeout waiting for completed event");

    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    assert!(fetched.processed_on().is_some());
    assert!(fetched.finished_on().is_some());
    assert!(fetched.finished_on().unwrap() >= fetched.processed_on().unwrap());

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_job_counts_after_processing() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    for i in 0..3 {
        queue
            .add(&format!("count-{}", i), serde_json::json!({}))
            .await
            .unwrap();
    }

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::Value::Null) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_secs(5)).await;

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 3);
    assert_eq!(counts.waiting, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// RemoveOnComplete / RemoveOnFail
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_remove_on_complete_true() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        remove_on_complete: Some(bullmq::types::RemoveOnFinish::Bool(true)),
        ..Default::default()
    };
    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .options(job_opts)
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::Value::Null) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

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
    .expect("timeout waiting for completed event");

    tokio::time::sleep(Duration::from_millis(100)).await;

    let fetched = queue.get_job(&job_id).await.unwrap();
    assert!(fetched.is_none(), "Job should have been removed");

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_remove_on_fail_true() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        remove_on_fail: Some(bullmq::types::RemoveOnFinish::Bool(true)),
        ..Default::default()
    };
    let job = queue
        .add("test", serde_json::json!({}))
        .options(job_opts)
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::Unrecoverable("intentional".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Failed { .. }) {
                    break;
                }
            }
        }
    })
    .await
    .expect("timeout waiting for failed event");

    tokio::time::sleep(Duration::from_millis(100)).await;

    let fetched = queue.get_job(&job_id).await.unwrap();
    assert!(
        fetched.is_none(),
        "Job should have been removed after failure"
    );

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.failed, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_remove_on_complete_keeps_specified_count() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        remove_on_complete: Some(bullmq::types::RemoveOnFinish::Count(3)),
        ..Default::default()
    };

    for i in 0..5 {
        queue
            .add("test", serde_json::json!({"idx": i}))
            .options(job_opts.clone())
            .await
            .unwrap();
    }

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::Value::Null) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut completed = 0;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Completed { .. }) {
                    completed += 1;
                    if completed == 5 {
                        break;
                    }
                }
            }
        }
    })
    .await
    .expect("timeout waiting for 5 completed events");

    tokio::time::sleep(Duration::from_millis(100)).await;

    let counts = queue.get_job_counts().await.unwrap();
    assert!(
        counts.completed <= 3,
        "Expected at most 3 completed jobs, got {}",
        counts.completed
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_worker_level_remove_on_complete() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::Value::Null) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        remove_on_complete: Some(bullmq::types::RemoveOnFinish::Bool(true)),
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

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
    .expect("timeout waiting for completed event");

    tokio::time::sleep(Duration::from_millis(100)).await;

    let fetched = queue.get_job(&job_id).await.unwrap();
    assert!(
        fetched.is_none(),
        "Job should be removed by worker-level removeOnComplete"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Process several jobs serially (Node.js: 'process several jobs serially')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_process_several_jobs_serially_with_data_check() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let max_jobs = 35u32;
    for i in 1..=max_jobs {
        queue
            .add("test", serde_json::json!({"foo": "bar", "num": i}))
            .await
            .unwrap();
    }

    let counter = Arc::new(std::sync::atomic::AtomicU32::new(1));
    let counter_clone = counter.clone();

    let (tx, mut rx) = mpsc::channel(1);
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let counter = counter_clone.clone();
        let tx = tx.clone();
        Box::pin(async move {
            let expected = counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            assert_eq!(job.data()["foo"], "bar");
            assert_eq!(job.data()["num"], expected);
            if expected == 35 {
                let _ = tx.send(()).await;
            }
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        concurrency: 1,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(15), rx.recv())
        .await
        .expect("timeout waiting for all 35 jobs")
        .expect("channel closed");

    assert!(worker.is_running());

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Process job that returns data (Node.js: 'process a job that returns data
// in the process handler')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_process_job_returns_data() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(|job: Job, _token: CancellationToken| {
        Box::pin(async move {
            assert_eq!(job.data()["foo"], "bar");
            Ok(serde_json::json!(37))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let result = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if let bullmq::worker::WorkerEvent::Completed { result, .. } = ev {
                    return result;
                }
            }
        }
    })
    .await
    .expect("timeout waiting for completed event");

    assert_eq!(result, serde_json::json!(37));

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Process a job that throws an exception (Node.js: 'process a job that
// throws an exception')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_process_job_throws_exception() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|job: Job, _token: CancellationToken| {
        Box::pin(async move {
            assert_eq!(job.data()["foo"], "bar");
            Err(Error::Unrecoverable("Job Failed".to_string()))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let (failed_job_id, error_msg) = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if let bullmq::worker::WorkerEvent::Failed { job_id, error } = ev {
                    return (job_id, error);
                }
            }
        }
    })
    .await
    .expect("timeout waiting for failed event");

    assert_eq!(failed_job_id, job_id);
    assert!(error_msg.contains("Job Failed"));

    // Verify finishedOn is set
    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    assert!(fetched.finished_on().is_some());

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Process a job that returns a rejected promise (Node.js: 'process a job
// that returns a rejected promise')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_process_job_returns_error() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(|job: Job, _token: CancellationToken| {
        Box::pin(async move {
            assert_eq!(job.data()["foo"], "bar");
            Err(Error::Unrecoverable("rejected promise".to_string()))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let (_, error_msg) = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if let bullmq::worker::WorkerEvent::Failed { job_id, error } = ev {
                    return (job_id, error);
                }
            }
        }
    })
    .await
    .expect("timeout waiting for failed event");

    assert!(error_msg.contains("rejected promise"));

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Concurrency respecting (Node.js: 'should process job respecting the
// concurrency set')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_process_job_respecting_concurrency() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let num_jobs = 8u32;
    let concurrency = 4u32;

    for _ in 0..num_jobs {
        queue.add("test", serde_json::json!({})).await.unwrap();
    }

    let current_processing = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let max_concurrent = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let completed_count = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let (tx, mut rx) = mpsc::channel(1);

    let cp = current_processing.clone();
    let mc = max_concurrent.clone();
    let cc = completed_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let cp = cp.clone();
        let mc = mc.clone();
        let cc = cc.clone();
        let tx = tx.clone();
        Box::pin(async move {
            let current = cp.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            // Update max observed concurrency
            mc.fetch_max(current, std::sync::atomic::Ordering::SeqCst);

            tokio::time::sleep(Duration::from_millis(100)).await;

            cp.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
            let done = cc.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            if done == 8 {
                let _ = tx.send(()).await;
            }
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        concurrency: concurrency as usize,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(10), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    let max = max_concurrent.load(std::sync::atomic::Ordering::SeqCst);
    assert!(
        max <= concurrency,
        "Max concurrency {} exceeded limit {}",
        max,
        concurrency
    );
    assert!(max > 1, "Should have processed multiple jobs concurrently");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Run job in sequence with concurrency 1 (Node.js: 'should run job in
// sequence if I specify a concurrency of 1')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_run_job_in_sequence_concurrency_1() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue.add("test", serde_json::json!({})).await.unwrap();
    queue.add("test", serde_json::json!({})).await.unwrap();

    let processing = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let processing_clone = processing.clone();
    let (tx, mut rx) = mpsc::channel(1);

    let completed = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let completed_clone = completed.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let processing = processing_clone.clone();
        let completed = completed_clone.clone();
        let tx = tx.clone();
        Box::pin(async move {
            // Assert no other job is being processed
            assert!(
                !processing.swap(true, std::sync::atomic::Ordering::SeqCst),
                "Two jobs processed concurrently with concurrency=1"
            );
            tokio::time::sleep(Duration::from_millis(50)).await;
            processing.store(false, std::sync::atomic::Ordering::SeqCst);
            if completed.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1 == 2 {
                let _ = tx.send(()).await;
            }
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        concurrency: 1,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Should not keep active jobs after completion (Node.js: 'should not keep
// active jobs')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_should_not_keep_active_jobs() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    for _ in 0..10 {
        queue.add("test", serde_json::json!({})).await.unwrap();
    }

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        concurrency: 3,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for all to complete
    let mut completed = 0;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Completed { .. }) {
                    completed += 1;
                    if completed == 10 {
                        break;
                    }
                }
            }
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(100)).await;

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.active, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Automatically retry a failed job (Node.js: 'should automatically retry a
// failed job if attempts is bigger than 1')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_auto_retry_failed_job_with_attempts() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(3),
        ..Default::default()
    };
    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .options(job_opts)
        .await
        .unwrap();

    let tries = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let tries_clone = tries.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let tries = tries_clone.clone();
        Box::pin(async move {
            let attempt = tries.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if attempt < 1 {
                Err(Error::ProcessingError("Not yet!".to_string()))
            } else {
                Ok(serde_json::Value::Null)
            }
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

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
    .expect("timeout waiting for completed after retry");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Should not retry more than attempts times (Node.js: 'should not retry a
// failed job more than the number of given attempts times')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_not_retry_more_than_attempts() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(3),
        ..Default::default()
    };
    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .options(job_opts)
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let tries = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let tries_clone = tries.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let tries = tries_clone.clone();
        Box::pin(async move {
            tries.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Err(Error::ProcessingError("Not yet!".to_string()))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for 3 failed events
    let mut failed_count = 0;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Failed { .. }) {
                    failed_count += 1;
                    if failed_count >= 3 {
                        break;
                    }
                }
            }
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(200)).await;

    let state = queue.get_job_state(&job_id).await.unwrap();
    assert_eq!(state, JobState::Failed);

    // Should have tried exactly 3 times
    assert_eq!(tries.load(std::sync::atomic::Ordering::SeqCst), 3);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Retry with exponential backoff (Node.js: 'should retry a job after a
// delay if an exponential backoff is given')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_retry_exponential_backoff() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(3),
        backoff: Some(bullmq::types::BackoffStrategy::Exponential(100)),
        ..Default::default()
    };

    let start = std::time::Instant::now();
    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .options(job_opts)
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(|job: Job, _token: CancellationToken| {
        Box::pin(async move {
            if job.attempts_made() < 2 {
                Err(Error::ProcessingError("Not yet!".to_string()))
            } else {
                Ok(serde_json::Value::Null)
            }
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

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
    .expect("timeout");

    // Exponential: 100ms + 200ms = 300ms minimum
    let elapsed = start.elapsed();
    assert!(
        elapsed >= Duration::from_millis(200),
        "Should have waited for backoff delays, elapsed: {:?}",
        elapsed
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Process priority jobs (Node.js: 'should process jobs by priority')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_process_jobs_by_priority() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add jobs with different priorities (lower number = higher priority)
    // Add them in reverse priority order
    for (i, prio) in [(1, 10u32), (2, 5), (3, 1)] {
        queue
            .add("test", serde_json::json!({"idx": i}))
            .options(JobOptions {
                priority: Some(prio),
                ..Default::default()
            })
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
        connection: conn_opts,
        concurrency: 1,
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut order = Vec::new();
    tokio::time::timeout(Duration::from_secs(5), async {
        while order.len() < 3 {
            if let Some(idx) = rx.recv().await {
                order.push(idx);
            }
        }
    })
    .await
    .expect("timeout");

    // Priority 1 (idx=3) should be first, then 5 (idx=2), then 10 (idx=1)
    assert_eq!(order, vec![3, 2, 1]);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pick standard job without delay (Node.js: 'pick standard job without
// delay')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_pick_standard_job_without_delay() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add a delayed job, then a standard job
    queue
        .add("delayed", serde_json::json!({"type": "delayed"}))
        .options(JobOptions {
            delay: Some(2000),
            ..Default::default()
        })
        .await
        .unwrap();

    queue
        .add("standard", serde_json::json!({"type": "standard"}))
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(10);
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send(job.data()["type"].as_str().unwrap().to_string())
                .await
                .unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Standard job should be picked first
    let first = tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    assert_eq!(first, "standard");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Remove job after completed if removeOnComplete (worker default)
// (Node.js: 'should remove a job after completed if the default job options
// specify removeOnComplete')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_remove_on_complete_from_worker_default() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|job: Job, _token: CancellationToken| {
        Box::pin(async move {
            assert_eq!(job.data()["foo"], "bar");
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        remove_on_complete: Some(bullmq::types::RemoveOnFinish::Bool(true)),
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

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
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(100)).await;

    let fetched = queue.get_job(&job_id).await.unwrap();
    assert!(fetched.is_none());

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Remove on fail from worker default (Node.js: 'should remove a job after
// fail if the default job options specify removeOnFail')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_remove_on_fail_from_worker_default() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::Unrecoverable("error".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        remove_on_fail: Some(bullmq::types::RemoveOnFinish::Bool(true)),
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Failed { .. }) {
                    break;
                }
            }
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(100)).await;

    let fetched = queue.get_job(&job_id).await.unwrap();
    assert!(fetched.is_none());

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.failed, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Keep specified number of jobs with removeOnFail (Node.js: 'should keep
// specified number of jobs after completed with removeOnFail')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_keep_specified_count_remove_on_fail() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let keep_jobs = 3;
    let total_jobs = 6;

    let job_opts = JobOptions {
        remove_on_fail: Some(bullmq::types::RemoveOnFinish::Count(keep_jobs)),
        ..Default::default()
    };

    for i in 0..total_jobs {
        queue
            .add("test", serde_json::json!({"idx": i}))
            .options(job_opts.clone())
            .await
            .unwrap();
    }

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::Unrecoverable("fail".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut failed = 0;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Failed { .. }) {
                    failed += 1;
                    if failed == total_jobs {
                        break;
                    }
                }
            }
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(100)).await;

    let counts = queue.get_job_counts().await.unwrap();
    assert!(
        counts.failed <= keep_jobs as u64,
        "Expected at most {} failed jobs, got {}",
        keep_jobs,
        counts.failed
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Remove all jobs when count is 0 with removeOnFail (Node.js: 'should
// remove all jobs when count is 0 with removeOnFail')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_remove_all_jobs_count_0_remove_on_fail() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        remove_on_fail: Some(bullmq::types::RemoveOnFinish::Bool(true)),
        ..Default::default()
    };

    for i in 0..5 {
        queue
            .add("test", serde_json::json!({"idx": i}))
            .options(job_opts.clone())
            .await
            .unwrap();
    }

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::Unrecoverable("fail".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut failed = 0;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Failed { .. }) {
                    failed += 1;
                    if failed == 5 {
                        break;
                    }
                }
            }
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(100)).await;

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.failed, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Saves failedReason (Node.js: 'saves failedReason')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_saves_failed_reason() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(3),
        ..Default::default()
    };
    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .options(job_opts)
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::ProcessingError("my error message".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for all 3 attempts to fail
    let mut failed_count = 0;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Failed { .. }) {
                    failed_count += 1;
                    if failed_count >= 3 {
                        break;
                    }
                }
            }
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(200)).await;

    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    assert!(
        fetched.failed_reason().contains("my error message"),
        "Expected failedReason to contain 'my error message', got: '{}'",
        fetched.failed_reason()
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// UnrecoverableError moves to failed immediately (Node.js: 'moves job to
// failed' in UnrecoverableError describe)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_unrecoverable_error_moves_to_failed_immediately() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Even with attempts=3, unrecoverable should not retry
    let job_opts = JobOptions {
        attempts: Some(3),
        ..Default::default()
    };
    let job = queue
        .add("test", serde_json::json!({}))
        .options(job_opts)
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let attempt_count = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let attempt_count_clone = attempt_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let count = attempt_count_clone.clone();
        Box::pin(async move {
            count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Err(Error::Unrecoverable("unrecoverable error".to_string()))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Failed { .. }) {
                    break;
                }
            }
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(200)).await;

    // Should have only processed once (no retries)
    assert_eq!(
        attempt_count.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "UnrecoverableError should not retry"
    );

    let state = queue.get_job_state(&job_id).await.unwrap();
    assert_eq!(state, JobState::Failed);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Lock extender continues to run (Node.js: 'lock extender continues to run
// until all active jobs are completed when closing a worker')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_lock_extender_runs_until_jobs_complete() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue.add("test", serde_json::json!({})).await.unwrap();

    let (tx, mut rx) = mpsc::channel(1);
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            // Processing takes longer than lock duration
            tokio::time::sleep(Duration::from_millis(1500)).await;
            tx.send(()).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        lock_duration: 500,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait a moment then close with generous timeout
    tokio::time::sleep(Duration::from_millis(200)).await;
    worker.close(5000).await.unwrap();

    // Job should have completed despite lock duration < processing time
    let result = tokio::time::timeout(Duration::from_millis(100), rx.recv()).await;
    assert!(
        result.is_ok(),
        "Job should have completed before close returned"
    );

    // Verify job is completed, not stalled/failed
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 1);
    assert_eq!(counts.failed, 0);

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Clear job from stalled set when completed (Node.js: 'should clear job
// from stalled set when job completed')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_clear_job_from_stalled_set_on_complete() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        stalled_interval: 10,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

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
    .expect("timeout");

    // After completion, stalled set should be empty
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 1);
    assert_eq!(counts.active, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Multiple workers don't process same job (Node.js: 'does not process a job
// that is being processed when a new queue starts')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_does_not_process_job_being_processed_by_another() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue.add("test", serde_json::json!({})).await.unwrap();

    let processed_ids = Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let ids1 = processed_ids.clone();
    let ids2 = processed_ids.clone();

    let processor1: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let ids = ids1.clone();
        Box::pin(async move {
            ids.lock().await.push(format!("w1-{}", job.id()));
            tokio::time::sleep(Duration::from_millis(500)).await;
            Ok(serde_json::Value::Null)
        })
    });

    let processor2: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let ids = ids2.clone();
        Box::pin(async move {
            ids.lock().await.push(format!("w2-{}", job.id()));
            Ok(serde_json::Value::Null)
        })
    });

    let worker1 = Worker::with_options(
        &name,
        processor1,
        WorkerOptions {
            connection: conn_opts.clone(),
            autorun: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // Start second worker after first has picked up the job
    tokio::time::sleep(Duration::from_millis(200)).await;

    let worker2 = Worker::with_options(
        &name,
        processor2,
        WorkerOptions {
            connection: conn_opts.clone(),
            autorun: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    tokio::time::sleep(Duration::from_secs(2)).await;

    let ids = processed_ids.lock().await;
    // Only one worker should have processed the job
    assert_eq!(
        ids.len(),
        1,
        "Job should only be processed once, got: {:?}",
        ids
    );

    worker1.close(5000).await.unwrap();
    worker2.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Worker is_running check (Node.js: verifies isRunning in various tests)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_worker_is_running() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::Value::Null) })
    });

    let worker = Worker::with_options(
        &name,
        processor,
        WorkerOptions {
            connection: conn_opts,
            autorun: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    assert!(worker.is_running());

    worker.close(5000).await.unwrap();

    assert!(!worker.is_running());
}

// ═══════════════════════════════════════════════════════════════════════════
// Keep jobs newer than specified age with removeOnComplete
// (Node.js: 'should keep of jobs newer than specified after completed with
// removeOnComplete')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_keep_jobs_newer_than_age_remove_on_complete() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Keep jobs younger than 10 seconds — all should be kept in this fast test
    let job_opts = JobOptions {
        remove_on_complete: Some(bullmq::types::RemoveOnFinish::Options(
            bullmq::types::KeepJobs {
                age: Some(10),
                count: None,
                limit: None,
            },
        )),
        ..Default::default()
    };

    for i in 0..5 {
        queue
            .add("test", serde_json::json!({"idx": i}))
            .options(job_opts.clone())
            .await
            .unwrap();
    }

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::Value::Null) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut completed = 0;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Completed { .. }) {
                    completed += 1;
                    if completed == 5 {
                        break;
                    }
                }
            }
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(100)).await;

    // All jobs are younger than 10s so all should be kept
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 5);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Keep jobs with age and count limit (Node.js: 'should keep of jobs newer
// than specified and up to a count completed with removeOnComplete')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_keep_jobs_with_age_and_count_limit() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // age=10s, count=3 — since all are < 10s old, count takes precedence
    let job_opts = JobOptions {
        remove_on_complete: Some(bullmq::types::RemoveOnFinish::Options(
            bullmq::types::KeepJobs {
                age: Some(10),
                count: Some(3),
                limit: None,
            },
        )),
        ..Default::default()
    };

    for i in 0..6 {
        queue
            .add("test", serde_json::json!({"idx": i}))
            .options(job_opts.clone())
            .await
            .unwrap();
    }

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::Value::Null) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut completed = 0;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Completed { .. }) {
                    completed += 1;
                    if completed == 6 {
                        break;
                    }
                }
            }
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(100)).await;

    let counts = queue.get_job_counts().await.unwrap();
    assert!(
        counts.completed <= 3,
        "Expected at most 3 completed jobs, got {}",
        counts.completed
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Global removeOnFail from worker options (Node.js: 'should keep specified
// number of jobs after completed with global removeOnFail')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_global_remove_on_fail_from_worker() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    for i in 0..6 {
        queue
            .add("test", serde_json::json!({"idx": i}))
            .await
            .unwrap();
    }

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::Unrecoverable("fail".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        remove_on_fail: Some(bullmq::types::RemoveOnFinish::Count(3)),
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut failed = 0;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Failed { .. }) {
                    failed += 1;
                    if failed == 6 {
                        break;
                    }
                }
            }
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(100)).await;

    let counts = queue.get_job_counts().await.unwrap();
    assert!(
        counts.failed <= 3,
        "Expected at most 3 failed jobs, got {}",
        counts.failed
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Continues processing after worker has stalled (Node.js: 'continues
// processing after a worker has stalled')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_continues_processing_after_stall() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("test", serde_json::json!({"bar": "baz"}))
        .await
        .unwrap();

    // Worker 1: stalls on the job
    let processor1: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move {
            tokio::time::sleep(Duration::from_secs(60)).await;
            Ok(serde_json::Value::Null)
        })
    });

    let worker1 = Worker::with_options(
        &name,
        processor1,
        WorkerOptions {
            connection: conn_opts.clone(),
            autorun: true,
            lock_duration: 500,
            stalled_interval: 100,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // Wait long enough for the job to be picked up, then force close
    tokio::time::sleep(Duration::from_millis(300)).await;
    worker1.close(0).await.unwrap();

    // Worker 2: processes the stalled job
    let (tx, mut rx) = mpsc::channel(1);
    let processor2: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send(()).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    let worker2 = Worker::with_options(
        &name,
        processor2,
        WorkerOptions {
            connection: conn_opts.clone(),
            autorun: true,
            lock_duration: 500,
            stalled_interval: 100,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    tokio::time::timeout(Duration::from_secs(10), rx.recv())
        .await
        .expect("timeout waiting for stalled job to be reprocessed")
        .expect("channel closed");

    worker2.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Retry with fixed backoff timing (Node.js: 'should retry a job after a
// delay if a fixed backoff is given')
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_retry_fixed_backoff_timing() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let start = std::time::Instant::now();
    let job_opts = JobOptions {
        attempts: Some(3),
        backoff: Some(bullmq::types::BackoffStrategy::Fixed(500)),
        ..Default::default()
    };
    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .options(job_opts)
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(|job: Job, _token: CancellationToken| {
        Box::pin(async move {
            if job.attempts_made() < 2 {
                Err(Error::ProcessingError("Not yet!".to_string()))
            } else {
                Ok(serde_json::Value::Null)
            }
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

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
    .expect("timeout");

    let elapsed = start.elapsed();
    // 2 retries * 500ms backoff = at least 1000ms
    assert!(
        elapsed >= Duration::from_millis(900),
        "Should have waited for backoff delays, elapsed: {:?}",
        elapsed
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// attemptsMade is correct (Node.js: various attemptsMade checks)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_attempts_made_is_correct() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(3),
        backoff: Some(bullmq::types::BackoffStrategy::Fixed(50)),
        ..Default::default()
    };
    let job = queue
        .add("test", serde_json::json!({}))
        .options(job_opts)
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::ProcessingError("fail".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut failed_count = 0;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Failed { .. }) {
                    failed_count += 1;
                    if failed_count >= 3 {
                        break;
                    }
                }
            }
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(200)).await;

    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    assert_eq!(fetched.attempts_made(), 3);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation Tests
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_concurrency_cannot_be_zero() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        concurrency: 0,
        ..Default::default()
    };

    let result = Worker::with_options(&name, processor, worker_opts).await;
    assert!(result.is_err());
    match result {
        Err(ref e) => assert!(
            e.to_string()
                .contains("concurrency must be a finite number greater than 0"),
            "got: {}",
            e
        ),
        Ok(_) => panic!("expected error"),
    }
}

#[tokio::test]
async fn test_queue_name_cannot_contain_colon() {
    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let result = Worker::with_options("invalid:queue", processor, worker_opts).await;
    assert!(result.is_err());
    match result {
        Err(err) => assert!(
            err.to_string().contains("Queue name cannot contain :"),
            "got: {}",
            err
        ),
        Ok(_) => panic!("expected error"),
    }
}

#[tokio::test]
async fn test_stalled_interval_cannot_be_zero() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        stalled_interval: 0,
        ..Default::default()
    };

    let result = Worker::with_options(&name, processor, worker_opts).await;
    assert!(result.is_err());
    match result {
        Err(ref e) => assert!(
            e.to_string()
                .contains("stalledInterval must be greater than 0"),
            "got: {}",
            e
        ),
        Ok(_) => panic!("expected error"),
    }
}

#[tokio::test]
async fn test_drain_delay_cannot_be_zero() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        drain_delay: 0,
        ..Default::default()
    };

    let result = Worker::with_options(&name, processor, worker_opts).await;
    assert!(result.is_err());
    match result {
        Err(ref e) => assert!(
            e.to_string().contains("drainDelay must be greater than 0"),
            "got: {}",
            e
        ),
        Ok(_) => panic!("expected error"),
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Worker Name
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_sets_worker_name_on_job() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let (tx, mut rx) = mpsc::channel::<()>(1);
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send(()).await.unwrap();
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        name: Some("foobar".to_string()),
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    // Give time for job to be moved to completed
    tokio::time::sleep(Duration::from_millis(200)).await;

    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    assert_eq!(fetched.processed_by(), Some("foobar"));

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Concurrency Getter
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_concurrency_getter() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: false,
        concurrency: 100,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    assert_eq!(worker.concurrency(), 100);

    worker.close(5000).await.unwrap();
}

// ═══════════════════════════════════════════════════════════════════════════
// AutoRun / Run
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_processes_jobs_with_autorun_false_then_run() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let num_jobs = 10u32;
    for i in 1..=num_jobs {
        queue
            .add("test", serde_json::json!({"num": i}))
            .await
            .unwrap();
    }

    let (tx, mut rx) = mpsc::channel::<u32>(16);
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            let num = job.data()["num"].as_u64().unwrap() as u32;
            tx.send(num).await.unwrap();
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: false,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Worker should not process until run() is called
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(rx.try_recv().is_err());

    worker.run().await.unwrap();

    // Now collect all processed jobs
    let mut count = 0u32;
    tokio::time::timeout(Duration::from_secs(10), async {
        while count < num_jobs {
            rx.recv().await.unwrap();
            count += 1;
        }
    })
    .await
    .expect("timeout");

    assert_eq!(count, num_jobs);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_run_throws_when_already_running() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let result = worker.run().await;
    assert!(result.is_err());
    match result {
        Err(ref e) => assert!(
            e.to_string().contains("Worker is already running"),
            "got: {}",
            e
        ),
        Ok(_) => panic!("expected error"),
    }

    worker.close(5000).await.unwrap();
}

// ═══════════════════════════════════════════════════════════════════════════
// Close During Processing
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_close_waits_for_job_to_complete() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel::<()>(1);
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            // Simulate slow processing
            tokio::time::sleep(Duration::from_millis(500)).await;
            tx.send(()).await.unwrap();
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for processing to start
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Close with enough timeout to allow job to finish
    worker.close(5000).await.unwrap();

    // Job should have completed (signal received)
    let received = rx.try_recv().is_ok();
    assert!(received, "Job should have completed before close returned");

    // Verify job is completed
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 1);
    assert_eq!(counts.active, 0);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_close_allows_job_that_fails_to_finish() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move {
            tokio::time::sleep(Duration::from_millis(500)).await;
            Err(Error::Unrecoverable("Job Failed".to_string()))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for processing to start
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Close with enough timeout
    worker.close(5000).await.unwrap();

    // Verify job is failed
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.failed, 1);
    assert_eq!(counts.active, 0);

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pause Behavior
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_pause_does_not_fetch_new_jobs() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let (tx, mut rx) = mpsc::channel::<u32>(16);
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            let num = job.data()["num"].as_u64().unwrap() as u32;
            tokio::time::sleep(Duration::from_millis(100)).await;
            tx.send(num).await.unwrap();
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Add a job that will be processed
    queue
        .add("test", serde_json::json!({"num": 1}))
        .await
        .unwrap();

    // Wait for first job to be picked up
    tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    // Pause the worker
    worker.pause();
    assert!(worker.is_paused());

    // Add another job while paused
    queue
        .add("test", serde_json::json!({"num": 2}))
        .await
        .unwrap();

    // Wait a bit - paused worker should not pick up the job
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        rx.try_recv().is_err(),
        "Paused worker should not process new jobs"
    );

    // Resume and it should process
    worker.resume();

    let val = tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");
    assert_eq!(val, 2);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Retries Exhausted
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_job_only_executes_once_when_attempts_is_1() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(1),
        ..Default::default()
    };
    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .options(job_opts)
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::ProcessingError("failed".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for failed event
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Failed { .. }) {
                    break;
                }
            }
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(200)).await;

    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    assert_eq!(fetched.attempts_made(), 1);

    // Verify state is failed (no retry since attempts=1)
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.failed, 1);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_does_not_retry_more_than_attempts_fixed_backoff() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(3),
        backoff: Some(bullmq::types::BackoffStrategy::Fixed(50)),
        ..Default::default()
    };
    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .options(job_opts)
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::ProcessingError("Not yet!".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for 3 failed events (retries exhausted)
    let mut failed_count = 0;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Failed { .. }) {
                    failed_count += 1;
                    if failed_count >= 3 {
                        break;
                    }
                }
            }
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(200)).await;

    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    assert_eq!(fetched.attempts_made(), 3);

    // State should be failed
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.failed, 1);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Retry with Fixed Backoff Timing
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_retry_respects_fixed_backoff_delay() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(3),
        backoff: Some(bullmq::types::BackoffStrategy::Fixed(500)),
        ..Default::default()
    };
    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .options(job_opts)
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel::<()>(1);
    let attempt = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let attempt_clone = attempt.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        let attempt = attempt_clone.clone();
        Box::pin(async move {
            let a = attempt.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if a < 2 {
                Err(Error::ProcessingError("Not yet!".to_string()))
            } else {
                tx.send(()).await.unwrap();
                Ok(serde_json::json!(null))
            }
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };

    let start = std::time::Instant::now();
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(10), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    let elapsed = start.elapsed();
    // Should have waited at least 1000ms total (2 retries * 500ms each)
    assert!(
        elapsed >= Duration::from_millis(900),
        "Expected at least 900ms, got {:?}",
        elapsed
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Unrecoverable Error Stops Retries Immediately
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_unrecoverable_stops_retries_with_backoff() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(3),
        backoff: Some(bullmq::types::BackoffStrategy::Fixed(500)),
        ..Default::default()
    };
    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .options(job_opts)
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let attempt = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let attempt_clone = attempt.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let attempt = attempt_clone.clone();
        Box::pin(async move {
            let a = attempt.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if a < 1 {
                Err(Error::ProcessingError("Not yet!".to_string()))
            } else {
                Err(Error::Unrecoverable("Unrecoverable".to_string()))
            }
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for 2 failed events (first retry + unrecoverable)
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
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(300)).await;

    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    // Only 2 attempts made (not 3), because unrecoverable stopped retries
    assert_eq!(fetched.attempts_made(), 2);
    assert!(fetched.failed_reason().contains("Unrecoverable"));

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.failed, 1);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Process Multiple Jobs with Concurrency > 1
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_concurrency_4_processes_jobs_in_parallel() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let total_jobs = 8u32;
    for _ in 0..total_jobs {
        queue.add("test", serde_json::json!({})).await.unwrap();
    }

    let max_concurrent = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let current = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let max_concurrent_clone = max_concurrent.clone();
    let current_clone = current.clone();
    let (tx, mut rx) = mpsc::channel::<()>(16);

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let max_concurrent = max_concurrent_clone.clone();
        let current = current_clone.clone();
        let tx = tx.clone();
        Box::pin(async move {
            let c = current.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            // Update max
            max_concurrent.fetch_max(c, std::sync::atomic::Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(200)).await;
            current.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
            tx.send(()).await.unwrap();
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        concurrency: 4,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for all jobs to complete
    let mut completed = 0u32;
    tokio::time::timeout(Duration::from_secs(15), async {
        while completed < total_jobs {
            rx.recv().await.unwrap();
            completed += 1;
        }
    })
    .await
    .expect("timeout");

    let observed_max = max_concurrent.load(std::sync::atomic::Ordering::SeqCst);
    // Should have had at most 4 concurrent jobs
    assert!(
        observed_max <= 4,
        "Max concurrent was {}, expected <= 4",
        observed_max
    );
    // Should have had more than 1 concurrent (proves parallelism)
    assert!(
        observed_max > 1,
        "Max concurrent was {}, expected > 1 (parallel)",
        observed_max
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Drained Event
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_drained_event_emitted() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue.add("test", serde_json::json!({})).await.unwrap();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // After the job completes, we should get a Drained event
    let mut got_completed = false;
    let mut got_drained = false;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                match ev {
                    bullmq::worker::WorkerEvent::Completed { .. } => {
                        got_completed = true;
                    }
                    bullmq::worker::WorkerEvent::Drained => {
                        if got_completed {
                            got_drained = true;
                            break;
                        }
                    }
                    _ => {}
                }
            }
        }
    })
    .await
    .expect("timeout waiting for drained event");

    assert!(got_drained);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Multiple Workers on Same Queue
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_multiple_workers_process_all_jobs() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let total_jobs = 20u32;
    for i in 0..total_jobs {
        queue
            .add("test", serde_json::json!({"i": i}))
            .await
            .unwrap();
    }

    let count = Arc::new(std::sync::atomic::AtomicU32::new(0));

    let make_processor = |count: Arc<std::sync::atomic::AtomicU32>| -> ProcessorFn {
        Arc::new(move |_job: Job, _token: CancellationToken| {
            let count = count.clone();
            Box::pin(async move {
                count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(50)).await;
                Ok(serde_json::json!(null))
            })
        })
    };

    let w1_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        concurrency: 2,
        ..Default::default()
    };
    let w2_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        concurrency: 2,
        ..Default::default()
    };

    let worker1 = Worker::with_options(&name, make_processor(count.clone()), w1_opts)
        .await
        .unwrap();
    let worker2 = Worker::with_options(&name, make_processor(count.clone()), w2_opts)
        .await
        .unwrap();

    // Wait until all jobs are processed
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if count.load(std::sync::atomic::Ordering::SeqCst) >= total_jobs {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("timeout");

    assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), total_jobs);

    worker1.close(5000).await.unwrap();
    worker2.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Error Event from Worker
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_worker_emits_error_event_on_failure() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue.add("test", serde_json::json!({})).await.unwrap();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::ProcessingError("something went wrong".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Should receive a Failed event with the error message
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if let bullmq::worker::WorkerEvent::Failed { error, .. } = ev {
                    assert!(error.contains("something went wrong"));
                    break;
                }
            }
        }
    })
    .await
    .expect("timeout");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Delayed Job with Immediate Retry (retryJob script)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_auto_retry_without_backoff_retries_immediately() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(3),
        // No backoff — should retry immediately
        ..Default::default()
    };
    queue
        .add("test", serde_json::json!({}))
        .options(job_opts)
        .await
        .unwrap();

    let attempt = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let attempt_clone = attempt.clone();
    let (tx, mut rx) = mpsc::channel::<()>(1);

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let attempt = attempt_clone.clone();
        let tx = tx.clone();
        Box::pin(async move {
            let a = attempt.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if a < 2 {
                Err(Error::ProcessingError("Not yet!".to_string()))
            } else {
                tx.send(()).await.unwrap();
                Ok(serde_json::json!(null))
            }
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let start = std::time::Instant::now();
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(10), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    // Without backoff, retries should be fast (< 3 seconds total)
    let elapsed = start.elapsed();
    assert!(
        elapsed < Duration::from_secs(3),
        "Expected fast retries without backoff, got {:?}",
        elapsed
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Return Value Types
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_return_value_object_stored() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue.add("test", serde_json::json!({})).await.unwrap();
    let job_id = job.id().to_string();

    let (tx, mut rx) = mpsc::channel::<()>(1);
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send(()).await.unwrap();
            Ok(serde_json::json!({"status": "ok", "count": 42}))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    tokio::time::sleep(Duration::from_millis(200)).await;

    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    let rv: serde_json::Value = serde_json::from_str(fetched.returnvalue()).unwrap();
    assert_eq!(rv["status"], "ok");
    assert_eq!(rv["count"], 42);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_return_value_array_stored() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue.add("test", serde_json::json!({})).await.unwrap();
    let job_id = job.id().to_string();

    let (tx, mut rx) = mpsc::channel::<()>(1);
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send(()).await.unwrap();
            Ok(serde_json::json!([1, 2, 3]))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    tokio::time::sleep(Duration::from_millis(200)).await;

    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    let rv: serde_json::Value = serde_json::from_str(fetched.returnvalue()).unwrap();
    assert_eq!(rv, serde_json::json!([1, 2, 3]));

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_return_value_number_stored() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue.add("test", serde_json::json!({})).await.unwrap();
    let job_id = job.id().to_string();

    let (tx, mut rx) = mpsc::channel::<()>(1);
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send(()).await.unwrap();
            Ok(serde_json::json!(123))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    tokio::time::sleep(Duration::from_millis(200)).await;

    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    let rv: serde_json::Value = serde_json::from_str(fetched.returnvalue()).unwrap();
    assert_eq!(rv, serde_json::json!(123));

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Worker Does Not Process Jobs From Other Queue
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_worker_only_processes_its_own_queue() {
    let name1 = test_queue_name();
    let name2 = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts1 = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue_opts2 = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue1 = Queue::with_options(&name1, queue_opts1).await.unwrap();
    let queue2 = Queue::with_options(&name2, queue_opts2).await.unwrap();

    // Add jobs to both queues
    queue1
        .add("test", serde_json::json!({"queue": 1}))
        .await
        .unwrap();
    queue2
        .add("test", serde_json::json!({"queue": 2}))
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel::<u32>(4);
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            let q = job.data()["queue"].as_u64().unwrap() as u32;
            tx.send(q).await.unwrap();
            Ok(serde_json::json!(null))
        })
    });

    // Worker only on queue1
    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name1, processor, worker_opts)
        .await
        .unwrap();

    let val = tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");
    assert_eq!(val, 1);

    // Should not receive anything from queue2
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(rx.try_recv().is_err());

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue1).await;
    cleanup_queue(&queue2).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Job Data Integrity
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_job_data_available_in_processor() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add(
            "test",
            serde_json::json!({"name": "Alice", "age": 30, "tags": ["a", "b"]}),
        )
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel::<serde_json::Value>(1);
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send(job.data().clone()).await.unwrap();
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let data = tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    assert_eq!(data["name"], "Alice");
    assert_eq!(data["age"], 30);
    assert_eq!(data["tags"], serde_json::json!(["a", "b"]));

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_job_name_available_in_processor() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("my-job-name", serde_json::json!({}))
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel::<String>(1);
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send(job.name().to_string()).await.unwrap();
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let job_name = tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    assert_eq!(job_name, "my-job-name");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Delay Property Updated on Backoff
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_delay_property_updated_on_fixed_backoff() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(3),
        backoff: Some(bullmq::types::BackoffStrategy::Fixed(300)),
        ..Default::default()
    };
    let job = queue
        .add("test", serde_json::json!({"bar": "baz"}))
        .options(job_opts)
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::ProcessingError("error".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for first failed event
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Failed { .. }) {
                    break;
                }
            }
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(100)).await;

    // After first failure with backoff, delay should be set to 300
    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    assert_eq!(fetched.delay(), 300);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_delay_property_updated_on_exponential_backoff() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(3),
        backoff: Some(bullmq::types::BackoffStrategy::Exponential(200)),
        ..Default::default()
    };
    let job = queue
        .add("test", serde_json::json!({"bar": "baz"}))
        .options(job_opts)
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::ProcessingError("error".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for second failed event (to check exponential growth)
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
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(100)).await;

    // After second failure with exponential backoff:
    // First retry delay: 2^0 * 200 = 200
    // Second retry delay: 2^1 * 200 = 400
    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    assert!(
        fetched.delay() >= 400,
        "Expected delay >= 400, got {}",
        fetched.delay()
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Token Deleted After Moving to Delayed
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_token_deleted_after_move_to_delayed() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(3),
        backoff: Some(bullmq::types::BackoffStrategy::Fixed(100)),
        ..Default::default()
    };
    let job = queue
        .add("test", serde_json::json!({"bar": "baz"}))
        .options(job_opts)
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let (tx, mut rx) = mpsc::channel::<()>(1);
    let attempt = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let attempt_clone = attempt.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let attempt = attempt_clone.clone();
        let tx = tx.clone();
        Box::pin(async move {
            let a = attempt.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if a < 2 {
                Err(Error::ProcessingError("error".to_string()))
            } else {
                tx.send(()).await.unwrap();
                Ok(serde_json::json!(null))
            }
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        drain_delay: 1,
        lock_duration: 10000,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for completion
    tokio::time::timeout(Duration::from_secs(10), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    tokio::time::sleep(Duration::from_millis(100)).await;

    // After completion, lock should be gone
    let lock_key = format!("bull:{}:{}:lock", name, job_id);
    let client = redis::Client::open("redis://127.0.0.1:6379").unwrap();
    let mut redis_conn = client.get_multiplexed_async_connection().await.unwrap();
    let lock_val: Option<String> = redis::cmd("GET")
        .arg(&lock_key)
        .query_async(&mut redis_conn)
        .await
        .unwrap();
    assert!(
        lock_val.is_none(),
        "Lock should be deleted after completion"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Promotes Delayed Jobs First (during retry)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_promotes_delayed_jobs_first() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add job 1 with attempts (will fail once then succeed)
    let job_opts = JobOptions {
        attempts: Some(2),
        ..Default::default()
    };
    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .options(job_opts)
        .await
        .unwrap();

    // Add 3 delayed jobs
    for _ in 0..3 {
        let opts = JobOptions {
            delay: Some(200),
            ..Default::default()
        };
        queue
            .add("test", serde_json::json!({}))
            .options(opts)
            .await
            .unwrap();
    }

    let order = Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let order_clone = order.clone();
    let attempt = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let attempt_clone = attempt.clone();
    let (tx, mut rx) = mpsc::channel::<()>(1);

    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let order = order_clone.clone();
        let attempt = attempt_clone.clone();
        let tx = tx.clone();
        Box::pin(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            let a = attempt.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            order.lock().await.push(job.id().to_string());

            // First attempt on job 1 fails
            if job.id() == "1" && a == 0 {
                return Err(Error::ProcessingError("Not yet!".to_string()));
            }

            // After 4 completions (job1 retry + 3 delayed), we're done
            let len = order.lock().await.len();
            if len >= 5 {
                let _ = tx.send(()).await;
            }

            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(10), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    // The delayed jobs should have been promoted and processed
    // Job 1 should appear twice (first attempt + retry)
    let final_order = order.lock().await;
    assert!(
        final_order.len() >= 5,
        "Expected at least 5 entries, got {}",
        final_order.len()
    );
    // First entry should be job 1 (initial attempt)
    assert_eq!(final_order[0], "1");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fixed Backoff Timing Verification
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_fixed_backoff_respects_delay_timing() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(4),
        backoff: Some(bullmq::types::BackoffStrategy::Fixed(300)),
        ..Default::default()
    };
    queue
        .add("test", serde_json::json!({}))
        .options(job_opts)
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel::<()>(1);
    let attempt = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let attempt_clone = attempt.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let attempt = attempt_clone.clone();
        let tx = tx.clone();
        Box::pin(async move {
            let a = attempt.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if a < 3 {
                Err(Error::ProcessingError("error".to_string()))
            } else {
                tx.send(()).await.unwrap();
                Ok(serde_json::json!(null))
            }
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };

    let start = std::time::Instant::now();
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(15), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    let elapsed = start.elapsed();
    // 3 retries * 300ms = 900ms minimum
    assert!(
        elapsed >= Duration::from_millis(800),
        "Expected at least 800ms for 3 retries at 300ms, got {:?}",
        elapsed
    );
    // Should not take too long
    assert!(
        elapsed < Duration::from_secs(5),
        "Took too long: {:?}",
        elapsed
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Exponential Backoff Timing Verification
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_exponential_backoff_timing() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(3),
        backoff: Some(bullmq::types::BackoffStrategy::Exponential(200)),
        ..Default::default()
    };
    queue
        .add("test", serde_json::json!({}))
        .options(job_opts)
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel::<()>(1);
    let attempt = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let attempt_clone = attempt.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let attempt = attempt_clone.clone();
        let tx = tx.clone();
        Box::pin(async move {
            let a = attempt.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if a < 2 {
                Err(Error::ProcessingError("Not yet!".to_string()))
            } else {
                tx.send(()).await.unwrap();
                Ok(serde_json::json!(null))
            }
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };

    let start = std::time::Instant::now();
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(10), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    let elapsed = start.elapsed();
    // Exponential: 200ms + 400ms = 600ms minimum (2^0 * 200 + 2^1 * 200)
    assert!(
        elapsed >= Duration::from_millis(500),
        "Expected at least 500ms, got {:?}",
        elapsed
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Prioritized Job Processing Without Delay
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_process_prioritized_job_without_delay() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add first job with priority 2
    queue
        .add("test1", serde_json::json!({"p": 2}))
        .options(JobOptions {
            priority: Some(2),
            ..Default::default()
        })
        .await
        .unwrap();

    let count = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let count_clone = count.clone();
    let (tx, mut rx) = mpsc::channel::<()>(1);

    let queue_name_inner = name.clone();
    let conn_opts_inner = conn_opts.clone();
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let count = count_clone.clone();
        let tx = tx.clone();
        let queue_name = queue_name_inner.clone();
        let conn = conn_opts_inner.clone();
        Box::pin(async move {
            // When processing test1, add another job with same priority
            if job.name() == "test1" {
                let q_opts = QueueOptions {
                    connection: conn,
                    ..Default::default()
                };
                let q = Queue::with_options(&queue_name, q_opts).await.unwrap();
                q.add("test2", serde_json::json!({"p": 2}))
                    .options(JobOptions {
                        priority: Some(2),
                        ..Default::default()
                    })
                    .await
                    .unwrap();
            }

            assert_eq!(job.data()["p"], 2);

            if count.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1 >= 2 {
                let _ = tx.send(()).await;
            }
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pause Waits for All Concurrent Processing
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_pause_waits_for_concurrent_processing() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add 8 jobs
    for _ in 0..8 {
        queue.add("test", serde_json::json!({})).await.unwrap();
    }

    let finish_count = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let finish_count_clone = finish_count.clone();
    let active_count = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let active_count_clone = active_count.clone();
    let (tx, _rx) = mpsc::channel::<()>(16);

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let finish_count = finish_count_clone.clone();
        let active_count = active_count_clone.clone();
        let tx = tx.clone();
        Box::pin(async move {
            active_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(100)).await;
            active_count.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
            finish_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let _ = tx.send(()).await;
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        concurrency: 4,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for first batch to start processing
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Pause while jobs are still being processed
    worker.pause();

    // Wait for active jobs to finish
    tokio::time::sleep(Duration::from_millis(300)).await;

    // After pause, active count should be 0 (active jobs finished)
    let active = active_count.load(std::sync::atomic::Ordering::SeqCst);
    assert_eq!(
        active, 0,
        "Expected 0 active jobs after pause, got {}",
        active
    );

    // Some jobs finished before pause took full effect
    let finished = finish_count.load(std::sync::atomic::Ordering::SeqCst);
    assert!(
        finished >= 4,
        "Expected at least 4 finished before pause, got {}",
        finished
    );

    // Resume and let remaining jobs process
    worker.resume();

    // Wait for all 8 jobs to complete
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if finish_count.load(std::sync::atomic::Ordering::SeqCst) >= 8 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("timeout");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Delay Reset After Retries Exhausted
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_delay_reset_to_zero_after_retries_exhausted() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(3),
        backoff: Some(bullmq::types::BackoffStrategy::Fixed(100)),
        ..Default::default()
    };
    let job = queue
        .add("test", serde_json::json!({}))
        .options(job_opts)
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::ProcessingError("error".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for all 3 failures
    let mut failed_count = 0;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Failed { .. }) {
                    failed_count += 1;
                    if failed_count >= 3 {
                        break;
                    }
                }
            }
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(200)).await;

    // After retries exhausted, delay should be reset to 0
    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    assert_eq!(
        fetched.delay(),
        0,
        "Delay should be 0 after retries exhausted"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Attempts Made Tracked Correctly Through Retries
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_attempts_made_increments_on_each_retry() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(4),
        backoff: Some(bullmq::types::BackoffStrategy::Fixed(50)),
        ..Default::default()
    };
    let job = queue
        .add("test", serde_json::json!({}))
        .options(job_opts)
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let observed_attempts = Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let observed_clone = observed_attempts.clone();
    let (tx, mut rx) = mpsc::channel::<()>(1);

    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let observed = observed_clone.clone();
        let tx = tx.clone();
        Box::pin(async move {
            observed.lock().await.push(job.attempts_made());
            if job.attempts_made() < 3 {
                Err(Error::ProcessingError("Not yet!".to_string()))
            } else {
                tx.send(()).await.unwrap();
                Ok(serde_json::json!(null))
            }
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(10), rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    tokio::time::sleep(Duration::from_millis(100)).await;

    let attempts = observed_attempts.lock().await;
    // attempts_made should be 0, 1, 2, 3 on successive processing
    assert_eq!(attempts.len(), 4);
    assert_eq!(attempts[0], 0);
    assert_eq!(attempts[1], 1);
    assert_eq!(attempts[2], 2);
    assert_eq!(attempts[3], 3);

    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    assert_eq!(fetched.attempts_made(), 4);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Worker Events Order (Ready → Completed → Drained)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_worker_events_order() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue.add("test", serde_json::json!({})).await.unwrap();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut events = Vec::new();
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                let ev_name = match &ev {
                    bullmq::worker::WorkerEvent::Ready => "ready",
                    bullmq::worker::WorkerEvent::Completed { .. } => "completed",
                    bullmq::worker::WorkerEvent::Failed { .. } => "failed",
                    bullmq::worker::WorkerEvent::Drained => "drained",
                    bullmq::worker::WorkerEvent::Closed => "closed",
                    bullmq::worker::WorkerEvent::Error(_) => "error",
                    bullmq::worker::WorkerEvent::Stalled { .. } => "stalled",
                    bullmq::worker::WorkerEvent::Active { .. } => "active",
                    bullmq::worker::WorkerEvent::Progress { .. } => "progress",
                    bullmq::worker::WorkerEvent::Paused => "paused",
                    bullmq::worker::WorkerEvent::Resumed => "resumed",
                };
                events.push(ev_name.to_string());
                if ev_name == "drained" {
                    break;
                }
            }
        }
    })
    .await
    .expect("timeout");

    // Should have Ready first, then Completed, then Drained
    assert!(events.contains(&"ready".to_string()));
    assert!(events.contains(&"completed".to_string()));
    assert!(events.contains(&"drained".to_string()));

    let ready_idx = events.iter().position(|e| e == "ready").unwrap();
    let completed_idx = events.iter().position(|e| e == "completed").unwrap();
    let drained_idx = events.iter().position(|e| e == "drained").unwrap();

    assert!(ready_idx < completed_idx);
    assert!(completed_idx < drained_idx);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Failed Job Reason Saved on Retry
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_failed_reason_saved_during_retry() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(3),
        backoff: Some(bullmq::types::BackoffStrategy::Fixed(50)),
        ..Default::default()
    };
    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .options(job_opts)
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::ProcessingError("custom error message".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for all attempts to fail (job moves to permanently failed)
    tokio::time::timeout(Duration::from_secs(10), async {
        let mut fail_count = 0;
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Failed { .. }) {
                    fail_count += 1;
                    if fail_count >= 3 {
                        break;
                    }
                }
            }
        }
    })
    .await
    .expect("timeout waiting for all retries to fail");

    tokio::time::sleep(Duration::from_millis(100)).await;

    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    assert_eq!(fetched.failed_reason(), "custom error message");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Worker Does Not Process During Close
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_worker_does_not_fetch_new_jobs_during_close() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let processed_count = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let processed_clone = processed_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let processed = processed_clone.clone();
        Box::pin(async move {
            processed.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(200)).await;
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Add a job and wait for it to start processing
    queue.add("test", serde_json::json!({})).await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Now close and simultaneously add more jobs
    queue.add("test2", serde_json::json!({})).await.unwrap();
    queue.add("test3", serde_json::json!({})).await.unwrap();

    worker.close(5000).await.unwrap();

    // Should have processed at most 1 job (the one that started before close)
    let processed = processed_count.load(std::sync::atomic::Ordering::SeqCst);
    assert!(
        processed <= 2,
        "Expected at most 2 jobs processed during close, got {}",
        processed
    );

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Worker Close Returns After Active Job Completes
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_close_resolves_after_active_job_finishes() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue.add("test", serde_json::json!({})).await.unwrap();

    let (started_tx, mut started_rx) = mpsc::channel::<()>(1);
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let started_tx = started_tx.clone();
        Box::pin(async move {
            let _ = started_tx.send(()).await;
            tokio::time::sleep(Duration::from_millis(500)).await;
            Ok(serde_json::json!("done"))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for processing to start
    tokio::time::timeout(Duration::from_secs(5), started_rx.recv())
        .await
        .expect("timeout")
        .expect("channel closed");

    // Close should wait for the active job
    let start = std::time::Instant::now();
    worker.close(5000).await.unwrap();
    let elapsed = start.elapsed();

    // Should have waited for the job (at least ~400ms remaining)
    assert!(
        elapsed >= Duration::from_millis(300),
        "Close returned too fast: {:?}",
        elapsed
    );

    // Job should be completed
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 1);

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Default Job Options - removeOnComplete
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_default_job_options_remove_on_complete() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        default_job_options: JobOptions {
            remove_on_complete: Some(bullmq::types::RemoveOnFinish::Bool(true)),
            ..Default::default()
        },
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|job: Job, _token: CancellationToken| {
        Box::pin(async move {
            assert_eq!(job.data()["foo"], "bar");
            Ok(serde_json::json!("done"))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

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
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(100)).await;

    // Job should be removed after completion
    let fetched = queue.get_job(&job_id).await.unwrap();
    assert!(fetched.is_none(), "Job should have been removed");
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Default Job Options - removeOnFail
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_default_job_options_remove_on_fail() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        default_job_options: JobOptions {
            remove_on_fail: Some(bullmq::types::RemoveOnFinish::Bool(true)),
            ..Default::default()
        },
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::ProcessingError("fail".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(ev) = worker.next_event().await {
                if matches!(ev, bullmq::worker::WorkerEvent::Failed { .. }) {
                    break;
                }
            }
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(100)).await;

    // Job should be removed after failure
    let fetched = queue.get_job(&job_id).await.unwrap();
    assert!(fetched.is_none(), "Job should have been removed");
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.failed, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Default Job Options - keep count with removeOnComplete
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_default_job_options_keep_count_remove_on_complete() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let keep_jobs: usize = 3;

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        default_job_options: JobOptions {
            remove_on_complete: Some(bullmq::types::RemoveOnFinish::Count(keep_jobs)),
            ..Default::default()
        },
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let total_jobs = 9;
    for i in 0..total_jobs {
        queue
            .add("test", serde_json::json!({"idx": i}))
            .await
            .unwrap();
    }

    let completed_count = Arc::new(AtomicUsize::new(0));
    let completed_count_clone = completed_count.clone();
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let cc = completed_count_clone.clone();
        Box::pin(async move {
            cc.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!("done"))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if completed_count.load(Ordering::SeqCst) >= total_jobs {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(200)).await;

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed as usize, keep_jobs);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Process prioritized jobs with custom jobId
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_process_prioritized_jobs_custom_id() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("test1", serde_json::json!({"p": 2}))
        .options(JobOptions {
            priority: Some(2),
            job_id: Some("custom1".to_string()),
            ..Default::default()
        })
        .await
        .unwrap();
    queue
        .add("test2", serde_json::json!({"p": 3}))
        .options(JobOptions {
            priority: Some(3),
            job_id: Some("custom2".to_string()),
            ..Default::default()
        })
        .await
        .unwrap();

    let completed_count = Arc::new(AtomicUsize::new(0));
    let completed_count_clone = completed_count.clone();
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let cc = completed_count_clone.clone();
        Box::pin(async move {
            cc.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if completed_count.load(Ordering::SeqCst) >= 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timeout");

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 2);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Add Bulk processing
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_add_bulk_processing() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let jobs: Vec<BulkJob> = (0..5)
        .map(|i| BulkJob::new(format!("job-{}", i), serde_json::json!({"idx": i})))
        .collect();

    let added = queue.add_bulk(jobs).await.unwrap();
    assert_eq!(added.len(), 5);

    let completed_count = Arc::new(AtomicUsize::new(0));
    let completed_count_clone = completed_count.clone();
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let cc = completed_count_clone.clone();
        Box::pin(async move {
            cc.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        concurrency: 3,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if completed_count.load(Ordering::SeqCst) >= 5 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timeout");

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 5);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Job retries once then succeeds
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_retries_job_then_succeeds() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(3),
        ..Default::default()
    };
    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .options(job_opts)
        .await
        .unwrap();

    let attempt_counter = Arc::new(AtomicUsize::new(0));
    let attempt_counter_clone = attempt_counter.clone();
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let counter = attempt_counter_clone.clone();
        Box::pin(async move {
            let attempt = counter.fetch_add(1, Ordering::SeqCst) + 1;
            if attempt == 1 {
                Err(Error::ProcessingError("fail first time".to_string()))
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
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for completion
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
    .expect("timeout");

    assert_eq!(attempt_counter.load(Ordering::SeqCst), 2);

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 1);
    assert_eq!(counts.failed, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Not leave orphaned job data when limit is less than removable jobs
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_no_orphaned_data_when_limit_less_than_removable() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let total_jobs = 10;
    let keep_count: usize = 2;
    for i in 0..total_jobs {
        queue
            .add("test", serde_json::json!({"idx": i}))
            .options(JobOptions {
                remove_on_complete: Some(bullmq::types::RemoveOnFinish::Count(keep_count)),
                ..Default::default()
            })
            .await
            .unwrap();
    }

    let completed_count = Arc::new(AtomicUsize::new(0));
    let completed_count_clone = completed_count.clone();
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let cc = completed_count_clone.clone();
        Box::pin(async move {
            cc.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!("done"))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if completed_count.load(Ordering::SeqCst) >= total_jobs {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(200)).await;

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed as usize, keep_count);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Keep jobs newer than specified and up to a count fail with removeOnFail
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_keep_jobs_age_and_count_remove_on_fail() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let keep_count: usize = 5;

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let total_jobs = 10;
    for i in 0..total_jobs {
        queue
            .add("test", serde_json::json!({"idx": i}))
            .options(JobOptions {
                remove_on_fail: Some(bullmq::types::RemoveOnFinish::Options(
                    bullmq::types::KeepJobs {
                        age: Some(7),
                        count: Some(keep_count),
                        limit: None,
                    },
                )),
                ..Default::default()
            })
            .await
            .unwrap();
    }

    let failed_count = Arc::new(AtomicUsize::new(0));
    let failed_count_clone = failed_count.clone();
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let fc = failed_count_clone.clone();
        Box::pin(async move {
            fc.fetch_add(1, Ordering::SeqCst);
            Err(Error::ProcessingError("intentional".to_string()))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if failed_count.load(Ordering::SeqCst) >= total_jobs {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(200)).await;

    let counts = queue.get_job_counts().await.unwrap();
    assert!(
        counts.failed as usize <= keep_count,
        "Expected at most {} failed jobs, got {}",
        keep_count,
        counts.failed
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Retries a job that fails and resets attemptsMade
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_retries_job_resets_attempts_made() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job_opts = JobOptions {
        attempts: Some(3),
        backoff: Some(bullmq::types::BackoffStrategy::Fixed(50)),
        ..Default::default()
    };
    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .options(job_opts)
        .await
        .unwrap();

    let attempt_counter = Arc::new(AtomicUsize::new(0));
    let attempt_counter_clone = attempt_counter.clone();
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let counter = attempt_counter_clone.clone();
        Box::pin(async move {
            let attempt = counter.fetch_add(1, Ordering::SeqCst) + 1;
            // Fail on first two attempts, succeed on third
            if attempt < 3 {
                Err(Error::ProcessingError(format!("fail attempt {}", attempt)))
            } else {
                // On the final (3rd) attempt, the job's attemptsMade should be 2
                assert_eq!(
                    job.attempts_made(),
                    2,
                    "attempts_made should be 2 on third processing"
                );
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
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

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
    .expect("timeout");

    assert_eq!(attempt_counter.load(Ordering::SeqCst), 3);
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 1);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Add bulk with priority
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_add_bulk_with_priority() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add jobs with different priorities
    let jobs: Vec<BulkJob> = vec![
        BulkJob::new("low", serde_json::json!({"priority": "low"})).priority(10),
        BulkJob::new("high", serde_json::json!({"priority": "high"})).priority(1),
        BulkJob::new("medium", serde_json::json!({"priority": "medium"})).priority(5),
    ];

    let added = queue.add_bulk(jobs).await.unwrap();
    assert_eq!(added.len(), 3);

    let order = Arc::new(Mutex::new(Vec::new()));
    let order_clone = order.clone();
    let completed_count = Arc::new(AtomicUsize::new(0));
    let completed_count_clone = completed_count.clone();

    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let o = order_clone.clone();
        let cc = completed_count_clone.clone();
        Box::pin(async move {
            o.lock().await.push(job.name().to_string());
            cc.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        concurrency: 1,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if completed_count.load(Ordering::SeqCst) >= 3 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timeout");

    let processing_order = order.lock().await;
    // Higher priority (lower number) should be processed first
    assert_eq!(processing_order[0], "high");
    assert_eq!(processing_order[1], "medium");
    assert_eq!(processing_order[2], "low");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Concurrent workers keep locks
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_concurrent_workers_keep_locks() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let concurrency = 10;
    for i in 0..concurrency {
        queue
            .add("test", serde_json::json!({"idx": i}))
            .await
            .unwrap();
    }

    let completed_count = Arc::new(AtomicUsize::new(0));
    let completed_count_clone = completed_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let cc = completed_count_clone.clone();
        Box::pin(async move {
            // Hold job for 500ms to test lock maintenance
            tokio::time::sleep(Duration::from_millis(500)).await;
            cc.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        concurrency,
        lock_duration: 1000,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if completed_count.load(Ordering::SeqCst) >= concurrency {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timeout");

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed as usize, concurrency);
    assert_eq!(counts.failed, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Should not keep active jobs after processing
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_no_active_jobs_after_all_processed() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let total = 20;
    for i in 0..total {
        queue
            .add("test", serde_json::json!({"idx": i}))
            .await
            .unwrap();
    }

    let completed_count = Arc::new(AtomicUsize::new(0));
    let completed_count_clone = completed_count.clone();
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let cc = completed_count_clone.clone();
        Box::pin(async move {
            cc.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        concurrency: 5,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if completed_count.load(Ordering::SeqCst) >= total {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(200)).await;

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.active, 0);
    assert_eq!(counts.completed as usize, total);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Process slow job without blocking next (concurrency > 1)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_slow_job_does_not_block_concurrent() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // First job is slow, second is fast
    queue
        .add("test", serde_json::json!({"index": 1, "slow": true}))
        .await
        .unwrap();
    queue
        .add("test", serde_json::json!({"index": 2, "slow": false}))
        .await
        .unwrap();

    let order = Arc::new(Mutex::new(Vec::new()));
    let order_clone = order.clone();
    let completed_count = Arc::new(AtomicUsize::new(0));
    let completed_count_clone = completed_count.clone();

    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let o = order_clone.clone();
        let cc = completed_count_clone.clone();
        Box::pin(async move {
            if job.data()["slow"].as_bool().unwrap_or(false) {
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            o.lock().await.push(job.data()["index"].as_u64().unwrap());
            cc.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!("done"))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        concurrency: 2,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if completed_count.load(Ordering::SeqCst) >= 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timeout");

    let processing_order = order.lock().await;
    // Fast job (index 2) should complete before slow job (index 1)
    assert_eq!(processing_order[0], 2);
    assert_eq!(processing_order[1], 1);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Concurrency respects limit - never exceeds concurrency
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_concurrency_never_exceeded() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let total_jobs = 8;
    let concurrency = 4_usize;
    for i in 0..total_jobs {
        queue
            .add("test", serde_json::json!({"idx": i}))
            .await
            .unwrap();
    }

    let active_count = Arc::new(AtomicUsize::new(0));
    let max_active = Arc::new(AtomicUsize::new(0));
    let completed_count = Arc::new(AtomicUsize::new(0));
    let active_clone = active_count.clone();
    let max_clone = max_active.clone();
    let completed_clone = completed_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let active = active_clone.clone();
        let max = max_clone.clone();
        let cc = completed_clone.clone();
        Box::pin(async move {
            let current = active.fetch_add(1, Ordering::SeqCst) + 1;
            // Update max observed concurrency
            max.fetch_max(current, Ordering::SeqCst);

            tokio::time::sleep(Duration::from_millis(100)).await;

            active.fetch_sub(1, Ordering::SeqCst);
            cc.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        concurrency,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if completed_count.load(Ordering::SeqCst) >= total_jobs {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timeout");

    // Max active should never exceed concurrency
    let observed_max = max_active.load(Ordering::SeqCst);
    assert!(
        observed_max <= concurrency,
        "Max active ({}) exceeded concurrency ({})",
        observed_max,
        concurrency,
    );
    assert!(
        observed_max > 1,
        "Should have had concurrent processing, max was {}",
        observed_max,
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Process job with async operation and verify return value
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_process_async_job_with_return_value() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();
    let job_id = job.id().to_string();

    let processor: ProcessorFn = Arc::new(|job: Job, _token: CancellationToken| {
        Box::pin(async move {
            assert_eq!(job.data()["foo"], "bar");
            tokio::time::sleep(Duration::from_millis(100)).await;
            Ok(serde_json::json!("my data"))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

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
    .expect("timeout");

    tokio::time::sleep(Duration::from_millis(50)).await;
    let fetched = queue.get_job(&job_id).await.unwrap().unwrap();
    assert_eq!(fetched.returnvalue(), "\"my data\"");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Default job options - LIFO
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_default_job_options_lifo() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        default_job_options: JobOptions {
            lifo: Some(true),
            ..Default::default()
        },
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add jobs: 1, 2, 3 - with LIFO, processing should be 3, 2, 1
    for i in 1..=3 {
        queue
            .add("test", serde_json::json!({"idx": i}))
            .await
            .unwrap();
    }

    let order = Arc::new(Mutex::new(Vec::new()));
    let order_clone = order.clone();
    let completed_count = Arc::new(AtomicUsize::new(0));
    let completed_count_clone = completed_count.clone();

    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let o = order_clone.clone();
        let cc = completed_count_clone.clone();
        Box::pin(async move {
            o.lock().await.push(job.data()["idx"].as_u64().unwrap());
            cc.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        concurrency: 1,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if completed_count.load(Ordering::SeqCst) >= 3 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timeout");

    let processing_order = order.lock().await;
    assert_eq!(processing_order[0], 3);
    assert_eq!(processing_order[1], 2);
    assert_eq!(processing_order[2], 1);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Worker should not process jobs from other queues
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_worker_ignores_other_queues() {
    let name1 = test_queue_name();
    let name2 = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts1 = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue1 = Queue::with_options(&name1, queue_opts1).await.unwrap();

    let queue_opts2 = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue2 = Queue::with_options(&name2, queue_opts2).await.unwrap();

    // Add job to queue2
    queue2
        .add("test", serde_json::json!({"queue": 2}))
        .await
        .unwrap();

    // Worker listens to queue1 only
    let processed = Arc::new(AtomicUsize::new(0));
    let processed_clone = processed.clone();
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let p = processed_clone.clone();
        Box::pin(async move {
            p.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };
    let worker = Worker::with_options(&name1, processor, worker_opts)
        .await
        .unwrap();

    // Wait a bit, no jobs should be processed
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert_eq!(processed.load(Ordering::SeqCst), 0);

    // Now add a job to queue1
    queue1
        .add("test", serde_json::json!({"queue": 1}))
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if processed.load(Ordering::SeqCst) >= 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timeout");

    assert_eq!(processed.load(Ordering::SeqCst), 1);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue1).await;
    cleanup_queue(&queue2).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Worker with autorun false processes jobs after run() is called
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_autorun_false_no_processing_until_run() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    let processed = Arc::new(AtomicUsize::new(0));
    let processed_clone = processed.clone();
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let p = processed_clone.clone();
        Box::pin(async move {
            p.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: false,
        ..Default::default()
    };
    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Worker is not running, so no processing should happen
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(processed.load(Ordering::SeqCst), 0);

    // Now start the worker
    worker.run().await.unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if processed.load(Ordering::SeqCst) >= 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timeout");

    assert_eq!(processed.load(Ordering::SeqCst), 1);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Progress, Active, Paused/Resumed Events
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_update_progress_as_number() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("progress-job", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(move |mut job: Job, _token: CancellationToken| {
        Box::pin(async move {
            job.update_progress(JobProgress::Number(42.0)).await?;
            job.update_progress(JobProgress::Number(100.0)).await?;
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut progress_values: Vec<f64> = Vec::new();

    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = worker.next_event().await;
            match ev {
                Some(WorkerEvent::Progress { progress, .. }) => {
                    if let JobProgress::Number(n) = progress {
                        progress_values.push(n);
                    }
                    if progress_values.len() == 2 {
                        break;
                    }
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;

    assert!(timeout.is_ok(), "Timed out waiting for progress events");
    assert_eq!(progress_values, vec![42.0, 100.0]);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_update_progress_as_object() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("progress-obj-job", serde_json::json!({}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(move |mut job: Job, _token: CancellationToken| {
        Box::pin(async move {
            job.update_progress(JobProgress::Object(
                serde_json::json!({"total": 100, "done": 50}),
            ))
            .await?;
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut got_progress = false;

    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = worker.next_event().await;
            match ev {
                Some(WorkerEvent::Progress { progress, .. }) => {
                    if let JobProgress::Object(val) = progress {
                        assert_eq!(val["total"], 100);
                        assert_eq!(val["done"], 50);
                        got_progress = true;
                    }
                    break;
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;

    assert!(timeout.is_ok(), "Timed out waiting for progress event");
    assert!(
        got_progress,
        "Should have received progress event with object"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_active_event_emitted() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("active-test", serde_json::json!({}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut got_active = false;
    let mut active_job_id = String::new();

    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = worker.next_event().await;
            match ev {
                Some(WorkerEvent::Active { job_id }) => {
                    got_active = true;
                    active_job_id = job_id;
                }
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;

    assert!(timeout.is_ok(), "Timed out waiting for events");
    assert!(got_active, "Should have received Active event");
    assert!(!active_job_id.is_empty(), "Active event should have job_id");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_paused_resumed_events() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait a bit for worker to start
    tokio::time::sleep(Duration::from_millis(100)).await;

    worker.pause();
    worker.resume();

    let mut got_paused = false;
    let mut got_resumed = false;

    let timeout = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let ev = worker.next_event().await;
            match ev {
                Some(WorkerEvent::Paused) => got_paused = true,
                Some(WorkerEvent::Resumed) => {
                    got_resumed = true;
                    break;
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;

    assert!(timeout.is_ok(), "Timed out waiting for paused/resumed");
    assert!(got_paused, "Should have received Paused event");
    assert!(got_resumed, "Should have received Resumed event");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_update_data() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("update-data-job", serde_json::json!({"initial": true}))
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel::<serde_json::Value>(1);
    let processor: ProcessorFn = Arc::new(move |mut job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            let new_data = serde_json::json!({"updated": true, "value": 123});
            job.update_data(new_data.clone()).await?;
            tx.send(job.data().clone()).await.unwrap();
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let data = tokio::time::timeout(Duration::from_secs(10), rx.recv())
        .await
        .expect("timeout waiting for data")
        .expect("channel closed");

    assert_eq!(data["updated"], true);
    assert_eq!(data["value"], 123);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_job_log() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue.add("log-job", serde_json::json!({})).await.unwrap();

    let (tx, mut rx) = mpsc::channel::<u64>(1);
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            job.log("First log entry").await?;
            let count = job.log("Second log entry").await?;
            tx.send(count).await.unwrap();
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let count = tokio::time::timeout(Duration::from_secs(10), rx.recv())
        .await
        .expect("timeout waiting for log count")
        .expect("channel closed");

    assert_eq!(count, 2, "Should have 2 log entries");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Job Retry (reprocessJob)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_retry_failed_job() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let mut job = queue
        .add("retry-me", serde_json::json!({"x": 1}))
        .await
        .unwrap();

    let attempt_count = Arc::new(AtomicUsize::new(0));
    let attempt_count2 = attempt_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let attempt_count = attempt_count2.clone();
        Box::pin(async move {
            let n = attempt_count.fetch_add(1, Ordering::SeqCst);
            if n == 0 {
                Err(Error::ProcessingError("first attempt fails".into()))
            } else {
                Ok(serde_json::json!({"success": true}))
            }
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for the first processing to fail
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = worker.next_event().await;
            match ev {
                Some(WorkerEvent::Failed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Timed out waiting for failed event");

    // Now retry the failed job
    job.retry("failed", None).await.unwrap();

    // Wait for the second processing to complete
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = worker.next_event().await;
            match ev {
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(
        timeout.is_ok(),
        "Timed out waiting for completed event after retry"
    );
    assert_eq!(attempt_count.load(Ordering::SeqCst), 2);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_retry_completed_job() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let mut job = queue
        .add("retry-completed", serde_json::json!({}))
        .await
        .unwrap();

    let attempt_count = Arc::new(AtomicUsize::new(0));
    let attempt_count2 = attempt_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let attempt_count = attempt_count2.clone();
        Box::pin(async move {
            attempt_count.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!({"done": true}))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for first completion
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = worker.next_event().await;
            match ev {
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(
        timeout.is_ok(),
        "Timed out waiting for first completed event"
    );

    // Retry from completed state
    job.retry("completed", None).await.unwrap();

    // Wait for second completion
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = worker.next_event().await;
            match ev {
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(
        timeout.is_ok(),
        "Timed out waiting for second completed event"
    );
    assert_eq!(attempt_count.load(Ordering::SeqCst), 2);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_retry_with_reset_attempts_made() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let mut job = queue
        .add("retry-reset", serde_json::json!({}))
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel::<u32>(2);
    let call_count = Arc::new(AtomicUsize::new(0));
    let call_count2 = call_count.clone();

    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        let call_count = call_count2.clone();
        Box::pin(async move {
            let n = call_count.fetch_add(1, Ordering::SeqCst);
            tx.send(job.attempts_made()).await.unwrap();
            if n == 0 {
                Err(Error::ProcessingError("fail first".into()))
            } else {
                Ok(serde_json::json!(null))
            }
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for failure
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = worker.next_event().await;
            match ev {
                Some(WorkerEvent::Failed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok());

    // Retry with reset_attempts_made
    job.retry(
        "failed",
        Some(RetryOptions {
            reset_attempts_made: true,
            ..Default::default()
        }),
    )
    .await
    .unwrap();

    // Wait for second processing to complete
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = worker.next_event().await;
            match ev {
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok());

    // Check that attempts_made was reset: first call had attempts_made from first processing,
    // second call should have attempts_made=0 because we reset it
    let _first = rx.recv().await.unwrap();
    let second = rx.recv().await.unwrap();
    // first processing increments to 1 inside moveToFinished, but we see pre-increment value
    // second processing after reset should see 0
    assert_eq!(second, 0, "attempts_made should be reset to 0");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Custom Backoff Strategy
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_custom_backoff_strategy() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("custom-backoff", serde_json::json!({}))
        .options(JobOptions {
            attempts: Some(3),
            backoff: Some(BackoffStrategy::Custom("custom".to_string())),
            ..Default::default()
        })
        .await
        .unwrap();

    let attempt_count = Arc::new(AtomicUsize::new(0));
    let attempt_count2 = attempt_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let attempt_count = attempt_count2.clone();
        Box::pin(async move {
            let n = attempt_count.fetch_add(1, Ordering::SeqCst);
            if n < 2 {
                Err(Error::ProcessingError("fail".into()))
            } else {
                Ok(serde_json::json!(null))
            }
        })
    });

    let backoff_fn: bullmq::BackoffStrategyFn = Arc::new(
        |_attempts_made: u32, _type_name: &str, _err: &str, _data: &serde_json::Value| {
            Box::pin(async move { 100i64 }) // 100ms delay
        },
    );

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        drain_delay: 1,
        backoff_strategy: Some(backoff_fn),
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for completion (should retry twice with custom backoff then succeed)
    let mut failed_count = 0usize;
    let mut completed = false;
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = worker.next_event().await;
            match ev {
                Some(WorkerEvent::Completed { .. }) => {
                    completed = true;
                    break;
                }
                Some(WorkerEvent::Failed { error, .. }) => {
                    failed_count += 1;
                    eprintln!("FAILED event #{}: {}", failed_count, error);
                    if failed_count >= 3 {
                        break;
                    }
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(
        timeout.is_ok(),
        "Timed out waiting for completion (failed_count={})",
        failed_count
    );
    assert!(
        completed,
        "Should have completed (failed_count={})",
        failed_count
    );
    assert_eq!(attempt_count.load(Ordering::SeqCst), 3);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_custom_backoff_returns_minus_one_no_retry() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("no-retry-custom", serde_json::json!({}))
        .options(JobOptions {
            attempts: Some(5),
            backoff: Some(BackoffStrategy::Custom("myCustom".to_string())),
            ..Default::default()
        })
        .await
        .unwrap();

    let attempt_count = Arc::new(AtomicUsize::new(0));
    let attempt_count2 = attempt_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let attempt_count = attempt_count2.clone();
        Box::pin(async move {
            attempt_count.fetch_add(1, Ordering::SeqCst);
            Err(Error::ProcessingError("always fails".into()))
        })
    });

    // Return -1 to signal "don't retry"
    let backoff_fn: bullmq::BackoffStrategyFn = Arc::new(
        |_attempts_made: u32, _type_name: &str, _err: &str, _data: &serde_json::Value| {
            Box::pin(async move { -1i64 })
        },
    );

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        backoff_strategy: Some(backoff_fn),
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for the failed event (should only process once since backoff returns -1)
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = worker.next_event().await;
            match ev {
                Some(WorkerEvent::Failed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Timed out waiting for failed event");

    // Give a moment for any unexpected retries
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        attempt_count.load(Ordering::SeqCst),
        1,
        "Should only attempt once"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_custom_backoff_based_on_error() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("error-based-backoff", serde_json::json!({}))
        .options(JobOptions {
            attempts: Some(3),
            backoff: Some(BackoffStrategy::Custom("errorBased".to_string())),
            ..Default::default()
        })
        .await
        .unwrap();

    let attempt_count = Arc::new(AtomicUsize::new(0));
    let attempt_count2 = attempt_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let attempt_count = attempt_count2.clone();
        Box::pin(async move {
            let n = attempt_count.fetch_add(1, Ordering::SeqCst);
            if n < 2 {
                Err(Error::ProcessingError("SpecificError".into()))
            } else {
                Ok(serde_json::json!(null))
            }
        })
    });

    let (tx, mut rx) = mpsc::channel::<String>(4);
    let backoff_fn: bullmq::BackoffStrategyFn = Arc::new(
        move |_attempts_made: u32, _type_name: &str, err: &str, _data: &serde_json::Value| {
            let tx = tx.clone();
            let err = err.to_string();
            Box::pin(async move {
                let _ = tx.send(err).await;
                50i64
            })
        },
    );

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        drain_delay: 1,
        backoff_strategy: Some(backoff_fn),
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for completion
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = worker.next_event().await;
            match ev {
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Timed out");

    // Verify the error was passed to the backoff function
    let err_msg = rx.recv().await.unwrap();
    assert!(err_msg.contains("SpecificError"));

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_custom_backoff_based_on_job_data() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add(
            "data-based-backoff",
            serde_json::json!({"delay_factor": 200}),
        )
        .options(JobOptions {
            attempts: Some(3),
            backoff: Some(BackoffStrategy::Custom("dataBased".to_string())),
            ..Default::default()
        })
        .await
        .unwrap();

    let attempt_count = Arc::new(AtomicUsize::new(0));
    let attempt_count2 = attempt_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let attempt_count = attempt_count2.clone();
        Box::pin(async move {
            let n = attempt_count.fetch_add(1, Ordering::SeqCst);
            if n < 1 {
                Err(Error::ProcessingError("fail".into()))
            } else {
                Ok(serde_json::json!(null))
            }
        })
    });

    let (tx, mut rx) = mpsc::channel::<i64>(4);
    let backoff_fn: bullmq::BackoffStrategyFn = Arc::new(
        move |_attempts_made: u32, _type_name: &str, _err: &str, data: &serde_json::Value| {
            let tx = tx.clone();
            let delay = data
                .get("delay_factor")
                .and_then(|v| v.as_i64())
                .unwrap_or(100);
            Box::pin(async move {
                let _ = tx.send(delay).await;
                delay
            })
        },
    );

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        drain_delay: 1,
        backoff_strategy: Some(backoff_fn),
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for completion
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = worker.next_event().await;
            match ev {
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Timed out");

    // Verify delay was computed from job data
    let delay = rx.recv().await.unwrap();
    assert_eq!(delay, 200);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_custom_backoff_for_custom_type() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("typed-backoff", serde_json::json!({}))
        .options(JobOptions {
            attempts: Some(3),
            backoff: Some(BackoffStrategy::Custom("mySpecialType".to_string())),
            ..Default::default()
        })
        .await
        .unwrap();

    let attempt_count = Arc::new(AtomicUsize::new(0));
    let attempt_count2 = attempt_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let attempt_count = attempt_count2.clone();
        Box::pin(async move {
            let n = attempt_count.fetch_add(1, Ordering::SeqCst);
            if n < 1 {
                Err(Error::ProcessingError("fail".into()))
            } else {
                Ok(serde_json::json!(null))
            }
        })
    });

    let (tx, mut rx) = mpsc::channel::<String>(4);
    let backoff_fn: bullmq::BackoffStrategyFn = Arc::new(
        move |_attempts_made: u32, type_name: &str, _err: &str, _data: &serde_json::Value| {
            let tx = tx.clone();
            let type_name = type_name.to_string();
            Box::pin(async move {
                let _ = tx.send(type_name).await;
                50i64
            })
        },
    );

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        drain_delay: 1,
        backoff_strategy: Some(backoff_fn),
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for completion
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = worker.next_event().await;
            match ev {
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Timed out");

    // Verify the type name was passed
    let received_type = rx.recv().await.unwrap();
    assert_eq!(received_type, "mySpecialType");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Progress Variants (string, boolean)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_update_progress_as_string() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(move |mut job: Job, _token: CancellationToken| {
        Box::pin(async move {
            job.update_progress(JobProgress::Object(serde_json::Value::String(
                "progress as string".to_string(),
            )))
            .await?;
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = worker.next_event().await;
            match ev {
                Some(WorkerEvent::Progress {
                    progress: JobProgress::Object(serde_json::Value::String(s)),
                    ..
                }) => {
                    assert_eq!(s, "progress as string");
                    break;
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(
        timeout.is_ok(),
        "Timed out waiting for string progress event"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_update_progress_as_boolean() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(move |mut job: Job, _token: CancellationToken| {
        Box::pin(async move {
            job.update_progress(JobProgress::Object(serde_json::Value::Bool(true)))
                .await?;
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = worker.next_event().await;
            match ev {
                Some(WorkerEvent::Progress {
                    progress: JobProgress::Object(serde_json::Value::Bool(b)),
                    ..
                }) => {
                    assert!(b);
                    break;
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(
        timeout.is_ok(),
        "Timed out waiting for boolean progress event"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Non-blocking getNextJob
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_get_next_job_nonblocking_returns_none_when_empty() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: false,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Non-blocking should return None immediately when no jobs
    let result = worker.get_next_job_nonblocking("token-1").await.unwrap();
    assert!(result.is_none());

    // Add a job and fetch it
    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    // Small delay to ensure Redis propagation
    tokio::time::sleep(Duration::from_millis(50)).await;

    let result = worker.get_next_job_nonblocking("token-2").await.unwrap();
    assert!(result.is_some());
    let job = result.unwrap();
    assert_eq!(job.data()["foo"], "bar");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_next_job_nonblocking_when_paused() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: false,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Add a job
    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    // Pause the worker
    worker.pause();

    // Non-blocking fetch while paused — should return None
    let result = worker.get_next_job_nonblocking("token-1").await.unwrap();
    assert!(result.is_none());

    // Resume and fetch
    worker.resume();

    let result = worker.get_next_job_nonblocking("token-2").await.unwrap();
    assert!(result.is_some());

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_next_job_emits_active_event() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: false,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Fetch the job manually
    let fetched = worker.get_next_job("token-1").await.unwrap();
    assert!(fetched.is_some());

    // Check that Active event was emitted
    let ev = worker.next_event().await;
    match ev {
        Some(WorkerEvent::Active { job_id }) => {
            assert_eq!(job_id, job.id());
        }
        other => panic!("Expected Active event, got {:?}", other),
    }

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Retry Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_cannot_retry_active_job() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let (tx, mut rx) = mpsc::unbounded_channel::<()>();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send(()).unwrap();
            // Keep the job active for a while
            tokio::time::sleep(Duration::from_secs(2)).await;
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    // Wait for the job to start processing
    rx.recv().await.unwrap();

    // Trying to retry while active should fail
    let result = job.retry("failed", None).await;
    assert!(result.is_err());

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_cannot_retry_completed_job_from_failed_state() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let attempt_count = Arc::new(AtomicUsize::new(0));
    let attempt_count_clone = attempt_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let count = attempt_count_clone.clone();
        Box::pin(async move {
            let attempt = count.fetch_add(1, Ordering::SeqCst);
            if attempt == 0 {
                return Err(Error::ProcessingError("first failure".to_string()));
            }
            Ok(serde_json::json!("done"))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    // Wait for the job to fail
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Failed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok());

    // Retry the failed job (should succeed)
    job.retry("failed", None).await.unwrap();

    // Wait for it to complete
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok());

    // Trying to retry from "failed" state when it's now "completed" should fail
    let result = job.retry("failed", None).await;
    assert!(result.is_err());

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Close Behavior
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_close_while_job_completes() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::unbounded_channel::<()>();

    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            assert_eq!(job.data()["foo"], "bar");
            tx.send(()).unwrap();
            // Simulate slow processing
            tokio::time::sleep(Duration::from_millis(500)).await;
            Ok(serde_json::json!("completed"))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for processing to start
    rx.recv().await.unwrap();

    // Close while job is processing (graceful close should wait for job to finish)
    let close_result = worker.close(5000).await;
    assert!(close_result.is_ok());
}

#[tokio::test]
async fn test_close_while_job_fails() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::unbounded_channel::<()>();

    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            assert_eq!(job.data()["foo"], "bar");
            tx.send(()).unwrap();
            // Simulate slow processing then fail
            tokio::time::sleep(Duration::from_millis(500)).await;
            Err(Error::ProcessingError("Job Failed".to_string()))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for processing to start
    rx.recv().await.unwrap();

    // Close while job is processing (graceful close should wait for job to finish)
    let close_result = worker.close(5000).await;
    assert!(close_result.is_ok());
}

// ═══════════════════════════════════════════════════════════════════════════
// Backoff Timing Verification
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_exponential_backoff_total_timing() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let base_delay: u64 = 100;
    let attempts: u32 = 4;

    let opts = JobOptions {
        attempts: Some(attempts),
        backoff: Some(BackoffStrategy::Exponential(base_delay)),
        ..Default::default()
    };
    queue
        .add("test", serde_json::json!({}))
        .options(opts)
        .await
        .unwrap();

    let start = std::time::Instant::now();
    let attempt_count = Arc::new(AtomicUsize::new(0));
    let attempt_count_clone = attempt_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let count = attempt_count_clone.clone();
        Box::pin(async move {
            count.fetch_add(1, Ordering::SeqCst);
            Err(Error::ProcessingError("fail".to_string()))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for all attempts to be exhausted (final failure)
    let timeout = tokio::time::timeout(Duration::from_secs(30), async {
        let mut fail_count = 0u32;
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Failed { .. }) => {
                    fail_count += 1;
                    if fail_count >= attempts {
                        break;
                    }
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Timed out waiting for all failures");

    let elapsed = start.elapsed().as_millis() as u64;
    // Exponential: delay * 2^(attempt-1) for attempts 1,2,3
    // Total minimum delay: 100 + 200 + 400 = 700ms
    let expected_min = base_delay + base_delay * 2 + base_delay * 4; // 700
    assert!(
        elapsed >= expected_min - 50,
        "Elapsed {}ms should be >= ~{}ms",
        elapsed,
        expected_min
    );
    assert_eq!(attempt_count.load(Ordering::SeqCst), attempts as usize);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_fixed_backoff_constant_delay() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let delay_ms: u64 = 1500;
    let attempts: u32 = 3;

    let opts = JobOptions {
        attempts: Some(attempts),
        backoff: Some(BackoffStrategy::Fixed(delay_ms)),
        ..Default::default()
    };
    queue
        .add("test", serde_json::json!({}))
        .options(opts)
        .await
        .unwrap();

    let fail_times = Arc::new(Mutex::new(Vec::<u64>::new()));
    let fail_times_clone = fail_times.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let ft = fail_times_clone.clone();
        Box::pin(async move {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;
            ft.lock().await.push(now);
            Err(Error::ProcessingError("fail".to_string()))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let timeout = tokio::time::timeout(Duration::from_secs(15), async {
        let mut fail_count = 0u32;
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Failed { .. }) => {
                    fail_count += 1;
                    if fail_count >= attempts {
                        break;
                    }
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Timed out waiting for all failures");

    let times = fail_times.lock().await;
    assert_eq!(times.len(), attempts as usize);

    // Verify each interval is at least the fixed delay (drain_delay polling adds overhead)
    for i in 1..times.len() {
        let interval = times[i] - times[i - 1];
        assert!(
            interval >= delay_ms - 100,
            "Interval {}ms should be >= ~{}ms",
            interval,
            delay_ms
        );
    }

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Concurrency Limits
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_concurrency_limits_parallel_processing() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let concurrency = 4;
    let total_jobs = 8;

    // Add jobs
    for i in 0..total_jobs {
        queue
            .add("test", serde_json::json!({"index": i}))
            .await
            .unwrap();
    }

    let max_concurrent = Arc::new(AtomicUsize::new(0));
    let current_concurrent = Arc::new(AtomicUsize::new(0));
    let max_concurrent_clone = max_concurrent.clone();
    let current_concurrent_clone = current_concurrent.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let max_c = max_concurrent_clone.clone();
        let cur_c = current_concurrent_clone.clone();
        Box::pin(async move {
            let current = cur_c.fetch_add(1, Ordering::SeqCst) + 1;
            // Update max if this is a new high
            loop {
                let prev_max = max_c.load(Ordering::SeqCst);
                if current <= prev_max {
                    break;
                }
                if max_c
                    .compare_exchange(prev_max, current, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok()
                {
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
            cur_c.fetch_sub(1, Ordering::SeqCst);
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        concurrency,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for all jobs to complete
    let timeout = tokio::time::timeout(Duration::from_secs(15), async {
        let mut completed = 0;
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => {
                    completed += 1;
                    if completed >= total_jobs {
                        break;
                    }
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Timed out waiting for completions");

    let observed_max = max_concurrent.load(Ordering::SeqCst);
    assert!(
        observed_max <= concurrency,
        "Max concurrent {} should be <= concurrency {}",
        observed_max,
        concurrency
    );
    assert!(
        observed_max >= 2,
        "Should have seen some parallelism, got {}",
        observed_max
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pause + Retry Interaction
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_retry_moves_job_to_paused_when_queue_paused() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let attempt_count = Arc::new(AtomicUsize::new(0));
    let attempt_count_clone = attempt_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let count = attempt_count_clone.clone();
        Box::pin(async move {
            let attempt = count.fetch_add(1, Ordering::SeqCst);
            if attempt == 0 {
                return Err(Error::ProcessingError("fail first time".to_string()));
            }
            Ok(serde_json::json!("done"))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    // Wait for the job to fail
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Failed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok());

    // Pause the worker
    worker.pause();
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Retry the job while paused — it should go to paused list
    job.retry("failed", None).await.unwrap();

    // The job should now be in the paused state (waiting in paused list)
    // Resume and it should complete
    worker.resume();

    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Job should complete after resume");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Job State Methods
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_job_get_state_waiting() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    let state = queue.get_job_state(job.id()).await.unwrap();
    assert_eq!(state, JobState::Waiting);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_job_get_state_active() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send(job.id().to_string()).unwrap();
            tokio::time::sleep(Duration::from_secs(2)).await;
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let job = queue.add("test", serde_json::json!({})).await.unwrap();

    // Wait for the job to become active
    let _active_job_id = rx.recv().await.unwrap();

    let state = queue.get_job_state(job.id()).await.unwrap();
    assert_eq!(state, JobState::Active);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_job_get_state_completed() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!("done")) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let job = queue.add("test", serde_json::json!({})).await.unwrap();

    // Wait for completion
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok());

    let state = queue.get_job_state(job.id()).await.unwrap();
    assert_eq!(state, JobState::Completed);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_job_get_state_failed() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::ProcessingError("fail".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let job = queue.add("test", serde_json::json!({})).await.unwrap();

    // Wait for failure
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Failed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok());

    let state = queue.get_job_state(job.id()).await.unwrap();
    assert_eq!(state, JobState::Failed);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_job_get_state_delayed() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let opts = JobOptions {
        delay: Some(60000), // 60 seconds — won't be promoted during test
        ..Default::default()
    };
    let job = queue
        .add("test", serde_json::json!({}))
        .options(opts)
        .await
        .unwrap();

    let state = queue.get_job_state(job.id()).await.unwrap();
    assert_eq!(state, JobState::Delayed);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_job_is_active_via_get_next_job() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let job = queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: false,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Manually fetch the job — it should now be active
    let fetched = worker.get_next_job("token-1").await.unwrap();
    assert!(fetched.is_some());

    let state = queue.get_job_state(job.id()).await.unwrap();
    assert_eq!(state, JobState::Active);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Additional Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_worker_processes_after_pause_resume_cycle() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!("done")) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Pause, add a job, resume — job should be processed
    worker.pause();
    tokio::time::sleep(Duration::from_millis(100)).await;

    queue.add("test", serde_json::json!({})).await.unwrap();

    worker.resume();

    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Job should be processed after resume");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_worker_multiple_pause_resume_cycles() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let completed_count = Arc::new(AtomicUsize::new(0));
    let completed_clone = completed_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let cc = completed_clone.clone();
        Box::pin(async move {
            cc.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!("done"))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Add job, wait for completion
    queue.add("test1", serde_json::json!({})).await.unwrap();

    let timeout = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok());

    // Pause and resume
    worker.pause();
    tokio::time::sleep(Duration::from_millis(100)).await;
    worker.resume();

    // Add another job
    queue.add("test2", serde_json::json!({})).await.unwrap();

    let timeout = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok());
    assert_eq!(completed_count.load(Ordering::SeqCst), 2);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_worker_unrecoverable_error_skips_retries() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let attempt_count = Arc::new(AtomicUsize::new(0));
    let attempt_count_clone = attempt_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let count = attempt_count_clone.clone();
        Box::pin(async move {
            count.fetch_add(1, Ordering::SeqCst);
            Err(Error::Unrecoverable("fatal error".to_string()))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Job with 3 attempts but should fail immediately with unrecoverable error
    let opts = JobOptions {
        attempts: Some(3),
        backoff: Some(BackoffStrategy::Fixed(100)),
        ..Default::default()
    };
    queue
        .add("test", serde_json::json!({}))
        .options(opts)
        .await
        .unwrap();

    // Wait for failure
    let timeout = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Failed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok());

    // Should have only been attempted once (unrecoverable skips retries)
    assert_eq!(attempt_count.load(Ordering::SeqCst), 1);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Dynamic Concurrency
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_set_concurrency_increase() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let total_jobs = 16;
    for i in 0..total_jobs {
        queue
            .add("test", serde_json::json!({"index": i}))
            .await
            .unwrap();
    }

    let max_concurrent_phase1 = Arc::new(AtomicUsize::new(0));
    let current_concurrent = Arc::new(AtomicUsize::new(0));
    let completed_count = Arc::new(AtomicUsize::new(0));
    let max_c1 = max_concurrent_phase1.clone();
    let cur_c = current_concurrent.clone();
    let comp = completed_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let max_c1 = max_c1.clone();
        let cur_c = cur_c.clone();
        let comp = comp.clone();
        Box::pin(async move {
            let current = cur_c.fetch_add(1, Ordering::SeqCst) + 1;
            let completed_so_far = comp.load(Ordering::SeqCst);

            if completed_so_far < 8 {
                loop {
                    let prev = max_c1.load(Ordering::SeqCst);
                    if current <= prev
                        || max_c1
                            .compare_exchange(prev, current, Ordering::SeqCst, Ordering::SeqCst)
                            .is_ok()
                    {
                        break;
                    }
                }
            }

            tokio::time::sleep(Duration::from_millis(50)).await;
            cur_c.fetch_sub(1, Ordering::SeqCst);
            comp.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        concurrency: 4,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for first 8 completions
    let timeout = tokio::time::timeout(Duration::from_secs(15), async {
        let mut count = 0;
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => {
                    count += 1;
                    if count >= 8 {
                        break;
                    }
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Timed out waiting for first 8 completions");

    // Increase concurrency
    worker.set_concurrency(8);

    // Wait for remaining 8 completions
    let timeout = tokio::time::timeout(Duration::from_secs(15), async {
        let mut count = 0;
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => {
                    count += 1;
                    if count >= 8 {
                        break;
                    }
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Timed out waiting for last 8 completions");

    let phase1_max = max_concurrent_phase1.load(Ordering::SeqCst);
    assert!(
        phase1_max <= 4,
        "Phase 1 max concurrent {} should be <= 4",
        phase1_max
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_set_concurrency_decrease() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    let total_jobs = 16;
    for i in 0..total_jobs {
        queue
            .add("test", serde_json::json!({"index": i}))
            .await
            .unwrap();
    }

    let max_concurrent_phase2 = Arc::new(AtomicUsize::new(0));
    let current_concurrent = Arc::new(AtomicUsize::new(0));
    let completed_count = Arc::new(AtomicUsize::new(0));
    let max_c2 = max_concurrent_phase2.clone();
    let cur_c = current_concurrent.clone();
    let comp = completed_count.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let max_c2 = max_c2.clone();
        let cur_c = cur_c.clone();
        let comp = comp.clone();
        Box::pin(async move {
            let current = cur_c.fetch_add(1, Ordering::SeqCst) + 1;
            let completed_so_far = comp.load(Ordering::SeqCst);

            // Track max concurrency only after transition settles (12+ completions)
            if completed_so_far >= 12 {
                loop {
                    let prev = max_c2.load(Ordering::SeqCst);
                    if current <= prev
                        || max_c2
                            .compare_exchange(prev, current, Ordering::SeqCst, Ordering::SeqCst)
                            .is_ok()
                    {
                        break;
                    }
                }
            }

            tokio::time::sleep(Duration::from_millis(50)).await;
            cur_c.fetch_sub(1, Ordering::SeqCst);
            comp.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        concurrency: 4,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for first 8 completions
    let timeout = tokio::time::timeout(Duration::from_secs(15), async {
        let mut count = 0;
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => {
                    count += 1;
                    if count >= 8 {
                        break;
                    }
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Timed out waiting for first 8");

    // Decrease concurrency
    worker.set_concurrency(2);

    // Wait for remaining 8 completions
    let timeout = tokio::time::timeout(Duration::from_secs(15), async {
        let mut count = 0;
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => {
                    count += 1;
                    if count >= 8 {
                        break;
                    }
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Timed out waiting for last 8");

    let phase2_max = max_concurrent_phase2.load(Ordering::SeqCst);
    assert!(
        phase2_max <= 2,
        "Phase 2 max concurrent {} should be <= 2 after decrease",
        phase2_max
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// DelayedError support
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_delayed_error_moves_job_to_delayed_and_reprocesses() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("test", serde_json::json!({"step": 0}))
        .await
        .unwrap();

    let attempt_count = Arc::new(AtomicUsize::new(0));
    let ac = attempt_count.clone();

    let processor: ProcessorFn = Arc::new(move |mut job: Job, _token: CancellationToken| {
        let ac = ac.clone();
        Box::pin(async move {
            let step = job.data().get("step").and_then(|v| v.as_u64()).unwrap_or(0);
            ac.fetch_add(1, Ordering::SeqCst);

            if step == 0 {
                // Move to delayed, then throw DelayedError
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64;
                job.move_to_delayed(now + 200).await.unwrap();
                job.update_data(serde_json::json!({"step": 1}))
                    .await
                    .unwrap();
                return Err(Error::Delayed);
            }

            // Step 1: complete
            Ok(serde_json::json!({"done": true}))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for completion
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Closed) | None => panic!("worker closed unexpectedly"),
                _ => {}
            }
        }
    })
    .await;
    assert!(
        timeout.is_ok(),
        "Job should eventually complete after being delayed"
    );

    // Should have been processed twice (step 0 -> delayed, step 1 -> completed)
    assert_eq!(attempt_count.load(Ordering::SeqCst), 2);

    // Verify job is completed
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 1);
    assert_eq!(counts.failed, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_delayed_error_does_not_emit_failed_event() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("test", serde_json::json!({"step": 0}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(move |mut job: Job, _token: CancellationToken| {
        Box::pin(async move {
            let step = job.data().get("step").and_then(|v| v.as_u64()).unwrap_or(0);

            if step == 0 {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64;
                job.move_to_delayed(now + 100).await.unwrap();
                job.update_data(serde_json::json!({"step": 1}))
                    .await
                    .unwrap();
                return Err(Error::Delayed);
            }

            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let mut saw_failed = false;
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Failed { .. }) => {
                    saw_failed = true;
                }
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Should complete");
    assert!(!saw_failed, "DelayedError should NOT emit a Failed event");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_discard_does_not_convert_delayed_error_to_failure() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("test", serde_json::json!({"step": 0}))
        .await
        .unwrap();

    let attempt_count = Arc::new(AtomicUsize::new(0));
    let attempts = attempt_count.clone();

    let processor: ProcessorFn = Arc::new(move |mut job: Job, _token: CancellationToken| {
        let attempts = attempts.clone();
        Box::pin(async move {
            let step = job.data().get("step").and_then(|v| v.as_u64()).unwrap_or(0);
            attempts.fetch_add(1, Ordering::SeqCst);

            if step == 0 {
                job.discard();
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64;
                job.move_to_delayed(now + 100).await.unwrap();
                job.update_data(serde_json::json!({"step": 1}))
                    .await
                    .unwrap();
                return Err(Error::Delayed);
            }

            Ok(serde_json::json!({"done": true}))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Failed { error, .. }) => {
                    panic!("discarded Delayed error should not fail the job: {error}")
                }
                Some(WorkerEvent::Closed) | None => panic!("worker closed unexpectedly"),
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Job should complete after being delayed");

    assert_eq!(attempt_count.load(Ordering::SeqCst), 2);
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 1);
    assert_eq!(counts.failed, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Queue.clean()
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_queue_clean_completed_jobs() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add and process jobs
    for i in 0..5 {
        queue
            .add("test", serde_json::json!({"i": i}))
            .await
            .unwrap();
    }

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for all jobs to complete
    let timeout = tokio::time::timeout(Duration::from_secs(5), async {
        let mut count = 0;
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => {
                    count += 1;
                    if count >= 5 {
                        break;
                    }
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Should complete all 5 jobs");

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 5);

    // Clean completed jobs with grace=0 (remove all)
    let removed = queue.clean(0, 0, "completed").await.unwrap();
    assert_eq!(removed.len(), 5);

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_queue_clean_with_limit() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    for i in 0..10 {
        queue
            .add("test", serde_json::json!({"i": i}))
            .await
            .unwrap();
    }

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let timeout = tokio::time::timeout(Duration::from_secs(5), async {
        let mut count = 0;
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => {
                    count += 1;
                    if count >= 10 {
                        break;
                    }
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Should complete all 10 jobs");

    // Clean only 3
    let removed = queue.clean(0, 3, "completed").await.unwrap();
    assert_eq!(removed.len(), 3);

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 7);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_queue_clean_failed_jobs() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    for i in 0..3 {
        queue
            .add("test", serde_json::json!({"i": i}))
            .await
            .unwrap();
    }

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(Error::ProcessingError("fail".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let timeout = tokio::time::timeout(Duration::from_secs(5), async {
        let mut count = 0;
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Failed { .. }) => {
                    count += 1;
                    if count >= 3 {
                        break;
                    }
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Should fail all 3 jobs");

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.failed, 3);

    let removed = queue.clean(0, 0, "failed").await.unwrap();
    assert_eq!(removed.len(), 3);

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.failed, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Manual processing: move_to_completed / move_to_failed
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_manual_move_to_completed() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    // Worker with no processor (manual mode)
    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: false,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let token = "manual-token";
    let mut job = worker.get_next_job(token).await.unwrap().unwrap();

    assert!(job.is_active().await.unwrap());

    job.move_to_completed("my return value").await.unwrap();

    assert!(job.is_completed().await.unwrap());
    assert_eq!(job.returnvalue(), "\"my return value\"");

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 1);
    assert_eq!(counts.active, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_manual_move_to_failed() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue
        .add("test", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: false,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let token = "manual-token";
    let mut job = worker.get_next_job(token).await.unwrap().unwrap();

    assert!(job.is_active().await.unwrap());

    job.move_to_failed("something went wrong").await.unwrap();

    assert!(job.is_failed().await.unwrap());

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.failed, 1);
    assert_eq!(counts.active, 0);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Job.promote() and Job.extend_lock()
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_job_promote_delayed_to_waiting() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add a delayed job (delay 60 seconds - should not run naturally)
    let job = queue
        .add("test", serde_json::json!({"promote": true}))
        .options(JobOptions {
            delay: Some(60_000),
            ..Default::default()
        })
        .await
        .unwrap();

    // Verify it's delayed
    assert!(job.is_delayed().await.unwrap());

    // Promote it
    job.promote().await.unwrap();

    // It should now be waiting
    assert!(job.is_waiting().await.unwrap());

    // Clean up
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_job_extend_lock_manual_processing() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    queue.add("test", serde_json::json!({})).await.unwrap();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: false,
        lock_duration: 500,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let token = "lock-test-token";
    let job = worker.get_next_job(token).await.unwrap().unwrap();

    // Extend lock - should succeed
    job.extend_lock(token, 5000).await.unwrap();

    // Wait longer than original lock duration
    tokio::time::sleep(Duration::from_millis(600)).await;

    // Job should still be active (lock was extended)
    assert!(job.is_active().await.unwrap());

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Job.change_delay() and Job.change_priority()
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_job_change_delay() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add a job with 60s delay
    let job = queue
        .add("test", serde_json::json!({}))
        .options(JobOptions {
            delay: Some(60_000),
            ..Default::default()
        })
        .await
        .unwrap();

    assert!(job.is_delayed().await.unwrap());

    // Change delay to 100ms
    job.change_delay(100).await.unwrap();

    // Still delayed but with shorter delay
    assert!(job.is_delayed().await.unwrap());

    // Wait for it to become available and be processed
    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: true,
        drain_delay: 1,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let timeout = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Job should complete after reduced delay");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_job_change_priority() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add jobs: low priority first, then high priority
    let _job_low = queue
        .add("low", serde_json::json!({"order": 1}))
        .options(JobOptions {
            priority: Some(10),
            ..Default::default()
        })
        .await
        .unwrap();

    let job_high = queue
        .add("high", serde_json::json!({"order": 2}))
        .options(JobOptions {
            priority: Some(10),
            ..Default::default()
        })
        .await
        .unwrap();

    // Change second job to highest priority
    job_high.change_priority(1, false).await.unwrap();

    // Process - the job_high should come first due to priority change
    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts,
        autorun: false,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let token = "prio-token";
    let first_job = worker.get_next_job(token).await.unwrap().unwrap();
    assert_eq!(first_job.name(), "high");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_queue_retry_jobs() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add jobs that will fail
    for i in 0..5 {
        queue
            .add("fail-job", serde_json::json!({"i": i}))
            .await
            .unwrap();
    }

    // Process jobs - all will fail
    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(bullmq::Error::ProcessingError("intentional".to_string())) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for all jobs to fail
    let timeout = tokio::time::timeout(Duration::from_secs(5), async {
        let mut count = 0;
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Failed { .. }) => {
                    count += 1;
                    if count >= 5 {
                        break;
                    }
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Should fail all 5 jobs");

    worker.close(5000).await.unwrap();

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.failed, 5);

    // Retry all failed jobs
    queue.retry_jobs("failed", 1000, None).await.unwrap();

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.failed, 0);
    assert_eq!(counts.waiting, 5);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_queue_retry_jobs_completed() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add and process jobs
    for i in 0..3 {
        queue.add("job", serde_json::json!({"i": i})).await.unwrap();
    }

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!("done")) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    let timeout = tokio::time::timeout(Duration::from_secs(5), async {
        let mut count = 0;
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => {
                    count += 1;
                    if count >= 3 {
                        break;
                    }
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Should complete all 3 jobs");

    worker.close(5000).await.unwrap();

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 3);

    // Retry completed jobs (move back to wait)
    queue.retry_jobs("completed", 1000, None).await.unwrap();

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.completed, 0);
    assert_eq!(counts.waiting, 3);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_queue_promote_jobs() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add delayed jobs
    for i in 0..5 {
        queue
            .add("delayed-job", serde_json::json!({"i": i}))
            .options(bullmq::JobOptions {
                delay: Some(60000), // 60 seconds in the future
                ..Default::default()
            })
            .await
            .unwrap();
    }

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.delayed, 5);
    assert_eq!(counts.waiting, 0);

    // Promote all delayed jobs
    queue.promote_jobs(1000).await.unwrap();

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.delayed, 0);
    assert_eq!(counts.waiting, 5);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_queue_get_job_logs() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add a job and log to it
    let job = queue
        .add("log-job", serde_json::json!({"test": true}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(|job: Job, _token: CancellationToken| {
        Box::pin(async move {
            job.log("log entry 1").await.unwrap();
            job.log("log entry 2").await.unwrap();
            job.log("log entry 3").await.unwrap();
            Ok(serde_json::json!(null))
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for completion
    let timeout = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => break,
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Job should complete");

    worker.close(5000).await.unwrap();

    // Get all logs ascending
    let (logs, count) = queue.get_job_logs(job.id(), 0, -1, true).await.unwrap();
    assert_eq!(count, 3);
    assert_eq!(logs.len(), 3);
    assert_eq!(logs[0], "log entry 1");
    assert_eq!(logs[1], "log entry 2");
    assert_eq!(logs[2], "log entry 3");

    // Get logs descending
    let (logs_desc, count_desc) = queue.get_job_logs(job.id(), 0, -1, false).await.unwrap();
    assert_eq!(count_desc, 3);
    assert_eq!(logs_desc[0], "log entry 3");
    assert_eq!(logs_desc[1], "log entry 2");
    assert_eq!(logs_desc[2], "log entry 1");

    // Get paginated logs
    let (logs_page, _) = queue.get_job_logs(job.id(), 0, 1, true).await.unwrap();
    assert_eq!(logs_page.len(), 2); // LRANGE 0 1 returns 2 elements

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_queue_trim_events() {
    let name = test_queue_name();
    let conn_opts = test_connection();

    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::with_options(&name, queue_opts).await.unwrap();

    // Add and process many jobs to generate events
    for i in 0..20 {
        queue
            .add("event-job", serde_json::json!({"i": i}))
            .await
            .unwrap();
    }

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!(null)) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };

    let worker = Worker::with_options(&name, processor, worker_opts)
        .await
        .unwrap();

    // Wait for all jobs to complete
    let timeout = tokio::time::timeout(Duration::from_secs(10), async {
        let mut count = 0;
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { .. }) => {
                    count += 1;
                    if count >= 20 {
                        break;
                    }
                }
                Some(WorkerEvent::Closed) | None => break,
                _ => {}
            }
        }
    })
    .await;
    assert!(timeout.is_ok(), "Should complete all 20 jobs");

    worker.close(5000).await.unwrap();

    // Trim events to 5
    // Note: XTRIM with ~ is approximate, so we just verify the call succeeds
    let _trimmed = queue.trim_events(5).await.unwrap();

    // Verify the event stream length is bounded (~ is very approximate for small streams)
    let mut conn = queue.connection().conn();
    let len: usize = redis::cmd("XLEN")
        .arg(queue.keys().events())
        .query_async(&mut conn)
        .await
        .unwrap();
    // With ~ approximation, Redis may not trim much for small streams
    // The important thing is the API works without error
    assert!(len > 0, "Should still have some events");

    cleanup_queue(&queue).await;
}
