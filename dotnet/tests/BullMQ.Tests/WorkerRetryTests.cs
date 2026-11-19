using System.Collections.Concurrent;
using BullMQ;
using BullMQ.Postgres;
using Xunit;

namespace BullMQ.Tests;

/// <summary>
/// Worker retry behaviour (attempts, backoff, unrecoverable errors), run against
/// both the Redis and PostgreSQL backends.
/// </summary>
public abstract class WorkerRetryTestsBase
{
    private static readonly TimeSpan WaitTimeout = TimeSpan.FromSeconds(20);

    protected abstract QueueOptions NewQueueOptions();

    protected abstract WorkerOptions NewWorkerOptions();

    private static string UniqueName() => $"dotnet-retry-{Guid.NewGuid():N}";

    private static async Task<T> WaitForAsync<T>(Task<T> task)
    {
        var completed = await Task.WhenAny(task, Task.Delay(WaitTimeout));
        if (completed != task)
        {
            throw new TimeoutException("Timed out waiting for the expected event.");
        }

        return await task;
    }

    private static TaskCompletionSource<T> NewTcs<T>() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    [Fact]
    public async Task FixedBackoff_MovesToDelayed_RetriesAndCompletes()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var startedAt = new ConcurrentQueue<long>();
        var firstFailure = NewTcs<Job>();
        var completed = NewTcs<Job>();
        var failures = 0;

