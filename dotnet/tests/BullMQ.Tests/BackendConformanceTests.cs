using BullMQ;
using Xunit;

namespace BullMQ.Tests;

/// <summary>
/// A single conformance suite that every <see cref="IQueueBackend"/> adapter must
/// satisfy. Concrete subclasses supply a backend factory so the exact same tests
/// run against both the Redis and PostgreSQL adapters, proving the two backends
/// implement identical semantics over the shared Lua/SQL scripts.
/// </summary>
public abstract class BackendConformanceTests
{
    protected const string Token = "conformance-token";

    /// <summary>Creates a backend bound to a fresh, unique queue.</summary>
    protected abstract Task<IQueueBackend> CreateBackendAsync(int lockDuration = 30000);

    protected static string UniqueName() => $"dotnet-conf-{Guid.NewGuid():N}";

    private static async Task CleanupAsync(IQueueBackend backend)
    {
        try
        {
            await backend.PauseAsync(true);
            long cursor;
            do
            {
                cursor = await backend.ObliterateAsync(force: true, count: 1000);
            }
            while (cursor != 0);
        }
        catch
        {
            // best-effort cleanup
        }
        finally
        {
            await backend.CloseAsync(force: true);
        }
    }

    private static async Task<Job> AddAsync(
        IQueueBackend backend, string name = "job", object? data = null, JobsOptions? opts = null)
    {
        return await Job.CreateAsync(backend, "conf", name, data ?? new { x = 1 }, opts ?? new JobsOptions());
    }

    [Fact]
    public async Task AddJob_SetsWaitingState_AndCounts()
    {
        var backend = await CreateBackendAsync();
        try
        {
            var job = await AddAsync(backend, data: new { hello = "world" });
            Assert.False(string.IsNullOrEmpty(job.Id));

            Assert.Equal(JobState.Waiting, await backend.GetStateAsync(job.Id!));

            var counts = await backend.GetCountsAsync("waiting", "active", "completed");
            Assert.Equal(1, counts[0]);
            Assert.Equal(0, counts[1]);
        }
        finally
        {
            await CleanupAsync(backend);
        }
    }

    [Fact]
    public async Task GetJobData_RoundTripsNameAndData()
    {
        var backend = await CreateBackendAsync();
        try
        {
            var job = await AddAsync(backend, name: "greet", data: new { hello = "world" });
            var raw = await backend.GetJobDataAsync(job.Id!);

            Assert.NotNull(raw);
            Assert.Equal("greet", raw!.Name);
            Assert.Contains("world", raw.Data);
        }
        finally
        {
            await CleanupAsync(backend);
        }
    }

    [Fact]
    public async Task MoveToActive_ThenCompleted_TransitionsState()
    {
        var backend = await CreateBackendAsync();
        try
        {
            var added = await AddAsync(backend);
            var next = await backend.MoveToActiveAsync(Token);

            Assert.NotNull(next.Job);
            Assert.Equal(added.Id, next.JobId);
            Assert.Equal(JobState.Active, await backend.GetStateAsync(added.Id!));

            var job = Job.FromJson(backend, "conf", next.Job!, next.JobId);
            await backend.MoveToCompletedAsync(job, "\"ok\"", null, Token, fetchNext: false);

            Assert.Equal(JobState.Completed, await backend.GetStateAsync(added.Id!));
        }
        finally
        {
            await CleanupAsync(backend);
        }
    }

    [Fact]
    public async Task MoveToActive_ThenFailed_TransitionsState()
    {
        var backend = await CreateBackendAsync();
        try
        {
            var added = await AddAsync(backend, opts: new JobsOptions { Attempts = 1 });
            var next = await backend.MoveToActiveAsync(Token);
            var job = Job.FromJson(backend, "conf", next.Job!, next.JobId);

            await backend.MoveToFailedAsync(job, "boom", null, Token, fetchNext: false);

            Assert.Equal(JobState.Failed, await backend.GetStateAsync(added.Id!));
        }
        finally
        {
            await CleanupAsync(backend);
        }
    }

    [Fact]
    public async Task Pause_And_Resume_TogglesPausedFlag()
    {
        var backend = await CreateBackendAsync();
        try
        {
            Assert.False(await backend.IsPausedAsync());
            await backend.PauseAsync(true);
            Assert.True(await backend.IsPausedAsync());
            await backend.PauseAsync(false);
            Assert.False(await backend.IsPausedAsync());
        }
        finally
        {
            await CleanupAsync(backend);
        }
    }

    [Fact]
    public async Task Remove_DeletesJob()
    {
        var backend = await CreateBackendAsync();
        try
        {
            var job = await AddAsync(backend);
            var removed = await backend.RemoveAsync(job.Id!, removeChildren: true);
            Assert.Equal(1, removed);
            Assert.Equal(JobState.Unknown, await backend.GetStateAsync(job.Id!));
        }
        finally
        {
            await CleanupAsync(backend);
        }
    }

