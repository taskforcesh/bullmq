use redis::aio::{ConnectionManager, ConnectionManagerConfig};
use redis::{Client, ClientTlsConfig, TlsCertificates};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, warn};

use crate::error::Error;
use crate::options::{redact_url_userinfo, RedisConnectionOptions};
use crate::scripts::ScriptRegistry;

/// The connection type used throughout the crate.
///
/// [`ConnectionManager`] wraps a multiplexed connection and transparently
/// re-establishes it after the socket dies (network blip, Redis restart,
/// failover). The command in flight when the socket dropped still fails, but
/// the reconnection happens in the background and later commands succeed
/// again — which is what keeps a long-running `Worker` alive across Redis
/// restarts instead of silently wedging forever.
pub type Conn = ConnectionManager;

/// Build a Redis [`Client`] from connection options.
///
/// When [`RedisConnectionOptions::tls_certs`] is set, the client is built with
/// the supplied TLS certificates (custom root CA and/or client certificate for
/// mTLS); otherwise the client is opened directly from the URL scheme.
fn build_client(opts: &RedisConnectionOptions, url: &str) -> Result<Client, Error> {
    let Some(certs) = &opts.tls_certs else {
        return Ok(Client::open(url)?);
    };

    let client_tls = match (&certs.client_cert, &certs.client_key) {
        (Some(client_cert), Some(client_key)) => Some(ClientTlsConfig {
            client_cert: client_cert.clone(),
            client_key: client_key.clone(),
        }),
        (None, None) => None,
        _ => {
            return Err(Error::InvalidConfig(
                "tls_certs requires both client_cert and client_key for mutual TLS (mTLS)"
                    .to_string(),
            ))
        }
    };

    let tls_certs = TlsCertificates {
        client_tls,
        root_cert: certs.root_cert.clone(),
    };

    Ok(Client::build_with_tls(url, tls_certs)?)
}

/// Build the reconnection/backoff configuration shared by every connection.
///
/// `response_timeout` is passed explicitly because blocking connections
/// (`BZPOPMIN`, `XREAD`) must run without one — see
/// [`BlockingRedisConnection::new`].
fn manager_config(
    opts: &RedisConnectionOptions,
    response_timeout: Option<std::time::Duration>,
) -> ConnectionManagerConfig {
    let reconnect = &opts.reconnect;
    ConnectionManagerConfig::new()
        .set_number_of_retries(reconnect.max_retries)
        .set_min_delay(reconnect.min_delay)
        .set_max_delay(reconnect.max_delay)
        .set_connection_timeout(reconnect.connection_timeout)
        .set_response_timeout(response_timeout)
}

/// A managed Redis connection that handles reconnection and script execution.
///
/// This is designed to be cheaply cloneable (Arc-wrapped internals).
/// The underlying [`ConnectionManager`] is internally multiplexed via channels,
/// so clones can be used concurrently without a mutex, and it reconnects on its
/// own when the socket dies.
#[derive(Clone)]
pub struct RedisConnection {
    inner: Arc<Inner>,
}

struct Inner {
    client: Client,
    opts: RedisConnectionOptions,
    conn: Conn,
    scripts: ScriptRegistry,
}

impl RedisConnection {
    /// Create a new connection from options.
    pub async fn new(opts: &RedisConnectionOptions) -> Result<Self, Error> {
        let url = opts.effective_url();
        let client = build_client(opts, &url)?;
        let scripts = ScriptRegistry::new();
        let config = manager_config(opts, opts.reconnect.response_timeout);
        let conn = ConnectionManager::new_with_config(client.clone(), config).await?;

        let inner = Arc::new(Inner {
            client,
            opts: opts.clone(),
            conn,
            scripts,
        });

        let redacted_url = redact_url_userinfo(&url);
        debug!(url = %redacted_url, "redis connection established");

        Ok(Self { inner })
    }

    /// Get a clone of the managed connection for concurrent use.
    pub fn conn(&self) -> Conn {
        self.inner.conn.clone()
    }

    /// Get the script registry.
    pub(crate) fn scripts(&self) -> &ScriptRegistry {
        &self.inner.scripts
    }

    /// The options this connection was created with.
    pub fn options(&self) -> &RedisConnectionOptions {
        &self.inner.opts
    }

    /// Execute a Redis command directly.
    pub async fn cmd<T: redis::FromRedisValue>(&self, cmd: &mut redis::Cmd) -> Result<T, Error> {
        let mut conn = self.inner.conn.clone();
        Ok(cmd.query_async(&mut conn).await?)
    }

