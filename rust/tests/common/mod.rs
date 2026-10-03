//! Shared helpers for integration tests.
//!
//! These tests require a running Redis instance at `redis://127.0.0.1:6379`.

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
#[allow(dead_code)]
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

/// Test connection options pinned to a dedicated logical database.
///
/// Tests that drop connections on purpose (see [`kill_connections_in_db`]) must
/// not share a database with the rest of the suite, otherwise they would also
/// kill the connections of unrelated tests running in parallel.
///
/// The configured URL is parsed and only its database component (the path) is
/// replaced, so any existing database, credentials, TLS scheme and query
/// parameters are preserved.
#[allow(dead_code)]
pub fn isolated_connection(db: u8) -> RedisConnectionOptions {
    let mut opts = test_connection();
    opts.url = with_database(&opts.url, db);
    opts
}

/// Return `url` with its database replaced by `db`.
fn with_database(url: &str, db: u8) -> String {
    let mut parsed = url::Url::parse(url).expect("REDIS_URL must be a valid URL");
    parsed.set_path(&format!("/{db}"));
    parsed.into()
}

#[cfg(test)]
mod tests {
    use super::with_database;

    #[test]
    fn with_database_handles_supported_url_forms() {
        assert_eq!(
            with_database("redis://127.0.0.1:6379", 14),
            "redis://127.0.0.1:6379/14"
        );
        assert_eq!(
            with_database("redis://127.0.0.1:6379/", 14),
            "redis://127.0.0.1:6379/14"
        );
        assert_eq!(
            with_database("redis://host:6379/0", 14),
            "redis://host:6379/14"
        );
        assert_eq!(
            with_database(
                "rediss://user:pa%40ss@host:6380/3?protocol=resp3&timeout=5",
                14
            ),
            "rediss://user:pa%40ss@host:6380/14?protocol=resp3&timeout=5"
        );
        assert_eq!(
            with_database("redis://host:6379?protocol=resp3", 14),
            "redis://host:6379/14?protocol=resp3"
        );
    }
}

/// Kill every client connection that selected logical database `db`, as a
/// Redis restart or network blip would, and return how many were killed.
///
/// `CLIENT KILL TYPE normal` is server-wide, so it is deliberately not used:
/// it would also drop the connections of every other test running in parallel
/// against the same server. The killer itself connects to the default database
/// and is therefore never killed.
#[allow(dead_code)]
pub async fn kill_connections_in_db(db: u8) -> i64 {
    let client = redis::Client::open(test_connection().effective_url()).unwrap();
    let mut killer = client.get_multiplexed_async_connection().await.unwrap();
    let list: String = redis::cmd("CLIENT")
        .arg("LIST")
        .query_async(&mut killer)
        .await
        .unwrap();

    let db_field = format!("db={db}");
    let mut killed = 0;
    for line in list.lines() {
        let mut fields = line.split_whitespace();
        let id = fields.clone().find_map(|f| f.strip_prefix("id="));
        let in_db = fields.any(|f| f == db_field);
        let (Some(id), true) = (id, in_db) else {
            continue;
        };
        // The connection may already be gone; ignore a failed kill.
        let n: i64 = redis::cmd("CLIENT")
            .arg("KILL")
            .arg("ID")
            .arg(id)
            .query_async(&mut killer)
            .await
            .unwrap_or(0);
        killed += n;
    }
    killed
}
