use redis::aio::{
    ConnectionLike, ConnectionManager, ConnectionManagerConfig, MultiplexedConnection,
};
use redis::cluster::ClusterClient;
use redis::cluster_async::ClusterConnection;
use redis::cluster_routing::{RoutingInfo, SingleNodeRoutingInfo};
use redis::{
    AsyncConnectionConfig, Client, ClientTlsConfig, RedisFuture, TlsCertificates, TlsMode, Value,
};
use std::collections::BTreeSet;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, warn};

use crate::error::Error;
use crate::options::{redact_url_userinfo, ReconnectOptions, RedisConnectionOptions};
use crate::scripts::ScriptRegistry;

/// The multiplexed connection type returned by the legacy connection APIs.
pub type Conn = MultiplexedConnection;

/// A multiplexed connection that transparently re-establishes itself after
/// the socket dies.
pub type ManagedConn = ConnectionManager;

/// A Redis connection that works with both a standalone server and a Redis
/// Cluster.
///
/// Implements [`redis::aio::ConnectionLike`], so it can be used anywhere a
/// redis-rs async connection is expected (`query_async`, `AsyncCommands`, ...).
/// Cheap to clone; clones share the same underlying connection(s).
#[derive(Clone)]
pub enum AnyConnection {
    /// Auto-reconnecting connection to a standalone Redis server.
    Single(ConnectionManager),
    /// Connection to a Redis Cluster. Commands are routed to the node owning
    /// the slot of their (first) key, and the topology is refreshed on
    /// `MOVED`/`ASK` redirects and reconnects.
    Cluster(ClusterConnection),
}

impl ConnectionLike for AnyConnection {
    fn req_packed_command<'a>(&'a mut self, cmd: &'a redis::Cmd) -> RedisFuture<'a, Value> {
        match self {
            Self::Single(conn) => conn.req_packed_command(cmd),
            Self::Cluster(conn) => conn.req_packed_command(cmd),
        }
    }

    fn req_packed_commands<'a>(
        &'a mut self,
        pipeline: &'a redis::Pipeline,
        offset: usize,
        count: usize,
    ) -> RedisFuture<'a, Vec<Value>> {
        match self {
            Self::Single(conn) => conn.req_packed_commands(pipeline, offset, count),
            Self::Cluster(conn) => conn.req_packed_commands(pipeline, offset, count),
        }
    }

    fn get_db(&self) -> i64 {
        match self {
            Self::Single(conn) => conn.get_db(),
            Self::Cluster(conn) => conn.get_db(),
        }
    }
}