        var worker = new Worker(name, (job, _) =>
        {
            startedAt.Enqueue(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            if (job.AttemptsMade < 2)
            {
                throw new InvalidOperationException($"fail {job.AttemptsMade}");
            }

            return Task.FromResult<object?>("ok");
        }, NewWorkerOptions());
        worker.Failed += (job, _) =>
        {
            Interlocked.Increment(ref failures);
            firstFailure.TrySetResult(job!);
        };
        worker.Completed += (job, _) => completed.TrySetResult(job);

        try
        {
            var added = await queue.AddAsync("job", new { x = 1 }, new JobsOptions
            {
                Attempts = 3,
                Backoff = new BackoffOptions { Type = "fixed", Delay = 500 },
            });
            _ = worker.RunAsync();

            var failed = await WaitForAsync(firstFailure.Task);
            Assert.Equal(1, failed.AttemptsMade);
            Assert.Equal(500, failed.Delay);
            Assert.Equal(JobState.Delayed, await added.GetStateAsync());

            var done = await WaitForAsync(completed.Task);
            Assert.Equal(added.Id, done.Id);
            Assert.Equal(3, done.AttemptsMade);
            Assert.Equal(2, failures);
            Assert.Equal(JobState.Completed, await added.GetStateAsync());

            var stored = await queue.GetJobAsync(added.Id!);
            Assert.Equal(3, stored!.AttemptsMade);

            var starts = startedAt.ToArray();
            Assert.Equal(3, starts.Length);
            Assert.True(starts[1] - starts[0] >= 450, $"retry 1 started after {starts[1] - starts[0]}ms");
            Assert.True(starts[2] - starts[1] >= 450, $"retry 2 started after {starts[2] - starts[1]}ms");
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task NoBackoff_RetriesImmediately()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var completed = NewTcs<Job>();
        var failures = 0;

        var worker = new Worker(name, (job, _) =>
        {
            if (job.AttemptsMade == 0)
            {
                throw new InvalidOperationException("first attempt fails");
            }

            return Task.FromResult<object?>("ok");
        }, NewWorkerOptions());
        worker.Failed += (_, _) => Interlocked.Increment(ref failures);
        worker.Completed += (job, _) => completed.TrySetResult(job);

        try
        {
            var added = await queue.AddAsync("job", new { x = 1 }, new JobsOptions { Attempts = 2 });
            _ = worker.RunAsync();

            var done = await WaitForAsync(completed.Task);
            Assert.Equal(2, done.AttemptsMade);
            Assert.Equal(1, failures);
            Assert.Equal(JobState.Completed, await added.GetStateAsync());

            var stored = await queue.GetJobAsync(added.Id!);
            Assert.Equal(2, stored!.AttemptsMade);
            Assert.Equal(0, stored.Delay);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task UnrecoverableException_SkipsRemainingAttempts()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var failed = NewTcs<(Job job, Exception error)>();
        var calls = 0;

        var worker = new Worker(name, (_, _) =>
        {
            Interlocked.Increment(ref calls);
            throw new UnrecoverableException("do not retry");
        }, NewWorkerOptions());
        worker.Failed += (job, error) => failed.TrySetResult((job!, error));

        try
        {
            var added = await queue.AddAsync("job", new { x = 1 }, new JobsOptions
            {
                Attempts = 3,
                Backoff = new BackoffOptions { Type = "fixed", Delay = 50 },
            });
            _ = worker.RunAsync();

            var (job, error) = await WaitForAsync(failed.Task);
            Assert.IsType<UnrecoverableException>(error);
            Assert.Equal(1, job.AttemptsMade);
            Assert.Equal(JobState.Failed, await added.GetStateAsync());

            var stored = await queue.GetJobAsync(added.Id!);
            Assert.Equal(1, stored!.AttemptsMade);
            Assert.Equal("do not retry", stored.FailedReason);
            Assert.Equal(1, calls);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task AttemptsExhausted_FailsWithAttemptsMadeEqualToAttempts()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var finalFailure = NewTcs<Job>();
        var failures = 0;

        var worker = new Worker(
            name,
            (job, _) => throw new InvalidOperationException($"attempt {job.AttemptsMade + 1} failed"),
            NewWorkerOptions());
        worker.Failed += (job, _) =>
        {
            if (Interlocked.Increment(ref failures) == 3)
            {
                finalFailure.TrySetResult(job!);
            }
        };

        try
        {
            var added = await queue.AddAsync("job", new { x = 1 }, new JobsOptions
            {
                Attempts = 3,
                Backoff = new BackoffOptions { Type = "exponential", Delay = 50 },
            });
            _ = worker.RunAsync();

            var job = await WaitForAsync(finalFailure.Task);
            Assert.Equal(3, job.AttemptsMade);
            Assert.Equal(3, job.StackTrace.Count);
            Assert.NotNull(job.FinishedOn);
            Assert.Equal(JobState.Failed, await added.GetStateAsync());

            var stored = await queue.GetJobAsync(added.Id!);
            Assert.Equal(3, stored!.AttemptsMade);
            Assert.Equal("attempt 3 failed", stored.FailedReason);
            Assert.Equal(3, stored.StackTrace.Count);
            Assert.Contains("attempt 1 failed", stored.StackTrace[0]);
            Assert.Contains("attempt 3 failed", stored.StackTrace[2]);
            Assert.Equal(1, await queue.GetFailedCountAsync());

            // No further attempt is scheduled once the attempts are exhausted.
            await Task.Delay(300);
            Assert.Equal(3, failures);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task CustomBackoffStrategy_IsUsed()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var completed = NewTcs<Job>();
        var calls = new ConcurrentQueue<(int attemptsMade, string type, string message, string? jobId)>();

        var options = NewWorkerOptions();
        options.BackoffStrategy = (attemptsMade, type, error, job) =>
        {
            calls.Enqueue((attemptsMade, type, error.Message, job.Id));
            return Task.FromResult(attemptsMade * 100L);
        };

        var worker = new Worker(name, (job, _) =>
        {
            if (job.AttemptsMade < 2)
            {
                throw new InvalidOperationException($"fail {job.AttemptsMade}");
            }

            return Task.FromResult<object?>("ok");
        }, options);
        worker.Completed += (job, _) => completed.TrySetResult(job);

        try
        {
            var added = await queue.AddAsync("job", new { x = 1 }, new JobsOptions
            {
                Attempts = 3,
                Backoff = new BackoffOptions { Type = "linear" },
            });
            _ = worker.RunAsync();

            var done = await WaitForAsync(completed.Task);
            Assert.Equal(added.Id, done.Id);
            Assert.Equal(3, done.AttemptsMade);

            Assert.Equal(
                new[] { (1, "linear", "fail 0", added.Id), (2, "linear", "fail 1", added.Id) },
                calls.ToArray());
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task CustomBackoffStrategy_ReturningMinusOne_FailsJob()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var failed = NewTcs<Job>();

        var options = NewWorkerOptions();
        options.BackoffStrategy = (_, _, _, _) => Task.FromResult(-1L);

        var worker = new Worker(
            name, (_, _) => throw new InvalidOperationException("give up"), options);
        worker.Failed += (job, _) => failed.TrySetResult(job!);

        try
        {
            var added = await queue.AddAsync("job", new { x = 1 }, new JobsOptions
            {
                Attempts = 5,
                Backoff = new BackoffOptions { Type = "custom" },
            });
            _ = worker.RunAsync();

            var job = await WaitForAsync(failed.Task);
            Assert.Equal(1, job.AttemptsMade);
            Assert.Equal(JobState.Failed, await added.GetStateAsync());

            var stored = await queue.GetJobAsync(added.Id!);
            Assert.Equal(1, stored!.AttemptsMade);
            Assert.Equal("give up", stored.FailedReason);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task DelayedRetry_PersistsFailedReasonAndStacktrace()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var failed = NewTcs<Job>();

        var worker = new Worker(
            name, (_, _) => throw new InvalidOperationException("first failure"), NewWorkerOptions());
        worker.Failed += (job, _) => failed.TrySetResult(job!);

        try
        {
            var added = await queue.AddAsync("job", new { x = 1 }, new JobsOptions
            {
                Attempts = 2,
                Backoff = new BackoffOptions { Type = "fixed", Delay = 60000 },
            });
            _ = worker.RunAsync();

            var job = await WaitForAsync(failed.Task);
            Assert.Equal(JobState.Delayed, await added.GetStateAsync());

            var stored = await queue.GetJobAsync(added.Id!);
            Assert.NotNull(stored);
            Assert.Equal(1, stored!.AttemptsMade);
            Assert.Equal("first failure", stored.FailedReason);
            Assert.Single(stored.StackTrace);
            Assert.Contains("InvalidOperationException", stored.StackTrace[0]);
            Assert.Contains("first failure", stored.StackTrace[0]);
            Assert.Equal(job.StackTrace, stored.StackTrace);
            Assert.Null(stored.FinishedOn);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task ImmediateRetry_PersistsFailedReasonAndStacktrace()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var secondAttempt = NewTcs<(string? failedReason, List<string> stackTrace)>();

        var worker = new Worker(name, (job, _) =>
        {
            if (job.AttemptsMade == 0)
            {
                throw new InvalidOperationException("first failure");
            }

            secondAttempt.TrySetResult((job.FailedReason, job.StackTrace.ToList()));
            return Task.FromResult<object?>("ok");
        }, NewWorkerOptions());

        try
        {
            await queue.AddAsync("job", new { x = 1 }, new JobsOptions { Attempts = 2 });
            _ = worker.RunAsync();

            var (failedReason, stackTrace) = await WaitForAsync(secondAttempt.Task);
            Assert.Equal("first failure", failedReason);
            Assert.Single(stackTrace);
            Assert.Contains("first failure", stackTrace[0]);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task BackoffJitter_IsPersisted()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            var added = await queue.AddAsync("job", new { x = 1 }, new JobsOptions
            {
                Attempts = 3,
                Backoff = new BackoffOptions { Type = "exponential", Delay = 100, Jitter = 0.25 },
            });

            var stored = await queue.GetJobAsync(added.Id!);
            Assert.NotNull(stored!.Opts.Backoff);
            Assert.Equal("exponential", stored.Opts.Backoff!.Type);
            Assert.Equal(100, stored.Opts.Backoff.Delay);
            Assert.Equal(0.25, stored.Opts.Backoff.Jitter);
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task MaxStartedAttempts_PreventsRetry()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var failed = NewTcs<Job>();

        var options = NewWorkerOptions();
        options.MaxStartedAttempts = 1;
        var worker = new Worker(name, (_, _) => throw new InvalidOperationException("boom"), options);
        worker.Failed += (job, _) => failed.TrySetResult(job!);

        try
        {
            var added = await queue.AddAsync("job", new { x = 1 }, new JobsOptions { Attempts = 3 });
            _ = worker.RunAsync();

            var job = await WaitForAsync(failed.Task);
            Assert.Equal(1, job.AttemptsMade);
            Assert.Equal(JobState.Failed, await added.GetStateAsync());
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task MaxStartedAttempts_FailsJobStartedTooManyTimes()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var failed = NewTcs<(Job job, Exception error)>();
        var calls = 0;

        var options = NewWorkerOptions();
        options.MaxStartedAttempts = 1;
        var worker = new Worker(name, (_, _) =>
        {
            Interlocked.Increment(ref calls);
            return Task.FromResult<object?>("ok");
        }, options);
        worker.Failed += (job, error) => failed.TrySetResult((job!, error));

        try
        {
            var added = await queue.AddAsync("job", new { x = 1 }, new JobsOptions { Attempts = 3 });

            // Simulate an earlier start that never finished (e.g. a crashed worker):
            // it consumes a start but not an attempt.
            await using var backend = await BackendBuilder.CreateAsync(name, NewWorkerOptions(), lockDuration: 30000);
            await backend.WaitUntilReadyAsync();
            const string token = "earlier-worker";
            var next = await backend.MoveToActiveAsync(token);
            Assert.Equal(added.Id, next.JobId ?? next.Job?.Id);
            await backend.MoveToDelayedAsync(
                added.Id!, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), 0, token, skipAttempt: true);

            _ = worker.RunAsync();

            var (job, error) = await WaitForAsync(failed.Task);
            Assert.IsType<UnrecoverableException>(error);
            Assert.Equal("job started more than allowable limit", error.Message);
            Assert.Equal(2, job.AttemptsStarted);
            Assert.Equal(0, calls);
            Assert.Equal(JobState.Failed, await added.GetStateAsync());
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public void MaxStartedAttempts_Negative_Throws()
    {
        var options = NewWorkerOptions();
        options.MaxStartedAttempts = -1;

        Assert.Throws<ArgumentOutOfRangeException>(
            () => new Worker(UniqueName(), (_, _) => Task.FromResult<object?>(null), options));
    }

    [Fact]
    public async Task ImmediateRetry_OnAnotherSlot_KeepsItsLockRenewed()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var retryStarted = NewTcs<bool>();
        var completed = NewTcs<Job>();
        var calls = 0;
        var completions = 0;
        var stalled = 0;
        var blockedFailedHandler = 0;

        var options = NewWorkerOptions();
        options.Concurrency = 2;
        options.LockDuration = 1000;
        options.StalledInterval = 300;

        var worker = new Worker(name, async (_, ct) =>
        {
            if (Interlocked.Increment(ref calls) == 1)
            {
                throw new InvalidOperationException("first attempt fails");
            }

            retryStarted.TrySetResult(true);
            await Task.Delay(2500, ct).ConfigureAwait(false);
            return "ok";
        }, options);

        // Hold attempt 1 in its Failed handler until the retry is running on the
        // other slot, so attempt 1's lock cleanup runs after the retry's tracking.
        worker.Failed += (_, _) =>
        {
            if (Interlocked.Exchange(ref blockedFailedHandler, 1) == 0)
            {
                retryStarted.Task.Wait(TimeSpan.FromSeconds(10));
            }
        };
        worker.Completed += (job, _) =>
        {
            Interlocked.Increment(ref completions);
            completed.TrySetResult(job);
        };
        worker.Stalled += _ => Interlocked.Increment(ref stalled);

        try
        {
            var added = await queue.AddAsync("job", new { x = 1 }, new JobsOptions { Attempts = 2 });
            _ = worker.RunAsync();

            var finished = await Task.WhenAny(completed.Task, Task.Delay(TimeSpan.FromSeconds(15)));

            // Give a wrongly stalled copy time to be picked up again.
            await Task.Delay(1000);

            Assert.Equal(0, stalled);
            Assert.True(finished == completed.Task, "the job did not complete");
            Assert.Equal(added.Id, (await completed.Task).Id);
            Assert.Equal(2, calls);
            Assert.Equal(1, completions);
            Assert.Equal(JobState.Completed, await added.GetStateAsync());
            Assert.Equal(2, (await queue.GetJobAsync(added.Id!))!.AttemptsMade);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }
}

/// <summary>Runs the worker retry suite against the Redis backend.</summary>
public sealed class RedisWorkerRetryTests : WorkerRetryTestsBase
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_REDIS") ?? "localhost:6379";

    protected override QueueOptions NewQueueOptions() =>
        new() { Connection = ConnectionOptions.FromString(ConnectionString) };

    protected override WorkerOptions NewWorkerOptions() =>
        new() { Connection = ConnectionOptions.FromString(ConnectionString), Autorun = false };
}

/// <summary>Runs the worker retry suite against the PostgreSQL backend.</summary>
public sealed class PostgresWorkerRetryTests : WorkerRetryTestsBase
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_POSTGRES")
        ?? $"Host=localhost;Database=bullmq_test;Username={Environment.UserName}";

    protected override QueueOptions NewQueueOptions() =>
        new() { Postgres = new PostgresOptions { ConnectionString = ConnectionString } };

    protected override WorkerOptions NewWorkerOptions() =>
        new() { Postgres = new PostgresOptions { ConnectionString = ConnectionString }, Autorun = false };
}
