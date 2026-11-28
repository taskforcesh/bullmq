using System.Text.Json;
using System.Text.RegularExpressions;
using BullMQ.Postgres;
using Npgsql;
using Xunit;

namespace BullMQ.Tests;

/// <summary>
/// Cross-runtime compatibility of the PostgreSQL migration ledger: .NET must
/// record and read the same <c>migration</c> table as the Node.js, Python and
/// Elixir migrators, and adopt the ledger of schemas migrated by older .NET
/// releases (<c>bullmq_migration</c>). Each test works in its own throwaway
/// schema.
/// </summary>
public sealed class PostgresMigrationTests
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_POSTGRES")
        ?? $"Host=localhost;Database=bullmq_test;Username={Environment.UserName}";

    // The ledger DDL used by the Node.js migrator (and its tests).
    private const string NodeLedgerDdl =
        "CREATE TABLE migration (version integer PRIMARY KEY, name text NOT NULL, " +
        "min_client_version integer NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())";

    // A ledger created before `min_client_version` was introduced.
    private const string PreMinClientLedgerDdl =
        "CREATE TABLE migration (version integer PRIMARY KEY, name text NOT NULL, " +
        "applied_at timestamptz NOT NULL DEFAULT now())";

    // The ledger DDL used by .NET releases before the ledger was aligned.
    private const string LegacyDotnetLedgerDdl =
        "CREATE TABLE bullmq_migration (version integer PRIMARY KEY, name text NOT NULL, " +
        "applied_at timestamptz NOT NULL DEFAULT now())";

    private sealed record LedgerRow(int Version, string Name, int MinClientVersion, DateTime AppliedAt);

    private sealed record NodeMigration(int Version, string Name, int MinClientVersion);

    private static int LatestVersion => SqlLoader.NameToVersion(SqlLoader.MigrationFiles()[^1]);

    private static string NewSchema() => $"bullmq_ledger_{Guid.NewGuid():N}";

    [Fact]
    public void BundledMigrations_MatchTheNodeManifest()
    {
        var node = ReadNodeMigrations();

        Assert.Equal(
            node.Select(m => (m.Version, m.Name)),
            SqlLoader.MigrationFiles().Select(f => (SqlLoader.NameToVersion(f), f)));
        // .NET records BullMQMajorVersion for every migration it applies, so it
        // must match Node's per-migration value and the Node.js major version.
        Assert.All(node, m => Assert.Equal(PostgresConnection.BullMQMajorVersion, m.MinClientVersion));
        Assert.Equal(PostgresConnection.BullMQMajorVersion, ReadNodeMajorVersion());
    }

    [Fact]
    public async Task FreshSchema_RecordsTheSameLedgerAsNode()
    {
        var schema = NewSchema();
        try
        {
            await using (var conn = await OpenAsync())
            {
                Assert.Equal(LatestVersion, await PostgresConnection.RunMigrationsAsync(conn, schema, false));
            }

            var columns = await QueryAsync(
                "SELECT column_name, data_type, is_nullable, COALESCE(column_default, '') " +
                "FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'migration' " +
                "ORDER BY ordinal_position",
                r => (r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3)),
                schema);
            Assert.Equal(
                new[]
                {
                    ("version", "integer", "NO", ""),
                    ("name", "text", "NO", ""),
                    ("min_client_version", "integer", "NO", ""),
                    ("applied_at", "timestamp with time zone", "NO", "now()"),
                },
                columns);

            var primaryKey = await QueryAsync(
                "SELECT a.attname FROM pg_index i " +
                "JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) " +
                "WHERE i.indrelid = to_regclass($1) AND i.indisprimary",
                r => r.GetString(0),
                $"\"{schema}\".migration");
            Assert.Equal(new[] { "version" }, primaryKey);

            Assert.Equal(
                ReadNodeMigrations(),
                (await ReadLedgerAsync(schema)).Select(r => new NodeMigration(r.Version, r.Name, r.MinClientVersion)));
            Assert.False(await TableExistsAsync(schema, PostgresConnection.LegacyLedgerTable));

            // Idempotent: a second run is a no-op.
            await using (var conn = await OpenAsync())
            {
                Assert.Equal(LatestVersion, await PostgresConnection.RunMigrationsAsync(conn, schema, false));
            }

            Assert.Equal(LatestVersion, (await ReadLedgerAsync(schema)).Count);
        }
        finally
        {
            await DropSchemaAsync(schema);
        }
    }

    [Theory]
    [InlineData(1, true)]
    [InlineData(4, true)]
    [InlineData(10, true)]
    [InlineData(4, false)]
    public async Task NodeLedgerAtOlderVersion_AppliesOnlyPendingMigrations(int seededVersion, bool withMinClientColumn)
    {
        var schema = NewSchema();
        try
        {
            await SeedAsync(
                schema,
                withMinClientColumn ? NodeLedgerDdl : PreMinClientLedgerDdl,
                withMinClientColumn
                    ? "INSERT INTO migration (version, name, min_client_version) VALUES ($1, $2, 6)"
                    : "INSERT INTO migration (version, name) VALUES ($1, $2)",
                seededVersion);
            var before = await ReadLedgerAsync(schema, withMinClientColumn);

            await AssertQueueWorksAsync(schema);

            var after = await ReadLedgerAsync(schema);
            Assert.Equal(Enumerable.Range(1, LatestVersion), after.Select(r => r.Version));
            Assert.All(after, r => Assert.Equal(PostgresConnection.BullMQMajorVersion, r.MinClientVersion));
            // Already-applied migrations keep their original ledger rows.
            Assert.Equal(
                before.Select(r => (r.Version, r.Name, r.AppliedAt)),
                after.Take(seededVersion).Select(r => (r.Version, r.Name, r.AppliedAt)));
            Assert.False(await TableExistsAsync(schema, PostgresConnection.LegacyLedgerTable));
        }
        finally
        {
            await DropSchemaAsync(schema);
        }
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    public async Task LegacyDotnetLedger_IsAdoptedWithoutReapplyingMigrations(int pending)
    {
        var schema = NewSchema();
        var seededVersion = LatestVersion - pending;
        try
        {
            await SeedAsync(
                schema,
                LegacyDotnetLedgerDdl,
                "INSERT INTO bullmq_migration (version, name) VALUES ($1, $2)",
                seededVersion);
            var legacy = await ReadLegacyLedgerAsync(schema);

            await AssertQueueWorksAsync(schema);

            var after = await ReadLedgerAsync(schema);
            Assert.Equal(
                ReadNodeMigrations(),
                after.Select(r => new NodeMigration(r.Version, r.Name, r.MinClientVersion)));
            // Adopted rows keep the legacy applied_at (they were not re-applied).
            Assert.Equal(legacy, after.Take(seededVersion).Select(r => (r.Version, r.Name, r.AppliedAt)));
            // The legacy ledger is kept for older .NET instances: its rows are
            // untouched and it gains the newly applied shared-ledger rows.
            var legacyAfter = await ReadLegacyLedgerAsync(schema);
            Assert.Equal(legacy, legacyAfter.Take(seededVersion));
            Assert.Equal(after.Select(r => (r.Version, r.Name, r.AppliedAt)), legacyAfter);

            // Re-running after the adoption is a no-op.
            await using (var conn = await OpenAsync())
            {
                Assert.Equal(LatestVersion, await PostgresConnection.RunMigrationsAsync(conn, schema, false));
            }

            Assert.Equal(after, await ReadLedgerAsync(schema));
        }
        finally
        {
            await DropSchemaAsync(schema);
        }
    }

    [Fact]
    public async Task LegacyDotnetLedger_RowsMissingFromTheSharedLedgerAreAdopted()
    {
        // Mixed deployment: a schema already adopted by an upgraded instance at
        // version 2 while an older .NET instance kept recording in the legacy table.
        var schema = NewSchema();
        try
        {
            await SeedAsync(
                schema,
                LegacyDotnetLedgerDdl,
                "INSERT INTO bullmq_migration (version, name) VALUES ($1, $2)",
                LatestVersion);
            await ExecuteAsync(
                $"CREATE TABLE \"{schema}\".{NodeLedgerDdl["CREATE TABLE ".Length..]}; " +
                $"INSERT INTO \"{schema}\".migration (version, name, min_client_version) " +
                $"SELECT version, name, 6 FROM \"{schema}\".bullmq_migration WHERE version <= 2");

            await using (var conn = await OpenAsync())
            {
                Assert.Equal(LatestVersion, await PostgresConnection.RunMigrationsAsync(conn, schema, false));
            }

            Assert.Equal(
                ReadNodeMigrations(),
                (await ReadLedgerAsync(schema)).Select(r => new NodeMigration(r.Version, r.Name, r.MinClientVersion)));
        }
        finally
        {
            await DropSchemaAsync(schema);
        }
    }

    [Fact]
    public async Task LegacyDotnetLedger_IsReconciledWhenTheSharedLedgerIsAhead()
    {
        // An upgraded .NET instance adopted a legacy schema at version 2, then
        // another runtime advanced the shared ledger to the latest version. This
        // run has nothing pending but must still bring the legacy ledger up to
        // date, or older .NET instances would re-apply migrations 3..latest.
        var schema = NewSchema();
        try
        {
            await SeedAsync(
                schema,
                NodeLedgerDdl,
                "INSERT INTO migration (version, name, min_client_version) VALUES ($1, $2, 6)",
                LatestVersion);
            await ExecuteAsync(
                $"UPDATE \"{schema}\".migration " +
                "SET applied_at = timestamptz '2026-01-01 00:00:00+00' + version * interval '1 hour'");
            await ExecuteAsync(
                $"CREATE TABLE \"{schema}\".{LegacyDotnetLedgerDdl["CREATE TABLE ".Length..]}; " +
                $"INSERT INTO \"{schema}\".bullmq_migration (version, name, applied_at) " +
                $"SELECT version, name, applied_at FROM \"{schema}\".migration WHERE version <= 2");
            var shared = await ReadLedgerAsync(schema);

            for (var run = 0; run < 2; run++)
            {
                await using (var conn = await OpenAsync())
                {
                    Assert.Equal(LatestVersion, await PostgresConnection.RunMigrationsAsync(conn, schema, false));
                }

                Assert.Equal(shared, await ReadLedgerAsync(schema));
                Assert.Equal(
                    shared.Select(r => (r.Version, r.Name, r.AppliedAt)),
                    await ReadLegacyLedgerAsync(schema));
            }
        }
        finally
        {
            await DropSchemaAsync(schema);
        }
    }

    [Fact]
    public async Task MinClientVersion_AcceptsNewerSameMajorAndRejectsNewerMajor()
    {
        var schema = NewSchema();
        var futureVersion = LatestVersion + 1;
        try
        {
            await SeedAsync(
                schema,
                NodeLedgerDdl,
                "INSERT INTO migration (version, name, min_client_version) VALUES ($1, $2, 6)",
                LatestVersion);
            await ExecuteAsync(
                $"INSERT INTO \"{schema}\".migration (version, name, min_client_version) VALUES ($1, $2, $3)",
                futureVersion, "future-compatible", PostgresConnection.BullMQMajorVersion);

            // A newer schema from the same major is accepted and left alone.
            await using (var conn = await OpenAsync())
            {
                Assert.Equal(futureVersion, await PostgresConnection.RunMigrationsAsync(conn, schema, false));
            }

            Assert.Equal(futureVersion, (await ReadLedgerAsync(schema)).Count);

            var newerMajor = PostgresConnection.BullMQMajorVersion + 1;
            await ExecuteAsync(
                $"UPDATE \"{schema}\".migration SET min_client_version = $1 WHERE version = $2",
                newerMajor, futureVersion);
            var before = await ReadLedgerAsync(schema);

            await using (var conn = await OpenAsync())
            {
                var err = await Assert.ThrowsAsync<SchemaVersionMismatchException>(
                    () => PostgresConnection.RunMigrationsAsync(conn, schema, false));
                Assert.Equal(newerMajor, err.MinimumClientVersion);
                Assert.Equal(PostgresConnection.BullMQMajorVersion, err.ClientVersion);
            }

            // The rejected run is rolled back and does not touch the ledger.
            Assert.Equal(before, await ReadLedgerAsync(schema));

            // Backends refuse to start against the incompatible schema.
            var backend = PostgresBackend.Create(
                $"dotnet-ledger-{Guid.NewGuid():N}",
                new PostgresOptions { ConnectionString = ConnectionString, Schema = schema },
                30000);
            try
            {
                await Assert.ThrowsAsync<SchemaVersionMismatchException>(() => backend.WaitUntilReadyAsync());
            }
            finally
            {
                await backend.CloseAsync();
            }
        }
        finally
        {
            await DropSchemaAsync(schema);
        }
    }

    [Fact]
    public async Task MinClientVersion_IsCheckedForEveryInstanceAfterTheMigrationIsCached()
    {
        var schema = NewSchema();
        var options = new PostgresOptions { ConnectionString = ConnectionString, Schema = schema };
        try
        {
            // Warm the per-process migration cache for this connection string.
            await using (var warm = new PostgresConnection(options))
            {
                await warm.WaitUntilReadyAsync();
            }

            var newerMajor = PostgresConnection.BullMQMajorVersion + 1;
            await ExecuteAsync(
                $"UPDATE \"{schema}\".migration SET min_client_version = $1 WHERE version = $2",
                newerMajor, LatestVersion);

            await using (var incompatible = new PostgresConnection(options))
            {
                var err = await Assert.ThrowsAsync<SchemaVersionMismatchException>(
                    () => incompatible.WaitUntilReadyAsync());
                Assert.Equal(newerMajor, err.MinimumClientVersion);
                Assert.Equal(PostgresConnection.BullMQMajorVersion, err.ClientVersion);
                await Assert.ThrowsAsync<SchemaVersionMismatchException>(
                    () => incompatible.RunAsync("SELECT 1", Array.Empty<object?>()));
            }

            await ExecuteAsync(
                $"UPDATE \"{schema}\".migration SET min_client_version = $1 WHERE version = $2",
                PostgresConnection.BullMQMajorVersion, LatestVersion);
            await using (var compatible = new PostgresConnection(options))
            {
                await compatible.WaitUntilReadyAsync();
            }
        }
        finally
        {
            await DropSchemaAsync(schema);
        }
    }

    [Fact]
    public async Task CachedSchemaWithoutLedger_IsMigratedAgain()
    {
        var schema = NewSchema();
        var options = new PostgresOptions { ConnectionString = ConnectionString, Schema = schema };
        try
        {
            await using (var warm = new PostgresConnection(options))
            {
                await warm.WaitUntilReadyAsync();
            }

            await DropSchemaAsync(schema);

            await using (var next = new PostgresConnection(options))
            {
                await next.WaitUntilReadyAsync();
            }

            Assert.Equal(LatestVersion, (await ReadLedgerAsync(schema)).Count);
        }
        finally
        {
            await DropSchemaAsync(schema);
        }
    }

    [Fact]
    public async Task CachedCompatibilityCheck_DoesNotBlockAnotherSchema()
    {
        var blockedSchema = NewSchema();
        var otherSchema = NewSchema();
        var blockedOptions = new PostgresOptions
        {
            ConnectionString = ConnectionString,
            Schema = blockedSchema,
            PoolSize = 1,
        };
        var otherOptions = new PostgresOptions { ConnectionString = ConnectionString, Schema = otherSchema };
        try
        {
            await using (var warm = new PostgresConnection(blockedOptions))
            {
                await warm.WaitUntilReadyAsync();
            }

            await using (var warm = new PostgresConnection(otherOptions))
            {
                await warm.WaitUntilReadyAsync();
            }

            var heldConnection = new PostgresConnection(blockedOptions);
            var cachedConnection = new PostgresConnection(blockedOptions);
            var otherConnection = new PostgresConnection(otherOptions);
            try
            {
                await heldConnection.WaitUntilReadyAsync();
                var heldQuery = heldConnection.RunAsync("SELECT pg_sleep(2)", Array.Empty<object?>());
                await Task.Delay(100);
                Assert.False(heldQuery.IsCompleted);

                var cachedCheck = cachedConnection.WaitUntilReadyAsync();
                await Task.Delay(100);
                Assert.False(cachedCheck.IsCompleted);

                var otherCheck = otherConnection.WaitUntilReadyAsync();
                var otherCheckIsPrompt = await Task.WhenAny(otherCheck, Task.Delay(TimeSpan.FromSeconds(1))) == otherCheck;
                await Task.WhenAll(heldQuery, cachedCheck, otherCheck);
                Assert.True(otherCheckIsPrompt, "A cached check for another schema waited on the busy pool.");
            }
            finally
            {
                await heldConnection.DisposeAsync();
                await cachedConnection.DisposeAsync();
                await otherConnection.DisposeAsync();
            }
        }
        finally
        {
            await DropSchemaAsync(blockedSchema);
            await DropSchemaAsync(otherSchema);
        }
    }

    // ============================================================
    // Helpers
    // ============================================================

    private static QueueOptions QueueOptionsFor(string schema) =>
        new() { Postgres = new PostgresOptions { ConnectionString = ConnectionString, Schema = schema } };

    // Starts a queue on the schema (running the .NET migrator end-to-end) and
    // checks it can operate.
    private static async Task AssertQueueWorksAsync(string schema)
    {
        await using var queue = new Queue($"dotnet-ledger-{Guid.NewGuid():N}", QueueOptionsFor(schema));
        await queue.AddAsync("job", new { x = 1 });
        Assert.Equal(1, await queue.GetWaitingCountAsync());
    }

    // Simulates a schema migrated by another runtime / an older release: applies
    // the bundled migrations up to `version` and records them in a ledger.
    private static async Task SeedAsync(string schema, string ledgerDdl, string insertSql, int version)
    {
        await using var conn = await OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        await ExecuteAsync(conn, tx, $"CREATE SCHEMA \"{schema}\"");
        await ExecuteAsync(conn, tx, $"SET LOCAL search_path TO \"{schema}\"");
        await ExecuteAsync(conn, tx, ledgerDdl);
        foreach (var file in SqlLoader.MigrationFiles().Where(f => SqlLoader.NameToVersion(f) <= version))
        {
            await ExecuteAsync(conn, tx, SqlLoader.LoadMigration(file));
            await ExecuteAsync(conn, tx, insertSql, SqlLoader.NameToVersion(file), file);
        }

        await tx.CommitAsync();
    }

    private static Task<List<LedgerRow>> ReadLedgerAsync(string schema, bool withMinClientColumn = true) =>
        QueryAsync(
            withMinClientColumn
                ? $"SELECT version, name, min_client_version, applied_at FROM \"{schema}\".migration ORDER BY version"
                : $"SELECT version, name, 0, applied_at FROM \"{schema}\".migration ORDER BY version",
            r => new LedgerRow(r.GetInt32(0), r.GetString(1), r.GetInt32(2), r.GetDateTime(3)));

    private static Task<List<(int, string, DateTime)>> ReadLegacyLedgerAsync(string schema) =>
        QueryAsync(
            $"SELECT version, name, applied_at FROM \"{schema}\".bullmq_migration ORDER BY version",
            r => (r.GetInt32(0), r.GetString(1), r.GetDateTime(2)));

    private static async Task<bool> TableExistsAsync(string schema, string table) =>
        (await QueryAsync("SELECT to_regclass($1) IS NOT NULL", r => r.GetBoolean(0), $"\"{schema}\".{table}"))[0];

    private static async Task<NpgsqlConnection> OpenAsync()
    {
        var conn = new NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();
        return conn;
    }

    private static async Task<List<T>> QueryAsync<T>(string sql, Func<NpgsqlDataReader, T> map, params object[] parameters)
    {
        await using var conn = await OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, conn);
        foreach (var value in parameters)
        {
            cmd.Parameters.Add(new NpgsqlParameter { Value = value });
        }

        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<T>();
        while (await reader.ReadAsync())
        {
            rows.Add(map(reader));
        }

        return rows;
    }

    private static async Task ExecuteAsync(string sql, params object[] parameters)
    {
        await using var conn = await OpenAsync();
        await ExecuteAsync(conn, null, sql, parameters);
    }

    private static async Task ExecuteAsync(
        NpgsqlConnection conn, NpgsqlTransaction? tx, string sql, params object[] parameters)
    {
        await using var cmd = new NpgsqlCommand(sql, conn, tx);
        foreach (var value in parameters)
        {
            cmd.Parameters.Add(new NpgsqlParameter { Value = value });
        }

        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task DropSchemaAsync(string schema)
    {
        Assert.StartsWith("bullmq_ledger_", schema);
        await ExecuteAsync($"DROP SCHEMA IF EXISTS \"{schema}\" CASCADE");
    }

    private static string RepoRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "src", "postgres", "migrations", "index.ts")))
            {
                return dir.FullName;
            }
        }

        throw new InvalidOperationException("Could not locate the repository root (src/postgres/migrations).");
    }

    // The Node.js migration manifest (src/postgres/migrations/index.ts) is the
    // source of truth for each migration's version, name and minClientVersion.
    private static List<NodeMigration> ReadNodeMigrations()
    {
        var source = File.ReadAllText(Path.Combine(RepoRoot(), "src", "postgres", "migrations", "index.ts"));
        var entries = Regex.Matches(
                source,
                @"\{\s*version:\s*(\d+),\s*name:\s*'([^']+)',.*?minClientVersion:\s*(\d+)",
                RegexOptions.Singleline)
            .Select(m => new NodeMigration(int.Parse(m.Groups[1].Value), m.Groups[2].Value, int.Parse(m.Groups[3].Value)))
            .ToList();
        Assert.NotEmpty(entries);
        return entries;
    }

    private static int ReadNodeMajorVersion()
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(RepoRoot(), "package.json")));
        return int.Parse(doc.RootElement.GetProperty("version").GetString()!.Split('.')[0]);
    }
}
