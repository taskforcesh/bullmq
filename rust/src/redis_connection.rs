use redis::aio::MultiplexedConnection;
use redis::Client;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::debug;

use crate::error::Error;
use crate::options::RedisConnectionOptions;
use crate::scripts::ScriptRegistry;

/// A managed Redis connection that handles reconnection and script loading.
///
/// This is designed to be cheaply cloneable (Arc-wrapped internals).
/// `MultiplexedConnection` is internally multiplexed via channels,
/// so clones can be used concurrently without a mutex.
#[derive(Clone)]
pub struct RedisConnection {
    inner: Arc<Inner>,
}

struct Inner {
    client: Client,
    conn: MultiplexedConnection,
    scripts: ScriptRegistry,
}

impl RedisConnection {
    /// Create a new connection from options.
    pub async fn new(opts: &RedisConnectionOptions) -> Result<Self, Error> {
        let client = Client::open(opts.url.as_str())?;
        let conn = client.get_multiplexed_async_connection().await?;

        let scripts = ScriptRegistry::new();

        let inner = Arc::new(Inner {
            client,
            conn,
            scripts,
        });

        debug!(url = %opts.url, "redis connection established");

        Ok(Self { inner })
    }

    /// Get a clone of the multiplexed connection for concurrent use.
    pub fn conn(&self) -> MultiplexedConnection {
        self.inner.conn.clone()
    }

    /// Get the script registry.
    pub fn scripts(&self) -> &ScriptRegistry {
        &self.inner.scripts
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
    pub async fn dedicated_connection(&self) -> Result<MultiplexedConnection, Error> {
        Ok(self.inner.client.get_multiplexed_async_connection().await?)
    }

    /// Ping the server to verify connectivity.
    pub async fn ping(&self) -> Result<(), Error> {
        let mut conn = self.inner.conn.clone();
        redis::cmd("PING").query_async::<()>(&mut conn).await?;
        Ok(())
    }

    /// Close the connection.
    pub async fn close(&self) {
        // MultiplexedConnection doesn't have an explicit close, it drops when all refs are gone.
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
    conn: Mutex<MultiplexedConnection>,
}

impl BlockingRedisConnection {
    /// Create a new blocking connection from a client.
    pub async fn new(client: &Client) -> Result<Self, Error> {
        let conn = client.get_multiplexed_async_connection().await?;
        Ok(Self {
            inner: Arc::new(BlockingInner {
                conn: Mutex::new(conn),
            }),
        })
    }

    /// Get a mutable reference to the connection.
    pub async fn conn(&self) -> tokio::sync::MutexGuard<'_, MultiplexedConnection> {
        self.inner.conn.lock().await
    }

    /// Execute a blocking BZPOPMIN command.
    pub async fn bzpopmin(
        &self,
        key: &str,
        timeout_secs: f64,
    ) -> Result<Option<(String, String, f64)>, Error> {
        let mut conn = self.inner.conn.lock().await;
        let result: Option<(String, String, f64)> = redis::cmd("BZPOPMIN")
            .arg(key)
            .arg(timeout_secs)
            .query_async(&mut *conn)
            .await?;
        Ok(result)
    }
}
