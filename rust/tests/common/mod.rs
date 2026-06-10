//! Shared helpers for integration tests.
//!
//! These tests require a running Redis instance at `redis://127.0.0.1:6379`.
#![allow(dead_code)]

use bullmq::options::RedisConnectionOptions;
use bullmq::Queue;
use uuid::Uuid;

/// Generate a unique queue name for test isolation.
pub fn test_queue_name() -> String {
    format!(
        "test-{}",
        Uuid::new_v4().to_string().split('-').next().unwrap()
    )
}

/// Default test connection options.
pub fn test_connection() -> RedisConnectionOptions {
    RedisConnectionOptions {
        url: std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string()),
        max_connections: 4,
        ..Default::default()
    }
}

/// Clean up a queue after testing.
pub async fn cleanup_queue(queue: &Queue) {
    let _ = queue.obliterate(true, 1000).await;
}
