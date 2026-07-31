//! QueueEvents integration tests — cross-process stream event listening.
//!
//! These mirror the Node.js `tests/events.test.ts` scenarios. They require a
//! running Redis instance at `redis://127.0.0.1:6379`.
#![allow(clippy::collapsible_match, clippy::collapsible_if)]

mod common;

use bullmq::types::JobProgress;
use bullmq::worker::{CancellationToken, ProcessorFn};
use bullmq::{
    FlowJob, FlowProducer, Job, JobOptions, Queue, QueueEvent, QueueEvents, QueueEventsOptions,
    QueueOptions, Worker, WorkerOptions,
};
use common::{cleanup_queue, test_connection, test_queue_name};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Build QueueEvents that reads the full stream history (`"0"`), which removes
/// the start-up race for freshly-created, uniquely-named test queues.
async fn make_events(name: &str) -> QueueEvents {
    QueueEvents::with_options(
        name,
        QueueEventsOptions {
            connection: test_connection(),
            last_event_id: Some("0".to_string()),
            blocking_timeout: 1000,
            ..Default::default()
        },
    )
    .await
    .expect("create QueueEvents")
}

/// Wait until an event matching `pred` is observed, or panic after `secs`.
async fn wait_for<F>(events: &QueueEvents, secs: u64, mut pred: F) -> QueueEvent
where
    F: FnMut(&QueueEvent) -> bool,
{
    let result = tokio::time::timeout(Duration::from_secs(secs), async {
        loop {
            match events.next_event().await {
                Some(entry) if pred(&entry.event) => return entry.event,
                Some(_) => continue,
                None => panic!("QueueEvents closed before matching event"),
            }
        }
    })
    .await;

    result.expect("timed out waiting for matching queue event")
}

