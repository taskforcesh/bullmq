using BullMQ;
using BullMQ.Postgres;
using Xunit;

namespace BullMQ.Tests;

/// <summary>
/// End-to-end tests that exercise the high-level <see cref="Queue"/> /
/// <see cref="Worker"/> API through a real backend. Subclasses supply the
/// backend-specific options so the exact same flow runs against both Redis and
/// PostgreSQL.
/// </summary>
public abstract class QueueWorkerTestsBase
{
    protected abstract QueueOptions NewQueueOptions();

    protected abstract WorkerOptions NewWorkerOptions();

    protected static string UniqueName() => $"dotnet-test-{Guid.NewGuid():N}";

    [Fact]
    public async Task AddJob_IncrementsWaitingCount()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            var job = await queue.AddAsync("greet", new { hello = "world" });
            Assert.NotNull(job.Id);

            var waiting = await queue.GetWaitingCountAsync();
            Assert.Equal(1, waiting);
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task AddJob_ThenGetJob_ReturnsData()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            var added = await queue.AddAsync("greet", new { hello = "world" });
            var fetched = await queue.GetJobAsync(added.Id!);

            Assert.NotNull(fetched);
            Assert.Equal("greet", fetched!.Name);
            Assert.Equal(added.Id, fetched.Id);
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Worker_ProcessesJob_AndMarksCompleted()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var completed = new TaskCompletionSource<(Job job, object? result)>(
            TaskCreationOptions.RunContinuationsAsynchronously);

        var worker = new Worker(name, (job, _) => Task.FromResult<object?>("done"), NewWorkerOptions());
        worker.Completed += (job, result) => completed.TrySetResult((job, result));