/// Convert [`TlsCerts`](crate::options::TlsCerts) into redis-rs certificates.
fn tls_certificates(opts: &RedisConnectionOptions) -> Result<Option<TlsCertificates>, Error> {
    let Some(certs) = &opts.tls_certs else {
        return Ok(None);
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

    Ok(Some(TlsCertificates {
        client_tls,
        root_cert: certs.root_cert.clone(),
    }))
}

/// Build a Redis [`Client`] from connection options.
///
/// When [`RedisConnectionOptions::tls_certs`] is set, the client is built with
/// the supplied TLS certificates (custom root CA and/or client certificate for
/// mTLS); otherwise the client is opened directly from the URL scheme.
fn build_client(opts: &RedisConnectionOptions, url: &str) -> Result<Client, Error> {
    match tls_certificates(opts)? {
        Some(tls_certs) => Ok(Client::build_with_tls(url, tls_certs)?),
        None => Ok(Client::open(url)?),
    }
}

/// Build a [`ClusterClient`] from the seed nodes in
/// [`RedisConnectionOptions::cluster_nodes`].
///
/// `response_timeout` is `None` for clients backing blocking connections
/// (`BZPOPMIN`, `XREAD`), see [`BlockingRedisConnection::new`].
fn build_cluster_client(
    opts: &RedisConnectionOptions,
    response_timeout: Option<std::time::Duration>,
) -> Result<ClusterClient, Error> {
    let reconnect = ReconnectOptions::default();
    let mut builder = ClusterClient::builder(opts.cluster_nodes.iter().map(String::as_str))
        .retries(reconnect.max_retries as u32);
    if let Some(connection_timeout) = reconnect.connection_timeout {
        builder = builder.connection_timeout(connection_timeout);
    }
    if let Some(response_timeout) = response_timeout {
        builder = builder.response_timeout(response_timeout);
    }
    if let Some(username) = &opts.username {
        builder = builder.username(username);
    }
    if let Some(password) = &opts.password {
        builder = builder.password(password);
    }
    if opts.tls {
        builder = builder.tls(TlsMode::Secure);
    }
    if let Some(certs) = tls_certificates(opts)? {
        builder = builder.certs(certs);
    }
    Ok(builder.build()?)
}

/// Factory for the dedicated connections used by blocking commands.
#[derive(Clone)]
#[allow(clippy::large_enum_variant)]
enum BlockingConnector {
    Single(Client),
    /// Cluster client built without a response timeout.
    Cluster(ClusterClient),
}

impl BlockingConnector {
    async fn connect(&self) -> Result<AnyConnection, Error> {
        match self {
            Self::Single(client) => {
                let config = manager_config(None);
                Ok(AnyConnection::Single(
                    ConnectionManager::new_with_config(client.clone(), config).await?,
                ))
            }
            Self::Cluster(client) => {
                Ok(AnyConnection::Cluster(client.get_async_connection().await?))
            }
        }
    }
}

/// Build the reconnection/backoff configuration shared by every connection.
///
/// `response_timeout` is passed explicitly because blocking connections
/// (`BZPOPMIN`, `XREAD`) must run without one — see
/// [`BlockingRedisConnection::new`].
fn manager_config(response_timeout: Option<std::time::Duration>) -> ConnectionManagerConfig {
    let reconnect = ReconnectOptions::default();
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
    /// Standalone client; `None` in cluster mode.
    client: Option<Client>,
    /// Factory for dedicated connections without a response timeout.
    blocking: BlockingConnector,
    opts: RedisConnectionOptions,
    /// Legacy multiplexed socket backing [`RedisConnection::conn`]. Opened by
    /// [`RedisConnection::new`]; absent for
    /// [`RedisConnection::new_managed_only`] and in cluster mode.
    legacy_conn: Option<MultiplexedConnection>,
    connection: AnyConnection,
    scripts: ScriptRegistry,
}

const CLUSTER_UNSUPPORTED: &str =
    "not available on a Redis Cluster connection; use RedisConnection::connection instead";

impl RedisConnection {
    /// Create a new connection from options.
    ///
    /// Besides the auto-reconnecting managed connection, this also opens the
    /// legacy multiplexed socket returned by [`conn`](Self::conn), so existing
    /// callers of `conn()` keep working. Use
    /// [`new_managed_only`](Self::new_managed_only) to skip that second socket.
    ///
    /// When [`RedisConnectionOptions::cluster_nodes`] is set, a Redis Cluster
    /// connection is opened instead and no legacy socket is created.
    pub async fn new(opts: &RedisConnectionOptions) -> Result<Self, Error> {
        Self::connect(opts, true).await
    }

    /// Create a new connection that only opens the auto-reconnecting managed
    /// connection, without the extra legacy socket.
    ///
    /// [`conn`](Self::conn) panics on such a connection; use
    /// [`try_conn`](Self::try_conn) to check, or [`managed_conn`](Self::managed_conn).
    pub async fn new_managed_only(opts: &RedisConnectionOptions) -> Result<Self, Error> {
        Self::connect(opts, false).await
    }

    async fn connect(opts: &RedisConnectionOptions, with_legacy: bool) -> Result<Self, Error> {
        if opts.is_cluster() {
            return Self::connect_cluster(opts).await;
        }

        let url = opts.effective_url();
        let client = build_client(opts, &url)?;
        let scripts = ScriptRegistry::new();
        let config = manager_config(ReconnectOptions::default().response_timeout);
        let managed_conn = ConnectionManager::new_with_config(client.clone(), config).await?;
        let legacy_conn = if with_legacy {
            Some(client.get_multiplexed_async_connection().await?)
        } else {
            None
        };

        let inner = Arc::new(Inner {
            client: Some(client.clone()),
            blocking: BlockingConnector::Single(client),
            opts: opts.clone(),
            legacy_conn,
            connection: AnyConnection::Single(managed_conn),
            scripts,
        });

        let redacted_url = redact_url_userinfo(&url);
        debug!(url = %redacted_url, "redis connection established");

        Ok(Self { inner })
    }

    async fn connect_cluster(opts: &RedisConnectionOptions) -> Result<Self, Error> {
        let client = build_cluster_client(opts, ReconnectOptions::default().response_timeout)?;
        let blocking_client = build_cluster_client(opts, None)?;
        let connection = client.get_async_connection().await?;

        let inner = Arc::new(Inner {
            client: None,
            blocking: BlockingConnector::Cluster(blocking_client),
            opts: opts.clone(),
            legacy_conn: None,
            connection: AnyConnection::Cluster(connection),
            scripts: ScriptRegistry::new(),
        });

        let redacted_nodes: Vec<String> = opts
            .cluster_nodes
            .iter()
            .map(|node| redact_url_userinfo(node))
            .collect();
        debug!(nodes = ?redacted_nodes, "redis cluster connection established");

        Ok(Self { inner })
    }

    /// Whether this is a Redis Cluster connection.
    pub fn is_cluster(&self) -> bool {
        matches!(self.inner.connection, AnyConnection::Cluster(_))
    }

    /// Get a clone of the legacy multiplexed connection for concurrent use.
    ///
    /// Prefer [`managed_conn`](Self::managed_conn), which reconnects
    /// automatically after the socket dies.
    ///
    /// # Panics
    ///
    /// Panics if this connection was created with
    /// [`new_managed_only`](Self::new_managed_only) or is a Redis Cluster
    /// connection.
    pub fn conn(&self) -> MultiplexedConnection {
        self.try_conn()
            .expect("legacy connection not opened; connection was created with new_managed_only")
    }

    /// Non-panicking variant of [`conn`](Self::conn); `None` when the legacy
    /// socket was not opened.
    pub fn try_conn(&self) -> Option<MultiplexedConnection> {
        self.inner.legacy_conn.clone()
    }

    /// Get a clone of the managed connection for concurrent use.
    ///
    /// # Panics
    ///
    /// Panics on a Redis Cluster connection; use
    /// [`connection`](Self::connection), which works in both modes.
    pub fn managed_conn(&self) -> ManagedConn {
        self.try_managed_conn()
            .unwrap_or_else(|| panic!("managed_conn is {CLUSTER_UNSUPPORTED}"))
    }

    /// Non-panicking variant of [`managed_conn`](Self::managed_conn); `None`
    /// on a Redis Cluster connection.
    pub fn try_managed_conn(&self) -> Option<ManagedConn> {
        match &self.inner.connection {
            AnyConnection::Single(conn) => Some(conn.clone()),
            AnyConnection::Cluster(_) => None,
        }
    }

    /// Get a clone of the auto-reconnecting connection, for either a
    /// standalone server or a Redis Cluster.
    pub fn connection(&self) -> AnyConnection {
        self.inner.connection.clone()
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
    ///
    /// Runs on the same session as [`conn`](Self::conn) when the legacy socket
    /// is open (see [`new`](Self::new)), so connection-local state such as
    /// `SELECT` or `CLIENT SETNAME` is shared. Otherwise it runs on the
    /// auto-reconnecting managed connection.
    pub async fn cmd<T: redis::FromRedisValue>(&self, cmd: &mut redis::Cmd) -> Result<T, Error> {
        if let Some(mut conn) = self.try_conn() {
            return Ok(cmd.query_async(&mut conn).await?);
        }
        let mut conn = self.inner.connection.clone();
        Ok(cmd.query_async(&mut conn).await?)
    }

    /// Execute a pipeline.
    ///
    /// Uses the same connection selection as [`cmd`](Self::cmd).
    pub async fn pipe<T: redis::FromRedisValue>(&self, pipe: &redis::Pipeline) -> Result<T, Error> {
        if let Some(mut conn) = self.try_conn() {
            return Ok(pipe.query_async(&mut conn).await?);
        }
        let mut conn = self.inner.connection.clone();
        Ok(pipe.query_async(&mut conn).await?)
    }

    /// Get the underlying client for creating additional connections.
    ///
    /// # Panics
    ///
    /// Panics on a Redis Cluster connection; see
    /// [`try_client`](Self::try_client).
    pub fn client(&self) -> &Client {
        self.try_client()
            .unwrap_or_else(|| panic!("client is {CLUSTER_UNSUPPORTED}"))
    }

    /// Non-panicking variant of [`client`](Self::client); `None` on a Redis
    /// Cluster connection.
    pub fn try_client(&self) -> Option<&Client> {
        self.inner.client.as_ref()
    }

    /// Create a new dedicated connection (e.g., for blocking operations).
    ///
    /// The connection is created with its response timeout **disabled**.
    /// redis-rs applies a 500ms default response timeout to every multiplexed
    /// connection, which is shorter than the block durations used by callers
    /// (e.g. `QueueEvents`' `XREAD BLOCK`). With the default timeout the client
    /// would abandon every blocking call after 500ms and surface a spurious
    /// "timed out" error on an otherwise healthy, idle queue. See the note on
    /// [`BlockingRedisConnection::new`] for the equivalent worker-side issue.
    ///
    /// Returns [`Error::InvalidConfig`] on a Redis Cluster connection; use
    /// [`dedicated_any_connection`](Self::dedicated_any_connection) instead.
    pub async fn dedicated_connection(&self) -> Result<MultiplexedConnection, Error> {
        let config = AsyncConnectionConfig::new().set_response_timeout(None);
        Ok(self
            .standalone_client()?
            .get_multiplexed_async_connection_with_config(&config)
            .await?)
    }

    /// Create a dedicated managed connection that reconnects automatically.
    ///
    /// Returns [`Error::InvalidConfig`] on a Redis Cluster connection; use
    /// [`dedicated_any_connection`](Self::dedicated_any_connection) instead.
    pub async fn managed_dedicated_connection(&self) -> Result<ManagedConn, Error> {
        let config = manager_config(None);
        Ok(ConnectionManager::new_with_config(self.standalone_client()?.clone(), config).await?)
    }

    /// Create a dedicated, auto-reconnecting connection with its response
    /// timeout disabled (for blocking commands), for either a standalone
    /// server or a Redis Cluster.
    pub async fn dedicated_any_connection(&self) -> Result<AnyConnection, Error> {
        self.inner.blocking.connect().await
    }

    fn standalone_client(&self) -> Result<&Client, Error> {
        self.try_client().ok_or_else(|| {
            Error::InvalidConfig(format!("dedicated connection is {CLUSTER_UNSUPPORTED}"))
        })
    }

    /// Return the `CLIENT LIST` output of the server, or of every primary
    /// node of a Redis Cluster (nodes that fail to answer are skipped).
    pub(crate) async fn client_lists(&self) -> Result<Vec<String>, Error> {
        let mut cmd = redis::cmd("CLIENT");
        cmd.arg("LIST");
        let AnyConnection::Cluster(mut conn) = self.inner.connection.clone() else {
            return Ok(vec![self.cmd(&mut cmd).await?]);
        };

        let primaries = Self::cluster_primary_addresses(&mut conn).await?;
        Ok(Self::client_lists_from_primaries(&conn, primaries).await)
    }

    async fn cluster_primary_addresses(
        conn: &mut ClusterConnection,
    ) -> Result<BTreeSet<(String, u16)>, Error> {
        let mut cmd = redis::cmd("CLUSTER");
        cmd.arg("SLOTS");
        let reply = conn
            .route_command(
                cmd,
                RoutingInfo::SingleNode(SingleNodeRoutingInfo::RandomPrimary),
            )
            .await?;
        Self::cluster_primary_addresses_from_slots(reply)
    }

    fn cluster_primary_addresses_from_slots(
        reply: Value,
    ) -> Result<BTreeSet<(String, u16)>, Error> {
        let slots: Vec<Vec<Value>> =
            redis::from_redis_value(reply).map_err(redis::RedisError::from)?;
        let mut primaries = BTreeSet::new();
        for slot in slots {
            let Some(primary) = slot.get(2) else {
                continue;
            };
            let Ok(primary) = redis::from_redis_value::<Vec<Value>>(primary.clone()) else {
                continue;
            };
            let (Some(host), Some(port)) = (primary.first(), primary.get(1)) else {
                continue;
            };
            if let (Ok(host), Ok(port)) = (
                redis::from_redis_value::<String>(host.clone()),
                redis::from_redis_value::<u16>(port.clone()),
            ) {
                if !host.is_empty() {
                    primaries.insert((host, port));
                }
            }
        }
        Ok(primaries)
    }

    async fn client_lists_from_primaries(
        conn: &ClusterConnection,
        primaries: impl IntoIterator<Item = (String, u16)>,
    ) -> Vec<String> {
        let requests = primaries.into_iter().map(|(host, port)| {
            let mut conn = conn.clone();
            async move {
                let mut cmd = redis::cmd("CLIENT");
                cmd.arg("LIST");
                let reply = conn
                    .route_command(
                        cmd,
                        RoutingInfo::SingleNode(SingleNodeRoutingInfo::ByAddress { host, port }),
                    )
                    .await
                    .ok()?;
                redis::from_redis_value::<String>(reply).ok()
            }
        });
        futures::future::join_all(requests)
            .await
            .into_iter()
            .flatten()
            .collect()
    }

    /// Ping the server to verify connectivity.
    ///
    /// Uses the same connection selection as [`cmd`](Self::cmd): the legacy
    /// socket when open, otherwise the auto-reconnecting managed connection.
    pub async fn ping(&self) -> Result<(), Error> {
        if let Some(mut conn) = self.try_conn() {
            redis::cmd("PING").query_async::<()>(&mut conn).await?;
            return Ok(());
        }
        let mut conn = self.inner.connection.clone();
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
    connector: BlockingConnector,
    conn: Mutex<AnyConnection>,
    /// Legacy multiplexed socket (response timeout disabled). Opened by
    /// [`BlockingRedisConnection::new`]; absent for
    /// [`BlockingRedisConnection::new_managed_only`].
    compat_conn: Option<Mutex<MultiplexedConnection>>,
    /// Name registered with `CLIENT SETNAME`, kept so it can be reapplied
    /// after the managed connection is re-established.
    client_name: std::sync::Mutex<Option<String>>,
    /// Set when the underlying socket may have been replaced, meaning the
    /// stored [`client_name`](BlockingInner::client_name) has to be reapplied
    /// before the connection is used again.
    needs_renaming: AtomicBool,
    /// Last time the stored client name was reconciled, even if the cluster
    /// connection transparently recovered without surfacing an error.
    last_name_reconcile: Mutex<Option<std::time::Instant>>,
}

/// Whether a failed `CLIENT SETNAME` is worth retrying once the connection has
/// recovered. Connection-level failures are transient, whereas an error reply
/// means the server rejects the command (some managed Redis providers do), so
/// retrying it on every reconnect would be pointless.
fn is_transient_connection_error(err: &Error) -> bool {
    matches!(err, Error::Redis(e) if e.is_io_error()
        || e.is_connection_dropped()
        || e.is_connection_refusal()
        || e.is_timeout())
}

/// Grace period added on top of a blocking command's own timeout before the
/// connection is considered stuck. Mirrors the TypeScript worker's
/// `blockTimeout + 1s` watchdog.
const BLOCK_WATCHDOG_GRACE: std::time::Duration = std::time::Duration::from_secs(1);
const CLIENT_NAME_RECONCILE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30);
const CLIENT_NAME_RECONCILE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(1);

async fn reconcile_client_name<F>(
    needs_renaming: &AtomicBool,
    last_reconcile: &mut Option<std::time::Instant>,
    name: &str,
    request: F,
) where
    F: Future<Output = Result<(), Error>>,
{
    match tokio::time::timeout(CLIENT_NAME_RECONCILE_TIMEOUT, request).await {
        Ok(Ok(())) => {
            needs_renaming.store(false, Ordering::Release);
            *last_reconcile = Some(std::time::Instant::now());
            debug!(client_name = %name, "reapplied client name after reconnect");
        }
        Ok(Err(err)) if is_transient_connection_error(&err) => {
            // Still reconnecting — keep the flag so the next call retries.
            warn!(error = %err, "could not reapply client name yet, will retry");
        }
        Err(_) => {
            // A cluster node may be unresponsive while the other nodes work.
            // Keep the flag so the next read retries after this bounded request.
            needs_renaming.store(true, Ordering::Release);
            warn!("timed out reapplying client name, will retry");
        }
        Ok(Err(err)) => {
            needs_renaming.store(false, Ordering::Release);
            *last_reconcile = Some(std::time::Instant::now());
            warn!(error = %err, "server rejected CLIENT SETNAME, worker will not be listed");
        }
    }
}

impl BlockingRedisConnection {
    /// Create a new blocking connection from a Redis client.
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
    ///
    /// Also opens the legacy socket used by [`conn`](Self::conn),
    /// [`bzpopmin`](Self::bzpopmin) and [`set_name`](Self::set_name). Use
    /// [`new_managed_only`](Self::new_managed_only) to skip it.
    pub async fn new(client: &Client) -> Result<Self, Error> {
        Self::connect(client, true).await
    }

    /// Create a blocking connection without the extra legacy socket.
    ///
    /// [`conn`](Self::conn) panics, and [`bzpopmin`](Self::bzpopmin) /
    /// [`set_name`](Self::set_name) return an error, on such a connection.
    pub async fn new_managed_only(client: &Client) -> Result<Self, Error> {
        Self::connect(client, false).await
    }

    async fn connect(client: &Client, with_legacy: bool) -> Result<Self, Error> {
        Self::connect_with(BlockingConnector::Single(client.clone()), with_legacy).await
    }

    async fn connect_with(connector: BlockingConnector, with_legacy: bool) -> Result<Self, Error> {
        let conn = connector.connect().await?;
        let compat_conn = match (&connector, with_legacy) {
            (BlockingConnector::Single(client), true) => {
                let compat_config = AsyncConnectionConfig::new().set_response_timeout(None);
                Some(Mutex::new(
                    client
                        .get_multiplexed_async_connection_with_config(&compat_config)
                        .await?,
                ))
            }
            _ => None,
        };
        Ok(Self {
            inner: Arc::new(BlockingInner {
                connector,
                conn: Mutex::new(conn),
                compat_conn,
                client_name: std::sync::Mutex::new(None),
                needs_renaming: AtomicBool::new(false),
                last_name_reconcile: Mutex::new(None),
            }),
        })
    }

    /// Create a new blocking connection managed by a [`RedisConnection`].
    ///
    /// Opens the legacy socket only if `conn` has one, so a managed-only
    /// `RedisConnection` yields a managed-only blocking connection. On a Redis
    /// Cluster connection, a dedicated cluster connection is opened; blocking
    /// commands are routed to the node owning their key.
    pub async fn new_managed(conn: &RedisConnection) -> Result<Self, Error> {
        Self::connect_with(conn.inner.blocking.clone(), conn.try_conn().is_some()).await
    }

    fn compat(&self) -> Result<&Mutex<MultiplexedConnection>, Error> {
        self.inner.compat_conn.as_ref().ok_or_else(|| {
            Error::InvalidConfig(
                "legacy connection not opened; connection was created with new_managed_only"
                    .to_string(),
            )
        })
    }

    /// Get a mutable reference to the legacy connection.
    ///
    /// # Panics
    ///
    /// Panics if this connection was created with
    /// [`new_managed_only`](Self::new_managed_only). Connections created with
    /// [`new`](Self::new) never panic.
    pub async fn conn(&self) -> tokio::sync::MutexGuard<'_, MultiplexedConnection> {
        self.compat()
            .expect("legacy connection not opened; connection was created with new_managed_only")
            .lock()
            .await
    }

    /// Execute a blocking BZPOPMIN command on the legacy connection.
    pub async fn bzpopmin(
        &self,
        key: &str,
        timeout_secs: f64,
    ) -> Result<Option<(String, String, f64)>, Error> {
        let mut conn = self.compat()?.lock().await;
        let result: Option<(String, String, f64)> = redis::cmd("BZPOPMIN")
            .arg(key)
            .arg(timeout_secs)
            .query_async(&mut *conn)
            .await?;
        Ok(result)
    }

    /// Execute a blocking BZPOPMIN command on the managed connection.
    ///
    /// Guarded by a watchdog: the response timeout is disabled on this
    /// connection, so a half-open socket (a network blip that never delivers a
    /// FIN/RST) would otherwise leave the read hanging forever and the worker
    /// would silently stop fetching jobs. If the reply does not arrive within
    /// the command's own timeout plus [`BLOCK_WATCHDOG_GRACE`], the connection
    /// is treated as stuck and rebuilt, and an error is returned so the caller
    /// retries on the fresh connection.
    pub(crate) async fn managed_bzpopmin(
        &self,
        key: &str,
        timeout_secs: f64,
    ) -> Result<Option<(String, String, f64)>, Error> {
        let mut conn = self.inner.conn.lock().await;

        // A reconnect hands us a brand-new, unnamed Redis connection, so
        // restore the worker's name before blocking on it again.
        self.reapply_client_name(&mut conn).await;

        let watchdog = std::time::Duration::from_secs_f64(timeout_secs.max(0.0))
            .saturating_add(BLOCK_WATCHDOG_GRACE);

        let mut cmd = redis::cmd("BZPOPMIN");
        cmd.arg(key).arg(timeout_secs);
        let command = cmd.query_async::<Option<(String, String, f64)>>(&mut *conn);

        match tokio::time::timeout(watchdog, command).await {
            Ok(Ok(value)) => {
                self.reapply_client_name(&mut conn).await;
                Ok(value)
            }
            Ok(Err(err)) => {
                // The command failed, most likely because the socket died.
                // `ConnectionManager` reconnects in the background and the
                // replacement connection is unnamed, so schedule a rename.
                self.inner.needs_renaming.store(true, Ordering::Release);
                Err(err.into())
            }
            Err(_) => {
                warn!(
                    timeout_secs,
                    "blocking read exceeded its watchdog, rebuilding connection"
                );
                // Drop the stuck manager and build a new one. `ConnectionManager`
                // only reconnects on errors it observes, and a half-open socket
                // never surfaces one.
                *conn = self.inner.connector.connect().await?;
                // The rebuilt connection starts out unnamed; restore the name
                // immediately so `Queue::get_workers` keeps reporting this worker.
                self.inner.needs_renaming.store(true, Ordering::Release);
                self.reapply_client_name(&mut conn).await;
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
        let mut conn = self.compat()?.lock().await;
        redis::cmd("CLIENT")
            .arg("SETNAME")
            .arg(name)
            .query_async::<()>(&mut *conn)
            .await?;
        Ok(())
    }

    /// Set the Redis client connection name on the managed connection.
    ///
    /// The name is reapplied automatically whenever the connection is
    /// re-established.
    ///
    pub(crate) async fn managed_set_name(&self, name: &str) -> Result<(), Error> {
        self.store_client_name(name);

        let mut conn = self.inner.conn.lock().await;
        match Self::apply_client_name(&mut conn, name).await {
            Ok(()) => {
                self.inner.needs_renaming.store(false, Ordering::Release);
                self.record_name_reconcile().await;
                Ok(())
            }
            Err(err) => {
                let transient = is_transient_connection_error(&err);
                self.inner
                    .needs_renaming
                    .store(transient, Ordering::Release);
                if !transient {
                    self.record_name_reconcile().await;
                }
                Err(err)
            }
        }
    }

    fn store_client_name(&self, name: &str) {
        let mut stored = self
            .inner
            .client_name
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *stored = Some(name.to_string());
    }

    fn stored_client_name(&self) -> Option<String> {
        self.inner
            .client_name
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    async fn apply_client_name(conn: &mut AnyConnection, name: &str) -> Result<(), Error> {
        redis::cmd("CLIENT")
            .arg("SETNAME")
            .arg(name)
            .query_async::<()>(conn)
            .await?;
        Ok(())
    }

    /// Reapply the stored client name when the connection may have been
    /// re-established.
    ///
    /// `ConnectionManager` replaces the underlying socket transparently, and
    /// the new Redis connection starts with an empty name. Without this, a
    /// worker that recovered from a Redis restart would silently disappear from
    /// `Queue::get_workers`, which discovers workers by `CLIENT LIST` name.
    async fn reapply_client_name(&self, conn: &mut AnyConnection) {
        let mut last_reconcile = self.inner.last_name_reconcile.lock().await;
        if !self.inner.needs_renaming.load(Ordering::Acquire)
            && last_reconcile.is_some_and(|last| last.elapsed() < CLIENT_NAME_RECONCILE_INTERVAL)
        {
            return;
        }

        let Some(name) = self.stored_client_name() else {
            self.inner.needs_renaming.store(false, Ordering::Release);
            *last_reconcile = Some(std::time::Instant::now());
            return;
        };

        reconcile_client_name(
            &self.inner.needs_renaming,
            &mut last_reconcile,
            &name,
            Self::apply_client_name(conn, &name),
        )
        .await;
    }

    async fn record_name_reconcile(&self) {
        *self.inner.last_name_reconcile.lock().await = Some(std::time::Instant::now());
    }
}

#[cfg(test)]
mod tests {
    use super::build_client;
    use super::build_cluster_client;
    use super::is_transient_connection_error;
    use super::{
        reconcile_client_name, CLIENT_NAME_RECONCILE_INTERVAL, CLIENT_NAME_RECONCILE_TIMEOUT,
    };
    use super::{AnyConnection, BlockingRedisConnection, ManagedConn, RedisConnection};
    use crate::error::Error;
    use crate::options::{redact_url_userinfo, RedisConnectionOptions, TlsCerts};
    use redis::aio::MultiplexedConnection;
    use redis::Client;
    use redis::Value;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tokio::sync::MutexGuard;

    #[allow(dead_code)]
    async fn legacy_connection_api_types(
        client: &Client,
        connection: &RedisConnection,
        blocking_connection: &BlockingRedisConnection,
    ) -> Result<(), Error> {
        let _: MultiplexedConnection = connection.conn();
        let _: MultiplexedConnection = connection.dedicated_connection().await?;
        let _: MutexGuard<'_, MultiplexedConnection> = blocking_connection.conn().await;
        let _: ManagedConn = connection.managed_conn();
        let _: ManagedConn = connection.managed_dedicated_connection().await?;
        let _ = BlockingRedisConnection::new(client).await?;
        Ok(())
    }

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

    fn cluster_opts() -> RedisConnectionOptions {
        RedisConnectionOptions::new()
            .cluster_nodes(["redis://127.0.0.1:7000", "redis://127.0.0.1:7001"])
    }

    #[test]
    fn cluster_slots_with_replicas_return_only_the_primary() {
        let reply = Value::Array(vec![Value::Array(vec![
            Value::Int(0),
            Value::Int(5460),
            Value::Array(vec![
                Value::BulkString(b"127.0.0.1".to_vec()),
                Value::Int(7000),
                Value::BulkString(b"primary-id".to_vec()),
            ]),
            Value::Array(vec![
                Value::BulkString(b"127.0.0.1".to_vec()),
                Value::Int(7001),
                Value::BulkString(b"replica-id".to_vec()),
            ]),
        ])]);

        let primaries = RedisConnection::cluster_primary_addresses_from_slots(reply).unwrap();

        assert_eq!(
            primaries,
            [("127.0.0.1".to_string(), 7000)].into_iter().collect()
        );
    }

    #[tokio::test(start_paused = true)]
    async fn blocking_client_name_retries_after_a_nonresponding_request() {
        let needs_renaming = AtomicBool::new(true);
        let mut last_reconcile = None;
        {
            let request = reconcile_client_name(
                &needs_renaming,
                &mut last_reconcile,
                "worker-name",
                std::future::pending(),
            );
            tokio::pin!(request);
            tokio::time::advance(CLIENT_NAME_RECONCILE_TIMEOUT).await;
            request.await;
        }

        assert!(needs_renaming.load(Ordering::Acquire));
        assert!(last_reconcile.is_none());

        reconcile_client_name(&needs_renaming, &mut last_reconcile, "worker-name", async {
            Ok(())
        })
        .await;

        assert!(!needs_renaming.load(Ordering::Acquire));
        assert!(last_reconcile.is_some());
    }

    fn cluster_opts_from_env() -> Option<RedisConnectionOptions> {
        let nodes = std::env::var("REDIS_CLUSTER_NODES").ok()?;
        let nodes: Vec<_> = nodes
            .split(',')
            .map(str::trim)
            .filter(|node| !node.is_empty())
            .collect();
        (!nodes.is_empty()).then(|| RedisConnectionOptions::new().cluster_nodes(nodes))
    }

    #[test]
    fn build_cluster_client_succeeds() {
        assert!(build_cluster_client(&cluster_opts(), None).is_ok());
    }

    #[test]
    fn build_cluster_client_with_tls_certs_succeeds() {
        let opts = cluster_opts().tls_certs(TlsCerts {
            root_cert: Some(b"cert".to_vec()),
            ..Default::default()
        });
        assert!(build_cluster_client(&opts, None).is_ok());
    }

    #[test]
    fn build_cluster_client_with_client_cert_without_key_errors() {
        let opts = cluster_opts().tls_certs(TlsCerts {
            client_cert: Some(b"cert".to_vec()),
            ..Default::default()
        });
        assert!(matches!(
            build_cluster_client(&opts, None),
            Err(Error::InvalidConfig(_))
        ));
    }

    #[tokio::test]
    async fn cluster_client_lists_skip_an_unavailable_primary() {
        let Some(opts) = cluster_opts_from_env() else {
            return;
        };
        let connection = RedisConnection::new_managed_only(&opts).await.unwrap();
        let AnyConnection::Cluster(mut cluster) = connection.connection() else {
            unreachable!();
        };
        let primaries = RedisConnection::cluster_primary_addresses(&mut cluster)
            .await
            .unwrap();
        assert!(!primaries.is_empty());

        let mut requested = primaries.clone();
        requested.insert(("127.0.0.1".to_string(), 1));
        let lists = RedisConnection::client_lists_from_primaries(&cluster, requested).await;

        assert_eq!(lists.len(), primaries.len());
    }

    #[tokio::test]
    async fn cluster_worker_name_is_reconciled_after_connection_name_loss() {
        let Some(opts) = cluster_opts_from_env() else {
            return;
        };
        let connection = RedisConnection::new_managed_only(&opts).await.unwrap();
        let blocking = BlockingRedisConnection::new_managed(&connection)
            .await
            .unwrap();
        let name = format!("bullmq-rs-test:w:{}", uuid::Uuid::new_v4());
        blocking.managed_set_name(&name).await.unwrap();

        {
            let mut conn = blocking.inner.conn.lock().await;
            BlockingRedisConnection::apply_client_name(&mut conn, "")
                .await
                .unwrap();
            *blocking.inner.last_name_reconcile.lock().await =
                Some(std::time::Instant::now() - CLIENT_NAME_RECONCILE_INTERVAL);
        }

        let result = blocking
            .managed_bzpopmin("{bullmq-rs-reconnect-test}:wait", 0.01)
            .await
            .unwrap();
        assert!(result.is_none());

        let lists = connection.client_lists().await.unwrap();
        assert!(lists
            .iter()
            .any(|list| list.contains(&format!("name={name}"))));
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

    #[test]
    fn io_failures_are_transient() {
        let err = Error::Redis(redis::RedisError::from((
            redis::ErrorKind::Io,
            "connection reset",
        )));
        assert!(is_transient_connection_error(&err));
    }

    #[test]
    fn server_rejections_are_not_transient() {
        let err = Error::Redis(redis::RedisError::from((
            redis::ErrorKind::Extension,
            "unknown command",
        )));
        assert!(!is_transient_connection_error(&err));
    }
}
