using System.Data.Common;
using System.Text.RegularExpressions;
using Npgsql;
using NpgsqlTypes;

namespace BullMQ.Postgres;

/// <summary>A lightweight query result: column names and rows.</summary>
public sealed class PgResult
{
    public IReadOnlyList<string> Columns { get; }
    public IReadOnlyList<object?[]> Rows { get; }

    public PgResult(IReadOnlyList<string> columns, IReadOnlyList<object?[]> rows)
    {
        Columns = columns;
        Rows = rows;
    }

    /// <summary>The first row as a column -&gt; value map, or null when empty.</summary>
    public IReadOnlyDictionary<string, object?>? FirstMap() => Rows.Count == 0 ? null : ToMap(Rows[0]);

    /// <summary>All rows as column -&gt; value maps.</summary>
    public IReadOnlyList<IReadOnlyDictionary<string, object?>> Maps() =>
        Rows.Select(ToMap).ToList();

    private IReadOnlyDictionary<string, object?> ToMap(object?[] row)
    {
        var map = new Dictionary<string, object?>(Columns.Count, StringComparer.Ordinal);
        for (var i = 0; i < Columns.Count; i++)
        {
            map[Columns[i]] = row[i];
        }

        return map;
    }
}

/// <summary>
/// Owns the PostgreSQL connectivity for a backend: a connection pool used for
/// regular queries (shared by every backend in the process with the same
/// connection settings) and dedicated <c>LISTEN</c> connections used by the
/// blocking "wait for job" and event-stream primitives. Also applies the shared
/// schema migrations on first use, guarded by a per-schema advisory lock so
/// concurrent starters migrate exactly once.
/// </summary>
public sealed class PostgresConnection : IAsyncDisposable
{
    // Transaction-scoped advisory lock that serializes migrations across
    // processes. The integer spells `BULL` (0x42554C4C); every runtime uses the
    // exact same key.
    private const int MigrationAdvisoryLockKey = 0x42554C4C;
    private const int MinimumPostgresMajor = 13;

    public const string JobsChannel = "bullmq_jobs";

    public const string EventsChannel = "bullmq_events";

    private static readonly Regex SchemaNameRegex =
        new("^[A-Za-z_][A-Za-z0-9_$]*$", RegexOptions.Compiled);

    private readonly string _connectionString;
    private readonly SharedDataSources _dataSources;
    private readonly bool _skipVersionCheck;
    private readonly SemaphoreSlim _readyLock = new(1, 1);
    // Serializes opening, naming and resetting the dedicated connections, and
    // the start of a jobs LISTEN wait, so a command is never sent on a blocked
    // connection and a connection opened during close cannot leak.
    private readonly SemaphoreSlim _dedicatedLock = new(1, 1);
    private readonly CancellationTokenSource _closeCts = new();
    private Task? _jobWaitTask;
    private Task? _eventsWaitTask;

    private bool _ready;
    private volatile bool _closed;
    private int _released;
    private NpgsqlConnection? _listenConn;
    private bool _jobChannelListening;
    private string? _listenConnName;
    private NpgsqlConnection? _eventsConn;
    private bool _eventsChannelListening;
    private string? _applicationName;

    public string Schema { get; }

    /// <summary>True once close has started; the connection will not reconnect.</summary>
    public bool IsClosing => _closed;

    public PostgresConnection(PostgresOptions options)
    {
        Schema = options.Schema;
        _skipVersionCheck = options.SkipVersionCheck;
        QuoteSchemaName(Schema); // validate early

        var builder = new NpgsqlConnectionStringBuilder(options.ConnectionString);
        ApplyPoolSettings(builder, options.PoolSize);
        builder.SearchPath = Schema;
        _connectionString = builder.ConnectionString;

        // LISTEN connections never come from the query pool: a long-lived LISTEN
        // must not hold a pool slot, and closing one must really disconnect it
        // (so it drops out of pg_stat_activity, i.e. worker discovery, at once).
        var listenBuilder = new NpgsqlConnectionStringBuilder(_connectionString)
        {
            Pooling = false,
            Multiplexing = false,
            MinPoolSize = 0,
        };
        _dataSources = AcquireDataSources(_connectionString, listenBuilder.ConnectionString);
    }

