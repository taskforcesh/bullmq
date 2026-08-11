using BullMQ;
using BullMQ.Postgres;
using Xunit;

namespace BullMQ.Tests;

/// <summary>
/// End-to-end tests for the high-level <see cref="Queue"/> administration and
/// query API (counts, state getters, drain/clean/remove, bulk retry/promote,
/// metadata). Runs against both the Redis and PostgreSQL backends.
/// </summary>
public abstract class QueueTestsBase
{
    protected abstract QueueOptions NewQueueOptions();

    protected abstract WorkerOptions NewWorkerOptions();

    protected static string UniqueName() => $"dotnet-queue-{Guid.NewGuid():N}";

    [Fact]
    public async Task GetJobCounts_ReflectsWaitingAndDelayed()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            await queue.AddAsync("a", new { });
            await queue.AddAsync("b", new { });
            await queue.AddAsync("later", new { }, new JobsOptions { Delay = 60_000 });

            var counts = await queue.GetJobCountsAsync("waiting", "delayed");
            Assert.Equal(2, counts["waiting"]);
            Assert.Equal(1, counts["delayed"]);
            Assert.Equal(2, await queue.GetWaitingCountAsync());
            Assert.Equal(1, await queue.GetDelayedCountAsync());
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task AddDelayed_HasDelayedStateAndAppearsInGetDelayed()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            var job = await queue.AddAsync("d", new { x = 1 }, new JobsOptions { Delay = 60_000 });

            Assert.Equal(JobState.Delayed, await queue.GetJobStateAsync(job.Id!));
            var delayed = await queue.GetDelayedAsync();
            Assert.Contains(delayed, j => j.Id == job.Id);
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task AddPrioritized_HasPrioritizedState()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            var job = await queue.AddAsync("p", new { }, new JobsOptions { Priority = 5 });
            Assert.Equal(JobState.Prioritized, await queue.GetJobStateAsync(job.Id!));
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Drain_RemovesWaitingJobs()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            await queue.AddAsync("a", new { });
            await queue.AddAsync("b", new { });
            Assert.Equal(2, await queue.GetWaitingCountAsync());

            await queue.DrainAsync();
            Assert.Equal(0, await queue.GetWaitingCountAsync());
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Remove_DeletesJobFromQueue()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            var job = await queue.AddAsync("r", new { });
            var removed = await queue.RemoveAsync(job.Id!);
            Assert.True(removed >= 1);
            Assert.Null(await queue.GetJobAsync(job.Id!));
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task PromoteJobs_MovesDelayedToWaiting()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            await queue.AddAsync("d1", new { }, new JobsOptions { Delay = 120_000 });
            await queue.AddAsync("d2", new { }, new JobsOptions { Delay = 120_000 });
            Assert.Equal(2, await queue.GetDelayedCountAsync());

            await queue.PromoteJobsAsync();

            Assert.Equal(0, await queue.GetDelayedCountAsync());
            Assert.Equal(2, await queue.GetWaitingCountAsync());
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task GetVersion_ReturnsBullmqVersion()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            await queue.WaitUntilReadyAsync();
            var version = await queue.GetVersionAsync();
            Assert.NotNull(version);
            Assert.StartsWith("bullmq", version);
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task RetryJobs_MovesFailedBackToWaiting()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var failed = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var worker = new Worker(
            name,
            (_, _) => throw new InvalidOperationException("boom"),
            NewWorkerOptions());
        worker.Failed += (_, _) => failed.TrySetResult(true);

        try
        {
            await queue.AddAsync("f", new { }, new JobsOptions { Attempts = 1 });
            _ = worker.RunAsync();
            await WaitForAsync(failed.Task, TimeSpan.FromSeconds(15));

            // Stop processing before retrying so the worker doesn't re-fail it.
            await worker.CloseAsync(force: true);
            Assert.Equal(1, await queue.GetFailedCountAsync());

            await queue.RetryJobsAsync("failed");

            Assert.Equal(0, await queue.GetFailedCountAsync());
            Assert.Equal(1, await queue.GetWaitingCountAsync());
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Clean_RemovesCompletedJobs()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var completed = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var worker = new Worker(name, (_, _) => Task.FromResult<object?>("ok"), NewWorkerOptions());
        worker.Completed += (_, _) => completed.TrySetResult(true);

        try
        {
            await queue.AddAsync("c", new { });
            _ = worker.RunAsync();
            await WaitForAsync(completed.Task, TimeSpan.FromSeconds(15));
            await worker.CloseAsync(force: true);

            Assert.Equal(1, await queue.GetCompletedCountAsync());

            var removed = await queue.CleanAsync(grace: 0, limit: 100, type: "completed");
            Assert.NotEmpty(removed);
            Assert.Equal(0, await queue.GetCompletedCountAsync());
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Obliterate_EmptiesTheQueue()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        await queue.AddAsync("a", new { });
        await queue.AddAsync("b", new { });
        Assert.Equal(2, await queue.GetWaitingCountAsync());

        await queue.ObliterateAsync(force: true);

        Assert.Equal(0, await queue.GetWaitingCountAsync());
    }

    [Fact]
    public async Task Pause_SetsQueueToPaused()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());

        try
        {
            Assert.False(await queue.IsPausedAsync());

            await queue.PauseAsync();

            Assert.True(await queue.IsPausedAsync());
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task GetCountsPerPriority_ReturnsJobCountsPerPriority()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());

        try
        {
            await queue.WaitUntilReadyAsync();

            for (var index = 0; index < 42; index++)
            {
                await queue.AddAsync(
                    "test",
                    new { },
                    new JobsOptions { Priority = index % 4 });
            }

            var counts = await queue.GetCountsPerPriorityAsync(
                new long[] { 0, 1, 2, 3 });

            Assert.Equal(new long[] { 11, 11, 10, 10 }, counts);
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    private static async Task<T> WaitForAsync<T>(Task<T> task, TimeSpan timeout)
    {
        var completed = await Task.WhenAny(task, Task.Delay(timeout));
        if (completed != task)
        {
            throw new TimeoutException("Timed out waiting for the expected event.");
        }

        return await task;
    }
}

/// <summary>Runs the Queue admin suite against the Redis backend.</summary>
public sealed class RedisQueueTests : QueueTestsBase
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_REDIS") ?? "localhost:6379";

    protected override QueueOptions NewQueueOptions() =>
        new() { Connection = ConnectionOptions.FromString(ConnectionString) };

    protected override WorkerOptions NewWorkerOptions() =>
        new() { Connection = ConnectionOptions.FromString(ConnectionString), Autorun = false };
}

/// <summary>Runs the Queue admin suite against the PostgreSQL backend.</summary>
public sealed class PostgresQueueTests : QueueTestsBase
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_POSTGRES")
        ?? $"Host=localhost;Database=bullmq_test;Username={Environment.UserName}";

    protected override QueueOptions NewQueueOptions() =>
        new() { Postgres = new PostgresOptions { ConnectionString = ConnectionString } };

    protected override WorkerOptions NewWorkerOptions() =>
        new() { Postgres = new PostgresOptions { ConnectionString = ConnectionString }, Autorun = false };
}
