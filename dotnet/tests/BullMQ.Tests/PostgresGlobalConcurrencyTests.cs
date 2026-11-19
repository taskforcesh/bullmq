using System.Diagnostics;
using BullMQ;
using BullMQ.Postgres;
using Xunit;

namespace BullMQ.Tests;

/// <summary>
/// PostgreSQL worker wait behaviour while a queue is at its global concurrency
/// limit: a worker must block (not re-poll) and still claim the next job as soon
/// as a slot frees.
/// </summary>
public sealed class PostgresGlobalConcurrencyTests
{
    private const string Token = "global-concurrency-token";

    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_POSTGRES")
        ?? $"Host=localhost;Database=bullmq_test;Username={Environment.UserName}";

    private static string UniqueName() => $"dotnet-gc-{Guid.NewGuid():N}";

    // A queue with global concurrency 1, one job active and `waitingJobs` more
    // waiting, so no further job can be claimed.
    private static async Task<(PostgresBackend Backend, Job Active)> CreateMaxedQueueAsync(int waitingJobs)
    {
        var name = UniqueName();
        var backend = PostgresBackend.Create(name, new PostgresOptions { ConnectionString = ConnectionString }, 30000);
        await backend.WaitUntilReadyAsync();
        await backend.SetQueueMetaAsync(new Dictionary<string, object> { ["concurrency"] = 1 });
        for (var i = 0; i <= waitingJobs; i++)
        {
            await Job.CreateAsync(backend, name, "job", new { i }, new JobsOptions());
        }

        var claimed = await backend.MoveToActiveAsync(Token);
        Assert.NotNull(claimed.Job);
        Assert.Null((await backend.MoveToActiveAsync(Token)).Job);
        return (backend, Job.FromJson(backend, name, claimed.Job!, claimed.JobId));
    }

    private static async Task CleanupAsync(PostgresBackend backend)
    {
        try
        {
            await backend.PauseAsync(true);
            while (await backend.ObliterateAsync(force: true, count: 1000) != 0)
            {
            }
        }
        finally
        {
            await backend.DisposeAsync();
        }
    }

    [Fact]
    public async Task WaitForJob_BlocksWhileQueueIsMaxed()
    {
        var (backend, active) = await CreateMaxedQueueAsync(waitingJobs: 2);
        try
        {
            var sw = Stopwatch.StartNew();
            var marker = await backend.WaitForJobAsync(1.0);
            Assert.Null(marker);
            Assert.True(sw.ElapsedMilliseconds >= 900, $"returned after {sw.ElapsedMilliseconds} ms");

            // Once the active job finishes a slot is free again, so the next
            // wait reports the waiting job right away.
            await backend.MoveToCompletedAsync(active, "null", false, Token, fetchNext: false);
            sw.Restart();
            Assert.NotNull(await backend.WaitForJobAsync(5.0));
            Assert.True(sw.ElapsedMilliseconds < 1000, $"returned after {sw.ElapsedMilliseconds} ms");
        }
        finally
        {
            await CleanupAsync(backend);
        }
    }

    [Fact]
    public async Task WaitForJob_WakesWhenOwnJobFreesSlot()
    {
        var (backend, active) = await CreateMaxedQueueAsync(waitingJobs: 1);
        try
        {
            var sw = Stopwatch.StartNew();
            var wait = backend.WaitForJobAsync(5.0);
            await Task.Delay(300);
            Assert.False(wait.IsCompleted);

            // Finishing does not NOTIFY (as in Redis), but the in-flight wait on
            // the same backend must still wake instead of sleeping out the block.
            await backend.MoveToCompletedAsync(active, "null", false, Token, fetchNext: false);
            Assert.NotNull(await wait.WaitAsync(TimeSpan.FromSeconds(10)));
            Assert.True(sw.ElapsedMilliseconds < 2000, $"returned after {sw.ElapsedMilliseconds} ms");
        }
        finally
        {
            await CleanupAsync(backend);
        }
    }

    [Fact]
    public async Task Worker_DoesNotSpinWhileMaxed_AndPicksUpNextJobPromptly()
    {
        var name = UniqueName();
        var options = new PostgresOptions { ConnectionString = ConnectionString };
        await using var queue = new Queue(name, new QueueOptions { Postgres = options });
        var backend = await queue.GetBackendAsync();
        await backend.SetQueueMetaAsync(new Dictionary<string, object> { ["concurrency"] = 1 });

        // Count this process's move_to_active round trips via Npgsql tracing.
        // Tests run serially (see AssemblyInfo), so only this test's worker is
        // claiming jobs meanwhile.
        long moveToActiveCalls = 0;
        using var listener = new ActivityListener
        {
            ShouldListenTo = source => source.Name.StartsWith("Npgsql", StringComparison.Ordinal),
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllDataAndRecorded,
            ActivityStopped = activity =>
            {
                if (activity.TagObjects.Any(t => t.Value is string s && s.Contains("move_to_active(", StringComparison.Ordinal)))
                {
                    Interlocked.Increment(ref moveToActiveCalls);
                }
            },
        };
        ActivitySource.AddActivityListener(listener);

        var clock = Stopwatch.StartNew();
        long firstDoneAt = 0, secondStartedAt = 0, callsWhileMaxed = 0;
        var secondStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var worker = new Worker(
            name,
            async (job, ct) =>
            {
                if (job.Name == "first")
                {
                    await Task.Delay(1500, ct);
                    callsWhileMaxed = Interlocked.Read(ref moveToActiveCalls);
                    firstDoneAt = clock.ElapsedMilliseconds;
                }
                else
                {
                    secondStartedAt = clock.ElapsedMilliseconds;
                    secondStarted.TrySetResult();
                }

                return null;
            },
            new WorkerOptions { Postgres = options, Autorun = false, Concurrency = 2, DrainDelay = 5 });

        try
        {
            await queue.AddAsync("first", new { });
            await queue.AddAsync("second", new { });
            _ = worker.RunAsync();

            await secondStarted.Task.WaitAsync(TimeSpan.FromSeconds(20));

            // Before the fix the free worker slot re-polled continuously (thousands
            // of claims) while the first job held the only global slot.
            Assert.InRange(callsWhileMaxed, 1, 9);
            Assert.True(
                secondStartedAt - firstDoneAt < 1000,
                $"second job started {secondStartedAt - firstDoneAt} ms after the first finished");
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }
}
