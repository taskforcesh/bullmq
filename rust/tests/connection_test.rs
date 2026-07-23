//! Connection option tests — typed fields and URL building.

mod common;

use bullmq::options::{RedisConnectionOptions, TlsCerts};
use bullmq::{Queue, QueueOptions};
use common::{cleanup_queue, test_queue_name};
use redis::{ConnectionAddr, IntoConnectionInfo};

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
    assert_eq!(
        opts.effective_url(),
        "redis://alice:secret@redis.local:6379"
    );
}

#[test]
fn test_effective_url_with_auth_percent_encoding() {
    let opts = RedisConnectionOptions {
        host: Some("redis.local".to_string()),
        username: Some("alice@example.com".to_string()),
        password: Some("p@ss:w/rd".to_string()),
        ..Default::default()
    };
    assert_eq!(
        opts.effective_url(),
        "redis://alice%40example.com:p%40ss%3Aw%2Frd@redis.local:6379"
    );
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

#[test]
fn test_effective_url_ipv6_host_bracketing() {
    let opts = RedisConnectionOptions {
        host: Some("2001:db8::1".to_string()),
        port: Some(6380),
        ..Default::default()
    };
    assert_eq!(opts.effective_url(), "redis://[2001:db8::1]:6380");
}

#[test]
fn test_effective_url_keeps_bracketed_ipv6_host() {
    let opts = RedisConnectionOptions {
        host: Some("[2001:db8::1]".to_string()),
        ..Default::default()
    };
    assert_eq!(opts.effective_url(), "redis://[2001:db8::1]:6379");
}

#[test]
fn test_debug_redacts_url_credentials() {
    let opts = RedisConnectionOptions {
        url: "redis://alice:secret@redis.local:6379/3".to_string(),
        ..Default::default()
    };

    let debug = format!("{opts:?}");
    assert!(debug.contains("redis://***@redis.local:6379/3"));
    assert!(!debug.contains("alice"));
    assert!(!debug.contains("secret"));
}

#[test]
fn test_debug_redacts_typed_credentials() {
    let opts = RedisConnectionOptions {
        host: Some("redis.local".to_string()),
        username: Some("alice".to_string()),
        password: Some("secret".to_string()),
        ..Default::default()
    };

    let debug = format!("{opts:?}");
    assert!(debug.contains("username: Some(\"***\")"));
    assert!(debug.contains("password: Some(\"***\")"));
    assert!(!debug.contains("alice"));
    assert!(!debug.contains("secret"));
}

#[test]
fn test_effective_url_tls_certs_imply_rediss_scheme() {
    let opts = RedisConnectionOptions {
        host: Some("secure.redis".to_string()),
        port: Some(6380),
        tls_certs: Some(TlsCerts {
            root_cert: Some(b"-----BEGIN CERTIFICATE-----".to_vec()),
            ..Default::default()
        }),
        ..Default::default()
    };
    assert_eq!(opts.effective_url(), "rediss://secure.redis:6380");
}

#[test]
fn test_debug_redacts_tls_certs() {
    let opts = RedisConnectionOptions {
        host: Some("secure.redis".to_string()),
        tls_certs: Some(TlsCerts {
            root_cert: Some(b"root-ca-pem".to_vec()),
            client_cert: Some(b"client-cert-pem".to_vec()),
            client_key: Some(b"client-key-pem".to_vec()),
        }),
        ..Default::default()
    };

    let debug = format!("{opts:?}");
    assert!(debug.contains("root_cert: Some(\"***\")"));
    assert!(debug.contains("client_cert: Some(\"***\")"));
    assert!(debug.contains("client_key: Some(\"***\")"));
    assert!(!debug.contains("root-ca-pem"));
    assert!(!debug.contains("client-cert-pem"));
    assert!(!debug.contains("client-key-pem"));
}

#[tokio::test]
async fn test_connect_via_typed_options() {
    // Parse REDIS_URL using redis-rs itself so common forms work:
    // rediss://, credentials, db paths, and IPv6 literals.
    let url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let conn_info = url
        .as_str()
        .into_connection_info()
        .expect("REDIS_URL must be a valid redis:// or rediss:// URL");

    let (host, port, tls) = match conn_info.addr {
        ConnectionAddr::Tcp(host, port) => (host, port, false),
        ConnectionAddr::TcpTls { host, port, .. } => (host, port, true),
        ConnectionAddr::Unix(_) => {
            panic!(
                "test_connect_via_typed_options only supports TCP/TLS REDIS_URL, not unix sockets"
            )
        }
    };

    let db = u8::try_from(conn_info.redis.db).ok();
    let username = conn_info.redis.username;
    let password = conn_info.redis.password;

    let name = test_queue_name();
    let queue = Queue::with_options(
        &name,
        QueueOptions {
            connection: RedisConnectionOptions {
                host: Some(host),
                port: Some(port),
                username,
                password,
                db,
                tls,
                ..Default::default()
            },
            ..Default::default()
        },
    )
    .await
    .expect("connect via typed options failed");

    // Sanity: add a job and read it back.
    let job = queue
        .add("typed", serde_json::json!({"ok": true}))
        .await
        .unwrap();
    assert!(!job.id().is_empty());
    let fetched = queue.get_job(job.id()).await.unwrap();
    assert!(fetched.is_some());

    cleanup_queue(&queue).await;
}