    [Fact]
    public async Task DelayedJob_IsDelayed_ThenPromoted()
    {
        var backend = await CreateBackendAsync();
        try
        {
            var job = await AddAsync(backend, opts: new JobsOptions { Delay = 60000 });
            Assert.Equal(JobState.Delayed, await backend.GetStateAsync(job.Id!));

            var counts = await backend.GetCountsAsync("delayed");
            Assert.Equal(1, counts[0]);

            await backend.PromoteAsync(job.Id!);
            Assert.Equal(JobState.Waiting, await backend.GetStateAsync(job.Id!));
        }
        finally
        {
            await CleanupAsync(backend);
        }
    }

    [Fact]
    public async Task PrioritizedJob_HasPrioritizedState()
    {
        var backend = await CreateBackendAsync();
        try
        {
            var job = await AddAsync(backend, opts: new JobsOptions { Priority = 5 });
            Assert.Equal(JobState.Prioritized, await backend.GetStateAsync(job.Id!));
        }
        finally
        {
            await CleanupAsync(backend);
        }
    }

    [Fact]
    public async Task ExtendLock_RenewsActiveJob()
    {
        var backend = await CreateBackendAsync();
        try
        {
            var added = await AddAsync(backend);
            await backend.MoveToActiveAsync(Token);

            var renewed = await backend.ExtendLockAsync(added.Id!, Token, 30000);
            Assert.Equal(1, renewed);
        }
        finally
        {
            await CleanupAsync(backend);
        }
    }

    [Fact]
    public async Task AddJobs_BulkAddsAll()
    {
        var backend = await CreateBackendAsync();
        try
        {
            var jobs = Enumerable.Range(0, 5)
                .Select(i => new Job(backend, "conf", "job", new { i }, new JobsOptions()))
                .ToList();

            var ids = await backend.AddJobsAsync(jobs);
            Assert.Equal(5, ids.Count);
            Assert.All(ids, id => Assert.False(string.IsNullOrEmpty(id)));

            var counts = await backend.GetCountsAsync("waiting");
            Assert.Equal(5, counts[0]);
        }
        finally
        {
            await CleanupAsync(backend);
        }
    }

    [Fact]
    public async Task UpdateProgress_And_UpdateData_Persist()
    {
        var backend = await CreateBackendAsync();
        try
        {
            var job = await AddAsync(backend, data: new { a = 1 });

            await backend.UpdateProgressAsync(job.Id!, 42);
            await backend.UpdateDataAsync(job.Id!, new { a = 2 });

            var raw = await backend.GetJobDataAsync(job.Id!);
            Assert.NotNull(raw);
            Assert.Contains("42", raw!.Progress);
            Assert.Contains("2", raw.Data);
        }
        finally
        {
            await CleanupAsync(backend);
        }
    }

    [Fact]
    public async Task AddLog_And_GetJobLogs_RoundTrip()
    {
        var backend = await CreateBackendAsync();
        try
        {
            var job = await AddAsync(backend);
            await backend.AddLogAsync(job.Id!, "first");
            var count = await backend.AddLogAsync(job.Id!, "second");
            Assert.Equal(2, count);

            var logs = await backend.GetJobLogsAsync(job.Id!);
            Assert.Equal(2, logs.Count);
            Assert.Equal("first", logs.Logs[0]);
            Assert.Equal("second", logs.Logs[1]);
        }
        finally
        {
            await CleanupAsync(backend);
        }
    }

    [Fact]
    public async Task WaitForJob_ReturnsMarker_WhenJobWaiting()
    {
        var backend = await CreateBackendAsync();
        try
        {
            await AddAsync(backend);
            var marker = await backend.WaitForJobAsync(1.0);
            Assert.NotNull(marker);
        }
        finally
        {
            await CleanupAsync(backend);
        }
    }

    [Fact]
    public async Task QueueMeta_SetAndGet()
    {
        var backend = await CreateBackendAsync();
        try
        {
            await backend.SetQueueMetaAsync(new Dictionary<string, object> { ["version"] = "bullmq:test" });
            Assert.True(await backend.HasQueueMetaFieldAsync("version"));
            Assert.Equal("bullmq:test", await backend.GetQueueMetaFieldAsync("version"));
        }
        finally
        {
            await CleanupAsync(backend);
        }
    }
}

/// <summary>Runs the backend conformance suite against the Redis adapter.</summary>
public sealed class RedisBackendConformanceTests : BackendConformanceTests
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_REDIS") ?? "localhost:6379";

    protected override async Task<IQueueBackend> CreateBackendAsync(int lockDuration = 30000)
    {
        var options = new QueueOptions { Connection = ConnectionOptions.FromString(ConnectionString) };
        var backend = await RedisBackend.CreateAsync(UniqueName(), options, lockDuration);
        await backend.WaitUntilReadyAsync();
        return backend;
    }
}

/// <summary>Runs the backend conformance suite against the PostgreSQL adapter.</summary>
public sealed class PostgresBackendConformanceTests : BackendConformanceTests
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_POSTGRES")
        ?? $"Host=localhost;Database=bullmq_test;Username={Environment.UserName}";

    protected override async Task<IQueueBackend> CreateBackendAsync(int lockDuration = 30000)
    {
        var options = new BullMQ.Postgres.PostgresOptions { ConnectionString = ConnectionString };
        var backend = PostgresBackend.Create(UniqueName(), options, lockDuration);
        await backend.WaitUntilReadyAsync();
        return backend;
    }
}
