//! Deduplication tests.

mod common;

use std::sync::Arc;
use std::time::Duration;

use bullmq::worker::{CancellationToken, ProcessorFn};
use bullmq::{DeduplicationOptions, Job, JobOptions, Queue, QueueOptions, Worker, WorkerOptions};
use common::{cleanup_queue, test_connection, test_queue_name};
use tokio::sync::mpsc;

// ═══════════════════════════════════════════════════════════════════════════
// Basic deduplication
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_dedup_prevents_duplicate_jobs() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Add two jobs with the same deduplication ID
    let opts1 = JobOptions {
        deduplication: Some(DeduplicationOptions {
            id: "dedup-1".to_string(),
            ..Default::default()
        }),
        ..Default::default()
    };
    let opts2 = JobOptions {
        deduplication: Some(DeduplicationOptions {
            id: "dedup-1".to_string(),
            ..Default::default()
        }),
        ..Default::default()
    };

    let id1 = queue
        .add("job1", serde_json::json!({"first": true}), Some(opts1))
        .await
        .unwrap()
        .id()
        .to_string();
    let id2 = queue
        .add("job2", serde_json::json!({"second": true}), Some(opts2))
        .await
        .unwrap()
        .id()
        .to_string();

    // Both should return the same job ID (second was deduplicated)
    assert_eq!(id1, id2);

    // Only 1 job should be in the queue
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.waiting, 1);

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_dedup_different_ids_create_separate_jobs() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    let opts1 = JobOptions {
        deduplication: Some(DeduplicationOptions {
            id: "dedup-a".to_string(),
            ..Default::default()
        }),
        ..Default::default()
    };
    let opts2 = JobOptions {
        deduplication: Some(DeduplicationOptions {
            id: "dedup-b".to_string(),
            ..Default::default()
        }),
        ..Default::default()
    };

    let id1 = queue
        .add("job1", serde_json::json!({"a": 1}), Some(opts1))
        .await
        .unwrap()
        .id()
        .to_string();
    let id2 = queue
        .add("job2", serde_json::json!({"b": 2}), Some(opts2))
        .await
        .unwrap()
        .id()
        .to_string();

    // Different dedup IDs → different jobs
    assert_ne!(id1, id2);

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.waiting, 2);

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Deduplication with TTL
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_dedup_with_ttl_allows_after_expiry() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // First job with 500ms TTL
    let opts1 = JobOptions {
        deduplication: Some(DeduplicationOptions {
            id: "ttl-dedup".to_string(),
            ttl: Some(500),
            ..Default::default()
        }),
        ..Default::default()
    };
    queue
        .add("job1", serde_json::json!({"first": true}), Some(opts1))
        .await
        .unwrap();

    // Immediately add a duplicate → should be deduplicated
    let opts2 = JobOptions {
        deduplication: Some(DeduplicationOptions {
            id: "ttl-dedup".to_string(),
            ttl: Some(500),
            ..Default::default()
        }),
        ..Default::default()
    };
    queue
        .add("job2", serde_json::json!({"second": true}), Some(opts2))
        .await
        .unwrap();

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.waiting, 1, "Duplicate should be prevented");

    // Wait for TTL to expire
    tokio::time::sleep(Duration::from_millis(600)).await;

    // Now add again → should create a new job
    let opts3 = JobOptions {
        deduplication: Some(DeduplicationOptions {
            id: "ttl-dedup".to_string(),
            ttl: Some(500),
            ..Default::default()
        }),
        ..Default::default()
    };
    queue
        .add("job3", serde_json::json!({"third": true}), Some(opts3))
        .await
        .unwrap();

    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(
        counts.waiting, 2,
        "After TTL expiry, new job should be created"
    );

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Deduplication with replace
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_dedup_replace_updates_delayed_job() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // First job delayed with dedup
    let opts1 = JobOptions {
        delay: Some(60_000),
        deduplication: Some(DeduplicationOptions {
            id: "replace-dedup".to_string(),
            ..Default::default()
        }),
        ..Default::default()
    };
    let id1 = queue
        .add("job1", serde_json::json!({"v": 1}), Some(opts1))
        .await
        .unwrap()
        .id()
        .to_string();

    // Replace with a new delayed job
    let opts2 = JobOptions {
        delay: Some(60_000),
        deduplication: Some(DeduplicationOptions {
            id: "replace-dedup".to_string(),
            replace: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };
    let id2 = queue
        .add("job2", serde_json::json!({"v": 2}), Some(opts2))
        .await
        .unwrap()
        .id()
        .to_string();

    // New job should have a different ID
    assert_ne!(id1, id2);

    // Only 1 delayed job should exist (the replacement)
    let counts = queue.get_job_counts().await.unwrap();
    assert_eq!(counts.delayed, 1);

    // Verify the existing job has the updated data
    let job = queue.get_job(&id2).await.unwrap().unwrap();
    assert_eq!(job.data()["v"], 2);

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Remove deduplication key
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_remove_deduplication_key() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Add a job with dedup (no TTL → key persists indefinitely)
    let opts = JobOptions {
        deduplication: Some(DeduplicationOptions {
            id: "persistent-dedup".to_string(),
            ..Default::default()
        }),
        ..Default::default()
    };
    let job_id = queue
        .add("job1", serde_json::json!({"v": 1}), Some(opts))
        .await
        .unwrap()
        .id()
        .to_string();

    // Verify dedup is active — adding same dedup ID returns same job
    let opts2 = JobOptions {
        deduplication: Some(DeduplicationOptions {
            id: "persistent-dedup".to_string(),
            ..Default::default()
        }),
        ..Default::default()
    };
    let id2 = queue
        .add("job2", serde_json::json!({"v": 2}), Some(opts2))
        .await
        .unwrap()
        .id()
        .to_string();
    assert_eq!(job_id, id2);

    // Remove the dedup key
    let removed = queue
        .remove_deduplication_key("persistent-dedup", &job_id)
        .await
        .unwrap();
    assert!(removed);

    // Now a new job should be created
    let opts3 = JobOptions {
        deduplication: Some(DeduplicationOptions {
            id: "persistent-dedup".to_string(),
            ..Default::default()
        }),
        ..Default::default()
    };
    let id3 = queue
        .add("job3", serde_json::json!({"v": 3}), Some(opts3))
        .await
        .unwrap()
        .id()
        .to_string();
    assert_ne!(job_id, id3);

    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Deduplication with worker processing
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_dedup_key_removed_after_job_completes() {
    let name = test_queue_name();
    let conn_opts = test_connection();
    let queue_opts = QueueOptions {
        connection: conn_opts.clone(),
        ..Default::default()
    };
    let queue = Queue::new(&name, queue_opts).await.unwrap();

    // Add job with dedup (no TTL → cleaned up on completion by Lua moveToFinished)
    let opts = JobOptions {
        deduplication: Some(DeduplicationOptions {
            id: "complete-dedup".to_string(),
            ..Default::default()
        }),
        ..Default::default()
    };
    queue
        .add("job1", serde_json::json!({"v": 1}), Some(opts))
        .await
        .unwrap();

    // Process it
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
    tokio::time::sleep(Duration::from_millis(100)).await;

    // After completion, dedup key should be removed → new job can be added
    let opts2 = JobOptions {
        deduplication: Some(DeduplicationOptions {
            id: "complete-dedup".to_string(),
            ..Default::default()
        }),
        ..Default::default()
    };
    let _id2 = queue
        .add("job2", serde_json::json!({"v": 2}), Some(opts2))
        .await
        .unwrap();

    // Should be a new job (not deduplicated)
    let counts = queue.get_job_counts().await.unwrap();
    // Either the new job is waiting or already picked up by the worker
    assert!(
        counts.waiting + counts.active >= 1,
        "New job should have been created after dedup key cleared"
    );

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

// ═══════════════════════════════════════════════════════════════════════════
// Deprecated debounce aliases
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_get_debounce_job_id_alias() {
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

    assert_eq!(queue.get_debounce_job_id("missing").await.unwrap(), None);

    let job_id = queue
        .add(
            "job1",
            serde_json::json!({"v": 1}),
            Some(JobOptions {
                deduplication: Some(DeduplicationOptions {
                    id: "debounce-1".to_string(),
                    ..Default::default()
                }),
                ..Default::default()
            }),
        )
        .await
        .unwrap()
        .id()
        .to_string();

    // The deprecated alias returns the same value as get_deduplication_job_id.
    assert_eq!(
        queue.get_debounce_job_id("debounce-1").await.unwrap(),
        Some(job_id.clone())
    );
    assert_eq!(
        queue.get_deduplication_job_id("debounce-1").await.unwrap(),
        Some(job_id)
    );

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_remove_debounce_key_alias() {
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
        .add(
            "job1",
            serde_json::json!({"v": 1}),
            Some(JobOptions {
                deduplication: Some(DeduplicationOptions {
                    id: "debounce-rm".to_string(),
                    ..Default::default()
                }),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

    // Plain DEL — returns 1 when the key existed, 0 afterwards.
    assert_eq!(queue.remove_debounce_key("debounce-rm").await.unwrap(), 1);
    assert_eq!(queue.remove_debounce_key("debounce-rm").await.unwrap(), 0);
    assert_eq!(
        queue.get_debounce_job_id("debounce-rm").await.unwrap(),
        None
    );

    cleanup_queue(&queue).await;
}
