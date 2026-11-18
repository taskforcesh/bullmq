using System.Text.Json;
using BullMQ;
using BullMQ.Postgres;
using Xunit;

namespace BullMQ.Tests;

/// <summary>
/// End-to-end tests for job-level <c>RemoveOnComplete</c>/<c>RemoveOnFail</c>
/// and the worker-level defaults. Subclasses run the same scenarios against
/// Redis and PostgreSQL.
/// </summary>
public abstract class RemoveOnFinishTestsBase
{
    private static readonly TimeSpan WaitTimeout = TimeSpan.FromSeconds(20);

    protected abstract QueueOptions NewQueueOptions();

    protected abstract WorkerOptions NewWorkerOptions();

    private static string UniqueName() => $"dotnet-test-{Guid.NewGuid():N}";

    [Fact]
    public async Task JobRemoveOnCompleteTrue_RemovesJob()
    {
        await RunAsync(async (queue, process) =>
        {
            var job = await queue.AddAsync("job", null, new JobsOptions { RemoveOnComplete = true });
            await process(1);

            Assert.Null(await queue.GetJobAsync(job.Id!));
            Assert.Equal(0, await queue.GetCompletedCountAsync());
        });
    }

    [Fact]
    public async Task JobRemoveOnCompleteNumber_KeepsLastN()
    {
        await RunAsync(async (queue, process) =>
        {
            var ids = new List<string>();
            for (var i = 0; i < 5; i++)
            {
                ids.Add((await queue.AddAsync("job", new { i }, new JobsOptions { RemoveOnComplete = 2 })).Id!);
            }

            await process(5);

            Assert.Equal(2, await queue.GetCompletedCountAsync());
            Assert.Equal(ids.TakeLast(2).OrderBy(x => x), await CompletedIdsAsync(queue));
            Assert.Null(await queue.GetJobAsync(ids[0]));
        });
    }

    [Fact]
    public async Task JobRemoveOnCompleteKeepJobs_Count_KeepsLastN()
    {
        await RunAsync(async (queue, process) =>
        {
            var opts = new JobsOptions { RemoveOnComplete = new KeepJobs { Age = 3600, Count = 1 } };
            var ids = new List<string>();
            for (var i = 0; i < 3; i++)
            {
                ids.Add((await queue.AddAsync("job", new { i }, opts)).Id!);
            }

            await process(3);

            Assert.Equal(new[] { ids[^1] }, await CompletedIdsAsync(queue));
        });
    }

    [Fact]
    public async Task JobRemoveOnCompleteKeepJobs_Age_RemovesExpiredJobs()
    {
        await RunAsync(async (queue, process) =>
        {
            var opts = new JobsOptions { RemoveOnComplete = new KeepJobs { Age = 1 } };

            var first = await queue.AddAsync("job", new { i = 1 }, opts);
            await process(1);
            Assert.Equal(new[] { first.Id! }, await CompletedIdsAsync(queue));

            // Age-based eviction runs when the next job finishes.
            await Task.Delay(1500);
            var second = await queue.AddAsync("job", new { i = 2 }, opts);
            await process(2);

            Assert.Equal(new[] { second.Id! }, await CompletedIdsAsync(queue));
            Assert.Null(await queue.GetJobAsync(first.Id!));
        });
    }

    [Fact]
    public async Task JobRemoveOnCompleteKeepJobs_CountZero_RemovesJob()
    {
        await RunAsync(async (queue, process) =>
        {
            // The shape some ports (e.g. Go) write for "remove on complete".
            var job = await queue.AddAsync(
                "job", null, new JobsOptions { RemoveOnComplete = new KeepJobs { Count = 0 } });
            await process(1);

            Assert.Null(await queue.GetJobAsync(job.Id!));
            Assert.Equal(0, await queue.GetCompletedCountAsync());
        });
    }

    [Fact]
    public async Task JobRemoveOnFailTrue_RemovesFailedJob()
    {
        await RunAsync(
            async (queue, process) =>
            {
                var job = await queue.AddAsync("job", null, new JobsOptions { RemoveOnFail = true });
                await process(1);

                Assert.Null(await queue.GetJobAsync(job.Id!));
                Assert.Equal(0, await queue.GetFailedCountAsync());
            },
            fail: true);
    }

    [Fact]
    public async Task JobRemoveOnFailNumber_KeepsLastN()
    {
        await RunAsync(
            async (queue, process) =>
            {
                var ids = new List<string>();
                for (var i = 0; i < 3; i++)
                {
                    ids.Add((await queue.AddAsync("job", new { i }, new JobsOptions { RemoveOnFail = 1 })).Id!);
                }

                await process(3);

                var failed = await queue.GetFailedAsync();
                Assert.Equal(new[] { ids[^1] }, failed.Select(j => j.Id));
            },
            fail: true);
    }

