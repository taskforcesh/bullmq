using System.Collections.Concurrent;
using BullMQ;
using BullMQ.Postgres;
using Xunit;

namespace BullMQ.Tests;

/// <summary>
/// End-to-end tests for <see cref="QueueEvents"/>: a listener observes the
/// queue's event stream as a job is added and processed. Runs against both backends.
/// </summary>
public abstract class QueueEventsTestsBase
{
    protected abstract QueueOptions NewQueueOptions();

    protected abstract WorkerOptions NewWorkerOptions();

    protected abstract QueueEventsOptions NewQueueEventsOptions();

    protected virtual string? InitialLastEventId => null;

    private static string UniqueName() => $"dotnet-qe-{Guid.NewGuid():N}";

    [Fact]
    public async Task Emits_Completed_For_Processed_Job()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        var queueEventsOptions = NewQueueEventsOptions();
        queueEventsOptions.LastEventId ??= InitialLastEventId;
        await using var events = new QueueEvents(q, queueEventsOptions);
        await events.WaitUntilReadyAsync();

        var completed = new TaskCompletionSource<QueueEvent>(TaskCreationOptions.RunContinuationsAsynchronously);
        var seen = new ConcurrentBag<string>();

        events.EventReceived += e => seen.Add(e.Name);
        events.Completed += e => completed.TrySetResult(e);

        _ = events.RunAsync();

        var worker = new Worker(q, (job, _) => Task.FromResult<object?>(new { ok = true }), NewWorkerOptions());
        try
        {
            var job = await queue.AddAsync("greet", new { hello = "world" });

            _ = worker.RunAsync();
            var evt = await WaitForAsync(completed.Task, TimeSpan.FromSeconds(20));

            Assert.Equal("completed", evt.Name);
            Assert.Equal(job.Id, evt.JobId);
            Assert.False(string.IsNullOrEmpty(evt.Id));
            Assert.Contains("completed", seen);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await events.CloseAsync();
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

/// <summary>Runs the QueueEvents suite against the Redis backend.</summary>
public sealed class RedisQueueEventsTests : QueueEventsTestsBase
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_REDIS") ?? "localhost:6379";

    protected override string? InitialLastEventId => "0-0";

    protected override QueueOptions NewQueueOptions() =>
        new() { Connection = ConnectionOptions.FromString(ConnectionString) };

    protected override WorkerOptions NewWorkerOptions() =>
        new() { Connection = ConnectionOptions.FromString(ConnectionString), Autorun = false };

    protected override QueueEventsOptions NewQueueEventsOptions() =>
        new() { Connection = ConnectionOptions.FromString(ConnectionString), Autorun = false };
}

/// <summary>Runs the QueueEvents suite against the PostgreSQL backend.</summary>
public sealed class PostgresQueueEventsTests : QueueEventsTestsBase
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_POSTGRES")
        ?? $"Host=localhost;Database=bullmq_test;Username={Environment.UserName}";

    protected override QueueOptions NewQueueOptions() =>
        new() { Postgres = new PostgresOptions { ConnectionString = ConnectionString } };

    protected override WorkerOptions NewWorkerOptions() =>
        new() { Postgres = new PostgresOptions { ConnectionString = ConnectionString }, Autorun = false };

    protected override QueueEventsOptions NewQueueEventsOptions() =>
        new() { Postgres = new PostgresOptions { ConnectionString = ConnectionString }, Autorun = false };
}