#[tokio::test]
async fn test_emits_added_event() {
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

    let events = make_events(&name).await;

    let job = queue
        .add("my-job", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    let event = wait_for(&events, 10, |e| matches!(e, QueueEvent::Added { .. })).await;
    match event {
        QueueEvent::Added {
            job_id,
            name: job_name,
        } => {
            assert_eq!(job_id, job.id());
            assert_eq!(job_name, "my-job");
        }
        other => panic!("expected Added, got {other:?}"),
    }

    events.close().await;
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_emits_waiting_event() {
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

    let events = make_events(&name).await;

    let job = queue
        .add("waiting-job", serde_json::json!({}))
        .await
        .unwrap();

    let event = wait_for(&events, 10, |e| matches!(e, QueueEvent::Waiting { .. })).await;
    if let QueueEvent::Waiting { job_id, .. } = event {
        assert_eq!(job_id, job.id());
    }

    events.close().await;
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_run_throws_when_already_running() {
    let name = test_queue_name();
    let events = QueueEvents::with_options(
        &name,
        QueueEventsOptions {
            connection: test_connection(),
            autorun: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    assert!(events.is_running());
    let err = events.run().await;
    assert!(err.is_err(), "second run() should fail");

    events.close().await;
}

#[tokio::test]
async fn test_close_makes_next_event_return_none() {
    let name = test_queue_name();
    let events = QueueEvents::with_options(
        &name,
        QueueEventsOptions {
            connection: test_connection(),
            autorun: true,
            blocking_timeout: 1000,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    events.close().await;

    let next = tokio::time::timeout(Duration::from_millis(500), events.next_event())
        .await
        .expect("next_event should not hang after close");
    assert!(next.is_none(), "closed listener should yield None");
}

#[tokio::test]
async fn test_run_after_close_resets_running() {
    let name = test_queue_name();
    let events = QueueEvents::with_options(
        &name,
        QueueEventsOptions {
            connection: test_connection(),
            autorun: false,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    assert!(!events.is_running());
    events.close().await;
    assert!(!events.is_running());

    let err = events.run().await;
    assert!(err.is_err(), "run() after close should fail");
    assert!(!events.is_running(), "failed run() should reset running");

    let err = events.run().await;
    assert!(
        err.is_err(),
        "subsequent run() after close should still fail"
    );
    assert!(
        !events.is_running(),
        "running should stay false after failed run()"
    );
}

#[tokio::test]
async fn test_autorun_false_then_run() {
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

    let events = QueueEvents::with_options(
        &name,
        QueueEventsOptions {
            connection: test_connection(),
            last_event_id: Some("0".to_string()),
            blocking_timeout: 1000,
            autorun: false,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    assert!(!events.is_running());
    events.run().await.unwrap();
    assert!(events.is_running());

    queue.add("late-job", serde_json::json!({})).await.unwrap();

    wait_for(&events, 10, |e| matches!(e, QueueEvent::Added { .. })).await;

    events.close().await;
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_emits_completed_event() {
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

    let events = make_events(&name).await;

    queue
        .add("done", serde_json::json!({"x": 1}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::json!({"ok": true})) })
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

    let event = wait_for(&events, 15, |e| matches!(e, QueueEvent::Completed { .. })).await;
    match event {
        QueueEvent::Completed { return_value, .. } => {
            let parsed: serde_json::Value = serde_json::from_str(&return_value).unwrap();
            assert_eq!(parsed, serde_json::json!({"ok": true}));
        }
        other => panic!("expected Completed, got {other:?}"),
    }

    worker.close(5000).await.unwrap();
    events.close().await;
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_emits_failed_event() {
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

    let events = make_events(&name).await;

    queue.add("boom", serde_json::json!({})).await.unwrap();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move {
            Err(bullmq::Error::ProcessingError(
                "intentional failure".to_string(),
            ))
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

    let event = wait_for(&events, 15, |e| matches!(e, QueueEvent::Failed { .. })).await;
    match event {
        QueueEvent::Failed { failed_reason, .. } => {
            assert!(failed_reason.contains("intentional failure"));
        }
        other => panic!("expected Failed, got {other:?}"),
    }

    worker.close(5000).await.unwrap();
    events.close().await;
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_emits_progress_event() {
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

    let events = make_events(&name).await;

    queue
        .add("progress-job", serde_json::json!({}))
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(|mut job: Job, _token: CancellationToken| {
        Box::pin(async move {
            job.update_progress(JobProgress::Number(42.0)).await?;
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

    let event = wait_for(&events, 15, |e| matches!(e, QueueEvent::Progress { .. })).await;
    match event {
        QueueEvent::Progress { data, .. } => {
            assert_eq!(data, serde_json::json!(42.0));
        }
        other => panic!("expected Progress, got {other:?}"),
    }

    worker.close(5000).await.unwrap();
    events.close().await;
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_emits_delayed_event() {
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

    let events = make_events(&name).await;

    let job = queue
        .add("delayed-job", serde_json::json!({}))
        .options(JobOptions {
            delay: Some(60_000),
            ..Default::default()
        })
        .await
        .unwrap();

    let event = wait_for(&events, 10, |e| matches!(e, QueueEvent::Delayed { .. })).await;
    if let QueueEvent::Delayed { job_id, delay } = event {
        assert_eq!(job_id, job.id());
        assert!(delay > 0);
    }

    events.close().await;
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_emits_drained_event() {
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

    let events = make_events(&name).await;

    queue.add("drain-me", serde_json::json!({})).await.unwrap();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::Value::Null) })
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

    wait_for(&events, 15, |e| matches!(e, QueueEvent::Drained)).await;

    worker.close(5000).await.unwrap();
    events.close().await;
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_emits_removed_event() {
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

    let events = make_events(&name).await;

    let job = queue.add("remove-me", serde_json::json!({})).await.unwrap();

    let removed = queue.remove(job.id()).await.unwrap();
    assert!(removed);

    let event = wait_for(&events, 10, |e| matches!(e, QueueEvent::Removed { .. })).await;
    if let QueueEvent::Removed { job_id, .. } = event {
        assert_eq!(job_id, job.id());
    }

    events.close().await;
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_resume_from_last_event_id() {
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

    // First listener captures the 'added' event and records its stream id.
    let events = make_events(&name).await;
    queue.add("first", serde_json::json!({})).await.unwrap();

    let first_id = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(entry) = events.next_event().await {
                if matches!(entry.event, QueueEvent::Added { .. }) {
                    return entry.id;
                }
            }
        }
    })
    .await
    .expect("timed out");
    events.close().await;

    // Second listener resumes after the first event and should only see newer ones.
    let resumed = QueueEvents::with_options(
        &name,
        QueueEventsOptions {
            connection: test_connection(),
            last_event_id: Some(first_id),
            blocking_timeout: 1000,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let job2 = queue.add("second", serde_json::json!({})).await.unwrap();

    let event = wait_for(&resumed, 10, |e| matches!(e, QueueEvent::Added { .. })).await;
    if let QueueEvent::Added {
        job_id,
        name: job_name,
    } = event
    {
        assert_eq!(job_id, job2.id());
        assert_eq!(job_name, "second");
    }

    resumed.close().await;
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_emits_active_event() {
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

    let events = make_events(&name).await;

    let job = queue.add("act", serde_json::json!({})).await.unwrap();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Ok(serde_json::Value::Null) })
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

    let event = wait_for(&events, 15, |e| matches!(e, QueueEvent::Active { .. })).await;
    match event {
        QueueEvent::Active { job_id, prev } => {
            assert_eq!(job_id, job.id());
            // Jobs become active from the waiting state.
            assert_eq!(prev.as_deref(), Some("waiting"));
        }
        other => panic!("expected Active, got {other:?}"),
    }

    worker.close(5000).await.unwrap();
    events.close().await;
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_emits_duplicated_event() {
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

    let events = make_events(&name).await;

    let opts = || JobOptions {
        job_id: Some("dup-1".to_string()),
        ..Default::default()
    };
    // The first add creates the job; the second with the same id is a duplicate.
    queue
        .add("test", serde_json::json!({}))
        .options(opts())
        .await
        .unwrap();
    queue
        .add("test", serde_json::json!({}))
        .options(opts())
        .await
        .unwrap();

    let event = wait_for(&events, 10, |e| matches!(e, QueueEvent::Duplicated { .. })).await;
    if let QueueEvent::Duplicated { job_id } = event {
        assert_eq!(job_id, "dup-1");
    }

    events.close().await;
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_emits_cleaned_event() {
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

    let num_jobs = 5u32;
    for i in 0..num_jobs {
        queue
            .add("test", serde_json::json!({ "i": i }))
            .await
            .unwrap();
    }

    // Process all jobs so they land in the completed set.
    let processed = Arc::new(AtomicU32::new(0));
    let processed_proc = processed.clone();
    let processor: ProcessorFn = Arc::new(move |_job: Job, _token: CancellationToken| {
        let processed = processed_proc.clone();
        Box::pin(async move {
            processed.fetch_add(1, Ordering::SeqCst);
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

    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if processed.load(Ordering::SeqCst) >= num_jobs {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timed out processing");
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Start the listener AFTER processing so we only capture the clean event.
    let events = make_events(&name).await;
    let removed = queue.clean(0, 0, "completed").await.unwrap();
    assert_eq!(removed.len(), num_jobs as usize);

    let event = wait_for(&events, 10, |e| matches!(e, QueueEvent::Cleaned { .. })).await;
    if let QueueEvent::Cleaned { count } = event {
        assert_eq!(count, num_jobs.to_string());
    }

    worker.close(5000).await.unwrap();
    events.close().await;
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_emits_retries_exhausted_event() {
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

    let events = make_events(&name).await;

    // Default attempts (1): a single failure exhausts retries.
    queue.add("boom", serde_json::json!({})).await.unwrap();

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move { Err(bullmq::Error::ProcessingError("nope".to_string())) })
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

    let event = wait_for(&events, 15, |e| {
        matches!(e, QueueEvent::RetriesExhausted { .. })
    })
    .await;
    if let QueueEvent::RetriesExhausted { attempts_made, .. } = event {
        assert_eq!(attempts_made, "1");
    }

    worker.close(5000).await.unwrap();
    events.close().await;
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_emits_waiting_children_event() {
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

    let events = make_events(&name).await;

    // A parent with one child is placed in the waiting-children state.
    let flow = FlowProducer::with_connection(queue.connection().clone(), None).unwrap();
    let node = flow
        .add(FlowJob {
            name: "parent".to_string(),
            queue_name: name.clone(),
            data: serde_json::json!({}),
            opts: None,
            prefix: None,
            children: Some(vec![FlowJob {
                name: "child".to_string(),
                queue_name: name.clone(),
                data: serde_json::json!({}),
                opts: None,
                prefix: None,
                children: None,
            }]),
        })
        .await
        .unwrap();
    let parent_id = node.job.id().to_string();

    let event = wait_for(&events, 10, |e| {
        matches!(e, QueueEvent::WaitingChildren { .. })
    })
    .await;
    if let QueueEvent::WaitingChildren { job_id } = event {
        assert_eq!(job_id, parent_id);
    }

    events.close().await;
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_no_removed_event_for_nonexistent_job() {
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

    let events = make_events(&name).await;

    // Removing a non-existent job must not publish a `removed` event.
    let _ = queue.remove("does-not-exist").await.unwrap();

    // Add a real job as a marker; we should observe its Added event without ever
    // seeing a Removed event for the missing id.
    let marker = queue.add("marker", serde_json::json!({})).await.unwrap();

    let saw_removed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let saw_removed_clone = saw_removed.clone();
    let reached_marker = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match events.next_event().await {
                Some(entry) => match entry.event {
                    QueueEvent::Removed { .. } => {
                        saw_removed_clone.store(true, std::sync::atomic::Ordering::SeqCst);
                    }
                    QueueEvent::Added { job_id, .. } if job_id == marker.id() => return true,
                    _ => {}
                },
                None => return false,
            }
        }
    })
    .await
    .expect("timed out");

    assert!(reached_marker);
    assert!(
        !saw_removed.load(std::sync::atomic::Ordering::SeqCst),
        "no removed event should be published for a non-existent job"
    );

    events.close().await;
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_drained_emitted_once_per_idle_batch() {
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

    let events = make_events(&name).await;

    // Count drained events seen across the whole test in a background task.
    let drained = Arc::new(AtomicU32::new(0));
    let drained_clone = drained.clone();
    let events_arc = Arc::new(events);
    let events_bg = events_arc.clone();
    let collector = tokio::spawn(async move {
        while let Some(entry) = events_bg.next_event().await {
            if matches!(entry.event, QueueEvent::Drained) {
                drained_clone.fetch_add(1, Ordering::SeqCst);
            }
        }
    });

    let processor: ProcessorFn = Arc::new(|_job: Job, _token: CancellationToken| {
        Box::pin(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            Ok(serde_json::Value::Null)
        })
    });
    let worker = Worker::with_options(
        &name,
        processor,
        WorkerOptions {
            connection: conn,
            autorun: true,
            drain_delay: 1,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // First idle batch.
    queue.add("a", serde_json::json!({})).await.unwrap();
    queue.add("b", serde_json::json!({})).await.unwrap();
    tokio::time::sleep(Duration::from_millis(1200)).await;

    // Second idle batch.
    queue.add("c", serde_json::json!({})).await.unwrap();
    queue.add("d", serde_json::json!({})).await.unwrap();
    tokio::time::sleep(Duration::from_millis(1200)).await;

    let count = drained.load(Ordering::SeqCst);
    assert_eq!(
        count, 2,
        "expected exactly one drained event per idle batch"
    );

    worker.close(5000).await.unwrap();
    events_arc.close().await;
    collector.abort();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_event_entry_exposes_id_and_job_id() {
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

    let events = make_events(&name).await;
    let job = queue.add("idx", serde_json::json!({})).await.unwrap();

    let entry = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(entry) = events.next_event().await {
                if matches!(entry.event, QueueEvent::Added { .. }) {
                    return entry;
                }
            }
        }
    })
    .await
    .expect("timed out");

    // Stream ids look like "<millis>-<seq>".
    assert!(entry.id.contains('-'), "unexpected stream id: {}", entry.id);
    assert_eq!(entry.event.job_id(), Some(job.id()));
    assert_eq!(entry.event.name(), "added");

    events.close().await;
    cleanup_queue(&queue).await;
}
