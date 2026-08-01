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
