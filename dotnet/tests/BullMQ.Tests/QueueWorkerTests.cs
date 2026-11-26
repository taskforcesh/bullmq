using System.Collections.Concurrent;
using System.Diagnostics;
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

    [Fact]
    public async Task Worker_JobStalledMoreThanMaxStalledCount_FailsWithoutProcessing()
    {
        const string deferredReason = "job stalled more than allowable limit";
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var active = new TaskCompletionSource<Job>(TaskCreationOptions.RunContinuationsAsynchronously);

        // The first worker takes the job and is then force closed, leaving the job
        // active with a lock that expires after LockDuration (a crashed worker).
        var stallingOptions = NewWorkerOptions();
        stallingOptions.LockDuration = 1000;
        stallingOptions.SkipStalledCheck = true;
        var stallingWorker = new Worker(
            name,
            async (job, ct) =>
            {
                active.TrySetResult(job);
                await Task.Delay(Timeout.Infinite, ct).ConfigureAwait(false);
                return null;
            },
            stallingOptions);

        var recoveringOptions = NewWorkerOptions();
        recoveringOptions.MaxStalledCount = 0;
        recoveringOptions.StalledInterval = 100;
        var processed = 0;
        var recoveringWorker = new Worker(
            name,
            (_, _) =>
            {
                Interlocked.Increment(ref processed);
                return Task.FromResult<object?>("done");
            },
            recoveringOptions);

        var stalled = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var failed = new TaskCompletionSource<(Job? job, Exception error)>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        recoveringWorker.Stalled += jobId => stalled.TrySetResult(jobId);
        recoveringWorker.Failed += (job, error) => failed.TrySetResult((job, error));

        try
        {
            // Attempts > 1: a deferred failure is unrecoverable, so it is not retried.
            var added = await queue.AddAsync("job", new { x = 1 }, new JobsOptions { Attempts = 3 });
            _ = stallingWorker.RunAsync();

            var activeJob = await WaitForAsync(active.Task, TimeSpan.FromSeconds(15));
            Assert.Equal(added.Id, activeJob.Id);
            await stallingWorker.CloseAsync(force: true);
            Assert.Equal(JobState.Active, await added.GetStateAsync());

            _ = recoveringWorker.RunAsync();

            var (failedJob, error) = await WaitForAsync(failed.Task, TimeSpan.FromSeconds(15));
            Assert.Equal(added.Id, await WaitForAsync(stalled.Task, TimeSpan.FromSeconds(1)));
            Assert.Equal(added.Id, failedJob!.Id);
            Assert.IsType<UnrecoverableException>(error);
            Assert.Equal(deferredReason, error.Message);
            Assert.Equal(0, Volatile.Read(ref processed));

            Assert.Equal(JobState.Failed, await added.GetStateAsync());
            var stored = await queue.GetJobAsync(added.Id!);
            Assert.NotNull(stored);
            Assert.Equal(deferredReason, stored!.FailedReason);
            Assert.Equal(1, stored.StalledCounter);
            Assert.Equal(1, stored.AttemptsMade);
            Assert.Equal(2, stored.AttemptsStarted);
        }
        finally
        {
            await stallingWorker.CloseAsync(force: true);
            await recoveringWorker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Worker_ManualMoveToDelayed_ThrowDelayedException_DoesNotFailJob()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var completed = new TaskCompletionSource<Job>(TaskCreationOptions.RunContinuationsAsynchronously);
        var failed = new TaskCompletionSource<Exception>(TaskCreationOptions.RunContinuationsAsynchronously);
        var movedToDelayed = 0;

        var worker = new Worker(
            name,
            async (job, _) =>
            {
                if (Interlocked.CompareExchange(ref movedToDelayed, 1, 0) == 0)
                {
                    await job.MoveToDelayedAsync(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 200)
                        .ConfigureAwait(false);
                    throw new DelayedException();
                }

                return "done";
            },
            NewWorkerOptions());

        worker.Completed += (job, _) => completed.TrySetResult(job);
        worker.Failed += (_, error) => failed.TrySetResult(error);

        try
        {
            var added = await queue.AddAsync("manual-delay", new { x = 1 });
            _ = worker.RunAsync();

            var finished = await WaitForAsync(completed.Task, TimeSpan.FromSeconds(20));
            Assert.Equal(added.Id, finished.Id);
            Assert.False(failed.Task.IsCompleted, "manual delayed flow should not emit failed event");
            Assert.Equal(JobState.Completed, await added.GetStateAsync());
            Assert.Equal(0, await queue.GetFailedCountAsync());

            var stored = await queue.GetJobAsync(added.Id!);
            Assert.NotNull(stored);
            Assert.Equal(1, stored!.AttemptsMade);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Worker_ManualMoveToDelayed_WithoutToken_UsesJobToken()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var completed = new TaskCompletionSource<Job>(TaskCreationOptions.RunContinuationsAsynchronously);
        var movedToDelayed = 0;

        var worker = new Worker(
            name,
            async (job, _) =>
            {
                if (Interlocked.CompareExchange(ref movedToDelayed, 1, 0) == 0)
                {
                    // Omits token on purpose to validate job.Token fallback.
                    await job.MoveToDelayedAsync(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 100)
                        .ConfigureAwait(false);
                    throw new DelayedException();
                }

                return "done";
            },
            NewWorkerOptions());

        worker.Completed += (job, _) => completed.TrySetResult(job);

        try
        {
            var added = await queue.AddAsync("manual-delay-token", new { x = 2 });
            _ = worker.RunAsync();

            var finished = await WaitForAsync(completed.Task, TimeSpan.FromSeconds(20));
            Assert.Equal(added.Id, finished.Id);
            Assert.Equal(JobState.Completed, await added.GetStateAsync());
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Worker_RateLimited_SleepsInsteadOfRefetchingWhileJobsAreAdded()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        await SetGlobalRateLimitAsync(queue, max: 1, duration: 1000);

        var calls = new BackendCallCounter();
        var completedAt = new ConcurrentQueue<long>();
        var worker = new Worker(name, (_, _) => Task.FromResult<object?>(null), NewWorkerOptions(), calls.Wrap);
        worker.Completed += (_, _) => completedAt.Enqueue(Environment.TickCount64);

        try
        {
            await queue.AddAsync("job", new { i = 0 });
            await worker.WaitUntilReadyAsync();
            var clock = Stopwatch.StartNew();
            _ = worker.RunAsync();

            // Every add wakes a worker blocked on the marker (Redis) / jobs
            // channel (PostgreSQL), so keep adding jobs for the whole test.
            var added = 1;
            while (clock.ElapsedMilliseconds < 3000)
            {
                await queue.AddAsync("job", new { i = added++ });
                await Task.Delay(20);
            }

            var fetches = calls.Count(nameof(IQueueBackend.MoveToActiveAsync));
            var completions = completedAt.ToArray();

            // One job per 1000 ms window over ~3 s, without the worker stalling.
            Assert.InRange(completions.Length, 2, 4);
            for (var i = 1; i < completions.Length; i++)
            {
                Assert.True(
                    completions[i] - completions[i - 1] >= 900,
                    $"jobs completed {completions[i] - completions[i - 1]} ms apart");
            }

            // About two fetches per window (one claims the job, one hits the
            // limit), instead of one per added job.
            Assert.True(
                fetches <= 20,
                $"{fetches} moveToActive calls to process {completions.Length} jobs while {added} were added");
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Worker_RateLimited_CloseInterruptsTheRateLimitWait()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        await SetGlobalRateLimitAsync(queue, max: 1, duration: 20000);

        var calls = new BackendCallCounter();
        var completed = new TaskCompletionSource<Job>(TaskCreationOptions.RunContinuationsAsynchronously);
        var worker = new Worker(name, (_, _) => Task.FromResult<object?>(null), NewWorkerOptions(), calls.Wrap);
        worker.Completed += (job, _) => completed.TrySetResult(job);

        try
        {
            await queue.AddAsync("job", new { i = 1 });
            var second = await queue.AddAsync("job", new { i = 2 });
            _ = worker.RunAsync();
            await WaitForAsync(completed.Task, TimeSpan.FromSeconds(15));

            // The fetch after the first job (made by its fetch-next completion)
            // hits the limit; from then on the worker sleeps the window out
            // without fetching again.
            int Fetches() => calls.Count(nameof(IQueueBackend.MoveToActiveAsync))
                + calls.Count(nameof(IQueueBackend.MoveToCompletedAsync) + BackendCallCounter.FetchNext);
            await WaitUntilAsync(() => Fetches() >= 2, TimeSpan.FromSeconds(5));
            await Task.Delay(500);
            Assert.Equal(2, Fetches());

            var clock = Stopwatch.StartNew();
            await worker.CloseAsync();
            Assert.True(clock.ElapsedMilliseconds < 3000, $"close took {clock.ElapsedMilliseconds} ms");
            Assert.Equal(JobState.Waiting, await second.GetStateAsync());
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Worker_RateLimited_MaximumRateLimitDelayKeepsPromotingDelayedJobs()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        await SetGlobalRateLimitAsync(queue, max: 1, duration: 20000);

        var calls = new BackendCallCounter();
        var completed = new TaskCompletionSource<Job>(TaskCreationOptions.RunContinuationsAsynchronously);
        var options = NewWorkerOptions();
        options.MaximumRateLimitDelay = 200;
        var worker = new Worker(name, (_, _) => Task.FromResult<object?>(null), options, calls.Wrap);
        worker.Completed += (job, _) => completed.TrySetResult(job);

        try
        {
            await queue.AddAsync("job", new { i = 1 });
            var delayed = await queue.AddAsync("delayed", new { i = 2 }, new JobsOptions { Delay = 500 });
            _ = worker.RunAsync();
            await WaitForAsync(completed.Task, TimeSpan.FromSeconds(15));

            // The 20 s window is slept out in 200 ms steps, and each re-fetch
            // promotes due delayed jobs (which stay waiting: still rate limited).
            await WaitUntilAsync(
                async () => await delayed.GetStateAsync() == JobState.Waiting, TimeSpan.FromSeconds(5));

            await Task.Delay(1000);
            Assert.Equal(JobState.Waiting, await delayed.GetStateAsync());
            Assert.InRange(calls.Count(nameof(IQueueBackend.MoveToActiveAsync)), 4, 30);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    /// <summary>
    /// Sets a queue-level rate limit the way the reference
    /// <c>queue.setGlobalRateLimit</c> stores it: the queue meta <c>max</c> and
    /// <c>duration</c> fields.
    /// </summary>
    private static async Task SetGlobalRateLimitAsync(Queue queue, int max, int duration)
    {
        var backend = await queue.GetBackendAsync();
        await backend.SetQueueMetaAsync(new Dictionary<string, object>
        {
            ["max"] = max,
            ["duration"] = duration,
        });
    }

    private static Task WaitUntilAsync(Func<bool> condition, TimeSpan timeout) =>
        WaitUntilAsync(() => Task.FromResult(condition()), timeout);

    private static async Task WaitUntilAsync(Func<Task<bool>> condition, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (!await condition())
        {
            if (DateTime.UtcNow > deadline)
            {
                throw new TimeoutException("Timed out waiting for the expected condition.");
            }

            await Task.Delay(20);
        }
    }

    [Fact]
    public async Task Worker_Concurrency_ChainsFetches_FinishesEachJobOnce()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        const int total = 200;
        const int concurrency = 8;
        var active = new ConcurrentDictionary<string, int>();
        var completed = new ConcurrentDictionary<string, int>();
        var failed = new ConcurrentDictionary<string, int>();
        int finished = 0, inFlight = 0, maxInFlight = 0, drained = 0;
        var allDone = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        var calls = new BackendCallCounter();
        var options = NewWorkerOptions();
        options.Concurrency = concurrency;
        var worker = new Worker(
            name,
            async (job, _) =>
            {
                InterlockedMax(ref maxInFlight, Interlocked.Increment(ref inFlight));
                try
                {
                    await Task.Yield();
                    if (job.Name == "fail")
                    {
                        throw new InvalidOperationException("boom");
                    }

                    return null;
                }
                finally
                {
                    Interlocked.Decrement(ref inFlight);
                }
            },
            options,
            calls.Wrap);
        worker.Active += job => Increment(active, job.Id!);
        worker.Completed += (job, _) => Finish(completed, job.Id!);
        worker.Failed += (job, _) => Finish(failed, job!.Id!);
        worker.Drained += () => Interlocked.Increment(ref drained);

        void Finish(ConcurrentDictionary<string, int> into, string id)
        {
            Increment(into, id);
            if (Interlocked.Increment(ref finished) == total)
            {
                allDone.TrySetResult(true);
            }
        }

        try
        {
            var added = await queue.AddBulkAsync(Enumerable.Range(0, total).Select(i =>
                (i % 4 == 0 ? "fail" : "ok", (object?)new { index = i }, (JobsOptions?)new JobsOptions { Attempts = 1 })));
            var failIds = added.Where(j => j.Name == "fail").Select(j => j.Id!).OrderBy(id => id).ToList();
            var okIds = added.Where(j => j.Name == "ok").Select(j => j.Id!).OrderBy(id => id).ToList();

            _ = worker.RunAsync();
            await WaitForAsync(allDone.Task, TimeSpan.FromSeconds(60));
            await worker.CloseAsync();

            Assert.Equal(added.Select(j => j.Id!).OrderBy(id => id), active.Keys.OrderBy(id => id));
            Assert.All(active.Values, n => Assert.Equal(1, n));
            Assert.Equal(okIds, completed.Keys.OrderBy(id => id));
            Assert.All(completed.Values, n => Assert.Equal(1, n));
            Assert.Equal(failIds, failed.Keys.OrderBy(id => id));
            Assert.All(failed.Values, n => Assert.Equal(1, n));
            Assert.True(drained >= 1, "drained should be raised once the queue empties");
            Assert.InRange(maxInFlight, 1, concurrency);

            Assert.Equal(okIds.Count, await queue.GetCompletedCountAsync());
            Assert.Equal(failIds.Count, await queue.GetFailedCountAsync());
            Assert.Equal(0, await queue.GetActiveCountAsync());
            Assert.Equal(0, await queue.GetWaitingCountAsync());

            // Every finish asked for the next job, so most jobs were fetched by
            // the finishing call rather than by a separate MoveToActive.
            Assert.Equal(okIds.Count, calls.Count(nameof(IQueueBackend.MoveToCompletedAsync) + BackendCallCounter.FetchNext));
            Assert.Equal(failIds.Count, calls.Count(nameof(IQueueBackend.MoveToFailedAsync) + BackendCallCounter.FetchNext));
            Assert.True(
                calls.Count(nameof(IQueueBackend.MoveToActiveAsync)) < total / 4,
                $"expected chained fetches, got {calls.Count(nameof(IQueueBackend.MoveToActiveAsync))} MoveToActive calls for {total} jobs");
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Worker_ChainedJob_KeepsItsLockRenewed()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var calls = new BackendCallCounter();
        var options = NewWorkerOptions();
        options.LockDuration = 1000;
        options.StalledInterval = 300;
        var fetchesWhenChained = -1;
        var stalled = new ConcurrentQueue<string>();
        var failed = new ConcurrentQueue<Exception>();
        var completed = 0;
        var bothDone = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        var worker = new Worker(
            name,
            async (job, _) =>
            {
                if (job.Name == "slow")
                {
                    fetchesWhenChained = calls.Count(nameof(IQueueBackend.MoveToActiveAsync));

                    // Outlive the lock several times: it must be renewed.
                    await Task.Delay(2500);
                }

                return null;
            },
            options,
            calls.Wrap);
        worker.Stalled += stalled.Enqueue;
        worker.Failed += (_, err) => failed.Enqueue(err);
        worker.Completed += (_, _) =>
        {
            if (Interlocked.Increment(ref completed) == 2)
            {
                bothDone.TrySetResult(true);
            }
        };

        try
        {
            await queue.AddBulkAsync(new (string, object?, JobsOptions?)[] { ("fast", null, null), ("slow", null, null) });
            _ = worker.RunAsync();
            await WaitForAsync(bothDone.Task, TimeSpan.FromSeconds(20));

            // "slow" was fetched by the completion of "fast", not by MoveToActive.
            Assert.Equal(1, fetchesWhenChained);
            Assert.Empty(stalled);
            Assert.Empty(failed);
            Assert.Equal(2, await queue.GetCompletedCountAsync());
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Worker_ChainedSchedulerJob_SchedulesNextIteration()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var calls = new BackendCallCounter();
        var options = NewWorkerOptions();
        var fetchesWhenChained = -1;
        var blockerActive = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseBlocker = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var tickDone = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        var worker = new Worker(
            name,
            async (job, _) =>
            {
                if (job.Name == "blocker")
                {
                    blockerActive.TrySetResult(true);
                    await releaseBlocker.Task;
                }
                else
                {
                    fetchesWhenChained = calls.Count(nameof(IQueueBackend.MoveToActiveAsync));
                }

                return null;
            },
            options,
            calls.Wrap);
        worker.Completed += (job, _) =>
        {
            if (job.Name == "tick")
            {
                tickDone.TrySetResult(true);
            }
        };

        try
        {
            await queue.AddAsync("blocker", null);
            _ = worker.RunAsync();
            await WaitForAsync(blockerActive.Task, TimeSpan.FromSeconds(15));

            // While the only slot is busy, the scheduler's first job becomes ready,
            // so it is fetched by the blocker's completion.
            await queue.UpsertJobSchedulerAsync(
                "chained-ticker",
                new RepeatOptions { Every = 60000, Immediately = true },
                new JobSchedulerTemplate { Name = "tick" });
            Assert.Equal(0, await queue.GetDelayedCountAsync());

            releaseBlocker.SetResult(true);
            await WaitForAsync(tickDone.Task, TimeSpan.FromSeconds(15));

            Assert.Equal(1, fetchesWhenChained);
            Assert.Equal(1, await queue.GetDelayedCountAsync());
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Worker_Close_WhileChaining_StopsPromptlyWithoutLosingJobs()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        const int total = 1000;
        var completed = new ConcurrentDictionary<string, int>();
        var failed = new ConcurrentQueue<Exception>();
        int processed = 0, completedTotal = 0;
        var enough = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var allDone = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        void OnCompleted(Job job, object? _)
        {
            Increment(completed, job.Id!);
            if (Interlocked.Increment(ref completedTotal) == total)
            {
                allDone.TrySetResult(true);
            }
        }

        var calls = new BackendCallCounter();
        var options = NewWorkerOptions();
        options.Concurrency = 4;
        var worker = new Worker(
            name,
            async (_, ct) =>
            {
                await Task.Delay(1, ct);
                if (Interlocked.Increment(ref processed) == 50)
                {
                    enough.TrySetResult(true);
                }

                return null;
            },
            options,
            calls.Wrap);
        worker.Completed += OnCompleted;
        worker.Failed += (_, err) => failed.Enqueue(err);

        var options2 = NewWorkerOptions();
        options2.Concurrency = 8;
        var worker2 = new Worker(name, (_, _) => Task.FromResult<object?>(null), options2);
        worker2.Completed += OnCompleted;
        worker2.Failed += (_, err) => failed.Enqueue(err);

        try
        {
            await queue.AddBulkAsync(Enumerable.Range(0, total).Select(i => ("job", (object?)new { i }, (JobsOptions?)null)));
            _ = worker.RunAsync();
            await WaitForAsync(enough.Task, TimeSpan.FromSeconds(30));

            var sw = Stopwatch.StartNew();
            await worker.CloseAsync();
            sw.Stop();
            Assert.True(sw.Elapsed < TimeSpan.FromSeconds(5), $"close took {sw.Elapsed}");

            var processedAtClose = Volatile.Read(ref processed);
            var completedAtClose = completed.Count;
            await Task.Delay(200);
            Assert.Equal(processedAtClose, Volatile.Read(ref processed));
            Assert.Equal(processedAtClose, completedAtClose);
            Assert.True(
                calls.Count(nameof(IQueueBackend.MoveToActiveAsync)) < completedAtClose,
                $"expected chained fetches, got {calls.Count(nameof(IQueueBackend.MoveToActiveAsync))} MoveToActive calls for {completedAtClose} jobs");

            // Nothing is left active (or failed) by the close: the rest is waiting.
            Assert.Equal(0, await queue.GetActiveCountAsync());
            Assert.Equal(0, await queue.GetFailedCountAsync());
            Assert.Equal(completedAtClose, await queue.GetCompletedCountAsync());
            Assert.Equal(total - completedAtClose, await queue.GetWaitingCountAsync());

            _ = worker2.RunAsync();
            await WaitForAsync(allDone.Task, TimeSpan.FromSeconds(60));

            Assert.Equal(total, completed.Count);
            Assert.All(completed.Values, n => Assert.Equal(1, n));
            Assert.Empty(failed);
            Assert.Equal(total, await queue.GetCompletedCountAsync());
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await worker2.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Worker_ForceClose_WhileChaining_StopsPromptlyWithoutFailingJobs()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        const int total = 1000;
        const int concurrency = 4;
        var processed = 0;
        var enough = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        var options = NewWorkerOptions();
        options.Concurrency = concurrency;
        var worker = new Worker(
            name,
            async (_, ct) =>
            {
                await Task.Delay(1, ct);
                if (Interlocked.Increment(ref processed) == 50)
                {
                    enough.TrySetResult(true);
                }

                return null;
            },
            options);

        try
        {
            await queue.AddBulkAsync(Enumerable.Range(0, total).Select(i => ("job", (object?)new { i }, (JobsOptions?)null)));
            _ = worker.RunAsync();
            await WaitForAsync(enough.Task, TimeSpan.FromSeconds(30));

            var sw = Stopwatch.StartNew();
            await worker.CloseAsync(force: true);
            sw.Stop();
            Assert.True(sw.Elapsed < TimeSpan.FromSeconds(5), $"force close took {sw.Elapsed}");

            // In-flight slots wind down right after the close returns and do not
            // keep chaining.
            await Task.Delay(300);
            var settled = Volatile.Read(ref processed);
            await Task.Delay(300);
            Assert.Equal(settled, Volatile.Read(ref processed));

            // Jobs interrupted by the force close (at most one per slot) stay
            // active to be recovered as stalled; none is failed or lost.
            var counts = await queue.GetJobCountsAsync("waiting", "active", "completed", "failed");
            Assert.Equal(0, counts["failed"]);
            Assert.InRange(counts["active"], 0, concurrency);
            Assert.Equal(total, counts["waiting"] + counts["active"] + counts["completed"]);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Worker_ForceClose_DuringChainedSchedulerUpdate_DoesNotStartTheJob()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        var gate = new BackendCallGate(nameof(IQueueBackend.IsJobSchedulerAsync));
        var activated = new ConcurrentQueue<string>();
        var started = new ConcurrentQueue<string>();
        var blockerActive = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseBlocker = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        var worker = new Worker(
            name,
            async (job, _) =>
            {
                started.Enqueue(job.Name);
                if (job.Name == "blocker")
                {
                    blockerActive.TrySetResult(true);
                    await releaseBlocker.Task;
                }

                return null;
            },
            NewWorkerOptions(),
            gate.Wrap);
        worker.Active += job => activated.Enqueue(job.Name);

        try
        {
            await queue.AddAsync("blocker", null);
            _ = worker.RunAsync();
            await WaitForAsync(blockerActive.Task, TimeSpan.FromSeconds(15));

            // Queued behind the blocker, so the blocker's completion fetches it.
            var tick = await queue.UpsertJobSchedulerAsync(
                "racing-ticker",
                new RepeatOptions { Every = 60000, Immediately = true },
                new JobSchedulerTemplate { Name = "tick" });
            releaseBlocker.SetResult(true);

            // The slot now holds the fetched job and awaits its scheduler update:
            // force close right there.
            await WaitForAsync(gate.Entered, TimeSpan.FromSeconds(15));
            var closing = worker.CloseAsync(force: true);
            gate.Release();
            await closing;
            await Task.Delay(300);

            Assert.Equal(new[] { "blocker" }, activated);
            Assert.Equal(new[] { "blocker" }, started);

            // Left active, to be recovered as stalled.
            Assert.Equal(JobState.Active, await queue.GetJobStateAsync(tick!.Id!));
        }
        finally
        {
            gate.Release();
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Worker_GracefulClose_WithBacklog_DoesNotRaiseDrained()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        const int total = 20;
        const int concurrency = 2;
        int running = 0, drained = 0;
        var allRunning = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        var options = NewWorkerOptions();
        options.Concurrency = concurrency;
        var worker = new Worker(
            name,
            async (_, _) =>
            {
                if (Interlocked.Increment(ref running) == concurrency)
                {
                    allRunning.TrySetResult(true);
                }

                await release.Task;
                return null;
            },
            options);
        worker.Drained += () => Interlocked.Increment(ref drained);

        try
        {
            await queue.AddBulkAsync(Enumerable.Range(0, total).Select(i => ("job", (object?)new { i }, (JobsOptions?)null)));
            _ = worker.RunAsync();
            await WaitForAsync(allRunning.Task, TimeSpan.FromSeconds(15));

            // The in-flight jobs finish after the close started, so without
            // fetching the next job: that says nothing about the backlog.
            var closing = worker.CloseAsync();
            release.SetResult(true);
            await closing;

            Assert.Equal(0, drained);
            Assert.Equal(concurrency, await queue.GetCompletedCountAsync());
            Assert.Equal(total - concurrency, await queue.GetWaitingCountAsync());
        }
        finally
        {
            release.TrySetResult(true);
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Worker_RateLimited_ChainedFinish_SleepsInsteadOfRefetching()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        await SetGlobalRateLimitAsync(queue, max: 2, duration: 1500);

        var calls = new BackendCallCounter();
        var completedAt = new ConcurrentQueue<long>();
        var worker = new Worker(name, (_, _) => Task.FromResult<object?>(null), NewWorkerOptions(), calls.Wrap);
        worker.Completed += (_, _) => completedAt.Enqueue(Environment.TickCount64);

        try
        {
            await queue.AddBulkAsync(Enumerable.Range(0, 3).Select(i => ("job", (object?)new { i }, (JobsOptions?)null)));
            _ = worker.RunAsync();

            // The first job is fetched by MoveToActive and the second by its
            // completion; the second's completion then hits the limit.
            await WaitUntilAsync(() => completedAt.Count >= 2, TimeSpan.FromSeconds(10));
            await Task.Delay(500);
            Assert.Equal(1, calls.Count(nameof(IQueueBackend.MoveToActiveAsync)));

            await WaitUntilAsync(() => completedAt.Count >= 3, TimeSpan.FromSeconds(10));
            var completions = completedAt.ToArray();
            Assert.True(
                completions[2] - completions[0] >= 1000,
                $"third job completed {completions[2] - completions[0]} ms after the first");
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    private static void Increment(ConcurrentDictionary<string, int> counts, string key) =>
        counts.AddOrUpdate(key, 1, (_, n) => n + 1);

    private static void InterlockedMax(ref int target, int value)
    {
        int current;
        while (value > (current = Volatile.Read(ref target))
               && Interlocked.CompareExchange(ref target, value, current) != current)
        {
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
