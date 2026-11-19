using System.Diagnostics;
using System.Globalization;
using BullMQ.Postgres;
using Npgsql;
using Xunit;

namespace BullMQ.Tests;

/// <summary>
/// Connection handling of the PostgreSQL backend: queries run on a shared,
/// bounded connection pool, while worker discovery (application_name) lives only
/// on the dedicated LISTEN connections.
/// </summary>
public sealed class PostgresConnectionPoolTests
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_POSTGRES")
        ?? $"Host=localhost;Database=bullmq_test;Username={Environment.UserName}";

    private static PostgresOptions Options(int? poolSize = null, string? connectionStringSuffix = null) => new()
    {
        ConnectionString = connectionStringSuffix is null
            ? ConnectionString
            : $"{ConnectionString};{connectionStringSuffix}",
        PoolSize = poolSize,
    };

    private static string Marker() => $"bullmq_pool_test_{Guid.NewGuid():N}";

    private static async Task<int> CountSessionsAsync(NpgsqlConnection monitor, string marker, bool activeOnly)
    {
        await using var cmd = new NpgsqlCommand(
            "SELECT count(*)::int FROM pg_stat_activity " +
            "WHERE query LIKE $1 AND pid <> pg_backend_pid() AND ($2 = false OR state = 'active')",
            monitor);
        cmd.Parameters.Add(new NpgsqlParameter { Value = $"%{marker}%" });
        cmd.Parameters.Add(new NpgsqlParameter { Value = activeOnly });
        return (int)(await cmd.ExecuteScalarAsync())!;
    }

    // Runs `count` concurrent pg_sleep calls through the connection, sampling
    // pg_stat_activity for the peak number of them executing at once.
    private static async Task<(TimeSpan Elapsed, int PeakActive)> RunConcurrentSleepsAsync(
        PostgresConnection connection, int count, double seconds)
    {
        await connection.WaitUntilReadyAsync();
        var marker = Marker();
        var sql = $"SELECT pg_sleep({seconds.ToString(CultureInfo.InvariantCulture)}) /* {marker} */";

        await using var monitor = new NpgsqlConnection(ConnectionString);
        await monitor.OpenAsync();
        var peak = 0;
        using var stop = new CancellationTokenSource();
        var sampler = Task.Run(async () =>
        {
            while (!stop.IsCancellationRequested)
            {
                peak = Math.Max(peak, await CountSessionsAsync(monitor, marker, activeOnly: true));
                await Task.Delay(20);
            }
        });

        var sw = Stopwatch.StartNew();
        await Task.WhenAll(Enumerable.Range(0, count)
            .Select(_ => connection.RunAsync(sql, Array.Empty<object?>())));
        sw.Stop();

        stop.Cancel();
        await sampler;
        return (sw.Elapsed, peak);
    }

    private static int CountName(IReadOnlyList<string> clientList, string name) =>
        clientList
            .SelectMany(block => block.Split('\n'))
            .Count(line => line == $"name={name}");

    [Theory]
    [InlineData(8, null)]
    [InlineData(null, "Pooling=false")]
    public async Task ConcurrentQueries_OnOneConnection_RunInParallel(int? poolSize, string? connectionStringSuffix)
    {
        await using var connection = new PostgresConnection(Options(poolSize, connectionStringSuffix));

        var (elapsed, peak) = await RunConcurrentSleepsAsync(connection, count: 8, seconds: 0.5);

        // Serialized through one session this would take 8 x 0.5s = 4s.
        Assert.True(elapsed < TimeSpan.FromSeconds(1.5), $"8 concurrent 0.5s sleeps took {elapsed}");
        Assert.Equal(8, peak);
    }

    [Theory]
    [InlineData(2, null, 2)]
    [InlineData(null, "Maximum Pool Size=3", 3)]
    [InlineData(2, "Maximum Pool Size=5", 2)]
    [InlineData(null, null, PostgresOptions.DefaultPoolSize)]
    public async Task PoolSize_BoundsConcurrentQueries(int? poolSize, string? connectionStringSuffix, int expected)
    {
        await using var connection = new PostgresConnection(Options(poolSize, connectionStringSuffix));

        var (elapsed, peak) = await RunConcurrentSleepsAsync(connection, count: expected * 2, seconds: 0.3);

        Assert.Equal(expected, peak);
        // Twice as many calls as connections: they must run in two waves.
        Assert.True(elapsed >= TimeSpan.FromSeconds(0.55), $"{expected * 2} sleeps finished in {elapsed}");
    }

    [Fact]
    public void PoolSize_MustBePositive()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new PostgresConnection(Options(poolSize: 0)));
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("No Reset On Close=false", false)]
    public async Task PooledSessions_AreNotResetOnReturn_UnlessConfigured(string? connectionStringSuffix, bool kept)
    {
        // A single pooled session, so both calls run on the same server session.
        await using var connection = new PostgresConnection(Options(poolSize: 1, connectionStringSuffix));
        await connection.RunAsync("SELECT set_config('bullmq.pool_test', 'kept', false)", Array.Empty<object?>());

        var row = (await connection.RunAsync(
            "SELECT current_setting('bullmq.pool_test', true) AS value", Array.Empty<object?>())).FirstMap()!;

        Assert.Equal(kept, Equals(row["value"], "kept"));
    }

    [Fact]
    public async Task PooledConnections_UseSchemaSearchPath_AndStayUnnamed()
    {
        await using var connection = new PostgresConnection(Options());
        var name = $"bullmq:pool-test-{Guid.NewGuid():N}";
        await connection.SetApplicationNameAsync(name);

        var results = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => connection.RunAsync(
            "SELECT current_setting('search_path') AS search_path, " +
            "current_setting('application_name') AS application_name, pg_sleep(0.2)",
            Array.Empty<object?>())));

        foreach (var row in results.Select(r => r.FirstMap()!))
        {
            Assert.Equal(connection.Schema, row["search_path"]);
            Assert.Equal(string.Empty, row["application_name"]);
        }

        await using var monitor = new NpgsqlConnection(ConnectionString);
        await monitor.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            "SELECT count(*)::int FROM pg_stat_activity WHERE application_name = $1", monitor);
        cmd.Parameters.Add(new NpgsqlParameter { Value = name });
        Assert.Equal(1, (int)(await cmd.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task Discovery_ListsEachNamedBackendOnce_AndDropsClosedOnes()
    {
        var options = Options();
        var queue = PostgresBackend.Create($"dotnet-pool-{Guid.NewGuid():N}", options);
        var workerA = PostgresBackend.Create($"dotnet-pool-{Guid.NewGuid():N}", options);
        var workerB = PostgresBackend.Create($"dotnet-pool-{Guid.NewGuid():N}", options);
        try
        {
            var nameA = workerA.ClientName(":w");
            var nameB = workerB.ClientName(":w");
            await workerA.SetNameAsync(nameA);
            await workerB.SetNameAsync(nameB);

            // Churn the shared pool from every backend, including a blocking wait.
            var waitA = workerA.WaitForJobAsync(0.3);
            await Task.WhenAll(Enumerable.Range(0, 30).Select(i =>
                (i % 3 == 0 ? queue : i % 3 == 1 ? workerA : workerB).GetCountsAsync("waiting")));
            Assert.Null(await waitA);

            var clients = await queue.GetClientListAsync();
            Assert.Equal(1, CountName(clients, nameA));
            Assert.Equal(1, CountName(clients, nameB));

            await workerA.CloseAsync();

            var deadline = DateTime.UtcNow.AddSeconds(5);
            while (CountName(await queue.GetClientListAsync(), nameA) > 0 && DateTime.UtcNow < deadline)
            {
                await Task.Delay(50);
            }

            clients = await queue.GetClientListAsync();
            Assert.Equal(0, CountName(clients, nameA));
            Assert.Equal(1, CountName(clients, nameB));
        }
        finally
        {
            await workerA.CloseAsync();
            await workerB.CloseAsync();
            await queue.CloseAsync();
        }
    }

    [Fact]
    public async Task SetName_DuringBlockingWait_IsAppliedBeforeTheNextWait()
    {
        var options = Options();
        var queue = PostgresBackend.Create($"dotnet-pool-{Guid.NewGuid():N}", options);
        var worker = PostgresBackend.Create($"dotnet-pool-{Guid.NewGuid():N}", options);
        try
        {
            var name = worker.ClientName(":w");
            await worker.WaitUntilReadyAsync();

            var wait = worker.WaitForJobAsync(0.6);
            await Task.Delay(150);
            // Must neither throw nor disturb the wait parked on the connection.
            await worker.SetNameAsync(name).WaitAsync(TimeSpan.FromSeconds(1));
            Assert.Null(await wait);

            Assert.Null(await worker.WaitForJobAsync(0.05));
            Assert.Equal(1, CountName(await queue.GetClientListAsync(), name));
        }
        finally
        {
            await worker.CloseAsync();
            await queue.CloseAsync();
        }
    }

    [Fact]
    public async Task Close_ReleasesPooledConnections_WithoutWaitingForInFlightQueries()
    {
        // A pool size no other test uses, so this connection is the pool's only user.
        var connection = new PostgresConnection(Options(poolSize: 4));
        var marker = Marker();
        await using var monitor = new NpgsqlConnection(ConnectionString);
        await monitor.OpenAsync();
        try
        {
            await connection.WaitUntilReadyAsync();
            await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => connection.RunAsync(
                $"SELECT pg_sleep(0.1) /* {marker} */", Array.Empty<object?>())));
            Assert.Equal(4, await CountSessionsAsync(monitor, marker, activeOnly: false));

            var inFlight = connection.RunAsync($"SELECT pg_sleep(0.6) /* {marker} */", Array.Empty<object?>());
            await Task.Delay(100);

            var sw = Stopwatch.StartNew();
            await connection.CloseAsync().WaitAsync(TimeSpan.FromSeconds(5));
            Assert.True(sw.Elapsed < TimeSpan.FromSeconds(0.4), $"close took {sw.Elapsed}");

            await inFlight; // the running query still completes
            await Assert.ThrowsAsync<ObjectDisposedException>(
                () => connection.RunAsync("SELECT 1", Array.Empty<object?>()));

            var deadline = DateTime.UtcNow.AddSeconds(5);
            while (await CountSessionsAsync(monitor, marker, activeOnly: false) > 0 && DateTime.UtcNow < deadline)
            {
                await Task.Delay(50);
            }

            Assert.Equal(0, await CountSessionsAsync(monitor, marker, activeOnly: false));
        }
        finally
        {
            await connection.DisposeAsync();
        }
    }

    // Occupies every slot of the pool with a sleep, then starts one more call,
    // which is left parked waiting for a slot. All calls are tagged with marker.
    private static async Task<(Task[] Blockers, Task Waiter)> SaturatePoolAsync(
        PostgresConnection connection, NpgsqlConnection monitor, string marker, int size)
    {
        await connection.WaitUntilReadyAsync();
        var blockers = Enumerable.Range(0, size).Select(_ => (Task)connection.RunAsync(
            $"SELECT pg_sleep(0.5) /* {marker} */", Array.Empty<object?>())).ToArray();
        await WaitUntilAsync(async () => await CountSessionsAsync(monitor, marker, activeOnly: true) == size);

        var waiter = connection.RunAsync($"SELECT 1 /* {marker} */", Array.Empty<object?>());
        await Task.Delay(100);
        Assert.False(waiter.IsCompleted);
        return (blockers, waiter);
    }

    [Fact]
    public async Task Close_WhileACallWaitsForAPoolSlot_LeavesNoIdlePooledSession()
    {
        // A pool size no other test uses, so this connection is the pool's only user.
        const int size = 5;
        var connection = new PostgresConnection(Options(poolSize: size));
        var marker = Marker();
        await using var monitor = new NpgsqlConnection(ConnectionString);
        await monitor.OpenAsync();
        try
        {
            var (blockers, waiter) = await SaturatePoolAsync(connection, monitor, marker, size);

            var sw = Stopwatch.StartNew();
            await connection.CloseAsync().WaitAsync(TimeSpan.FromSeconds(5));
            Assert.True(sw.Elapsed < TimeSpan.FromSeconds(0.3), $"close took {sw.Elapsed}");

            // The cleared blockers' connections are discarded on return, so the
            // waiter opens a fresh one and returns it after the close-time clear.
            await Task.WhenAll(blockers);
            await waiter;

            await WaitUntilAsync(async () => await CountSessionsAsync(monitor, marker, activeOnly: false) == 0);
            Assert.Equal(0, await CountSessionsAsync(monitor, marker, activeOnly: false));
        }
        finally
        {
            await connection.DisposeAsync();
        }
    }

    [Fact]
    public async Task StragglerReturn_AfterThePoolIsReacquired_LeavesTheNewUsersPoolAlone()
    {
        // A pool size no other test uses, so these connections are the pool's only users.
        const int size = 7;
        var first = new PostgresConnection(Options(poolSize: size));
        PostgresConnection? second = null;
        var marker = Marker();
        await using var monitor = new NpgsqlConnection(ConnectionString);
        await monitor.OpenAsync();
        try
        {
            var (blockers, waiter) = await SaturatePoolAsync(first, monitor, marker, size);
            await first.CloseAsync();
            second = new PostgresConnection(Options(poolSize: size));

            await Task.WhenAll(blockers);
            await waiter;

            // The waiter's connection now belongs to the second user's pool.
            await Task.Delay(300);
            Assert.Equal(1, await CountSessionsAsync(monitor, marker, activeOnly: false));

            await second.CloseAsync();
            await WaitUntilAsync(async () => await CountSessionsAsync(monitor, marker, activeOnly: false) == 0);
            Assert.Equal(0, await CountSessionsAsync(monitor, marker, activeOnly: false));
        }
        finally
        {
            await first.DisposeAsync();
            if (second is not null)
            {
                await second.DisposeAsync();
            }
        }
    }

    private static async Task WaitUntilAsync(Func<Task<bool>> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (!await condition() && DateTime.UtcNow < deadline)
        {
            await Task.Delay(50);
        }
    }
}
