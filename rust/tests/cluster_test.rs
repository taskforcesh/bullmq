//! Redis Cluster integration tests.
//!
//! These tests run against a real Redis Cluster whose seed node URLs are given
//! (comma separated) in `REDIS_CLUSTER_NODES`, e.g.
//! `REDIS_CLUSTER_NODES=redis://127.0.0.1:7000,redis://127.0.0.1:7001`.
//! They are skipped when the variable is not set.
//!
//! All keys of a queue must hash to the same slot, so every test uses a
//! hash-tagged prefix.

mod common;

use bullmq::flow_producer::{FlowJob, FlowProducer, FlowProducerOptions};
use bullmq::options::RedisConnectionOptions;
use bullmq::redis_connection::{AnyConnection, BlockingRedisConnection, RedisConnection};
use bullmq::worker::{CancellationToken, ProcessorFn, WorkerEvent};
use bullmq::{
    Job, Queue, QueueEvent, QueueEvents, QueueEventsOptions, QueueOptions, Worker, WorkerOptions,
};
use common::{cleanup_queue, test_queue_name};
use std::sync::Arc;
use std::time::Duration;

const PREFIX: &str = "{bull-rs}";

fn cluster_connection() -> Option<RedisConnectionOptions> {
    let nodes = std::env::var("REDIS_CLUSTER_NODES").ok()?;
    let nodes: Vec<String> = nodes
        .split(',')
        .map(str::trim)
        .filter(|node| !node.is_empty())
        .map(String::from)
        .collect();
    if nodes.is_empty() {
        return None;
    }
    Some(RedisConnectionOptions::new().cluster_nodes(nodes))
}

macro_rules! cluster_or_skip {
    () => {
        match cluster_connection() {
            Some(opts) => opts,
            None => {
                eprintln!("REDIS_CLUSTER_NODES not set; skipping Redis Cluster test");
                return;
            }
        }
    };
}

async fn cluster_queue(name: &str, connection: &RedisConnectionOptions) -> Queue {
    Queue::with_options(
        name,
        QueueOptions {
            connection: connection.clone(),
            prefix: PREFIX.to_string(),
            ..Default::default()
        },
    )
    .await
    .unwrap()
}

fn echo_processor() -> ProcessorFn {
    Arc::new(|job: Job, _token: CancellationToken| Box::pin(async move { Ok(job.data().clone()) }))
}

#[tokio::test]
async fn test_cluster_connection_routes_commands() {
    let opts = cluster_or_skip!();
    let conn = RedisConnection::new_managed_only(&opts).await.unwrap();
    assert!(conn.is_cluster());
    assert!(conn.try_managed_conn().is_none());
    assert!(conn.try_client().is_none());
    assert!(conn.try_conn().is_none());
    assert!(conn.dedicated_connection().await.is_err());
    assert!(conn.managed_dedicated_connection().await.is_err());
    conn.ping().await.unwrap();

    // Keys in different slots are routed to their own nodes.
    let mut redis_conn = conn.connection();
    assert!(matches!(redis_conn, AnyConnection::Cluster(_)));
    for i in 0..20 {
        let key = format!("bullmq-rs-cluster-test:{i}");
        let _: () = redis::cmd("SET")
            .arg(&key)
            .arg(i)
            .query_async(&mut redis_conn)
            .await
            .unwrap();
        let value: i64 = redis::cmd("GET")
            .arg(&key)
            .query_async(&mut redis_conn)
            .await
            .unwrap();
        assert_eq!(value, i);
        let _: () = redis::cmd("DEL")
            .arg(&key)
            .query_async(&mut redis_conn)
            .await
            .unwrap();
    }

    // Blocking connections work on the cluster too.
    let blocking = BlockingRedisConnection::new_managed(&conn).await.unwrap();
    let mut dedicated = conn.dedicated_any_connection().await.unwrap();
    let _: () = redis::cmd("PING")
        .query_async(&mut dedicated)
        .await
        .unwrap();
    drop(blocking);
}

#[tokio::test]
async fn test_cluster_idle_worker_picks_up_new_job_quickly() {
    let opts = cluster_or_skip!();
    let name = test_queue_name();
    let queue = cluster_queue(&name, &opts).await;
    let worker = Worker::with_options(
        &name,
        echo_processor(),
        WorkerOptions {
            connection: opts,
            prefix: PREFIX.to_string(),
            autorun: true,
            drain_delay: 30,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Drained) => break,
                Some(WorkerEvent::Error(message)) => panic!("worker error: {message}"),
                Some(_) => {}
                None => panic!("worker event channel closed"),
            }
        }
    })
    .await
    .expect("timed out waiting for the cluster worker to become idle");

    // Keep BZPOPMIN blocked past the regular connection's 10s response timeout,
    // but enqueue well before the 30s drain delay so polling cannot pass.
    tokio::time::sleep(Duration::from_secs(12)).await;

    tokio::time::timeout(Duration::from_secs(3), async {
        let job = queue
            .add("wake-up", serde_json::json!({"hello": "world"}))
            .await
            .unwrap();
        loop {
            match worker.next_event().await {
                Some(WorkerEvent::Completed { job_id, .. }) => {
                    assert_eq!(job_id, job.id());
                    break;
                }
                Some(WorkerEvent::Error(message)) => {
                    panic!("idle cluster worker emitted a spurious error: {message}");
                }
                Some(_) => {}
                None => panic!("worker event channel closed"),
            }
        }
    })
    .await
    .expect("idle cluster worker did not promptly pick up the job via BZPOPMIN");

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
    queue.close().await;
}

