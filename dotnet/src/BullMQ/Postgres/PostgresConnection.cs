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
/// Owns the PostgreSQL connectivity for a backend: a pooled connection used for
/// regular queries and a dedicated <c>LISTEN</c> connection used by the blocking
/// "wait for job" primitive. Also applies the shared schema migrations on first
/// use, guarded by a per-schema advisory lock so concurrent starters migrate
/// exactly once.
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
    private readonly bool _skipVersionCheck;
    private readonly SemaphoreSlim _readyLock = new(1, 1);
    private readonly SemaphoreSlim _connLock = new(1, 1);
    private readonly CancellationTokenSource _closeCts = new();
    private Task? _jobWaitTask;
    private Task? _eventsWaitTask;

    private bool _ready;
    private volatile bool _closed;
    private NpgsqlConnection? _conn;
    private NpgsqlConnection? _listenConn;
    private bool _jobChannelListening;
    private NpgsqlConnection? _eventsConn;
    private bool _eventsChannelListening;
    private string? _applicationName;

    public string Schema { get; }

    /// <summary>True once the connection has been closed; it will not reconnect.</summary>
    public bool IsClosing => _closed;

    public PostgresConnection(PostgresOptions options)
    {
        Schema = options.Schema;
        _skipVersionCheck = options.SkipVersionCheck;
        QuoteSchemaName(Schema); // validate early

        var builder = new NpgsqlConnectionStringBuilder(options.ConnectionString)
        {
            SearchPath = Schema,
        };
        _connectionString = builder.ConnectionString;
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
    // connection string per process. Doing them per-instance would repeatedly
    // invalidate Npgsql's shared type cache and, under concurrency (e.g. many
    // queues/workers/tests starting at once), trigger a catalog-reload storm
    // across every other connection — turning startup into tens of seconds.
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

            await using var conn = await OpenWithRetryAsync().ConfigureAwait(false);
            await RunMigrationsAsync(conn).ConfigureAwait(false);

            // The migrations create custom types (e.g. the job-state enum). Npgsql
            // caches the database type catalog on first connect (before those types
            // existed), so reload it once now so subsequent connections resolve the
            // new types (and read the unmapped enum columns as strings).
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

        // A single persistent connection serialized by a lock (matching the
        // reference runtimes). Concurrency across queues/workers comes from their
        // separate connections; the blocking wait uses its own dedicated
        // connection so it never holds this lock. Reusing one connection avoids
        // per-operation connect overhead (and the type-catalog reload that a
        // fresh physical connection incurs after migrations).
        await _connLock.WaitAsync().ConfigureAwait(false);
        try
        {
            var conn = await GetConnAsync().ConfigureAwait(false);
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
        finally
        {
            _connLock.Release();
        }
    }

    private async Task<NpgsqlConnection> GetConnAsync()
    {
        if (_closed)
        {
            throw new ObjectDisposedException(nameof(PostgresConnection));
        }

        if (_conn is null || _conn.State != System.Data.ConnectionState.Open)
        {
            _conn = await OpenWithRetryAsync().ConfigureAwait(false);
        }

        return _conn;
    }

    /// <summary>
    /// Opens a fresh physical connection, retrying a few times on transient
    /// failures. Some servers (notably Postgres.app on macOS) intermittently
    /// reject connections under a burst of opens; a short backoff makes
    /// connection establishment resilient without masking a real outage.
    /// </summary>
    private async Task<NpgsqlConnection> OpenWithRetryAsync()
    {
        const int maxAttempts = 5;
        NpgsqlException? last = null;
        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            var conn = new NpgsqlConnection(_connectionString);
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

    public async Task SetApplicationNameAsync(string name)
    {
        if (string.IsNullOrEmpty(name))
        {
            return;
        }

        _applicationName = name;
        await RunAsync("SELECT set_config('application_name', $1, false)", new object?[] { name })
            .ConfigureAwait(false);
    }

    // ============================================================
    // LISTEN/NOTIFY (blocking wait)
    // ============================================================

    /// <summary>Returns the dedicated LISTEN connection, subscribing to <c>bullmq_jobs</c> once.</summary>
    public async Task<NpgsqlConnection> EnsureJobChannelAsync()
    {
        if (_closed)
        {
            throw new ObjectDisposedException(nameof(PostgresConnection));
        }

        if (_listenConn is null || _listenConn.State != System.Data.ConnectionState.Open)
        {
            _listenConn = await OpenWithRetryAsync().ConfigureAwait(false);
            _jobChannelListening = false;
            if (_applicationName is not null)
            {
                await using var cmd = new NpgsqlCommand(
                    "SELECT set_config('application_name', $1, false)", _listenConn);
                cmd.Parameters.Add(new NpgsqlParameter { Value = _applicationName });
                await cmd.ExecuteNonQueryAsync().ConfigureAwait(false);
            }
        }

        if (!_jobChannelListening)
        {
            await using var cmd = new NpgsqlCommand($"LISTEN {JobsChannel}", _listenConn);
            await cmd.ExecuteNonQueryAsync().ConfigureAwait(false);
            _jobChannelListening = true;
        }

        return _listenConn;
    }

    /// <summary>Waits up to <paramref name="timeout"/> for a NOTIFY on the job channel.</summary>
    public Task WaitForNotificationAsync(NpgsqlConnection listenConn, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        // Track the wait so CloseAsync can let it fully unwind before closing the
        // connection (closing a connection with a live WaitAsync read makes
        // Npgsql hang trying to drain it).
        var task = WaitCoreAsync(listenConn, timeout, isEvents: false, cancellationToken);
        _jobWaitTask = task;
        return task;
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
        if (_closed)
        {
            throw new ObjectDisposedException(nameof(PostgresConnection));
        }

        if (_eventsConn is null || _eventsConn.State != System.Data.ConnectionState.Open)
        {
            _eventsConn = await OpenWithRetryAsync().ConfigureAwait(false);
            _eventsChannelListening = false;
            if (_applicationName is not null)
            {
                await using var cmd = new NpgsqlCommand(
                    "SELECT set_config('application_name', $1, false)", _eventsConn);
                cmd.Parameters.Add(new NpgsqlParameter { Value = _applicationName });
                await cmd.ExecuteNonQueryAsync().ConfigureAwait(false);
            }
        }

        if (!_eventsChannelListening)
        {
            await using var cmd = new NpgsqlCommand($"LISTEN {EventsChannel}", _eventsConn);
            await cmd.ExecuteNonQueryAsync().ConfigureAwait(false);
            _eventsChannelListening = true;
        }

        return _eventsConn;
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

        await ResetJobChannelAsync().ConfigureAwait(false);
        await ResetEventsChannelAsync().ConfigureAwait(false);

        // Serialize with in-flight queries so we never dispose the connection
        // out from under an executing command (which can hang under load).
        await _connLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_conn is not null)
            {
                try
                {
                    await _conn.CloseAsync().ConfigureAwait(false);
                    await _conn.DisposeAsync().ConfigureAwait(false);
                }
                catch
                {
                    // ignore
                }

                _conn = null;
            }
        }
        finally
        {
            _connLock.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        await CloseAsync().ConfigureAwait(false);
        _closeCts.Dispose();
        _readyLock.Dispose();
        _connLock.Dispose();
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
