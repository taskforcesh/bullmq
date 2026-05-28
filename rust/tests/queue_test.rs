//! Queue tests — creation, add, bulk, pause, drain, obliterate, getters.

mod common;

use bullmq::types::JobState;
use bullmq::{JobOptions, Queue, QueueOptions};
use common::{cleanup_queue, test_connection, test_queue_name};

// ═══════════════════════════════════════════════════════════════════════════
// Queue CRUD
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_queue_creation() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts)
        .await
        .expect("queue creation failed");
    assert_eq!(queue.name(), name);
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_add_job() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();
    let job = queue
        .add("test-job", serde_json::json!({"key": "value"}), None)
        .await
        .unwrap();

    assert!(!job.id().is_empty());
    assert_eq!(job.name(), "test-job");
    assert_eq!(job.data(), &serde_json::json!({"key": "value"}));

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_add_job_with_custom_id() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();
    let job = queue
        .add(
            "custom-id-job",
            serde_json::json!({}),
            Some(JobOptions {
                job_id: Some("my-custom-id".to_string()),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

    assert_eq!(job.id(), "my-custom-id");

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_add_bulk_jobs() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();
    let jobs = queue
        .add_bulk(vec![
            ("job-1".to_string(), serde_json::json!({"n": 1}), None),
            ("job-2".to_string(), serde_json::json!({"n": 2}), None),
            ("job-3".to_string(), serde_json::json!({"n": 3}), None),
        ])
        .await
        .unwrap();

    assert_eq!(jobs.len(), 3);
    assert_eq!(jobs[0].name(), "job-1");
    assert_eq!(jobs[1].name(), "job-2");
    assert_eq!(jobs[2].name(), "job-3");

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_add_bulk_empty() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();
    let jobs = queue.add_bulk(vec![]).await.unwrap();
    assert_eq!(jobs.len(), 0);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_add_bulk_with_options() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();
    let jobs = queue
        .add_bulk(vec![
            ("normal".to_string(), serde_json::json!({}), None),
            (
                "delayed".to_string(),
                serde_json::json!({}),
                Some(JobOptions {
                    delay: Some(60_000),
                    ..Default::default()
                }),
            ),
            (
                "priority".to_string(),
                serde_json::json!({}),
                Some(JobOptions {
                    priority: Some(5),
                    ..Default::default()
                }),
            ),
        ])
        .await
        .unwrap();

    assert_eq!(jobs.len(), 3);
    assert_eq!(jobs[0].name(), "normal");
    assert_eq!(jobs[1].name(), "delayed");
    assert_eq!(jobs[1].delay(), 60_000);
    assert_eq!(jobs[2].name(), "priority");
    assert_eq!(jobs[2].priority(), 5);

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.waiting, 1);
    assert_eq!(counts.delayed, 1);
    assert_eq!(counts.prioritized, 1);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_job() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();
    let added = queue
        .add("fetch-test", serde_json::json!({"hello": "world"}), None)
        .await
        .unwrap();

    let fetched = queue.get_job(added.id()).await.unwrap();
    assert!(fetched.is_some());
    let fetched = fetched.unwrap();
    assert_eq!(fetched.id(), added.id());
    assert_eq!(fetched.name(), "fetch-test");

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_job_not_found() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();
    let result = queue.get_job("nonexistent-id").await.unwrap();
    assert!(result.is_none());

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_remove_job() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();
    let job = queue
        .add("to-remove", serde_json::json!({}), None)
        .await
        .unwrap();

    let removed = queue.remove(job.id()).await.unwrap();
    assert!(removed);

    let fetched = queue.get_job(job.id()).await.unwrap();
    assert!(fetched.is_none());

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_remove_nonexistent_job() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();
    let _removed = queue.remove("does-not-exist").await.unwrap();

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pause / Resume / Drain / Obliterate
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_pause_resume() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();

    assert!(!queue.is_paused().await.unwrap());

    queue.pause().await.unwrap();
    assert!(queue.is_paused().await.unwrap());

    queue.resume().await.unwrap();
    assert!(!queue.is_paused().await.unwrap());

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_drain() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();

    for i in 0..5 {
        queue
            .add(&format!("drain-job-{}", i), serde_json::json!({}), None)
            .await
            .unwrap();
    }

    queue.drain(false).await.unwrap();

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.waiting, 0);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_drain_with_delayed_jobs() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();

    for i in 0..3 {
        queue
            .add(&format!("normal-{}", i), serde_json::json!({}), None)
            .await
            .unwrap();
    }

    for i in 0..2 {
        queue
            .add(
                &format!("delayed-{}", i),
                serde_json::json!({}),
                Some(JobOptions {
                    delay: Some(60_000),
                    ..Default::default()
                }),
            )
            .await
            .unwrap();
    }

    queue.drain(false).await.unwrap();
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.waiting, 0);
    assert_eq!(counts.delayed, 2);

    queue.drain(true).await.unwrap();
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.delayed, 0);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_obliterate() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();

    for i in 0..10 {
        queue
            .add(&format!("obliterate-{}", i), serde_json::json!({}), None)
            .await
            .unwrap();
    }

    queue.obliterate(true, 1000).await.unwrap();

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.waiting, 0);
}

#[tokio::test]
async fn test_queue_close_is_idempotent() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();
    queue.close().await;
    queue.close().await; // second close should not panic
}