    /// Execute a pipeline.
    pub async fn pipe<T: redis::FromRedisValue>(&self, pipe: &redis::Pipeline) -> Result<T, Error> {
        let mut conn = self.inner.conn.clone();
        Ok(pipe.query_async(&mut conn).await?)
    }

    /// Get the underlying client for creating additional connections.
    pub fn client(&self) -> &Client {
        &self.inner.client
    }

    /// Create a new dedicated connection (e.g., for blocking operations).
    ///
    /// Like the shared connection it reconnects automatically. The response
    /// timeout is disabled because callers use it for commands that block
    /// server-side (`XREAD BLOCK`).
    pub async fn dedicated_connection(&self) -> Result<Conn, Error> {
        let config = manager_config(&self.inner.opts, None);
        Ok(ConnectionManager::new_with_config(self.inner.client.clone(), config).await?)
    }

    /// Ping the server to verify connectivity.
    pub async fn ping(&self) -> Result<(), Error> {
        let mut conn = self.inner.conn.clone();
        redis::cmd("PING").query_async::<()>(&mut conn).await?;
        Ok(())
    }

    /// Close the connection.
    pub async fn close(&self) {
        // ConnectionManager doesn't have an explicit close, it drops when all refs are gone.
        debug!("redis connection marked for close");
    }
}

/// A blocking Redis connection used by workers to wait for jobs.
///
/// Uses a separate connection so that blocking calls (BZPOPMIN)
/// don't interfere with normal commands.
#[derive(Clone)]
pub struct BlockingRedisConnection {
    inner: Arc<BlockingInner>,
}

struct BlockingInner {
    client: Client,
    opts: RedisConnectionOptions,
    conn: Mutex<Conn>,
}

/// Grace period added on top of a blocking command's own timeout before the
/// connection is considered stuck. Mirrors the TypeScript worker's
/// `blockTimeout + 1s` watchdog.
const BLOCK_WATCHDOG_GRACE: std::time::Duration = std::time::Duration::from_secs(1);

impl BlockingRedisConnection {
    /// Create a new blocking connection from a [`RedisConnection`].
    ///
    /// The connection is a [`ConnectionManager`], so it re-establishes itself
    /// in the background when the socket dies (Redis restart, failover). A
    /// blocking read that was in flight at that moment returns an error; the
    /// worker's driver loop retries and the retry lands on the reconnected
    /// socket, which is what allows a worker to resume fetching jobs without a
    /// process restart.
    ///
    /// The connection is created with its response timeout **disabled**.
    /// redis-rs applies a default response timeout to every multiplexed
    /// connection. This connection is dedicated to blocking reads (`BZPOPMIN`
    /// on the marker key) that must wait up to `drain_delay` seconds for a job
    /// to appear. With the default timeout, the client abandons the in-flight
    /// `BZPOPMIN` after 500ms — long before a marker is written for an idle
    /// worker. When the marker eventually arrives, the server-side `BZPOPMIN`
    /// pops it and replies, but the client has already discarded that request
    /// slot, so the marker is silently consumed without waking the worker. The
    /// worker then only picks up the job on its periodic empty-queue re-poll,
    /// yielding 0–`drain_delay`s pickup latency (see issue #4512). Disabling
    /// the response timeout lets the command block for its full duration so the
    /// reply is always delivered to a live waiter. This mirrors the TypeScript
    /// worker, whose stuck-connection watchdog fires at `blockTimeout + 1s`,
    /// deliberately longer than the block rather than shorter.
    pub async fn new(conn: &RedisConnection) -> Result<Self, Error> {
        let opts = conn.options().clone();
        let client = conn.client().clone();
        let config = manager_config(&opts, None);
        let conn = ConnectionManager::new_with_config(client.clone(), config).await?;
        Ok(Self {
            inner: Arc::new(BlockingInner {
                client,
                opts,
                conn: Mutex::new(conn),
            }),
        })
    }

