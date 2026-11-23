using System.Collections.Concurrent;
using System.Diagnostics;
using BullMQ;
using BullMQ.Postgres;
using Xunit;

namespace BullMQ.Tests;

/// <summary>
/// End-to-end tests for rate limiting (<see cref="WorkerOptions.Limiter"/>,
/// global rate limit, manual rate limit with <see cref="RateLimitException"/>),
/// global concurrency and the default job counts. Runs against both backends.
/// </summary>
public abstract class RateLimitTestsBase
{
    protected abstract QueueOptions NewQueueOptions();

    protected abstract WorkerOptions NewWorkerOptions();

    private static string UniqueName() => $"dotnet-ratelimit-{Guid.NewGuid():N}";

    [Fact]
    public async Task Limiter_CapsThroughput()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        var finishedAt = new ConcurrentQueue<long>();
        var allDone = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var options = NewWorkerOptions();
        options.Concurrency = 4;
        options.Limiter = new RateLimiterOptions { Max = 2, Duration = 1000 };
        var worker = new Worker(q, (_, _) => Task.FromResult<object?>(null), options);
        worker.Completed += (_, _) =>
        {
            finishedAt.Enqueue(Stopwatch.GetTimestamp());
            if (finishedAt.Count == 6)
            {
                allDone.TrySetResult();
            }
        };