    [Fact]
    public async Task WorkerRemoveOnComplete_AppliesWhenJobHasNone()
    {
        await RunAsync(
            async (queue, process) =>
            {
                var ids = new List<string>();
                for (var i = 0; i < 3; i++)
                {
                    ids.Add((await queue.AddAsync("job", new { i })).Id!);
                }

                await process(3);

                Assert.Equal(new[] { ids[^1] }, await CompletedIdsAsync(queue));
            },
            configure: o => o.RemoveOnComplete = new KeepJobs { Count = 1 });
    }

    [Fact]
    public async Task WorkerRemoveOnFail_AppliesWhenJobHasNone()
    {
        await RunAsync(
            async (queue, process) =>
            {
                var job = await queue.AddAsync("job", null);
                await process(1);

                Assert.Null(await queue.GetJobAsync(job.Id!));
                Assert.Equal(0, await queue.GetFailedCountAsync());
            },
            fail: true,
            configure: o => o.RemoveOnFail = new KeepJobs { Count = 0 });
    }

    [Fact]
    public async Task JobRemoveOnCompleteFalse_OverridesWorkerDefault()
    {
        await RunAsync(
            async (queue, process) =>
            {
                var removed = await queue.AddAsync("job", new { i = 1 });
                var kept = await queue.AddAsync("job", new { i = 2 }, new JobsOptions { RemoveOnComplete = false });
                await process(2);

                Assert.Null(await queue.GetJobAsync(removed.Id!));
                Assert.Equal(new[] { kept.Id! }, await CompletedIdsAsync(queue));
            },
            configure: o => o.RemoveOnComplete = new KeepJobs { Count = 0 });
    }

    [Fact]
    public async Task JobRemoveOnFailTrue_OverridesWorkerDefault()
    {
        await RunAsync(
            async (queue, process) =>
            {
                var kept = await queue.AddAsync("job", new { i = 1 });
                var removed = await queue.AddAsync("job", new { i = 2 }, new JobsOptions { RemoveOnFail = true });
                await process(2);

                Assert.Null(await queue.GetJobAsync(removed.Id!));
                var failed = await queue.GetFailedAsync();
                Assert.Equal(new[] { kept.Id }, failed.Select(j => j.Id));
            },
            fail: true,
            configure: o => o.RemoveOnFail = new KeepJobs { Count = 10 });
    }

    [Fact]
    public async Task StoredRemoveOptions_RoundTripThroughBackend()
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());
        try
        {
            var added = await queue.AddAsync("job", null, new JobsOptions
            {
                RemoveOnComplete = 5,
                RemoveOnFail = new KeepJobs { Age = 60, Count = 10, Limit = 7 },
            });
            var flag = await queue.AddAsync("job", null, new JobsOptions { RemoveOnComplete = true });
            var plain = await queue.AddAsync("job", null);

            var job = await queue.GetJobAsync(added.Id!);
            Assert.Equal(5, job!.Opts.RemoveOnComplete);
            var keep = Assert.IsType<KeepJobs>(job.Opts.RemoveOnFail);
            Assert.Equal((60, 10, 7), (keep.Age, keep.Count, keep.Limit));

            Assert.Equal(true, (await queue.GetJobAsync(flag.Id!))!.Opts.RemoveOnComplete);

            var none = await queue.GetJobAsync(plain.Id!);
            Assert.Null(none!.Opts.RemoveOnComplete);
            Assert.Null(none.Opts.RemoveOnFail);
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    private static async Task<IEnumerable<string>> CompletedIdsAsync(Queue queue) =>
        (await queue.GetCompletedAsync()).Select(j => j.Id!).OrderBy(x => x).ToList();

    /// <summary>
    /// Runs <paramref name="body"/> with a single-concurrency worker. The body
    /// adds jobs and calls <c>process(n)</c> to start the worker (if needed)
    /// and wait until <c>n</c> jobs in total have finished.
    /// </summary>
    private async Task RunAsync(
        Func<Queue, Func<int, Task>, Task> body,
        bool fail = false,
        Action<WorkerOptions>? configure = null)
    {
        var name = UniqueName();
        await using var queue = new Queue(name, NewQueueOptions());

        var options = NewWorkerOptions();
        configure?.Invoke(options);

        var finished = 0;
        var waiters = new List<(int Target, TaskCompletionSource Tcs)>();
        void OnFinished()
        {
            var count = Interlocked.Increment(ref finished);
            lock (waiters)
            {
                foreach (var (target, tcs) in waiters.Where(w => count >= w.Target))
                {
                    tcs.TrySetResult();
                }
            }
        }

        var worker = new Worker(
            name,
            (_, _) => fail
                ? throw new InvalidOperationException("boom")
                : Task.FromResult<object?>("done"),
            options);
        worker.Completed += (_, _) => OnFinished();
        worker.Failed += (_, _) => OnFinished();

        async Task Process(int total)
        {
            var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            lock (waiters)
            {
                waiters.Add((total, tcs));
                if (Volatile.Read(ref finished) >= total)
                {
                    tcs.TrySetResult();
                }
            }

            _ = worker.RunAsync();
            if (await Task.WhenAny(tcs.Task, Task.Delay(WaitTimeout)) != tcs.Task)
            {
                throw new TimeoutException($"Timed out waiting for {total} finished jobs (saw {finished}).");
            }
        }

        try
        {
            await body(queue, Process);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }
}

/// <summary>Runs the removeOnComplete/removeOnFail suite against Redis.</summary>
public sealed class RedisRemoveOnFinishTests : RemoveOnFinishTestsBase
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_REDIS") ?? "localhost:6379";

    protected override QueueOptions NewQueueOptions() =>
        new() { Connection = ConnectionOptions.FromString(ConnectionString) };

    protected override WorkerOptions NewWorkerOptions() =>
        new() { Connection = ConnectionOptions.FromString(ConnectionString), Autorun = false };
}