#[tokio::test]
async fn test_cluster_idle_queue_emits_no_spurious_error_events() {
    let opts = cluster_or_skip!();
    let name = test_queue_name();
    let queue = cluster_queue(&name, &opts).await;
    let events = QueueEvents::with_options(
        &name,
        QueueEventsOptions {
            connection: opts,
            prefix: PREFIX.to_string(),
            last_event_id: Some("0".to_string()),
            blocking_timeout: 30_000,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // XREAD BLOCK must outlive the regular connection's 10s response timeout
    // without emitting errors, then still deliver events when the queue wakes.
    tokio::time::sleep(Duration::from_secs(12)).await;
    while let Some(entry) = events.try_next_event().await {
        if let QueueEvent::Error { message } = entry.event {
            panic!("idle cluster queue emitted a spurious error event: {message}");
        }
    }

    tokio::time::timeout(Duration::from_secs(3), async {
        let job = queue.add("wake-up", serde_json::json!({})).await.unwrap();
        loop {
            match events.next_event().await {
                Some(entry) => match entry.event {
                    QueueEvent::Added { job_id, .. } => {
                        assert_eq!(job_id, job.id());
                        break;
                    }
                    QueueEvent::Error { message } => {
                        panic!("cluster queue emitted a spurious error event: {message}");
                    }
                    _ => {}
                },
                None => panic!("QueueEvents closed before the added event"),
            }
        }
    })
    .await
    .expect("idle cluster QueueEvents did not promptly deliver the added event");

    events.close().await;
    cleanup_queue(&queue).await;
    queue.close().await;
}

#[tokio::test]
async fn test_cluster_queue_worker_and_events() {
    let opts = cluster_or_skip!();
    let name = test_queue_name();
    let queue = cluster_queue(&name, &opts).await;

    let events = QueueEvents::with_options(
        &name,
        QueueEventsOptions {
            connection: opts.clone(),
            prefix: PREFIX.to_string(),
            last_event_id: Some("0".to_string()),
            blocking_timeout: 1000,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let worker = Worker::with_options(
        &name,
        echo_processor(),
        WorkerOptions {
            connection: opts.clone(),
            prefix: PREFIX.to_string(),
            autorun: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let job = queue
        .add("cluster-job", serde_json::json!({"foo": "bar"}))
        .await
        .unwrap();

    let completed = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            match events.next_event().await {
                Some(entry) => {
                    if let QueueEvent::Completed {
                        job_id,
                        return_value,
                        ..
                    } = entry.event
                    {
                        if job_id == job.id() {
                            return return_value;
                        }
                    }
                }
                None => panic!("QueueEvents closed before the job completed"),
            }
        }
    })
    .await
    .expect("timed out waiting for the completed event");
    let return_value: serde_json::Value = serde_json::from_str(&completed).unwrap();
    assert_eq!(return_value, serde_json::json!({"foo": "bar"}));
    assert_eq!(queue.get_completed_count().await.unwrap(), 1);

    // The worker names its blocking connection on every node, so it is
    // discoverable through CLIENT LIST on the cluster.
    let workers = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let workers = queue.get_workers().await.unwrap();
            if !workers.is_empty() {
                return workers;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timed out waiting for the worker to be listed");
    assert_eq!(workers.len(), 1);

    worker.close(5000).await.unwrap();
    events.close().await;
    cleanup_queue(&queue).await;
    queue.close().await;
}

#[tokio::test]
async fn test_cluster_flow_across_queues() {
    let opts = cluster_or_skip!();
    let parent_name = test_queue_name();
    let child_name = test_queue_name();
    let parent_queue = cluster_queue(&parent_name, &opts).await;
    let child_queue = cluster_queue(&child_name, &opts).await;

    let flow = FlowProducer::with_options(FlowProducerOptions {
        connection: opts.clone(),
        prefix: Some(PREFIX.to_string()),
    })
    .await
    .unwrap();

    let child = |i: u64| FlowJob {
        name: "child".to_string(),
        queue_name: child_name.clone(),
        data: serde_json::json!({ "value": i }),
        opts: None,
        prefix: None,
        children: None,
    };
    let tree = flow
        .add(FlowJob {
            name: "parent".to_string(),
            queue_name: parent_name.clone(),
            data: serde_json::json!({}),
            opts: None,
            prefix: None,
            children: Some(vec![child(1), child(2)]),
        })
        .await
        .unwrap();

    let make_worker = |queue_name: String| {
        let opts = opts.clone();
        async move {
            Worker::with_options(
                &queue_name,
                echo_processor(),
                WorkerOptions {
                    connection: opts,
                    prefix: PREFIX.to_string(),
                    autorun: true,
                    ..Default::default()
                },
            )
            .await
            .unwrap()
        }
    };
    let child_worker = make_worker(child_name.clone()).await;
    let parent_worker = make_worker(parent_name.clone()).await;

    tokio::time::timeout(Duration::from_secs(15), async {
        while parent_queue.get_completed_count().await.unwrap() < 1 {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timed out waiting for the parent job to complete");

    assert_eq!(child_queue.get_completed_count().await.unwrap(), 2);
    let parent = parent_queue
        .get_job(tree.job.id())
        .await
        .unwrap()
        .expect("parent job exists");
    let values = parent.get_children_values().await.unwrap();
    assert_eq!(values.len(), 2);

    child_worker.close(5000).await.unwrap();
    parent_worker.close(5000).await.unwrap();
    flow.close().await;
    cleanup_queue(&child_queue).await;
    cleanup_queue(&parent_queue).await;
    child_queue.close().await;
    parent_queue.close().await;
}