        try
        {
            await queue.AddBulkAsync(Enumerable.Range(0, 6).Select(i => ("job", (object?)new { i }, (JobsOptions?)null)));
            var started = Stopwatch.GetTimestamp();
            _ = worker.RunAsync();

            await WaitForAsync(allDone.Task, TimeSpan.FromSeconds(20));

            // 6 jobs at 2 per second need at least two full windows after the first.
            var elapsed = Stopwatch.GetElapsedTime(started, finishedAt.Max());
            Assert.True(elapsed >= TimeSpan.FromMilliseconds(1800), $"6 jobs finished in {elapsed.TotalMilliseconds}ms");

            // No more than 2 jobs finish within any window shorter than the duration.
            var sorted = finishedAt.OrderBy(t => t).ToArray();
            for (var i = 2; i < sorted.Length; i++)
            {
                var gap = Stopwatch.GetElapsedTime(sorted[i - 2], sorted[i]);
                Assert.True(gap >= TimeSpan.FromMilliseconds(800), $"jobs {i - 2} and {i} finished {gap.TotalMilliseconds}ms apart");
            }
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task GlobalRateLimit_CapsThroughput()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        var completed = 0;
        var allDone = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var options = NewWorkerOptions();
        options.Concurrency = 3;
        var worker = new Worker(q, (_, _) => Task.FromResult<object?>(null), options);
        worker.Completed += (_, _) =>
        {
            if (Interlocked.Increment(ref completed) == 3)
            {
                allDone.TrySetResult();
            }
        };

        try
        {
            await queue.SetGlobalRateLimitAsync(1, 500);
            await queue.AddBulkAsync(Enumerable.Range(0, 3).Select(i => ("job", (object?)new { i }, (JobsOptions?)null)));
            var stopwatch = Stopwatch.StartNew();
            _ = worker.RunAsync();

            await WaitForAsync(allDone.Task, TimeSpan.FromSeconds(20));
            Assert.True(stopwatch.ElapsedMilliseconds >= 900, $"3 jobs finished in {stopwatch.ElapsedMilliseconds}ms");
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task RateLimitException_MovesJobBackToWait_WithoutConsumingAnAttempt()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        var invocations = new ConcurrentQueue<(long At, int AttemptsMade)>();
        var failed = 0;
        var completed = new TaskCompletionSource<Job>(TaskCreationOptions.RunContinuationsAsynchronously);
        var stateAfterLimit = new TaskCompletionSource<JobState>(TaskCreationOptions.RunContinuationsAsynchronously);

        Worker? worker = null;
        worker = new Worker(q, async (job, _) =>
        {
            invocations.Enqueue((Stopwatch.GetTimestamp(), job.AttemptsMade));
            if (invocations.Count == 1)
            {
                await worker!.RateLimitAsync(1000);
                throw new RateLimitException();
            }

            return "done";
        }, NewWorkerOptions());
        var errors = new ConcurrentQueue<Exception>();
        worker.Failed += (_, _) => Interlocked.Increment(ref failed);
        worker.Error += errors.Enqueue;
        worker.Completed += (job, _) => completed.TrySetResult(job);

        try
        {
            var job = await queue.AddAsync("limited", new { x = 1 }, new JobsOptions { Attempts = 1 });
            _ = worker.RunAsync();

            // While the limit holds, the job sits in wait with no attempt consumed.
            await WaitUntilAsync(() => Task.FromResult(invocations.Count >= 1));
            await WaitUntilAsync(async () => await job.GetStateAsync() is JobState.Waiting);
            var waiting = (await queue.GetJobAsync(job.Id!))!;
            Assert.Equal(0, waiting.AttemptsMade);
            Assert.Null(waiting.FailedReason);

            await Task.WhenAny(completed.Task, Task.Delay(TimeSpan.FromSeconds(15)));
            Assert.True(
                completed.Task.IsCompleted,
                $"not completed: state {await job.GetStateAsync()}, invocations {invocations.Count}, " +
                $"errors [{string.Join("; ", errors.Select(e => e.Message))}]");
            var done = await completed.Task;
            Assert.Equal(job.Id, done.Id);
            Assert.Equal(0, Volatile.Read(ref failed));

            var calls = invocations.ToArray();
            Assert.Equal(2, calls.Length);
            Assert.Equal(0, calls[1].AttemptsMade);
            var gap = Stopwatch.GetElapsedTime(calls[0].At, calls[1].At);
            Assert.True(gap >= TimeSpan.FromMilliseconds(800), $"retried after {gap.TotalMilliseconds}ms");

            // A job with a single attempt completed: the limited run did not count.
            Assert.Equal(JobState.Completed, await job.GetStateAsync());
            Assert.Equal(1, (await queue.GetJobAsync(job.Id!))!.AttemptsMade);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task QueueRateLimit_SetsAndRemovesTheWindow()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        try
        {
            await queue.RateLimitAsync(10000);
            var ttl = await queue.GetRateLimitTtlAsync();
            Assert.InRange(ttl, 1, 10000);

            Assert.Equal(1, await queue.RemoveRateLimitKeyAsync());
            Assert.True(await queue.GetRateLimitTtlAsync() <= 0);
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task GlobalConcurrencyAndRateLimit_AreStoredInQueueMeta()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        try
        {
            Assert.Null(await queue.GetGlobalConcurrencyAsync());
            await queue.SetGlobalConcurrencyAsync(3);
            Assert.Equal(3, await queue.GetGlobalConcurrencyAsync());
            Assert.Equal(1, await queue.RemoveGlobalConcurrencyAsync());
            Assert.Null(await queue.GetGlobalConcurrencyAsync());

            Assert.Null(await queue.GetGlobalRateLimitAsync());
            await queue.SetGlobalRateLimitAsync(5, 1000);
            var limit = await queue.GetGlobalRateLimitAsync();
            Assert.Equal(5, limit!.Max);
            Assert.Equal(1000, limit.Duration);
            Assert.Equal(2, await queue.RemoveGlobalRateLimitAsync());
            Assert.Null(await queue.GetGlobalRateLimitAsync());
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task GlobalConcurrency_LimitsActiveJobs()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        var active = 0;
        var maxActive = 0;
        var completed = 0;
        var allDone = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var options = NewWorkerOptions();
        options.Concurrency = 5;
        var worker = new Worker(q, async (_, _) =>
        {
            var now = Interlocked.Increment(ref active);
            int seen;
            while (now > (seen = Volatile.Read(ref maxActive)) &&
                   Interlocked.CompareExchange(ref maxActive, now, seen) != seen)
            {
            }

            await Task.Delay(100);
            Interlocked.Decrement(ref active);
            return null;
        }, options);
        worker.Completed += (_, _) =>
        {
            if (Interlocked.Increment(ref completed) == 6)
            {
                allDone.TrySetResult();
            }
        };

        try
        {
            await queue.SetGlobalConcurrencyAsync(2);
            await queue.AddBulkAsync(Enumerable.Range(0, 6).Select(i => ("job", (object?)new { i }, (JobsOptions?)null)));
            _ = worker.RunAsync();

            await WaitForAsync(allDone.Task, TimeSpan.FromSeconds(20));
            Assert.InRange(Volatile.Read(ref maxActive), 1, 2);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task GetJobCounts_DefaultsIncludePrioritizedAndWaitingChildren()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        await using var flow = new FlowProducer(NewQueueOptions());
        try
        {
            await queue.AddAsync("prioritized", null, new JobsOptions { Priority = 5 });
            await flow.AddAsync(new FlowJob
            {
                Name = "parent",
                QueueName = q,
                Children = new[] { new FlowJob { Name = "child", QueueName = q } },
            });

            var counts = await queue.GetJobCountsAsync();
            Assert.Equal(1, counts["prioritized"]);
            Assert.Equal(1, counts["waiting-children"]);
            Assert.Equal(1, counts["waiting"]);
            foreach (var type in new[] { "active", "completed", "delayed", "failed", "paused" })
            {
                Assert.Equal(0, counts[type]);
            }
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    private static async Task WaitUntilAsync(Func<Task<bool>> condition, int timeoutMs = 15000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            if (await condition())
            {
                return;
            }

            await Task.Delay(20);
        }

        throw new TimeoutException("Timed out waiting for the expected condition.");
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

    private static async Task WaitForAsync(Task task, TimeSpan timeout)
    {
        var completed = await Task.WhenAny(task, Task.Delay(timeout));
        if (completed != task)
        {
            throw new TimeoutException("Timed out waiting for the expected event.");
        }

        await task;
    }
}

/// <summary>Runs the rate limit suite against the Redis backend.</summary>
public sealed class RedisRateLimitTests : RateLimitTestsBase
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_REDIS") ?? "localhost:6379";

    protected override QueueOptions NewQueueOptions() =>
        new() { Connection = ConnectionOptions.FromString(ConnectionString) };

    protected override WorkerOptions NewWorkerOptions() =>
        new() { Connection = ConnectionOptions.FromString(ConnectionString), Autorun = false };
}

/// <summary>Runs the rate limit suite against the PostgreSQL backend.</summary>
public sealed class PostgresRateLimitTests : RateLimitTestsBase
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_POSTGRES")
        ?? $"Host=localhost;Database=bullmq_test;Username={Environment.UserName}";

    protected override QueueOptions NewQueueOptions() =>
        new() { Postgres = new PostgresOptions { ConnectionString = ConnectionString } };

    protected override WorkerOptions NewWorkerOptions() =>
        new() { Postgres = new PostgresOptions { ConnectionString = ConnectionString }, Autorun = false };
}