        try
        {
            var added = await queue.AddAsync("greet", new { hello = "world" });
            _ = worker.RunAsync();

            var finished = await WaitForAsync(completed.Task, TimeSpan.FromSeconds(15));
            Assert.Equal(added.Id, finished.job.Id);

            var jobState = await added.GetStateAsync();
            Assert.Equal(JobState.Completed, jobState);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Worker_FailingProcessor_MarksJobFailed()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var failed = new TaskCompletionSource<Exception>(TaskCreationOptions.RunContinuationsAsynchronously);

        var worker = new Worker(
            name,
            (job, _) => throw new InvalidOperationException("boom"),
            NewWorkerOptions());
        worker.Failed += (_, error) => failed.TrySetResult(error);

        try
        {
            var added = await queue.AddAsync("job", new { x = 1 }, new JobsOptions { Attempts = 1 });
            _ = worker.RunAsync();

            var error = await WaitForAsync(failed.Task, TimeSpan.FromSeconds(15));
            Assert.Equal("boom", error.Message);

            Assert.Equal(JobState.Failed, await added.GetStateAsync());
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Pause_And_Resume_TogglesPausedFlag()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            Assert.False(await queue.IsPausedAsync());

            await queue.PauseAsync();
            Assert.True(await queue.IsPausedAsync());

            await queue.ResumeAsync();
            Assert.False(await queue.IsPausedAsync());
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Worker_ProcessesMultipleJobs()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        const int total = 10;
        var processed = 0;
        var allDone = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        var options = NewWorkerOptions();
        options.Concurrency = 4;
        var worker = new Worker(name, (job, _) => Task.FromResult<object?>(null), options);
        worker.Completed += (_, _) =>
        {
            if (Interlocked.Increment(ref processed) == total)
            {
                allDone.TrySetResult(true);
            }
        };

        try
        {
            for (var i = 0; i < total; i++)
            {
                await queue.AddAsync("job", new { index = i });
            }

            _ = worker.RunAsync();
            await WaitForAsync(allDone.Task, TimeSpan.FromSeconds(20));

            Assert.Equal(total, processed);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    protected static async Task<T> WaitForAsync<T>(Task<T> task, TimeSpan timeout)
    {
        var completed = await Task.WhenAny(task, Task.Delay(timeout));
        if (completed != task)
        {
            throw new TimeoutException("Timed out waiting for the expected event.");
        }

        return await task;
    }

    [Fact]
    public async Task AddBulk_AddsAllJobs()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            var added = await queue.AddBulkAsync(new (string, object?, JobsOptions?)[]
            {
                ("a", new { i = 1 }, null),
                ("b", new { i = 2 }, null),
                ("c", new { i = 3 }, null),
            });

            Assert.Equal(3, added.Count);
            Assert.All(added, j => Assert.False(string.IsNullOrEmpty(j.Id)));
            Assert.Equal(3, await queue.GetWaitingCountAsync());
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task GetWaiting_ReturnsAddedJobs()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            await queue.AddAsync("first", new { i = 1 });
            await queue.AddAsync("second", new { i = 2 });

            var waiting = await queue.GetWaitingAsync();
            Assert.Equal(2, waiting.Count);
            Assert.Contains(waiting, j => j.Name == "first");
            Assert.Contains(waiting, j => j.Name == "second");
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task JobLog_And_GetJobLogs_RoundTrip()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            var job = await queue.AddAsync("job", new { i = 1 });
            await job.LogAsync("hello");
            await job.LogAsync("world");

            var logs = await queue.GetJobLogsAsync(job.Id!);
            Assert.Equal(2, logs.Count);
            Assert.Equal("hello", logs.Logs[0]);
            Assert.Equal("world", logs.Logs[1]);
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Job_UpdateProgress_Persists()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            var job = await queue.AddAsync("job", new { i = 1 });
            await job.UpdateProgressAsync(75);

            var fetched = await queue.GetJobAsync(job.Id!);
            Assert.NotNull(fetched);
            Assert.Contains("75", fetched!.Progress?.ToString());
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Job_Remove_DeletesJob()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            var job = await queue.AddAsync("job", new { i = 1 });
            var removed = await job.RemoveAsync();
            Assert.Equal(1, removed);
            Assert.Equal(JobState.Unknown, await queue.GetJobStateAsync(job.Id!));
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task DelayedJob_Promote_ViaJob()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            var job = await queue.AddAsync("job", new { i = 1 }, new JobsOptions { Delay = 60000 });
            Assert.Equal(JobState.Delayed, await job.GetStateAsync());

            await job.PromoteAsync();
            Assert.Equal(JobState.Waiting, await job.GetStateAsync());
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task UpsertJobScheduler_CreatesScheduler()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            var job = await queue.UpsertJobSchedulerAsync(
                "my-scheduler",
                new RepeatOptions { Every = 5000 },
                new JobSchedulerTemplate { Name = "tick", Data = new { n = 1 } });

            Assert.NotNull(job);
            Assert.Equal(1, await queue.GetJobSchedulersCountAsync());

            var scheduler = await queue.GetJobSchedulerAsync("my-scheduler");
            Assert.NotNull(scheduler);
            Assert.Equal("my-scheduler", scheduler!.Key);
            Assert.Equal(5000, scheduler.Every);

            Assert.True(await queue.RemoveJobSchedulerAsync("my-scheduler"));
            Assert.Equal(0, await queue.GetJobSchedulersCountAsync());
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task JobScheduler_ProducesRepeatingJobs()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var processed = 0;
        var enough = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        var worker = new Worker(name, (job, _) => Task.FromResult<object?>(null), NewWorkerOptions());
        worker.Completed += (_, _) =>
        {
            if (Interlocked.Increment(ref processed) >= 3)
            {
                enough.TrySetResult(true);
            }
        };

        try
        {
            await queue.UpsertJobSchedulerAsync(
                "ticker",
                new RepeatOptions { Every = 300, Immediately = true },
                new JobSchedulerTemplate { Name = "tick" });

            _ = worker.RunAsync();
            await WaitForAsync(enough.Task, TimeSpan.FromSeconds(20));

            Assert.True(processed >= 3);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public void Worker_InvalidConcurrency_Throws()
    {
        var opts = NewWorkerOptions();
        opts.Concurrency = 0;

        Assert.Throws<ArgumentOutOfRangeException>(
            () => new Worker(UniqueName(), (_, _) => Task.FromResult<object?>(null), opts));
    }

    [Fact]
    public async Task Worker_ForceClose_DoesNotFailActiveJob()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var active = new TaskCompletionSource<Job>(TaskCreationOptions.RunContinuationsAsynchronously);

        // A cooperating processor that blocks until its abort token is cancelled
        // (as a graceful processor should), throwing OperationCanceledException.
        var worker = new Worker(
            name,
            async (job, ct) =>
            {
                active.TrySetResult(job);
                await Task.Delay(Timeout.Infinite, ct).ConfigureAwait(false);
                return null;
            },
            NewWorkerOptions());

        var failedRaised = false;
        worker.Failed += (_, _) => failedRaised = true;

        try
        {
            var added = await queue.AddAsync("job", new { x = 1 }, new JobsOptions { Attempts = 1 });
            _ = worker.RunAsync();

            var job = await WaitForAsync(active.Task, TimeSpan.FromSeconds(15));
            Assert.Equal(added.Id, job.Id);

            // Force close cancels the processor's token. The job must NOT be moved
            // to failed just because the worker shut down; it is left active to be
            // recovered as stalled/retried later.
            await worker.CloseAsync(force: true);

            Assert.False(failedRaised, "job should not be marked failed due to shutdown");
            Assert.NotEqual(JobState.Failed, await added.GetStateAsync());
            Assert.Equal(0, await queue.GetFailedCountAsync());
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }
}

/// <summary>Runs the Queue/Worker end-to-end suite against the Redis backend.</summary>
public sealed class RedisQueueWorkerTests : QueueWorkerTestsBase
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_REDIS") ?? "localhost:6379";

    protected override QueueOptions NewQueueOptions() =>
        new() { Connection = ConnectionOptions.FromString(ConnectionString) };

    protected override WorkerOptions NewWorkerOptions() =>
        new() { Connection = ConnectionOptions.FromString(ConnectionString), Autorun = false };
}

/// <summary>Runs the Queue/Worker end-to-end suite against the PostgreSQL backend.</summary>
public sealed class PostgresQueueWorkerTests : QueueWorkerTestsBase
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_POSTGRES")
        ?? $"Host=localhost;Database=bullmq_test;Username={Environment.UserName}";

    protected override QueueOptions NewQueueOptions() =>
        new() { Postgres = new PostgresOptions { ConnectionString = ConnectionString } };

    protected override WorkerOptions NewWorkerOptions() =>
        new() { Postgres = new PostgresOptions { ConnectionString = ConnectionString }, Autorun = false };
}
