//! Connection option tests — typed fields and URL building.

mod common;

use bullmq::options::RedisConnectionOptions;
use bullmq::{Queue, QueueOptions};
use common::{cleanup_queue, test_queue_name};

// ═══════════════════════════════════════════════════════════════════════════
// effective_url() — typed connection options build the right URL
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_effective_url_falls_back_to_url() {
    let opts = RedisConnectionOptions {
        url: "redis://example.com:6380".to_string(),
        ..Default::default()
    };
    assert_eq!(opts.effective_url(), "redis://example.com:6380");
}

#[test]
fn test_effective_url_from_host_only() {
    let opts = RedisConnectionOptions {
        host: Some("127.0.0.1".to_string()),
        ..Default::default()
    };
    assert_eq!(opts.effective_url(), "redis://127.0.0.1:6379");
}

#[test]
fn test_effective_url_with_port_and_db() {
    let opts = RedisConnectionOptions {
        host: Some("redis.local".to_string()),
        port: Some(6380),
        db: Some(3),
        ..Default::default()
    };
    assert_eq!(opts.effective_url(), "redis://redis.local:6380/3");
}

#[test]
fn test_effective_url_with_auth() {
    let opts = RedisConnectionOptions {
        host: Some("redis.local".to_string()),
        username: Some("alice".to_string()),
        password: Some("secret".to_string()),
        ..Default::default()
    };
    assert_eq!(opts.effective_url(), "redis://alice:secret@redis.local:6379");
}

#[test]
fn test_effective_url_with_password_only() {
    let opts = RedisConnectionOptions {
        host: Some("redis.local".to_string()),
        password: Some("secret".to_string()),
        ..Default::default()
    };
    assert_eq!(opts.effective_url(), "redis://:secret@redis.local:6379");
}

#[test]
fn test_effective_url_tls_scheme() {
    let opts = RedisConnectionOptions {
        host: Some("secure.redis".to_string()),
        port: Some(6380),
        tls: true,
        ..Default::default()
    };
    assert_eq!(opts.effective_url(), "rediss://secure.redis:6380");
}

// ═══════════════════════════════════════════════════════════════════════════
// End-to-end: connect using typed host/port options
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_connect_via_typed_options() {
    // Parse host/port from REDIS_URL (defaults to localhost:6379).
    let url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let hostport = url.trim_start_matches("redis://");
    let mut parts = hostport.split(':');
    let host = parts.next().unwrap_or("127.0.0.1").to_string();
    let port: u16 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(6379);

    let name = test_queue_name();
    let queue = Queue::new(
        &name,
        QueueOptions {
            connection: RedisConnectionOptions {
                host: Some(host),
                port: Some(port),
                ..Default::default()
            },
            ..Default::default()
        },
    )
    .await
    .expect("connect via typed options failed");

    // Sanity: add a job and read it back.
    let job = queue.add("typed", serde_json::json!({"ok": true}), None).await.unwrap();
    assert!(!job.id().is_empty());
    let fetched = queue.get_job(job.id()).await.unwrap();
    assert!(fetched.is_some());

    cleanup_queue(&queue).await;
}
