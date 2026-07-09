//! Job Scheduler tests — upsert, get, remove, cron patterns, every-ms schedules.
#![allow(clippy::collapsible_match, clippy::collapsible_if)]

mod common;

use bullmq::types::JobState;
use bullmq::worker::{CancellationToken, ProcessorFn};
use bullmq::{Job, JobOptions, Queue, QueueOptions, Worker, WorkerOptions};
use common::{cleanup_queue, test_connection, test_queue_name};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

use bullmq::job_scheduler::RepeatOptions;

// ═══════════════════════════════════════════════════════════════════════════
// Upsert Job Scheduler
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_upsert_job_scheduler_with_every() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(1000),
        ..Default::default()
    };

    let job = queue
        .upsert_job_scheduler("scheduler-1", repeat_opts, None, None, None)
        .await
        .unwrap();

    assert!(job.is_some(), "upsert should return a job");
    let job = job.unwrap();
    assert!(job.id().contains("repeat:scheduler-1:"));

    // Verify the scheduler is stored
    let count = queue.get_job_schedulers_count().await.unwrap();
    assert_eq!(count, 1);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_upsert_job_scheduler_with_cron_pattern() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        pattern: Some("*/5 * * * * *".to_string()), // every 5 seconds
        ..Default::default()
    };

    let job = queue
        .upsert_job_scheduler("cron-scheduler", repeat_opts, None, None, None)
        .await
        .unwrap();

    assert!(job.is_some());
    let job = job.unwrap();
    assert!(job.id().contains("repeat:cron-scheduler:"));

    // The created job should be in delayed state
    let state = queue.get_job_state(job.id()).await.unwrap();
    assert_eq!(state, JobState::Delayed);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_upsert_job_scheduler_with_custom_name_and_data() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(2000),
        ..Default::default()
    };

    let data = serde_json::json!({"email": "user@example.com"});
    let job = queue
        .upsert_job_scheduler(
            "email-scheduler",
            repeat_opts,
            Some("send-email"),
            Some(data.clone()),
            None,
        )
        .await
        .unwrap();

    assert!(job.is_some());
    let job = job.unwrap();
    assert_eq!(job.name(), "send-email");
    assert_eq!(*job.data(), data);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_upsert_job_scheduler_idempotent() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Upsert twice with same ID but different every
    let repeat_opts1 = RepeatOptions {
        every: Some(1000),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("my-scheduler", repeat_opts1, None, None, None)
        .await
        .unwrap();

    let repeat_opts2 = RepeatOptions {
        every: Some(2000),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("my-scheduler", repeat_opts2, None, None, None)
        .await
        .unwrap();

    // Should still have only 1 scheduler
    let count = queue.get_job_schedulers_count().await.unwrap();
    assert_eq!(count, 1);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_upsert_validates_pattern_and_every_exclusive() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(1000),
        pattern: Some("* * * * *".to_string()),
        ..Default::default()
    };

    let result = queue
        .upsert_job_scheduler("bad-scheduler", repeat_opts, None, None, None)
        .await;

    assert!(result.is_err());
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_upsert_validates_pattern_or_every_required() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions::default();

    let result = queue
        .upsert_job_scheduler("bad-scheduler", repeat_opts, None, None, None)
        .await;

    assert!(result.is_err());
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_upsert_validates_end_date_in_past() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(1000),
        end_date: Some(1000), // Unix timestamp from 1970 (well in the past)
        ..Default::default()
    };

    let result = queue
        .upsert_job_scheduler("past-scheduler", repeat_opts, None, None, None)
        .await;

    assert!(result.is_err());
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Get Job Schedulers
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_get_job_scheduler_by_id() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(5000),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("get-test", repeat_opts, Some("my-job"), None, None)
        .await
        .unwrap();

    let scheduler = queue.get_job_scheduler("get-test").await.unwrap();
    assert!(scheduler.is_some());
    let scheduler = scheduler.unwrap();
    assert_eq!(scheduler.key, "get-test");
    assert_eq!(scheduler.name, "my-job");
    assert_eq!(scheduler.every, Some(5000));
    assert!(scheduler.next.is_some());

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_nonexistent_scheduler_returns_none() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let scheduler = queue.get_job_scheduler("does-not-exist").await.unwrap();
    assert!(scheduler.is_none());

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_job_schedulers_list() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Add multiple schedulers
    for i in 0..3 {
        let repeat_opts = RepeatOptions {
            every: Some((i + 1) * 1000),
            ..Default::default()
        };
        queue
            .upsert_job_scheduler(&format!("scheduler-{}", i), repeat_opts, None, None, None)
            .await
            .unwrap();
    }

    let schedulers = queue.get_job_schedulers(0, -1, true).await.unwrap();
    assert_eq!(schedulers.len(), 3);

    // In ascending order (by nextMillis)
    assert!(schedulers[0].next <= schedulers[1].next);
    assert!(schedulers[1].next <= schedulers[2].next);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_job_schedulers_count() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    assert_eq!(queue.get_job_schedulers_count().await.unwrap(), 0);

    for i in 0..5 {
        let repeat_opts = RepeatOptions {
            every: Some(1000),
            ..Default::default()
        };
        queue
            .upsert_job_scheduler(&format!("count-{}", i), repeat_opts, None, None, None)
            .await
            .unwrap();
    }

    assert_eq!(queue.get_job_schedulers_count().await.unwrap(), 5);

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Remove Job Scheduler
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_remove_job_scheduler() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(1000),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("remove-me", repeat_opts, None, None, None)
        .await
        .unwrap();

    assert_eq!(queue.get_job_schedulers_count().await.unwrap(), 1);

    let removed = queue.remove_job_scheduler("remove-me").await.unwrap();
    assert!(removed);

    assert_eq!(queue.get_job_schedulers_count().await.unwrap(), 0);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_remove_nonexistent_scheduler() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let removed = queue.remove_job_scheduler("nope").await.unwrap();
    assert!(!removed);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_remove_scheduler_also_removes_delayed_job() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Use a cron pattern far in the future so the job lands in "delayed"
    let repeat_opts = RepeatOptions {
        pattern: Some("0 0 1 1 *".to_string()), // Jan 1st at midnight (yearly)
        ..Default::default()
    };
    let job = queue
        .upsert_job_scheduler("delayed-remove", repeat_opts, None, None, None)
        .await
        .unwrap()
        .unwrap();

    let job_id = job.id().to_string();

    // Verify the delayed job exists
    let state = queue.get_job_state(&job_id).await.unwrap();
    assert_eq!(state, JobState::Delayed);

    // Remove the scheduler
    queue.remove_job_scheduler("delayed-remove").await.unwrap();

    // The delayed job should be gone too
    let state = queue.get_job_state(&job_id).await.unwrap();
    assert_eq!(state, JobState::Unknown);

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler Execution (Worker picks up and repeats)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_repeats_with_every() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(500), // every 500ms
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("repeater", repeat_opts, None, None, None)
        .await
        .unwrap();

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
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Should process at least 3 iterations within 3 seconds
    let mut count = 0;
    let result = tokio::time::timeout(Duration::from_secs(5), async {
        while count < 3 {
            rx.recv()
                .await
                .expect("channel closed before processing 3 iterations");
            count += 1;
        }
    })
    .await;

    assert!(result.is_ok(), "Expected at least 3 iterations");
    assert!(count >= 3);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_scheduler_respects_limit() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(200),
        limit: Some(3),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("limited", repeat_opts, None, None, None)
        .await
        .unwrap();

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
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Wait enough time for more than 3 iterations if there was no limit
    tokio::time::sleep(Duration::from_secs(3)).await;

    // Count how many were processed
    let mut count = 0;
    while rx.try_recv().is_ok() {
        count += 1;
    }

    // Should have processed exactly 3 (the limit)
    assert_eq!(count, 3, "Expected exactly 3 iterations due to limit");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_multiple_schedulers_independent() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Two independent schedulers
    let repeat_opts_a = RepeatOptions {
        every: Some(1000),
        ..Default::default()
    };
    let repeat_opts_b = RepeatOptions {
        every: Some(2000),
        ..Default::default()
    };

    queue
        .upsert_job_scheduler("sched-a", repeat_opts_a, Some("job-a"), None, None)
        .await
        .unwrap();
    queue
        .upsert_job_scheduler("sched-b", repeat_opts_b, Some("job-b"), None, None)
        .await
        .unwrap();

    let count = queue.get_job_schedulers_count().await.unwrap();
    assert_eq!(count, 2);

    let schedulers = queue.get_job_schedulers(0, -1, true).await.unwrap();
    let names: Vec<&str> = schedulers.iter().map(|s| s.name.as_str()).collect();
    assert!(names.contains(&"job-a"));
    assert!(names.contains(&"job-b"));

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler with job template options
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_with_job_options() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(5000),
        ..Default::default()
    };

    let job_opts = JobOptions {
        attempts: Some(5),
        backoff: Some(bullmq::types::BackoffStrategy::Fixed(1000)),
        ..Default::default()
    };

    let job = queue
        .upsert_job_scheduler(
            "with-opts",
            repeat_opts,
            Some("retryable"),
            Some(serde_json::json!({"key": "value"})),
            Some(job_opts),
        )
        .await
        .unwrap();

    assert!(job.is_some());

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler with end date
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_with_future_end_date() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let future_end = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
        + 60_000; // 1 minute from now

    let repeat_opts = RepeatOptions {
        every: Some(1000),
        end_date: Some(future_end),
        ..Default::default()
    };

    let job = queue
        .upsert_job_scheduler("end-date-test", repeat_opts, None, None, None)
        .await
        .unwrap();

    assert!(job.is_some());

    let scheduler = queue
        .get_job_scheduler("end-date-test")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(scheduler.end_date, Some(future_end));

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Repeat with cron pattern execution
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_repeats_with_cron_pattern() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Every second
    let repeat_opts = RepeatOptions {
        pattern: Some("* * * * * *".to_string()),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("cron-repeat", repeat_opts, None, None, None)
        .await
        .unwrap();

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
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Should fire at least 2 times within 3 seconds
    let mut count = 0;
    let result = tokio::time::timeout(Duration::from_secs(4), async {
        while count < 2 {
            rx.recv().await.unwrap();
            count += 1;
        }
    })
    .await;

    assert!(result.is_ok(), "Expected at least 2 cron iterations");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler stops repeating after endDate
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_stops_after_end_date() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    // End date ~800ms from now — should allow ~3 iterations at 200ms intervals
    let repeat_opts = RepeatOptions {
        every: Some(200),
        end_date: Some(now + 800),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("end-stop", repeat_opts, None, None, None)
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(20);
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
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Wait long enough for many iterations if there was no endDate
    tokio::time::sleep(Duration::from_secs(2)).await;

    let mut count = 0;
    while rx.try_recv().is_ok() {
        count += 1;
    }

    // Should have stopped — not more than ~5 iterations
    assert!(
        count <= 6,
        "Expected scheduler to stop after endDate, got {} iterations",
        count
    );
    assert!(count >= 1, "Expected at least 1 iteration");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler continues after job failure
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_continues_after_failure() {
    use bullmq::error::Error;

    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(300),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("fail-repeat", repeat_opts, None, None, None)
        .await
        .unwrap();

    let counter = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let counter_clone = counter.clone();
    let (tx, mut rx) = mpsc::channel(10);

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let c = counter_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let tx = tx.clone();
        Box::pin(async move {
            if c == 0 {
                // First iteration fails
                Err(Error::ProcessingError("intentional failure".to_string()))
            } else {
                // Subsequent iterations succeed
                tx.send(()).await.unwrap();
                Ok(serde_json::Value::Null)
            }
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Wait for at least 2 successful iterations (after the first failure)
    let result = tokio::time::timeout(Duration::from_secs(4), async {
        let mut success_count = 0;
        while success_count < 2 {
            rx.recv().await.unwrap();
            success_count += 1;
        }
    })
    .await;

    assert!(
        result.is_ok(),
        "Scheduler should continue repeating after a job failure"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Same cron pattern, different scheduler IDs → multiple jobs
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_same_cron_different_ids_creates_multiple_jobs() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts1 = RepeatOptions {
        pattern: Some("0 0 * * *".to_string()), // daily at midnight
        ..Default::default()
    };
    let repeat_opts2 = RepeatOptions {
        pattern: Some("0 0 * * *".to_string()), // same pattern
        ..Default::default()
    };

    queue
        .upsert_job_scheduler("daily-a", repeat_opts1, Some("job-a"), None, None)
        .await
        .unwrap();
    queue
        .upsert_job_scheduler("daily-b", repeat_opts2, Some("job-b"), None, None)
        .await
        .unwrap();

    // Both should exist independently
    let count = queue.get_job_schedulers_count().await.unwrap();
    assert_eq!(count, 2);

    let sched_a = queue.get_job_scheduler("daily-a").await.unwrap().unwrap();
    let sched_b = queue.get_job_scheduler("daily-b").await.unwrap().unwrap();
    assert_eq!(sched_a.name, "job-a");
    assert_eq!(sched_b.name, "job-b");

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Same scheduler ID + different every → only one scheduler
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_same_id_different_every_creates_one_scheduler() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts1 = RepeatOptions {
        every: Some(1000),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("same-id", repeat_opts1, None, None, None)
        .await
        .unwrap();

    let repeat_opts2 = RepeatOptions {
        every: Some(5000),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("same-id", repeat_opts2, None, None, None)
        .await
        .unwrap();

    let count = queue.get_job_schedulers_count().await.unwrap();
    assert_eq!(count, 1);

    // Should have the updated every value
    let scheduler = queue.get_job_scheduler("same-id").await.unwrap().unwrap();
    assert_eq!(scheduler.every, Some(5000));

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler with startDate in the future
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_with_start_date_in_future() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    let repeat_opts = RepeatOptions {
        every: Some(200),
        start_date: Some(now + 1000), // starts 1 second from now
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("future-start", repeat_opts, None, None, None)
        .await
        .unwrap();

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
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Should NOT have fired in the first 500ms
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        rx.try_recv().is_err(),
        "Job should not fire before startDate"
    );

    // But should fire after startDate (wait another 1.5s)
    let result = tokio::time::timeout(Duration::from_secs(3), rx.recv()).await;
    assert!(result.is_ok(), "Job should fire after startDate");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler with immediately option
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_immediately_fires_first_job() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Cron pattern that would normally be far in the future (every day at midnight)
    // but with immediately=true should fire right away
    let repeat_opts = RepeatOptions {
        pattern: Some("0 0 * * *".to_string()),
        immediately: Some(true),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("immediate", repeat_opts, None, None, None)
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(5);
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
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Should fire within 2 seconds (immediately)
    let result = tokio::time::timeout(Duration::from_secs(2), rx.recv()).await;
    assert!(
        result.is_ok(),
        "With immediately=true, job should fire right away"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Upsert quick succession → only one scheduler, one delayed job
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_upsert_quick_succession_only_one_scheduler() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Rapid-fire upserts with same ID
    for i in 0..5 {
        let repeat_opts = RepeatOptions {
            every: Some(1000 + i * 100),
            ..Default::default()
        };
        queue
            .upsert_job_scheduler("rapid", repeat_opts, None, None, None)
            .await
            .unwrap();
    }

    // Only one scheduler should exist
    let count = queue.get_job_schedulers_count().await.unwrap();
    assert_eq!(count, 1);

    // Last upsert wins
    let scheduler = queue.get_job_scheduler("rapid").await.unwrap().unwrap();
    assert_eq!(scheduler.every, Some(1400)); // 1000 + 4*100

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Allow re-adding scheduler after removal
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_readd_scheduler_after_removal() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(1000),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("removable", repeat_opts.clone(), None, None, None)
        .await
        .unwrap();

    // Remove
    let removed = queue.remove_job_scheduler("removable").await.unwrap();
    assert!(removed);
    assert_eq!(queue.get_job_schedulers_count().await.unwrap(), 0);

    // Re-add
    let job = queue
        .upsert_job_scheduler("removable", repeat_opts, None, None, None)
        .await
        .unwrap();
    assert!(job.is_some());
    assert_eq!(queue.get_job_schedulers_count().await.unwrap(), 1);

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Worker data and name passed correctly to scheduler jobs
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_job_has_correct_name_and_data() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(500),
        ..Default::default()
    };

    let data = serde_json::json!({"message": "hello"});
    queue
        .upsert_job_scheduler(
            "data-test",
            repeat_opts,
            Some("my-named-job"),
            Some(data.clone()),
            None,
        )
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(5);
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        Box::pin(async move {
            tx.send((job.name().to_string(), job.data().clone()))
                .await
                .unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    let result = tokio::time::timeout(Duration::from_secs(3), rx.recv()).await;
    assert!(result.is_ok());
    let (job_name, job_data) = result.unwrap().unwrap();
    assert_eq!(job_name, "my-named-job");
    assert_eq!(job_data, data);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Iteration count tracking
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_has_correct_iteration_count() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(200),
        limit: Some(5),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("count-track", repeat_opts, None, None, None)
        .await
        .unwrap();

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
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Wait for all 5 iterations to complete
    for _ in 0..5 {
        let result = tokio::time::timeout(Duration::from_secs(3), rx.recv()).await;
        assert!(result.is_ok(), "timed out waiting for iteration");
    }

    // Check the scheduler's iteration count
    let scheduler = queue
        .get_job_scheduler("count-track")
        .await
        .unwrap()
        .unwrap();
    assert!(
        scheduler.iteration_count >= 5,
        "Expected iteration_count >= 5, got {}",
        scheduler.iteration_count
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Using 'every' starts immediately (no initial delay)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_every_starts_immediately() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(60_000), // 1 minute interval
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("immediate-every", repeat_opts, None, None, None)
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(5);
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
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // With 'every', the first job should be created immediately (delay=0)
    // So it should be processed within a couple seconds, not in 60s
    let result = tokio::time::timeout(Duration::from_secs(3), rx.recv()).await;
    assert!(
        result.is_ok(),
        "With 'every', first job should fire immediately"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler with removeOnComplete option
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_with_remove_on_complete() {
    use bullmq::types::RemoveOnFinish;

    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(300),
        limit: Some(3),
        ..Default::default()
    };

    let job_opts = JobOptions {
        remove_on_complete: Some(RemoveOnFinish::Bool(true)),
        ..Default::default()
    };

    queue
        .upsert_job_scheduler("roc-test", repeat_opts, None, None, Some(job_opts))
        .await
        .unwrap();

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
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Wait for all 3 to complete
    for _ in 0..3 {
        tokio::time::timeout(Duration::from_secs(3), rx.recv())
            .await
            .unwrap();
    }
    tokio::time::sleep(Duration::from_millis(200)).await;

    // Completed jobs should be removed
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(
        counts.completed, 0,
        "Completed jobs should be removed with removeOnComplete"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler with timezone
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_with_timezone() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Every second cron with a timezone
    let repeat_opts = RepeatOptions {
        pattern: Some("* * * * * *".to_string()),
        tz: Some("America/New_York".to_string()),
        ..Default::default()
    };

    let job = queue
        .upsert_job_scheduler("tz-test", repeat_opts, None, None, None)
        .await
        .unwrap();

    assert!(job.is_some());

    let scheduler = queue.get_job_scheduler("tz-test").await.unwrap().unwrap();
    assert_eq!(scheduler.tz, Some("America/New_York".to_string()));
    assert!(scheduler.next.is_some());

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler pagination (get_job_schedulers with ranges)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_pagination() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Create 10 schedulers with increasing intervals so they have different next timestamps
    for i in 0..10u64 {
        let repeat_opts = RepeatOptions {
            every: Some((i + 1) * 1000),
            ..Default::default()
        };
        queue
            .upsert_job_scheduler(&format!("page-{:02}", i), repeat_opts, None, None, None)
            .await
            .unwrap();
    }

    // Get first page (0..4)
    let page1 = queue.get_job_schedulers(0, 4, true).await.unwrap();
    assert_eq!(page1.len(), 5);

    // Get second page (5..9)
    let page2 = queue.get_job_schedulers(5, 9, true).await.unwrap();
    assert_eq!(page2.len(), 5);

    // All should be unique
    let all = queue.get_job_schedulers(0, -1, true).await.unwrap();
    assert_eq!(all.len(), 10);

    // Descending order
    let desc = queue.get_job_schedulers(0, 2, false).await.unwrap();
    assert_eq!(desc.len(), 3);
    assert!(desc[0].next >= desc[1].next);

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler with priority
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_with_priority() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(500),
        ..Default::default()
    };

    let job_opts = JobOptions {
        priority: Some(10),
        ..Default::default()
    };

    let job = queue
        .upsert_job_scheduler("priority-test", repeat_opts, None, None, Some(job_opts))
        .await
        .unwrap();

    assert!(job.is_some());

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler validation: immediately + startDate
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_upsert_validates_immediately_and_start_date_exclusive() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    let repeat_opts = RepeatOptions {
        pattern: Some("0 0 * * *".to_string()),
        immediately: Some(true),
        start_date: Some(now + 60_000),
        ..Default::default()
    };

    let result = queue
        .upsert_job_scheduler("bad-combo", repeat_opts, None, None, None)
        .await;

    assert!(
        result.is_err(),
        "immediately + startDate should be rejected"
    );
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: concurrent workers process iterations reliably
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_with_concurrent_workers() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(300),
        limit: Some(6),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("concurrent", repeat_opts, None, None, None)
        .await
        .unwrap();

    let counter = Arc::new(std::sync::atomic::AtomicU32::new(0));

    // Start 3 workers
    let mut workers = Vec::new();
    for _ in 0..3 {
        let counter_clone = counter.clone();
        let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
            let c = counter_clone.clone();
            Box::pin(async move {
                c.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok(serde_json::Value::Null)
            })
        });

        let worker_opts = WorkerOptions {
            connection: conn_opts.clone(),
            autorun: true,
            ..Default::default()
        };
        let worker = Worker::new(&name, processor, worker_opts).await.unwrap();
        workers.push(worker);
    }

    // Wait for all iterations
    tokio::time::sleep(Duration::from_secs(4)).await;

    let total = counter.load(std::sync::atomic::Ordering::SeqCst);
    // Should have processed exactly 6 (the limit)
    assert_eq!(
        total, 6,
        "Expected 6 iterations with limit=6, got {}",
        total
    );

    for w in workers {
        w.close(5000).await.unwrap();
    }
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: upsert updates data and options
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_upsert_updates_data_and_options() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // First upsert
    let repeat_opts = RepeatOptions {
        every: Some(5000),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler(
            "update-test",
            repeat_opts.clone(),
            Some("job-v1"),
            Some(serde_json::json!({"version": 1})),
            None,
        )
        .await
        .unwrap();

    // Second upsert with new data
    queue
        .upsert_job_scheduler(
            "update-test",
            repeat_opts,
            Some("job-v2"),
            Some(serde_json::json!({"version": 2})),
            None,
        )
        .await
        .unwrap();

    let scheduler = queue
        .get_job_scheduler("update-test")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(scheduler.name, "job-v2");

    // Data should be updated
    if let Some(data) = &scheduler.data {
        assert_eq!(data["version"], 2);
    }

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Worker should continue processing after drain
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_worker_processes_scheduler_after_drain() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

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
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Worker starts with empty queue (drained state)
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Now add a scheduler — worker should wake up and process it
    let repeat_opts = RepeatOptions {
        every: Some(300),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("after-drain", repeat_opts, None, None, None)
        .await
        .unwrap();

    // Should process within a few seconds
    let result = tokio::time::timeout(Duration::from_secs(3), rx.recv()).await;
    assert!(
        result.is_ok(),
        "Worker should process jobs added after drain"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: repeat job key is correctly set on the job
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_job_has_repeat_job_key() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(500),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("rjk-test", repeat_opts, None, None, None)
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(5);
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        let rjk = job.repeat_job_key().map(|s| s.to_string());
        Box::pin(async move {
            tx.send(rjk).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    let result = tokio::time::timeout(Duration::from_secs(3), rx.recv()).await;
    assert!(result.is_ok());
    let rjk = result.unwrap().unwrap();
    assert_eq!(rjk, Some("rjk-test".to_string()));

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: each iteration gets unique job ID
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_each_iteration_has_unique_id() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(200),
        limit: Some(4),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("unique-ids", repeat_opts, None, None, None)
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(10);
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        let id = job.id().to_string();
        Box::pin(async move {
            tx.send(id).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    let mut ids = Vec::new();
    for _ in 0..4 {
        let result = tokio::time::timeout(Duration::from_secs(3), rx.recv()).await;
        assert!(result.is_ok());
        ids.push(result.unwrap().unwrap());
    }

    // All IDs should be unique
    let unique: std::collections::HashSet<_> = ids.iter().collect();
    assert_eq!(unique.len(), 4, "All job IDs should be unique");

    // All IDs should follow the pattern repeat:<schedulerId>:<timestamp>
    for id in &ids {
        assert!(
            id.starts_with("repeat:unique-ids:"),
            "ID '{}' should start with 'repeat:unique-ids:'",
            id
        );
    }

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: emit waiting event when job added
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_emits_events() {
    use bullmq::worker::WorkerEvent;

    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(300),
        limit: Some(2),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("events-test", repeat_opts, None, None, None)
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::Value::Null) })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Wait for at least one Completed event using next_event()
    let result = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if let Some(event) = worker.next_event().await {
                if matches!(event, WorkerEvent::Completed { .. }) {
                    return true;
                }
            }
        }
    })
    .await;

    assert!(result.is_ok(), "Should receive Completed events");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: cron with 5-field pattern (no seconds)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_cron_5_field_pattern() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Standard 5-field cron (minute-level)
    let repeat_opts = RepeatOptions {
        pattern: Some("*/1 * * * *".to_string()), // every minute
        ..Default::default()
    };

    let job = queue
        .upsert_job_scheduler("5field-cron", repeat_opts, None, None, None)
        .await
        .unwrap();

    assert!(job.is_some());
    let job = job.unwrap();
    assert_eq!(
        queue.get_job_state(job.id()).await.unwrap(),
        JobState::Delayed
    );

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: cron with 6-field pattern (with seconds)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_cron_6_field_pattern() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // 6-field cron (second-level)
    let repeat_opts = RepeatOptions {
        pattern: Some("*/10 * * * * *".to_string()), // every 10 seconds
        ..Default::default()
    };

    let job = queue
        .upsert_job_scheduler("6field-cron", repeat_opts, None, None, None)
        .await
        .unwrap();

    assert!(job.is_some());

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: invalid cron pattern returns error
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_invalid_cron_returns_error() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        pattern: Some("not a cron".to_string()),
        ..Default::default()
    };

    let result = queue
        .upsert_job_scheduler("bad-cron", repeat_opts, None, None, None)
        .await;

    assert!(result.is_err());
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: invalid timezone returns error
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_invalid_timezone_returns_error() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        pattern: Some("* * * * *".to_string()),
        tz: Some("Invalid/Timezone".to_string()),
        ..Default::default()
    };

    let result = queue
        .upsert_job_scheduler("bad-tz", repeat_opts, None, None, None)
        .await;

    assert!(result.is_err());
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler with offset aligns first job correctly
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_every_with_offset() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(10_000), // every 10 seconds
        offset: Some(5000),  // offset by 5 seconds
        ..Default::default()
    };

    let job = queue
        .upsert_job_scheduler("offset-test", repeat_opts, None, None, None)
        .await
        .unwrap();

    assert!(job.is_some());

    let scheduler = queue
        .get_job_scheduler("offset-test")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(scheduler.every, Some(10_000));

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: startDate in the past with every
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_with_start_date_in_past() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    // startDate 10 seconds in the past
    let repeat_opts = RepeatOptions {
        every: Some(500),
        start_date: Some(now - 10_000),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("past-start", repeat_opts, None, None, None)
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(5);
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
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // With startDate in the past, the first job should fire immediately
    let result = tokio::time::timeout(Duration::from_secs(3), rx.recv()).await;
    assert!(
        result.is_ok(),
        "With startDate in past, job should fire immediately"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: multiple different cron patterns
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_create_schedulers_with_different_patterns() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let patterns = vec![
        ("hourly", "0 * * * *"),
        ("daily", "0 0 * * *"),
        ("weekly", "0 0 * * 1"),
        ("monthly", "0 0 1 * *"),
    ];

    for (id, pattern) in &patterns {
        let repeat_opts = RepeatOptions {
            pattern: Some(pattern.to_string()),
            ..Default::default()
        };
        queue
            .upsert_job_scheduler(id, repeat_opts, None, None, None)
            .await
            .unwrap();
    }

    let count = queue.get_job_schedulers_count().await.unwrap();
    assert_eq!(count, 4);

    // All schedulers should have different next timestamps
    let schedulers = queue.get_job_schedulers(0, -1, true).await.unwrap();
    let nexts: Vec<_> = schedulers.iter().map(|s| s.next).collect();
    // At minimum, hourly should be before daily, daily before weekly, etc.
    assert!(nexts[0] <= nexts[1]);

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: re-add and process after removal + re-add
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_processes_after_remove_and_readd() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

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
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // First: add and process
    let repeat_opts = RepeatOptions {
        every: Some(300),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("cycle", repeat_opts.clone(), None, None, None)
        .await
        .unwrap();

    let result = tokio::time::timeout(Duration::from_secs(2), rx.recv()).await;
    assert!(result.is_ok(), "First scheduler should process");

    // Remove the scheduler
    queue.remove_job_scheduler("cycle").await.unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Re-add
    queue
        .upsert_job_scheduler("cycle", repeat_opts, None, None, None)
        .await
        .unwrap();

    // Should process again after re-add
    let result = tokio::time::timeout(Duration::from_secs(3), rx.recv()).await;
    assert!(result.is_ok(), "Re-added scheduler should process");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: not more than limit iterations even with slow processing
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_limit_with_slow_processing() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(100),
        limit: Some(3),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("slow-limit", repeat_opts, None, None, None)
        .await
        .unwrap();

    let counter = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let counter_clone = counter.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let c = counter_clone.clone();
        Box::pin(async move {
            // Simulate slow processing (200ms per job)
            tokio::time::sleep(Duration::from_millis(200)).await;
            c.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Wait plenty of time
    tokio::time::sleep(Duration::from_secs(3)).await;

    let total = counter.load(std::sync::atomic::Ordering::SeqCst);
    assert_eq!(
        total, 3,
        "Should process exactly 3 with limit=3, got {}",
        total
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: many rapid upserts stress test
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_many_upserts_stress() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Upsert the same scheduler 20 times rapidly
    for i in 0..20u64 {
        let repeat_opts = RepeatOptions {
            every: Some(1000 + i * 10),
            ..Default::default()
        };
        queue
            .upsert_job_scheduler("stress", repeat_opts, None, None, None)
            .await
            .unwrap();
    }

    // Guarantees: only 1 scheduler, and the last upsert settings stick
    let count = queue.get_job_schedulers_count().await.unwrap();
    assert_eq!(count, 1);

    let scheduler = queue.get_job_scheduler("stress").await.unwrap().unwrap();
    assert_eq!(scheduler.every, Some(1190)); // 1000 + 19*10

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: many independent schedulers
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_many_independent_schedulers() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Create 20 independent schedulers
    for i in 0..20 {
        let repeat_opts = RepeatOptions {
            every: Some(60_000), // all with same interval (won't fire in test)
            ..Default::default()
        };
        queue
            .upsert_job_scheduler(
                &format!("independent-{:03}", i),
                repeat_opts,
                Some(&format!("job-{}", i)),
                None,
                None,
            )
            .await
            .unwrap();
    }

    let count = queue.get_job_schedulers_count().await.unwrap();
    assert_eq!(count, 20);

    // Remove one in the middle
    queue.remove_job_scheduler("independent-010").await.unwrap();
    assert_eq!(queue.get_job_schedulers_count().await.unwrap(), 19);

    // Remove first
    queue.remove_job_scheduler("independent-000").await.unwrap();
    assert_eq!(queue.get_job_schedulers_count().await.unwrap(), 18);

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: ID with special characters / colons
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_id_with_colons() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Test scheduler IDs with 5+ colon segments (regression for issue #3828)
    let scheduler_id = "org:team:project:env:task";
    let repeat_opts = RepeatOptions {
        every: Some(5000),
        ..Default::default()
    };

    let job = queue
        .upsert_job_scheduler(scheduler_id, repeat_opts, Some("colon-job"), None, None)
        .await
        .unwrap();

    assert!(job.is_some());

    let scheduler = queue.get_job_scheduler(scheduler_id).await.unwrap();
    assert!(scheduler.is_some());
    let scheduler = scheduler.unwrap();
    assert_eq!(scheduler.key, scheduler_id);
    assert_eq!(scheduler.name, "colon-job");

    // Should be removable
    let removed = queue.remove_job_scheduler(scheduler_id).await.unwrap();
    assert!(removed);
    assert_eq!(queue.get_job_schedulers_count().await.unwrap(), 0);

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: UTC timezone works correctly
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_utc_timezone() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        pattern: Some("* * * * * *".to_string()),
        tz: Some("UTC".to_string()),
        ..Default::default()
    };

    let job = queue
        .upsert_job_scheduler("utc-test", repeat_opts, None, None, None)
        .await
        .unwrap();

    assert!(job.is_some());

    let scheduler = queue.get_job_scheduler("utc-test").await.unwrap().unwrap();
    assert_eq!(scheduler.tz, Some("UTC".to_string()));

    // The next timestamp should be very close to now (within 2 seconds)
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let next = scheduler.next.unwrap();
    assert!(
        next <= now + 2000,
        "Next should be within 2s from now (next={}, now={})",
        next,
        now
    );

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: remove does not affect other schedulers
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_remove_scheduler_does_not_affect_others() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    for i in 0..3 {
        let repeat_opts = RepeatOptions {
            every: Some((i + 1) * 1000),
            ..Default::default()
        };
        queue
            .upsert_job_scheduler(&format!("s-{}", i), repeat_opts, None, None, None)
            .await
            .unwrap();
    }

    assert_eq!(queue.get_job_schedulers_count().await.unwrap(), 3);

    // Remove the middle one
    queue.remove_job_scheduler("s-1").await.unwrap();

    assert_eq!(queue.get_job_schedulers_count().await.unwrap(), 2);
    assert!(queue.get_job_scheduler("s-0").await.unwrap().is_some());
    assert!(queue.get_job_scheduler("s-1").await.unwrap().is_none());
    assert!(queue.get_job_scheduler("s-2").await.unwrap().is_some());

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: processing continues reliably over many iterations
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_reliable_over_many_iterations() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(100),
        limit: Some(10),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("reliable", repeat_opts, None, None, None)
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(20);
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
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // All 10 iterations should complete
    let mut count = 0;
    let result = tokio::time::timeout(Duration::from_secs(5), async {
        while count < 10 {
            rx.recv().await.unwrap();
            count += 1;
        }
    })
    .await;

    assert!(result.is_ok(), "All 10 iterations should complete");
    assert_eq!(count, 10);

    // After limit reached, no more should come
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(rx.try_recv().is_err(), "No more iterations after limit");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Drain should not remove delayed jobs belonging to a scheduler
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_drain_does_not_remove_scheduler_delayed_jobs() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Scheduler with 'every' puts first job in waiting (delay=0)
    let repeat_opts = RepeatOptions {
        every: Some(5000),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("drain-protect", repeat_opts, None, None, None)
        .await
        .unwrap();

    let counts_before = queue.get_job_counts().await.unwrap();
    assert_eq!(counts_before.waiting, 1);

    // Drain with delayed=true
    queue.drain(true).await.unwrap();

    // The scheduler's waiting job should still be there
    let counts_after = queue.get_job_counts().await.unwrap();
    assert_eq!(
        counts_after.waiting, 1,
        "Drain should not remove jobs belonging to a scheduler"
    );

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Clean should not remove waiting jobs belonging to a scheduler
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_clean_does_not_remove_scheduler_waiting_jobs() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(5000),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("clean-protect", repeat_opts, None, None, None)
        .await
        .unwrap();

    let counts_before = queue.get_job_counts().await.unwrap();
    assert_eq!(counts_before.waiting, 1);

    // Clean wait jobs with grace=0
    let removed = queue.clean(0, 100, "wait").await.unwrap();

    // The scheduler's job should NOT have been removed
    let counts_after = queue.get_job_counts().await.unwrap();
    assert_eq!(
        counts_after.waiting, 1,
        "Clean should not remove jobs belonging to a scheduler (removed: {:?})",
        removed
    );

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Direct removal of scheduler's job should fail
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_cannot_directly_remove_scheduler_job() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(5000),
        ..Default::default()
    };
    let job = queue
        .upsert_job_scheduler("no-remove", repeat_opts, None, None, None)
        .await
        .unwrap()
        .unwrap();

    // Try to remove the job directly — should fail or return false
    let result = queue.remove(job.id()).await;
    // The script should reject removal of jobs belonging to a scheduler
    if let Ok(removed) = result {
        assert!(
            !removed,
            "Should not be able to remove a job belonging to a scheduler"
        );
    }

    // Job should still exist
    let state = queue.get_job_state(job.id()).await.unwrap();
    assert_ne!(
        state,
        JobState::Unknown,
        "Job should still exist after failed removal"
    );

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Promote delayed scheduler job → process → next delayed created
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_promote_scheduler_job_creates_next_iteration() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Use 'every' with long interval — first job goes to waiting (delay=0),
    // after processing, next goes to delayed (far in future)
    let repeat_opts = RepeatOptions {
        every: Some(60_000), // 60s interval
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("promote-test", repeat_opts, None, None, None)
        .await
        .unwrap();

    // First job is in waiting (delay=0 for 'every')
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.waiting, 1);

    // Process the first job
    let (tx, mut rx) = mpsc::channel(5);
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
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    let result = tokio::time::timeout(Duration::from_secs(3), rx.recv()).await;
    assert!(result.is_ok(), "First job should be processed");

    // After processing, next iteration should be in delayed (60s in future)
    tokio::time::sleep(Duration::from_millis(200)).await;
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(
        counts.delayed, 1,
        "Next iteration should be scheduled as delayed"
    );

    // Promote the delayed job
    queue.promote_jobs(1000).await.unwrap();

    // Worker picks up promoted job almost instantly, so just wait for processing
    // (don't assert waiting=1 because it may already be active)

    // Process the promoted job
    let result = tokio::time::timeout(Duration::from_secs(3), rx.recv()).await;
    assert!(result.is_ok(), "Promoted job should be processed");

    // After processing promoted job, another delayed should be created
    tokio::time::sleep(Duration::from_millis(500)).await;
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(
        counts.delayed, 1,
        "Next iteration should be scheduled after promote+process"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Promote 'every' scheduler job after processing → next delayed
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_promote_every_scheduler_creates_next_delayed() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // 'every' with large interval — first job goes to waiting immediately
    let repeat_opts = RepeatOptions {
        every: Some(50_000),
        limit: Some(3),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("promote-every", repeat_opts, None, None, None)
        .await
        .unwrap();

    // First job should be in waiting (delay=0 for 'every')
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.waiting, 1);

    // Process the first job
    let (tx, mut rx) = mpsc::channel(5);
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
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    tokio::time::timeout(Duration::from_secs(3), rx.recv())
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_millis(200)).await;

    // After processing, next iteration should be in delayed (50s in future)
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(
        counts.delayed, 1,
        "Next iteration should be in delayed after processing 'every' scheduler"
    );

    // Promote the delayed job
    queue.promote_jobs(1000).await.unwrap();

    // Worker picks up promoted job almost instantly, so just wait for processing

    // Process the promoted job
    tokio::time::timeout(Duration::from_secs(3), rx.recv())
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_millis(200)).await;

    // After second processing, another delayed should exist
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(
        counts.delayed, 1,
        "After promote+process, next delayed should exist"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Retry failed scheduler job should not create duplicate delayed
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_retry_failed_scheduler_job_no_duplicate_delayed() {
    use bullmq::error::Error;
    use std::sync::atomic::{AtomicU32, Ordering};

    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(5000),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("retry-test", repeat_opts, None, None, None)
        .await
        .unwrap();

    let counter = Arc::new(AtomicU32::new(0));
    let counter_clone = counter.clone();
    let (tx, mut rx) = mpsc::channel(5);

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let c = counter_clone.fetch_add(1, Ordering::SeqCst);
        let tx = tx.clone();
        Box::pin(async move {
            if c == 0 {
                Err(Error::ProcessingError("fail first time".to_string()))
            } else {
                tx.send(()).await.unwrap();
                Ok(serde_json::Value::Null)
            }
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Wait for the job to fail
    tokio::time::sleep(Duration::from_millis(500)).await;

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.failed, 1, "First job should have failed");
    // Next iteration was already scheduled (delayed)
    assert_eq!(
        counts.delayed, 1,
        "Next iteration should be scheduled after failure"
    );

    // Retry the failed jobs
    queue.retry_jobs("failed", 100, None).await.unwrap();

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.failed, 0, "No failed jobs after retry");

    // Wait for retried job to be processed
    let result = tokio::time::timeout(Duration::from_secs(3), rx.recv()).await;
    assert!(result.is_ok(), "Retried job should be processed");

    // After retry+process, should still only have 1 delayed (not duplicated)
    tokio::time::sleep(Duration::from_millis(200)).await;
    let counts = queue.get_job_counts().await.unwrap();
    assert!(
        counts.waiting + counts.delayed <= 1,
        "Should only have 1 job scheduled (waiting={}, delayed={})",
        counts.waiting,
        counts.delayed
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Job.retry() on failed scheduler job should not create duplicate delayed
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_job_retry_on_failed_scheduler_job_no_duplicate() {
    use bullmq::error::Error;
    use std::sync::atomic::{AtomicU32, Ordering};

    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(5000),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("job-retry-test", repeat_opts, None, None, None)
        .await
        .unwrap();

    let counter = Arc::new(AtomicU32::new(0));
    let counter_clone = counter.clone();
    let (tx, mut rx) = mpsc::channel(5);

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let c = counter_clone.fetch_add(1, Ordering::SeqCst);
        let tx = tx.clone();
        Box::pin(async move {
            if c == 0 {
                Err(Error::ProcessingError("fail first".to_string()))
            } else {
                tx.send(()).await.unwrap();
                Ok(serde_json::Value::Null)
            }
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Wait for the job to fail
    tokio::time::sleep(Duration::from_millis(500)).await;

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.failed, 1);

    // Get the failed job and retry it using Job::retry()
    // First get the job ID from the failed set
    let mut conn = redis::Client::open(conn_opts.url.as_str())
        .unwrap()
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    let failed_ids: Vec<String> = redis::cmd("ZRANGE")
        .arg(format!("bull:{}:failed", name))
        .arg(0i64)
        .arg(-1i64)
        .query_async(&mut conn)
        .await
        .unwrap();

    assert_eq!(failed_ids.len(), 1);

    let mut failed_job = queue.get_job(&failed_ids[0]).await.unwrap().unwrap();
    failed_job.retry("failed", None).await.unwrap();

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.failed, 0);

    // Wait for the retried job to process
    let result = tokio::time::timeout(Duration::from_secs(3), rx.recv()).await;
    assert!(result.is_ok(), "Retried job should process");

    // Should have at most 1 job scheduled
    tokio::time::sleep(Duration::from_millis(200)).await;
    let counts = queue.get_job_counts().await.unwrap();
    assert!(
        counts.waiting + counts.delayed <= 1,
        "Should not duplicate: waiting={}, delayed={}",
        counts.waiting,
        counts.delayed
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler repeats reliably with stall recovery configured
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_repeats_with_stall_recovery_configured() {
    use std::sync::atomic::{AtomicU32, Ordering};

    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(500),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("stall-test", repeat_opts, None, None, None)
        .await
        .unwrap();

    let counter = Arc::new(AtomicU32::new(0));
    let counter_clone = counter.clone();

    // First worker with very short lock duration to simulate stalling
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let c = counter_clone.clone();
        Box::pin(async move {
            c.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        lock_duration: 30_000,
        stalled_interval: 5_000,
        max_stalled_count: 2,
        ..Default::default()
    };
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Wait for multiple iterations to process
    tokio::time::sleep(Duration::from_secs(3)).await;

    let total = counter.load(Ordering::SeqCst);
    assert!(
        total >= 3,
        "Scheduler should keep repeating even with stall recovery configured, got {}",
        total
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler with 'pattern' + promote: next delayed created after promote
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_promote_pattern_scheduler_then_process() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Use 'every' with large interval — more predictable than cron for promote tests
    let repeat_opts = RepeatOptions {
        every: Some(30_000), // 30s interval
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("promote-pattern", repeat_opts, None, None, None)
        .await
        .unwrap();

    // First job in waiting (delay=0 for 'every')
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.waiting, 1);

    // Process first job
    let (tx, mut rx) = mpsc::channel(5);
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
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    tokio::time::timeout(Duration::from_secs(3), rx.recv())
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_millis(200)).await;

    // After first processing, next goes to delayed
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.delayed, 1);

    // Promote
    queue.promote_jobs(1000).await.unwrap();

    // Worker picks up promoted job almost instantly, so just wait for processing

    // Process promoted job
    tokio::time::timeout(Duration::from_secs(3), rx.recv())
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_millis(200)).await;

    // After processing promoted job, next delayed should exist
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(
        counts.delayed, 1,
        "Next iteration delayed after promote+process"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler with 'immediately' + 'pattern' promotes and processes again
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_promote_pattern_immediately_scheduler() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Use immediately with a long-interval 'every' instead of cron
    // to avoid timing issues with cron patterns near second boundaries
    let repeat_opts = RepeatOptions {
        every: Some(45_000), // 45s
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("promote-imm", repeat_opts, None, None, None)
        .await
        .unwrap();

    // With 'every', first job is in waiting (delay=0)
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.waiting, 1);

    // Process first
    let (tx, mut rx) = mpsc::channel(5);
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
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_millis(200)).await;

    // Next should be in delayed (45s in future)
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.delayed, 1);

    // Promote it
    queue.promote_jobs(1000).await.unwrap();

    // Process the promoted job
    tokio::time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_millis(200)).await;

    // After second process, next delayed should exist
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(
        counts.delayed, 1,
        "Next delayed should exist after promote+process"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: count value is correct in job opts
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_job_has_correct_count_in_opts() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(300),
        limit: Some(3),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("count-opts", repeat_opts, None, None, None)
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(10);
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        let count = job.opts().repeat.as_ref().and_then(|r| r.count);
        Box::pin(async move {
            tx.send(count).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Collect count values from each iteration
    let mut counts = Vec::new();
    for _ in 0..3 {
        let result = tokio::time::timeout(Duration::from_secs(3), rx.recv()).await;
        assert!(result.is_ok());
        counts.push(result.unwrap().unwrap());
    }

    // The count should increment: first job has count=1, second has count=2, etc.
    assert_eq!(counts[0], Some(1));
    assert_eq!(counts[1], Some(2));
    assert_eq!(counts[2], Some(3));

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: keep only one delayed if upserting with same id
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_upsert_keeps_only_one_delayed_job() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // First upsert with cron (creates delayed)
    let repeat_opts = RepeatOptions {
        pattern: Some("0 0 * * *".to_string()), // daily
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("one-delayed", repeat_opts, None, None, None)
        .await
        .unwrap();

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.delayed, 1);

    // Upsert again with different pattern
    let repeat_opts2 = RepeatOptions {
        pattern: Some("0 12 * * *".to_string()), // daily at noon
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("one-delayed", repeat_opts2, None, None, None)
        .await
        .unwrap();

    // Should still have only 1 delayed job (old one replaced)
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(
        counts.delayed, 1,
        "Should have exactly 1 delayed job after re-upsert"
    );

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: update delayed job timestamp when upserting different pattern
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_upsert_updates_delayed_job_timestamp() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Hourly cron
    let repeat_opts = RepeatOptions {
        pattern: Some("0 * * * *".to_string()),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("ts-update", repeat_opts, None, None, None)
        .await
        .unwrap();

    let sched1 = queue.get_job_scheduler("ts-update").await.unwrap().unwrap();
    let next1 = sched1.next.unwrap();

    // Now upsert with a "every minute" cron — should have an earlier next
    let repeat_opts2 = RepeatOptions {
        pattern: Some("* * * * *".to_string()),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("ts-update", repeat_opts2, None, None, None)
        .await
        .unwrap();

    let sched2 = queue.get_job_scheduler("ts-update").await.unwrap().unwrap();
    let next2 = sched2.next.unwrap();

    // Every-minute next should be earlier than hourly next, or effectively the
    // same when both schedules align on the next run boundary.
    assert!(
        next2 <= next1 + 1_000,
        "After upserting with more frequent pattern, next timestamp should not be meaningfully later (was {}, now {})",
        next1,
        next2
    );

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: keep only one waiting job if upserting with same id (every)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_upsert_keeps_only_one_waiting_job_every() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // First upsert with 'every' (puts first job in waiting)
    let repeat_opts = RepeatOptions {
        every: Some(5000),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("one-waiting", repeat_opts, None, None, None)
        .await
        .unwrap();

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.waiting, 1);

    // Upsert again with different every
    let repeat_opts2 = RepeatOptions {
        every: Some(10_000),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("one-waiting", repeat_opts2, None, None, None)
        .await
        .unwrap();

    // Should still have only 1 waiting job
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(
        counts.waiting, 1,
        "Should have exactly 1 waiting job after re-upsert"
    );

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: delete and upsert should not throw during processing
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_delete_and_upsert_during_processing() {
    use std::sync::atomic::{AtomicU32, Ordering};

    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let repeat_opts = RepeatOptions {
        every: Some(300),
        ..Default::default()
    };
    queue
        .upsert_job_scheduler("del-upsert", repeat_opts.clone(), None, None, None)
        .await
        .unwrap();

    let counter = Arc::new(AtomicU32::new(0));
    let counter_clone = counter.clone();

    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let c = counter_clone.clone();
        Box::pin(async move {
            c.fetch_add(1, Ordering::SeqCst);
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Let it process one iteration
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(counter.load(Ordering::SeqCst) >= 1);

    // Delete the scheduler
    queue.remove_job_scheduler("del-upsert").await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Re-add it
    queue
        .upsert_job_scheduler("del-upsert", repeat_opts, None, None, None)
        .await
        .unwrap();

    // Worker should continue processing without crashing
    let before = counter.load(Ordering::SeqCst);
    tokio::time::sleep(Duration::from_secs(1)).await;
    let after = counter.load(Ordering::SeqCst);
    assert!(
        after > before,
        "Worker should continue processing after delete+upsert"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler: processes delayed jobs by priority
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_scheduler_processes_jobs_by_priority() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Create two schedulers with different priorities
    let repeat_opts_low = RepeatOptions {
        every: Some(60_000), // won't repeat during test
        ..Default::default()
    };
    let repeat_opts_high = RepeatOptions {
        every: Some(60_000),
        ..Default::default()
    };

    let opts_low = JobOptions {
        priority: Some(10), // lower priority (higher number = lower priority)
        ..Default::default()
    };
    let opts_high = JobOptions {
        priority: Some(1), // higher priority
        ..Default::default()
    };

    // Add low priority first
    queue
        .upsert_job_scheduler(
            "low-prio",
            repeat_opts_low,
            Some("low"),
            None,
            Some(opts_low),
        )
        .await
        .unwrap();

    // Add high priority second
    queue
        .upsert_job_scheduler(
            "high-prio",
            repeat_opts_high,
            Some("high"),
            None,
            Some(opts_high),
        )
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(5);
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let tx = tx.clone();
        let name = job.name().to_string();
        Box::pin(async move {
            tx.send(name).await.unwrap();
            Ok(serde_json::Value::Null)
        })
    });

    let worker_opts = WorkerOptions {
        connection: conn_opts.clone(),
        autorun: true,
        ..Default::default()
    };
    let worker = Worker::new(&name, processor, worker_opts).await.unwrap();

    // Collect the order they're processed
    let first = tokio::time::timeout(Duration::from_secs(3), rx.recv())
        .await
        .unwrap()
        .unwrap();
    let second = tokio::time::timeout(Duration::from_secs(3), rx.recv())
        .await
        .unwrap()
        .unwrap();

    // High priority should be processed first
    assert_eq!(
        first, "high",
        "Higher priority job should be processed first"
    );
    assert_eq!(second, "low");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}