    // ============================================================
    // Shared data sources
    // ============================================================

    // One pooled data source per effective connection string (which includes the
    // schema's search_path and the pool size), shared by every PostgresConnection
    // in the process: all queues/workers draw from one bounded pool, and Npgsql
    // loads the database type catalog once per data source instead of once per
    // instance. Data sources live for the process (like Npgsql's own
    // per-connection-string pools); when the last user closes, the pool's idle
    // physical connections are closed.
    private sealed class SharedDataSources
    {
        public SharedDataSources(string queryConnectionString, string listenConnectionString)
        {
            Queries = NpgsqlDataSource.Create(queryConnectionString);
            Listen = NpgsqlDataSource.Create(listenConnectionString);
        }

        public NpgsqlDataSource Queries { get; }

        public NpgsqlDataSource Listen { get; }

        public int Users { get; set; }
    }

    private static readonly Dictionary<string, SharedDataSources> s_dataSources = new(StringComparer.Ordinal);

    private static SharedDataSources AcquireDataSources(string connectionString, string listenConnectionString)
    {
        lock (s_dataSources)
        {
            if (!s_dataSources.TryGetValue(connectionString, out var shared))
            {
                shared = new SharedDataSources(connectionString, listenConnectionString);
                s_dataSources[connectionString] = shared;
            }

            shared.Users++;
            return shared;
        }
    }

    private void ReleaseDataSources()
    {
        if (Interlocked.Exchange(ref _released, 1) != 0)
        {
            return;
        }

        lock (s_dataSources)
        {
            if (--_dataSources.Users == 0)
            {
                // Closes the idle pooled connections; any still running a query
                // are closed when returned, so this never waits on or interrupts
                // an in-flight command.
                _dataSources.Queries.Clear();
            }
        }
    }

    // Applies BullMQ's pool defaults to the settings the caller's connection
    // string leaves unset (explicit settings, and PoolSize, always win).
    private static void ApplyPoolSettings(NpgsqlConnectionStringBuilder builder, int? poolSize)
    {
        // Npgsql's builder reports every *valid* keyword as present, so detect
        // the caller's explicit settings on the canonicalized string instead.
        var explicitKeys = new DbConnectionStringBuilder { ConnectionString = builder.ConnectionString };

        if (poolSize is { } size)
        {
            if (size < 1)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(PostgresOptions.PoolSize), size, "BullMQ: PostgresOptions.PoolSize must be at least 1.");
            }