    /// Get a mutable reference to the connection.
    pub async fn conn(&self) -> tokio::sync::MutexGuard<'_, Conn> {
        self.inner.conn.lock().await
    }

    /// Execute a blocking BZPOPMIN command.
    ///
    /// Guarded by a watchdog: the response timeout is disabled on this
    /// connection, so a half-open socket (a network blip that never delivers a
    /// FIN/RST) would otherwise leave the read hanging forever and the worker
    /// would silently stop fetching jobs. If the reply does not arrive within
    /// the command's own timeout plus [`BLOCK_WATCHDOG_GRACE`], the connection
    /// is treated as stuck and rebuilt, and an error is returned so the caller
    /// retries on the fresh connection.
    pub async fn bzpopmin(
        &self,
        key: &str,
        timeout_secs: f64,
    ) -> Result<Option<(String, String, f64)>, Error> {
        let mut conn = self.inner.conn.lock().await;
        let watchdog = std::time::Duration::from_secs_f64(timeout_secs.max(0.0))
            .saturating_add(BLOCK_WATCHDOG_GRACE);

        let mut cmd = redis::cmd("BZPOPMIN");
        cmd.arg(key).arg(timeout_secs);
        let command = cmd.query_async::<Option<(String, String, f64)>>(&mut *conn);

        match tokio::time::timeout(watchdog, command).await {
            Ok(result) => Ok(result?),
            Err(_) => {
                warn!(
                    timeout_secs,
                    "blocking read exceeded its watchdog, rebuilding connection"
                );
                // Drop the stuck manager and build a new one. `ConnectionManager`
                // only reconnects on errors it observes, and a half-open socket
                // never surfaces one.
                let config = manager_config(&self.inner.opts, None);
                *conn =
                    ConnectionManager::new_with_config(self.inner.client.clone(), config).await?;
                Err(Error::Redis(redis::RedisError::from((
                    redis::ErrorKind::Io,
                    "blocking read timed out, connection rebuilt",
                ))))
            }
        }
    }

    /// Set the Redis client connection name (`CLIENT SETNAME`).
    ///
    /// Used by workers so that `Queue::get_workers` can discover them via
    /// `CLIENT LIST`. Best-effort: some managed providers (e.g. GCP) reject this
    /// command, so callers typically ignore the error.
    pub async fn set_name(&self, name: &str) -> Result<(), Error> {
        let mut conn = self.inner.conn.lock().await;
        redis::cmd("CLIENT")
            .arg("SETNAME")
            .arg(name)
            .query_async::<()>(&mut *conn)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::build_client;
    use crate::error::Error;
    use crate::options::{redact_url_userinfo, RedisConnectionOptions, TlsCerts};

    fn opts_with_certs(certs: TlsCerts) -> RedisConnectionOptions {
        RedisConnectionOptions {
            tls_certs: Some(certs),
            ..Default::default()
        }
    }

    #[test]
    fn build_client_without_tls_certs_succeeds() {
        let opts = RedisConnectionOptions::default();
        assert!(build_client(&opts, "redis://127.0.0.1:6379").is_ok());
    }

    #[test]
    fn build_client_with_root_cert_only_succeeds() {
        let opts = opts_with_certs(TlsCerts {
            root_cert: Some(b"cert".to_vec()),
            ..Default::default()
        });
        assert!(build_client(&opts, "rediss://127.0.0.1:6379").is_ok());
    }

    #[test]
    fn build_client_with_client_cert_without_key_errors() {
        let opts = opts_with_certs(TlsCerts {
            client_cert: Some(b"cert".to_vec()),
            client_key: None,
            ..Default::default()
        });
        assert!(matches!(
            build_client(&opts, "rediss://127.0.0.1:6379"),
            Err(Error::InvalidConfig(_))
        ));
    }

    #[test]
    fn build_client_with_client_key_without_cert_errors() {
        let opts = opts_with_certs(TlsCerts {
            client_cert: None,
            client_key: Some(b"key".to_vec()),
            ..Default::default()
        });
        assert!(matches!(
            build_client(&opts, "rediss://127.0.0.1:6379"),
            Err(Error::InvalidConfig(_))
        ));
    }

    #[test]
    fn redacts_username_password() {
        let input = "redis://user:pass@localhost:6379/0";
        assert_eq!(redact_url_userinfo(input), "redis://***@localhost:6379/0");
    }

    #[test]
    fn redacts_password_only_and_keeps_ipv6_host() {
        let input = "rediss://:p%40ss@[::1]:6380/2";
        assert_eq!(redact_url_userinfo(input), "rediss://***@[::1]:6380/2");
    }

    #[test]
    fn keeps_url_without_userinfo() {
        let input = "redis://localhost:6379/0";
        assert_eq!(redact_url_userinfo(input), input);
    }
}