/// <summary>Runs the removeOnComplete/removeOnFail suite against PostgreSQL.</summary>
public sealed class PostgresRemoveOnFinishTests : RemoveOnFinishTestsBase
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_POSTGRES")
        ?? $"Host=localhost;Database=bullmq_test;Username={Environment.UserName}";

    protected override QueueOptions NewQueueOptions() =>
        new() { Postgres = new PostgresOptions { ConnectionString = ConnectionString } };

    protected override WorkerOptions NewWorkerOptions() =>
        new() { Postgres = new PostgresOptions { ConnectionString = ConnectionString }, Autorun = false };
}

/// <summary>
/// Parses the <c>removeOnComplete</c>/<c>removeOnFail</c> shapes written by the
/// different BullMQ runtimes, without a backend.
/// </summary>
public sealed class RemoveOnFinishParsingTests
{
    private static JobsOptions Parse(string optsJson) =>
        Job.FromJson(null!, "q", new JobJson { Id = "1", Name = "job", Opts = optsJson }).Opts;

    [Theory]
    [InlineData("""{"removeOnComplete":true,"removeOnFail":false}""", true, false)]
    [InlineData("""{"removeOnComplete":false,"removeOnFail":true}""", false, true)]
    public void Booleans(string json, bool complete, bool fail)
    {
        var opts = Parse(json);
        Assert.Equal(complete, opts.RemoveOnComplete);
        Assert.Equal(fail, opts.RemoveOnFail);
    }

    [Fact]
    public void Numbers()
    {
        var opts = Parse("""{"removeOnComplete":100,"removeOnFail":0}""");
        Assert.Equal(100, opts.RemoveOnComplete);
        Assert.Equal(0, opts.RemoveOnFail);
    }

    [Fact]
    public void FractionalNumbers_RoundUp()
    {
        var opts = Parse("""{"removeOnComplete":2.5,"removeOnFail":{"age":0.5}}""");
        Assert.Equal(3, opts.RemoveOnComplete);
        Assert.Equal(1, Assert.IsType<KeepJobs>(opts.RemoveOnFail).Age);
    }

    [Fact]
    public void Objects()
    {
        var opts = Parse("""{"removeOnComplete":{"age":3600,"count":1000,"limit":50},"removeOnFail":{"count":0}}""");

        var complete = Assert.IsType<KeepJobs>(opts.RemoveOnComplete);
        Assert.Equal((3600, 1000, 50), (complete.Age, complete.Count, complete.Limit));

        var fail = Assert.IsType<KeepJobs>(opts.RemoveOnFail);
        Assert.Equal(0, fail.Count);
        Assert.Null(fail.Age);
        Assert.Null(fail.Limit);
    }

    [Theory]
    [InlineData("""{}""")]
    [InlineData("""{"removeOnComplete":null,"removeOnFail":null}""")]
    [InlineData("""{"removeOnComplete":"yes","removeOnFail":[1]}""")]
    public void MissingOrUnrecognized_IsNull(string json)
    {
        var opts = Parse(json);
        Assert.Null(opts.RemoveOnComplete);
        Assert.Null(opts.RemoveOnFail);
    }

    [Fact]
    public void ParsedOptions_ReEncodeUnchanged()
    {
        const string json = """{"removeOnComplete":{"count":5,"age":60,"limit":7},"removeOnFail":true}""";
        var map = OptsCodec.ToStorageMap(Parse(json));

        Assert.Equal(
            """{"count":5,"age":60,"limit":7}""",
            JsonSerializer.Serialize(map["removeOnComplete"]));
        Assert.Equal(true, map["removeOnFail"]);
    }
}