// ═══════════════════════════════════════════════════════════════════════════
// Job Data & Options
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_job_data_types() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();

    let data = serde_json::json!({
        "string": "hello",
        "number": 42,
        "float": 3.15,
        "bool": true,
        "null": null,
        "array": [1, 2, 3],
        "nested": {"key": "value"}
    });

    let job = queue.add("complex-data", data.clone(), None).await.unwrap();
    let fetched = queue.get_job(job.id()).await.unwrap().unwrap();
    assert_eq!(fetched.data(), &data);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_job_with_delay() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();
    let job = queue
        .add(
            "delayed-job",
            serde_json::json!({}),
            Some(JobOptions {
                delay: Some(5000),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

    assert_eq!(job.delay(), 5000);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_job_with_priority() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();
    let job = queue
        .add(
            "priority-job",
            serde_json::json!({}),
            Some(JobOptions {
                priority: Some(10),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

    assert_eq!(job.priority(), 10);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_job_with_attempts() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();
    let job = queue
        .add(
            "retry-job",
            serde_json::json!({}),
            Some(JobOptions {
                attempts: Some(3),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

    let fetched = queue.get_job(job.id()).await.unwrap().unwrap();
    assert_eq!(fetched.opts().attempts, Some(3));

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_add_job_lifo() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();

    queue.pause().await.unwrap();

    for i in 0..4 {
        queue
            .add(
                &format!("lifo-{}", i),
                serde_json::json!({"order": i}),
                Some(JobOptions {
                    lifo: Some(true),
                    ..Default::default()
                }),
            )
            .await
            .unwrap();
    }

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.paused, 4);

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Getters / State
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_get_job_state_waiting() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();
    let job = queue
        .add("state-test", serde_json::json!({}), None)
        .await
        .unwrap();

    let state = queue.get_job_state(job.id()).await.unwrap();
    assert_eq!(state, JobState::Waiting);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_job_state_delayed() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();
    let job = queue
        .add(
            "delayed-state",
            serde_json::json!({}),
            Some(JobOptions {
                delay: Some(60_000),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

    let state = queue.get_job_state(job.id()).await.unwrap();
    assert_eq!(state, JobState::Delayed);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_job_state_prioritized() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();
    let job = queue
        .add(
            "priority-state",
            serde_json::json!({}),
            Some(JobOptions {
                priority: Some(5),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

    let state = queue.get_job_state(job.id()).await.unwrap();
    assert!(
        state == JobState::Waiting || state == JobState::Prioritized,
        "Expected Waiting or Prioritized, got {:?}",
        state
    );

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_job_counts_multiple_states() {
    let name = test_queue_name();
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let queue = Queue::new(&name, opts).await.unwrap();

    for i in 0..3 {
        queue
            .add(&format!("wait-{}", i), serde_json::json!({}), None)
            .await
            .unwrap();
    }

    for i in 0..2 {
        queue
            .add(
                &format!("delayed-{}", i),
                serde_json::json!({}),
                Some(JobOptions {
                    delay: Some(60_000),
                    ..Default::default()
                }),
            )
            .await
            .unwrap();
    }

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.waiting, 3);
    assert_eq!(counts.delayed, 2);
    assert_eq!(counts.active, 0);
    assert_eq!(counts.completed, 0);
    assert_eq!(counts.failed, 0);

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Unit Tests (keys, types)
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_queue_keys() {
    use bullmq::QueueKeys;

    let keys = QueueKeys::new("my-queue", None);
    assert_eq!(keys.base(), "bull:my-queue");
    assert_eq!(keys.wait(), "bull:my-queue:wait");
    assert_eq!(keys.active(), "bull:my-queue:active");
    assert_eq!(keys.delayed(), "bull:my-queue:delayed");
    assert_eq!(keys.completed(), "bull:my-queue:completed");
    assert_eq!(keys.failed(), "bull:my-queue:failed");
    assert_eq!(keys.stalled(), "bull:my-queue:stalled");
    assert_eq!(keys.meta(), "bull:my-queue:meta");
    assert_eq!(keys.events(), "bull:my-queue:events");
    assert_eq!(keys.marker(), "bull:my-queue:marker");
    assert_eq!(keys.id(), "bull:my-queue:id");
    assert_eq!(keys.job_key("123"), "bull:my-queue:123");
}

#[test]
fn test_queue_keys_custom_prefix() {
    use bullmq::QueueKeys;

    let keys = QueueKeys::new("tasks", Some("myapp"));
    assert_eq!(keys.base(), "myapp:tasks");
    assert_eq!(keys.wait(), "myapp:tasks:wait");
}

#[test]
fn test_job_state_parsing() {
    assert_eq!(JobState::from_redis_str("wait"), JobState::Waiting);
    assert_eq!(JobState::from_redis_str("waiting"), JobState::Waiting);
    assert_eq!(JobState::from_redis_str("active"), JobState::Active);
    assert_eq!(JobState::from_redis_str("delayed"), JobState::Delayed);
    assert_eq!(JobState::from_redis_str("completed"), JobState::Completed);
    assert_eq!(JobState::from_redis_str("failed"), JobState::Failed);
    assert_eq!(
        JobState::from_redis_str("waiting-children"),
        JobState::WaitingChildren
    );
    assert_eq!(JobState::from_redis_str("unknown_state"), JobState::Unknown);
}

#[test]
fn test_job_state_display() {
    assert_eq!(JobState::Waiting.as_str(), "wait");
    assert_eq!(JobState::Active.as_str(), "active");
    assert_eq!(JobState::Completed.as_str(), "completed");
}
