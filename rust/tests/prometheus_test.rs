//! Prometheus metrics export tests — `Queue::export_prometheus_metrics`.
//!
//! Mirrors Node.js `tests/getters.test.ts` `#exportPrometheusMetrics`.
//! Requires a running Redis instance at `redis://127.0.0.1:6379`.

mod common;

use bullmq::worker::{CancellationToken, ProcessorFn};
use bullmq::{Job, JobOptions, Queue, QueueOptions, Worker, WorkerOptions};
use common::{cleanup_queue, test_connection, test_queue_name};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

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

#[tokio::test]
async fn test_exports_job_states_in_gauge_format() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    // 3 waiting, 1 delayed.
    for _ in 0..3 {
        queue.add("w", serde_json::json!({}), None).await.unwrap();
    }
    queue
        .add(
            "d",
            serde_json::json!({}),
            Some(JobOptions {
                delay: Some(60_000),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

    let metrics = queue.export_prometheus_metrics(&[]).await.unwrap();

    assert!(metrics.contains("# HELP bullmq_job_count Number of jobs in the queue by state"));
    assert!(metrics.contains("# TYPE bullmq_job_count gauge"));
    assert!(metrics.contains(&format!(
        "bullmq_job_count{{queue=\"{name}\", state=\"waiting\"}} 3"
    )));
    assert!(metrics.contains(&format!(
        "bullmq_job_count{{queue=\"{name}\", state=\"delayed\"}} 1"
    )));
    // Counters from the time-series metrics are always present.
    assert!(metrics.contains("# TYPE bullmq_job_completed_total counter"));
    assert!(metrics.contains("# TYPE bullmq_job_failed_total counter"));

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_exports_with_global_labels() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    queue.add("w", serde_json::json!({}), None).await.unwrap();

    let metrics = queue
        .export_prometheus_metrics(&[("env", "Production"), ("server", "1")])
        .await
        .unwrap();

    assert!(metrics.contains(&format!(
        "bullmq_job_count{{queue=\"{name}\", state=\"waiting\", env=\"Production\", server=\"1\"}} 1"
    )));
    assert!(metrics.contains(&format!(
        "bullmq_job_completed_total{{queue=\"{name}\", env=\"Production\", server=\"1\"}} 0"
    )));

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_exports_all_states_present() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    let metrics = queue.export_prometheus_metrics(&[]).await.unwrap();
    for state in [
        "active",
        "completed",
        "delayed",
        "failed",
        "paused",
        "prioritized",
        "waiting",
        "waiting-children",
    ] {
        assert!(
            metrics.contains(&format!("state=\"{state}\"")),
            "missing state {state}"
        );
    }

    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_completed_and_failed_totals_reflect_metrics() {
    let name = test_queue_name();
    let conn = test_connection();
    let queue = new_queue(&name).await;

    // 2 completed, 1 failed.
    for _ in 0..2 {
        queue.add("ok", serde_json::json!({}), None).await.unwrap();
    }
    queue.add("bad", serde_json::json!({}), None).await.unwrap();

    let done = Arc::new(AtomicU32::new(0));
    let done_proc = done.clone();
    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let done = done_proc.clone();
        Box::pin(async move {
            done.fetch_add(1, Ordering::SeqCst);
            if job.name() == "bad" {
                Err(bullmq::Error::ProcessingError("fail".to_string()))
            } else {
                Ok(serde_json::Value::Null)
            }
        })
    });
    // metrics option enables the time-series counters that back the totals.
    let worker = Worker::new(
        &name,
        processor,
        WorkerOptions {
            connection: conn,
            autorun: true,
            metrics: Some(bullmq::MetricsOptions::default()),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if done.load(Ordering::SeqCst) >= 3 {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("timed out processing");
    tokio::time::sleep(Duration::from_millis(150)).await;

    let metrics = queue.export_prometheus_metrics(&[]).await.unwrap();
    assert!(metrics.contains(&format!("bullmq_job_completed_total{{queue=\"{name}\"}} 2")));
    assert!(metrics.contains(&format!("bullmq_job_failed_total{{queue=\"{name}\"}} 1")));

    worker.close(5000).await.unwrap();
    cleanup_queue(&queue).await;
}

#[tokio::test]
async fn test_label_values_are_escaped() {
    let name = test_queue_name();
    let queue = new_queue(&name).await;

    queue.add("w", serde_json::json!({}), None).await.unwrap();

    // A label value containing a quote, backslash and newline must be escaped.
    let metrics = queue
        .export_prometheus_metrics(&[("note", "a\"b\\c\nd")])
        .await
        .unwrap();

    assert!(
        metrics.contains("note=\"a\\\"b\\\\c\\nd\""),
        "label value was not escaped: {metrics}"
    );

    cleanup_queue(&queue).await;
}
