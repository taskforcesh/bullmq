//! Queue tests — creation, add, bulk, pause, drain, obliterate, getters.

mod common;

use bullmq::types::JobState;
use bullmq::worker::{CancellationToken, ProcessorFn};
use bullmq::{Job, JobOptions, Queue, QueueOptions, Worker, WorkerOptions};
use common::{cleanup_queue, test_connection, test_queue_name};
use std::sync::Arc;
use std::time::Duration;

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
async fn test_queue_name_cannot_contain_colon() {
    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let result = Queue::new("invalid:queue", opts).await;
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
async fn test_add_job_with_parent_queue_name() {
    let parent_name = test_queue_name();
    let child_name = test_queue_name();

    let opts = QueueOptions {
        connection: test_connection(),
        ..Default::default()
    };

    let parent_queue = Queue::new(&parent_name, opts.clone()).await.unwrap();
    let child_queue = Queue::new(&child_name, opts).await.unwrap();

    let parent = parent_queue
        .add(
            "parent",
            serde_json::json!({}),
            Some(JobOptions {
                job_id: Some("parent-id".to_string()),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

    let child = child_queue
        .add(
            "child",
            serde_json::json!({}),
            Some(JobOptions {
                parent: Some(bullmq::ParentOpts {
                    // ParentOpts.queue is a queue name, not a qualified key.
                    queue: parent_name.clone(),
                    id: parent.id().to_string(),
                    wait_children: None,
                }),
                fail_parent_on_failure: Some(true),
                ignore_dependency_on_failure: Some(true),
                remove_dependency_on_failure: Some(true),
                continue_parent_on_failure: Some(true),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

    assert!(!child.id().is_empty());

    let mut cmd = redis::cmd("HGET");
    cmd.arg(child_queue.keys().job_key(child.id()))
        .arg("parent");
    let stored_parent: String = child_queue.connection().cmd(&mut cmd).await.unwrap();
    let stored_parent: serde_json::Value = serde_json::from_str(&stored_parent).unwrap();
    assert_eq!(stored_parent["id"], parent.id());
    assert_eq!(
        stored_parent["queueKey"],
        format!("{}:{}", child_queue.keys().prefix(), parent_name)
    );
    assert_eq!(stored_parent["fpof"], true);
    assert_eq!(stored_parent["idof"], true);
    assert_eq!(stored_parent["rdof"], true);
    assert_eq!(stored_parent["cpof"], true);

    let deps = parent_queue
        .get_dependencies_count(parent.id())
        .await
        .unwrap();
    assert_eq!(deps.unprocessed, 1);

    cleanup_queue(&child_queue).await;
    cleanup_queue(&parent_queue).await;
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
    assert_eq!(counts.waiting, 4);

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

// ═══════════════════════════════════════════════════════════════════════════
// State-list getters (getWaiting / getActive / getJobs / getRanges / counts)
// ═══════════════════════════════════════════════════════════════════════════

// Node.js: "should get waiting jobs"
#[tokio::test]
async fn test_get_waiting_jobs() {
    let name = test_queue_name();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    queue
        .add("test", serde_json::json!({"foo": "bar"}), None)
        .await
        .unwrap();
    queue
        .add("test", serde_json::json!({"baz": "qux"}), None)
        .await
        .unwrap();

    let jobs = queue.get_waiting(0, -1).await.unwrap();
    assert_eq!(jobs.len(), 2);
    assert_eq!(jobs[0].data()["foo"], "bar");
    assert_eq!(jobs[1].data()["baz"], "qux");

    cleanup_queue(&queue).await;
}

// Node.js: "should get all waiting jobs when no range is provided"
#[tokio::test]
async fn test_get_waiting_jobs_full_range() {
    let name = test_queue_name();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    queue
        .add("test", serde_json::json!({"foo": "bar"}), None)
        .await
        .unwrap();
    queue
        .add("test", serde_json::json!({"baz": "qux"}), None)
        .await
        .unwrap();
    queue
        .add("test", serde_json::json!({"bar": "qux"}), None)
        .await
        .unwrap();
    queue
        .add("test", serde_json::json!({"baz": "xuq"}), None)
        .await
        .unwrap();

    let all_jobs = queue.get_waiting(0, -1).await.unwrap();
    assert_eq!(all_jobs.len(), 4);
    assert_eq!(all_jobs[0].data()["foo"], "bar");
    assert_eq!(all_jobs[1].data()["baz"], "qux");
    assert_eq!(all_jobs[2].data()["bar"], "qux");
    assert_eq!(all_jobs[3].data()["baz"], "xuq");

    cleanup_queue(&queue).await;
}

// Node.js: "should get paused jobs" (getWaiting also returns paused jobs)
#[tokio::test]
async fn test_get_paused_jobs_via_waiting() {
    let name = test_queue_name();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    queue.pause().await.unwrap();
    queue
        .add("test", serde_json::json!({"foo": "bar"}), None)
        .await
        .unwrap();
    queue
        .add("test", serde_json::json!({"baz": "qux"}), None)
        .await
        .unwrap();

    let jobs = queue.get_waiting(0, -1).await.unwrap();
    assert_eq!(jobs.len(), 2);

    cleanup_queue(&queue).await;
}

// getJobs with explicit waiting type
#[tokio::test]
async fn test_get_jobs_by_type_waiting() {
    let name = test_queue_name();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    for i in 0..5 {
        queue
            .add("test", serde_json::json!({"idx": i}), None)
            .await
            .unwrap();
    }

    let jobs = queue.get_jobs(&["waiting"], 0, -1, true).await.unwrap();
    assert_eq!(jobs.len(), 5);

    // Default (empty types) returns everything too.
    let all = queue.get_jobs(&[], 0, -1, true).await.unwrap();
    assert_eq!(all.len(), 5);

    cleanup_queue(&queue).await;
}

// get_ranges sanitizes types: querying `waiting` must also include `paused`
// jobs (where waiting jobs are parked while the queue is paused).
#[tokio::test]
async fn test_get_ranges_waiting_includes_paused() {
    let name = test_queue_name();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    for i in 0..3 {
        queue
            .add("test", serde_json::json!({"idx": i}), None)
            .await
            .unwrap();
    }

    // Pausing moves waiting jobs into the paused list.
    queue.pause().await.unwrap();

    let ids = queue.get_ranges(&["waiting"], 0, -1, true).await.unwrap();
    assert_eq!(
        ids.len(),
        3,
        "waiting query should include paused jobs after pause"
    );

    cleanup_queue(&queue).await;
}

// getPrioritized
#[tokio::test]
async fn test_get_prioritized_jobs() {
    let name = test_queue_name();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    for i in 1..=3 {
        queue
            .add(
                "test",
                serde_json::json!({"idx": i}),
                Some(JobOptions {
                    priority: Some(i),
                    ..Default::default()
                }),
            )
            .await
            .unwrap();
    }

    let prioritized = queue.get_prioritized(0, -1).await.unwrap();
    assert_eq!(prioritized.len(), 3);
    let count = queue.get_prioritized_count().await.unwrap();
    assert_eq!(count, 3);

    cleanup_queue(&queue).await;
}

// getDelayed
#[tokio::test]
async fn test_get_delayed_jobs() {
    let name = test_queue_name();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    for i in 0..3 {
        queue
            .add(
                "test",
                serde_json::json!({"idx": i}),
                Some(JobOptions {
                    delay: Some(60_000),
                    ..Default::default()
                }),
            )
            .await
            .unwrap();
    }

    let delayed = queue.get_delayed(0, -1).await.unwrap();
    assert_eq!(delayed.len(), 3);
    assert_eq!(queue.get_delayed_count().await.unwrap(), 3);

    cleanup_queue(&queue).await;
}

// Node.js: ".count > retries count considering prioritized jobs"
#[tokio::test]
async fn test_count_considering_prioritized() {
    let name = test_queue_name();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    for i in 0..8 {
        queue
            .add(
                "test",
                serde_json::json!({"idx": i}),
                Some(JobOptions {
                    priority: Some(i + 1),
                    ..Default::default()
                }),
            )
            .await
            .unwrap();
    }
    queue
        .add("test", serde_json::json!({}), None)
        .await
        .unwrap();

    let count = queue.count().await.unwrap();
    assert_eq!(count, 9);

    cleanup_queue(&queue).await;
}

// Node.js: ".getCountsPerPriority > returns job counts per priority"
#[tokio::test]
async fn test_get_counts_per_priority() {
    let name = test_queue_name();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    for i in 0..42u64 {
        queue
            .add(
                "test",
                serde_json::json!({}),
                Some(JobOptions {
                    priority: Some((i % 4) as u32),
                    ..Default::default()
                }),
            )
            .await
            .unwrap();
    }

    let counts = queue.get_counts_per_priority(&[0, 1, 2, 3]).await.unwrap();
    assert_eq!(counts.get(&0), Some(&11));
    assert_eq!(counts.get(&1), Some(&11));
    assert_eq!(counts.get(&2), Some(&10));
    assert_eq!(counts.get(&3), Some(&10));

    cleanup_queue(&queue).await;
}

// Node.js: ".getCountsPerPriority > when queue is paused"
#[tokio::test]
async fn test_get_counts_per_priority_when_paused() {
    let name = test_queue_name();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    queue.pause().await.unwrap();
    for i in 0..42u64 {
        queue
            .add(
                "test",
                serde_json::json!({}),
                Some(JobOptions {
                    priority: Some((i % 4) as u32),
                    ..Default::default()
                }),
            )
            .await
            .unwrap();
    }

    let counts = queue.get_counts_per_priority(&[0, 1, 2, 3]).await.unwrap();
    assert_eq!(counts.get(&0), Some(&11));
    assert_eq!(counts.get(&1), Some(&11));
    assert_eq!(counts.get(&2), Some(&10));
    assert_eq!(counts.get(&3), Some(&10));

    cleanup_queue(&queue).await;
}

// get_job_counts_by_types + individual count getters
#[tokio::test]
async fn test_get_job_counts_by_types() {
    let name = test_queue_name();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    for _ in 0..3 {
        queue
            .add("test", serde_json::json!({}), None)
            .await
            .unwrap();
    }
    queue
        .add(
            "test",
            serde_json::json!({}),
            Some(JobOptions {
                delay: Some(60_000),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

    assert_eq!(queue.get_waiting_count().await.unwrap(), 3);
    assert_eq!(queue.get_delayed_count().await.unwrap(), 1);

    let map = queue
        .get_job_counts_by_types(&["waiting", "delayed"])
        .await
        .unwrap();
    assert_eq!(map.get("waiting"), Some(&3));
    assert_eq!(map.get("delayed"), Some(&1));

    // Total across types.
    let total = queue
        .get_job_count_by_types(&["waiting", "delayed"])
        .await
        .unwrap();
    assert_eq!(total, 4);

    cleanup_queue(&queue).await;
}

// Worker-based getCompleted / getFailed
#[tokio::test]
async fn test_get_completed_and_failed_jobs() {
    let name = test_queue_name();
    let conn = test_connection();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: conn.clone(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // One job that completes, one that fails.
    queue
        .add("ok", serde_json::json!({"ok": true}), None)
        .await
        .unwrap();
    queue
        .add(
            "fail",
            serde_json::json!({"ok": false}),
            Some(JobOptions {
                attempts: Some(1),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

    let processor: ProcessorFn = Arc::new(|job: Job, _token: CancellationToken| {
        Box::pin(async move {
            if job.name() == "fail" {
                Err(bullmq::Error::ProcessingError("boom".to_string()))
            } else {
                Ok(serde_json::json!({"done": true}))
            }
        })
    });
    let worker = Worker::new(
        &name,
        processor,
        WorkerOptions {
            connection: conn.clone(),
            autorun: true,
            drain_delay: 1,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // Wait for both jobs to settle.
    let settled = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let completed = queue.get_completed_count().await.unwrap();
            let failed = queue.get_failed_count().await.unwrap();
            if completed >= 1 && failed >= 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await;
    assert!(settled.is_ok(), "jobs did not settle");

    let completed = queue.get_completed(0, -1).await.unwrap();
    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0].name(), "ok");

    let failed = queue.get_failed(0, -1).await.unwrap();
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].name(), "fail");

    // getJobs with multiple types returns the union.
    let both = queue
        .get_jobs(&["completed", "failed"], 0, -1, false)
        .await
        .unwrap();
    assert_eq!(both.len(), 2);

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Paired getters (rate-limit ttl, global concurrency, global rate limit)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_get_rate_limit_ttl() {
    let name = test_queue_name();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // Not rate limited yet: with no maxJobs and no key, this mirrors Redis PTTL
    // semantics and returns -2 (key does not exist).
    assert_eq!(queue.get_rate_limit_ttl(None).await.unwrap(), -2);

    // Apply a manual rate limit; TTL should now be positive.
    queue.rate_limit(5_000).await.unwrap();
    let ttl = queue.get_rate_limit_ttl(None).await.unwrap();
    assert!(ttl > 0 && ttl <= 5_000, "unexpected ttl: {}", ttl);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_global_concurrency() {
    let name = test_queue_name();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    assert_eq!(queue.get_global_concurrency().await.unwrap(), None);

    queue.set_global_concurrency(5).await.unwrap();
    assert_eq!(queue.get_global_concurrency().await.unwrap(), Some(5));

    queue.remove_global_concurrency().await.unwrap();
    assert_eq!(queue.get_global_concurrency().await.unwrap(), None);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_get_global_rate_limit() {
    let name = test_queue_name();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: test_connection(),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    assert_eq!(queue.get_global_rate_limit().await.unwrap(), None);

    queue.set_global_rate_limit(100, 1_000).await.unwrap();
    assert_eq!(
        queue.get_global_rate_limit().await.unwrap(),
        Some((100, 1_000))
    );

    queue.remove_global_rate_limit().await.unwrap();
    assert_eq!(queue.get_global_rate_limit().await.unwrap(), None);

    cleanup_queue(&queue).await;
}