            builder.MaxPoolSize = size;
        }
        else if (!explicitKeys.ContainsKey("Maximum Pool Size"))
        {
            builder.MaxPoolSize = Math.Max(PostgresOptions.DefaultPoolSize, builder.MinPoolSize);
        }

        // By default Npgsql resets every returned session with DISCARD ALL, which
        // also drops the server's cached plans: each PL/pgSQL operation function
        // would be re-planned on every call, cancelling out the pool's gain. The
        // pool is private to BullMQ and its commands leave no session state (see
        // RunAsync), so skip the reset, as node-postgres' pool does.
        if (!explicitKeys.ContainsKey("No Reset On Close"))
        {
            builder.NoResetOnClose = true;
        }
    }

    // ============================================================
    // Readiness / migrations
    // ============================================================

    public async Task WaitUntilReadyAsync()
    {
        if (_ready)
        {
            return;
        }

        await _readyLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_ready)
            {
                return;
            }

            await EnsureMigratedOnceAsync().ConfigureAwait(false);
            _ready = true;
        }
        finally
        {
            _readyLock.Release();
        }
    }

    // Migrations and the post-migration type-catalog reload run at most once per
    // connection string (i.e. per shared data source) per process. Doing them
    // per-instance would repeatedly invalidate the data source's shared type
    // cache and, under concurrency (e.g. many queues/workers/tests starting at
    // once), trigger a catalog-reload storm across every other connection —
    // turning startup into tens of seconds.
    private static readonly SemaphoreSlim s_migrateLock = new(1, 1);
    private static readonly HashSet<string> s_migrated = new(StringComparer.Ordinal);

    private async Task EnsureMigratedOnceAsync()
    {
        await s_migrateLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (s_migrated.Contains(_connectionString))
            {
                return;
            }

            await using var conn = await OpenWithRetryAsync(_dataSources.Queries).ConfigureAwait(false);
            await RunMigrationsAsync(conn).ConfigureAwait(false);

            // The migrations create custom types (e.g. the job-state enum). Npgsql
            // caches the database type catalog per data source on its first
            // connect (before those types existed), so reload it once now so
            // every pooled connection resolves the new types (and reads the
            // unmapped enum columns as strings).
            await conn.ReloadTypesAsync().ConfigureAwait(false);
            s_migrated.Add(_connectionString);
        }
        finally
        {
            s_migrateLock.Release();
        }
    }

    private async Task RunMigrationsAsync(NpgsqlConnection conn)
    {
        var quoted = QuoteSchemaName(Schema);
        await using var tx = await conn.BeginTransactionAsync().ConfigureAwait(false);

        if (!_skipVersionCheck)
        {
            await using var versionCmd = new NpgsqlCommand("SELECT current_setting('server_version_num')", conn, tx);
            var serverNum = int.Parse((string)(await versionCmd.ExecuteScalarAsync().ConfigureAwait(false))!);
            var major = serverNum / 10000;
            if (major < MinimumPostgresMajor)
            {
                throw new BullMQException(
                    $"BullMQ: the PostgreSQL backend requires server version {MinimumPostgresMajor} " +
                    $"or newer (server reports major {major}).");
            }
        }

        await using (var lockCmd = new NpgsqlCommand("SELECT pg_advisory_xact_lock($1, hashtext($2))", conn, tx))
        {
            lockCmd.Parameters.Add(new NpgsqlParameter { Value = MigrationAdvisoryLockKey });
            lockCmd.Parameters.Add(new NpgsqlParameter { Value = Schema });
            await lockCmd.ExecuteNonQueryAsync().ConfigureAwait(false);
        }

        await ExecuteRawAsync(conn, tx, $"CREATE SCHEMA IF NOT EXISTS {quoted}").ConfigureAwait(false);
        await ExecuteRawAsync(conn, tx, $"SET LOCAL search_path TO {quoted}").ConfigureAwait(false);
        await ExecuteRawAsync(
            conn, tx,
            "CREATE TABLE IF NOT EXISTS bullmq_migration (" +
            "version integer PRIMARY KEY, name text NOT NULL, " +
            "applied_at timestamptz NOT NULL DEFAULT now())").ConfigureAwait(false);

        int current;
        await using (var maxCmd = new NpgsqlCommand(
            "SELECT COALESCE(MAX(version), 0)::int FROM bullmq_migration", conn, tx))
        {
            current = (int)(await maxCmd.ExecuteScalarAsync().ConfigureAwait(false))!;
        }

        foreach (var file in SqlLoader.MigrationFiles())
        {
            var version = SqlLoader.NameToVersion(file);
            if (version <= current)
            {
                continue;
            }

            await ExecuteRawAsync(conn, tx, SqlLoader.LoadMigration(file)).ConfigureAwait(false);
            await using var insert = new NpgsqlCommand(
                "INSERT INTO bullmq_migration (version, name) VALUES ($1, $2)", conn, tx);
            insert.Parameters.Add(new NpgsqlParameter { Value = version });
            insert.Parameters.Add(new NpgsqlParameter { Value = file });
            await insert.ExecuteNonQueryAsync().ConfigureAwait(false);
            current = version;
        }

        await tx.CommitAsync().ConfigureAwait(false);
    }

    private static async Task ExecuteRawAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string sql)
    {
        await using var cmd = new NpgsqlCommand(sql, conn, tx);
        await cmd.ExecuteNonQueryAsync().ConfigureAwait(false);
    }

    // ============================================================
    // Command execution
    // ============================================================

    /// <summary>Executes a parameterized command (native <c>$1..$N</c> placeholders).</summary>
    public async Task<PgResult> RunAsync(string sql, IReadOnlyList<object?> parameters)
    {
        if (!_ready)
        {
            await WaitUntilReadyAsync().ConfigureAwait(false);
        }

        if (_closed)
        {
            throw new ObjectDisposedException(nameof(PostgresConnection));
        }

        // Every call rents its own pooled connection, so the concurrent
        // operations of a queue/worker run in parallel. Any pooled session can
        // serve any call: BullMQ commands are single statements that leave no
        // session state behind (advisory locks are transaction-scoped, temp
        // tables are ON COMMIT DROP, and application_name is only set on the
        // dedicated connections).
        await using var conn = await OpenWithRetryAsync(_dataSources.Queries).ConfigureAwait(false);
        await using var cmd = new NpgsqlCommand(sql, conn);
        foreach (var value in parameters)
        {
            // Send string values with the `unknown` type (like the reference
            // pg driver) so PostgreSQL infers the real type from context. This
            // lets untyped string arguments bind to jsonb / enum parameters
            // even when the command SQL has no explicit `::type` cast.
            var parameter = value is string s
                ? new NpgsqlParameter { Value = s, NpgsqlDbType = NpgsqlDbType.Unknown }
                : new NpgsqlParameter { Value = value ?? DBNull.Value };
            cmd.Parameters.Add(parameter);
        }

        await using var reader = await cmd.ExecuteReaderAsync().ConfigureAwait(false);
        if (!reader.HasRows && reader.FieldCount == 0)
        {
            return new PgResult(Array.Empty<string>(), Array.Empty<object?[]>());
        }

        var columns = new string[reader.FieldCount];
        for (var i = 0; i < reader.FieldCount; i++)
        {
            columns[i] = reader.GetName(i);
        }

        var rows = new List<object?[]>();
        while (await reader.ReadAsync().ConfigureAwait(false))
        {
            var row = new object?[reader.FieldCount];
            for (var i = 0; i < reader.FieldCount; i++)
            {
                row[i] = reader.IsDBNull(i) ? null : reader.GetValue(i);
            }

            rows.Add(row);
        }

        return new PgResult(columns, rows);
    }

    /// <summary>
    /// Opens a connection from <paramref name="dataSource"/>, retrying a few
    /// times on transient failures. Some servers (notably Postgres.app on macOS)
    /// intermittently reject connections under a burst of opens; a short backoff
    /// makes connection establishment resilient without masking a real outage.
    /// </summary>
    private static async Task<NpgsqlConnection> OpenWithRetryAsync(NpgsqlDataSource dataSource)
    {
        const int maxAttempts = 5;
        NpgsqlException? last = null;
        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            var conn = dataSource.CreateConnection();
            try
            {
                await conn.OpenAsync().ConfigureAwait(false);
                return conn;
            }
            catch (NpgsqlException ex) when (attempt < maxAttempts)
            {
                last = ex;
                try
                {
                    await conn.DisposeAsync().ConfigureAwait(false);
                }
                catch
                {
                    // ignore
                }

                await Task.Delay(25 * attempt).ConfigureAwait(false);
            }
        }

        throw last!;
    }

    // Opens a dedicated (unpooled) connection for LISTEN/discovery.
    private async Task<NpgsqlConnection> OpenDedicatedAsync()
    {
        var conn = await OpenWithRetryAsync(_dataSources.Listen).ConfigureAwait(false);
        if (_closed)
        {
            // CloseAsync ran while we were connecting: don't leak the connection.
            await conn.DisposeAsync().ConfigureAwait(false);
            throw new ObjectDisposedException(nameof(PostgresConnection));
        }

        return conn;
    }

    /// <summary>
    /// Sets the PostgreSQL <c>application_name</c> (the analogue of Redis
    /// <c>CLIENT SETNAME</c>) that worker discovery lists. It is applied only to
    /// the dedicated jobs connection, which is opened now if needed (without
    /// subscribing) and renamed whenever it reconnects. Pooled query sessions are
    /// shared by every backend in the process, so naming one would leak the name
    /// to later rentals and miscount workers.
    /// </summary>
    public async Task SetApplicationNameAsync(string name)
    {
        if (string.IsNullOrEmpty(name))
        {
            return;
        }

        await _dedicatedLock.WaitAsync().ConfigureAwait(false);
        try
        {
            _applicationName = name;

            // A connection blocked in a LISTEN wait cannot run a command; the
            // next EnsureJobChannelAsync (before the next wait) applies the name.
            if (_jobWaitTask is { IsCompleted: false })
            {
                return;
            }

            await GetJobConnCoreAsync().ConfigureAwait(false);
        }
        finally
        {
            _dedicatedLock.Release();
        }
    }

    // ============================================================
    // LISTEN/NOTIFY (blocking wait)
    // ============================================================

    /// <summary>Returns the dedicated LISTEN connection, subscribing to <c>bullmq_jobs</c> once.</summary>
    public async Task<NpgsqlConnection> EnsureJobChannelAsync()
    {
        await _dedicatedLock.WaitAsync().ConfigureAwait(false);
        try
        {
            var conn = await GetJobConnCoreAsync().ConfigureAwait(false);
            if (!_jobChannelListening)
            {
                await using var cmd = new NpgsqlCommand($"LISTEN {JobsChannel}", conn);
                await cmd.ExecuteNonQueryAsync().ConfigureAwait(false);
                _jobChannelListening = true;
            }

            return conn;
        }
        finally
        {
            _dedicatedLock.Release();
        }
    }

    // Opens the dedicated jobs connection if needed and brings its
    // application_name up to date. The caller holds _dedicatedLock.
    private async Task<NpgsqlConnection> GetJobConnCoreAsync()
    {
        if (_closed)
        {
            throw new ObjectDisposedException(nameof(PostgresConnection));
        }

        if (_listenConn is null || _listenConn.State != System.Data.ConnectionState.Open)
        {
            _listenConn = await OpenDedicatedAsync().ConfigureAwait(false);
            _jobChannelListening = false;
            _listenConnName = null;
        }

        if (_applicationName is not null && _listenConnName != _applicationName)
        {
            await using var cmd = new NpgsqlCommand(
                "SELECT set_config('application_name', $1, false)", _listenConn);
            cmd.Parameters.Add(new NpgsqlParameter { Value = _applicationName });
            await cmd.ExecuteNonQueryAsync().ConfigureAwait(false);
            _listenConnName = _applicationName;
        }

        return _listenConn;
    }

    /// <summary>Waits up to <paramref name="timeout"/> for a NOTIFY on the job channel.</summary>
    public async Task WaitForNotificationAsync(NpgsqlConnection listenConn, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        // Track the wait so CloseAsync can let it fully unwind before closing the
        // connection (closing a connection with a live WaitAsync read makes
        // Npgsql hang trying to drain it), and so SetApplicationNameAsync defers
        // instead of sending a command on the blocked connection.
        Task task;
        await _dedicatedLock.WaitAsync().ConfigureAwait(false);
        try
        {
            task = WaitCoreAsync(listenConn, timeout, isEvents: false, cancellationToken);
            _jobWaitTask = task;
        }
        finally
        {
            _dedicatedLock.Release();
        }

        await task.ConfigureAwait(false);
    }

    private async Task WaitCoreAsync(NpgsqlConnection listenConn, TimeSpan timeout, bool isEvents, CancellationToken cancellationToken = default)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(_closeCts.Token, cancellationToken);
        cts.CancelAfter(timeout);
        try
        {
            // WaitAsync returns on a NOTIFY; the linked token ends it on timeout
            // or when the connection is closing (so shutdown is not blocked for
            // the full timeout).
            await listenConn.WaitAsync(cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Timed out or closing — nothing to do.
        }
        catch (NpgsqlException)
        {
            if (isEvents)
            {
                await ResetEventsChannelAsync().ConfigureAwait(false);
            }
            else
            {
                await ResetJobChannelAsync().ConfigureAwait(false);
            }
        }
    }

    public async Task ResetJobChannelAsync()
    {
        if (_listenConn is not null)
        {
            try
            {
                await _listenConn.CloseAsync().ConfigureAwait(false);
                await _listenConn.DisposeAsync().ConfigureAwait(false);
            }
            catch
            {
                // ignore
            }
        }

        _listenConn = null;
        _jobChannelListening = false;
    }

    // Awaits a (cancelled) LISTEN wait so it fully unwinds, bounded so a stuck
    // wait can never block shutdown. Exceptions/cancellation are expected.
    private static async Task DrainWaitAsync(Task? task)
    {
        if (task is null)
        {
            return;
        }

        try
        {
            await task.WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false);
        }
        catch
        {
            // Cancellation, timeout, or a connection error — nothing to do.
        }
    }

    /// <summary>Returns a dedicated LISTEN connection subscribed to <c>bullmq_events</c> once.</summary>
    public async Task<NpgsqlConnection> EnsureEventsChannelAsync()
    {
        await _dedicatedLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_closed)
            {
                throw new ObjectDisposedException(nameof(PostgresConnection));
            }

            if (_eventsConn is null || _eventsConn.State != System.Data.ConnectionState.Open)
            {
                _eventsConn = await OpenDedicatedAsync().ConfigureAwait(false);
                _eventsChannelListening = false;
            }

            if (!_eventsChannelListening)
            {
                await using var cmd = new NpgsqlCommand($"LISTEN {EventsChannel}", _eventsConn);
                await cmd.ExecuteNonQueryAsync().ConfigureAwait(false);
                _eventsChannelListening = true;
            }

            return _eventsConn;
        }
        finally
        {
            _dedicatedLock.Release();
        }
    }

    /// <summary>Waits up to <paramref name="timeout"/> for a NOTIFY on the events channel.</summary>
    public Task WaitForEventsNotificationAsync(NpgsqlConnection listenConn, TimeSpan timeout)
    {
        var task = WaitCoreAsync(listenConn, timeout, isEvents: true);
        _eventsWaitTask = task;
        return task;
    }

    public async Task ResetEventsChannelAsync()
    {
        if (_eventsConn is not null)
        {
            try
            {
                await _eventsConn.CloseAsync().ConfigureAwait(false);
                await _eventsConn.DisposeAsync().ConfigureAwait(false);
            }
            catch
            {
                // ignore
            }
        }

        _eventsConn = null;
        _eventsChannelListening = false;
    }

    public async Task CloseAsync()
    {
        _closed = true;

        // Interrupt any in-flight blocking LISTEN waits immediately so shutdown
        // does not stall for their full timeout.
        try
        {
            _closeCts.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // Already disposed.
        }

        // Let the cancelled LISTEN waits fully unwind BEFORE closing their
        // connections. Closing a connection that still has a live WaitAsync read
        // makes Npgsql hang trying to drain the ongoing operation.
        await DrainWaitAsync(_jobWaitTask).ConfigureAwait(false);
        await DrainWaitAsync(_eventsWaitTask).ConfigureAwait(false);

        // Let an in-progress open of a dedicated connection finish first (bounded),
        // so it cannot be assigned after the reset below and leak.
        bool locked;
        try
        {
            locked = await _dedicatedLock.WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false);
        }
        catch (ObjectDisposedException)
        {
            locked = false;
        }

        try
        {
            await ResetJobChannelAsync().ConfigureAwait(false);
            await ResetEventsChannelAsync().ConfigureAwait(false);
        }
        finally
        {
            if (locked)
            {
                _dedicatedLock.Release();
            }
        }

        // Queries never hold a connection beyond their own call, so there is
        // nothing to wait for: in-flight ones finish on their rented connection
        // and return it to the pool.
        ReleaseDataSources();
    }

    public async ValueTask DisposeAsync()
    {
        await CloseAsync().ConfigureAwait(false);
        _closeCts.Dispose();
        _readyLock.Dispose();
        _dedicatedLock.Dispose();
    }

    // ============================================================
    // Helpers
    // ============================================================

    internal static string QuoteSchemaName(string schema)
    {
        if (schema.Length > 63 || !SchemaNameRegex.IsMatch(schema))
        {
            throw new ArgumentException(
                $"BullMQ: invalid PostgreSQL schema name '{schema}'. Use a simple identifier starting " +
                "with a letter or underscore and containing only letters, digits, underscores, or $ (max 63 chars).");
        }

        return $"\"{schema}\"";
    }
}
