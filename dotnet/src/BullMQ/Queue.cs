namespace BullMQ;

/// <summary>
/// A queue lets you add jobs to be processed by one or more <see cref="Worker"/>
/// instances, and provides high-level administration such as pausing, counting
/// and obliterating.
/// </summary>
public sealed class Queue : IAsyncDisposable
{
    private readonly Lazy<Task<IQueueBackend>> _backend;
    private readonly JobsOptions _defaultJobOptions;

    /// <summary>The queue name.</summary>
    public string Name { get; }

    /// <summary>The options this queue was created with.</summary>
    public QueueOptions Opts { get; }

    public Queue(string name, QueueOptions opts)
    {
        Name = name;
        Opts = opts ?? throw new ArgumentNullException(nameof(opts));
        _defaultJobOptions = opts.DefaultJobOptions ?? new JobsOptions();
        _backend = new Lazy<Task<IQueueBackend>>(InitBackendAsync);
    }

    private async Task<IQueueBackend> InitBackendAsync()
    {
        var backend = await BackendBuilder.CreateAsync(Name, Opts).ConfigureAwait(false);
        await backend.WaitUntilReadyAsync().ConfigureAwait(false);

        if (!Opts.SkipMetasUpdate)
        {
            await backend.SetQueueMetaAsync(MetaValues).ConfigureAwait(false);
        }

        return backend;
    }

    private IReadOnlyDictionary<string, object> MetaValues => new Dictionary<string, object>
    {
        ["opts.maxLenEvents"] = 10000,
        ["version"] = $"bullmq:{Version.Value}",
    };

    /// <summary>Resolves the backend, connecting on first use.</summary>
    public Task<IQueueBackend> GetBackendAsync() => _backend.Value;

    /// <summary>Waits until the queue's connection is ready.</summary>
    public async Task WaitUntilReadyAsync() => await _backend.Value.ConfigureAwait(false);

    /// <summary>Adds a new job to the queue.</summary>
    public async Task<Job> AddAsync(string name, object? data, JobsOptions? opts = null)
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        var merged = MergeOpts(opts);

        if (merged.JobId == "0" || (merged.JobId?.StartsWith("0:", StringComparison.Ordinal) ?? false))
        {
            throw new ArgumentException("JobId cannot be '0' or start with '0:'");
        }

        return await Job.CreateAsync(backend, Name, name, data, merged).ConfigureAwait(false);
    }

    /// <summary>Pauses the processing of this queue globally.</summary>
    public async Task PauseAsync()
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        await backend.PauseAsync(true).ConfigureAwait(false);
    }

    /// <summary>Resumes the processing of this queue globally.</summary>
    public async Task ResumeAsync()
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        await backend.PauseAsync(false).ConfigureAwait(false);
    }

    /// <summary>Returns true if the queue is currently paused.</summary>
    public async Task<bool> IsPausedAsync()
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        return await backend.HasQueueMetaFieldAsync("paused").ConfigureAwait(false);
    }

    /// <summary>Returns the number of jobs in the given states.</summary>
    public async Task<IReadOnlyDictionary<string, long>> GetJobCountsAsync(params string[] types)
    {
        if (types.Length == 0)
        {
            types = new[] { "waiting", "active", "completed", "failed", "delayed", "paused" };
        }

        var backend = await _backend.Value.ConfigureAwait(false);
        var counts = await backend.GetCountsAsync(types).ConfigureAwait(false);

        var result = new Dictionary<string, long>(StringComparer.Ordinal);
        for (var i = 0; i < types.Length; i++)
        {
            result[types[i]] = i < counts.Length ? counts[i] : 0;
        }

        return result;
    }

    /// <summary>Returns the number of jobs waiting to be processed.</summary>
    public async Task<long> GetWaitingCountAsync()
    {
        var counts = await GetJobCountsAsync("waiting").ConfigureAwait(false);
        return counts["waiting"];
    }

    /// <summary>Fetches a job by id, or null when it does not exist.</summary>
    public async Task<Job?> GetJobAsync(string jobId)
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        return await Job.FromIdAsync(backend, Name, jobId).ConfigureAwait(false);
    }

    /// <summary>Adds several jobs to the queue in a single efficient operation.</summary>
    public async Task<IReadOnlyList<Job>> AddBulkAsync(
        IEnumerable<(string name, object? data, JobsOptions? opts)> jobs)
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        var list = jobs
            .Select(j => new Job(backend, Name, j.name, j.data, MergeOpts(j.opts)))
            .ToList();
        await backend.AddJobsAsync(list).ConfigureAwait(false);
        return list;
    }

    /// <summary>Returns the current state of a job.</summary>
    public async Task<JobState> GetJobStateAsync(string jobId)
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        return await backend.GetStateAsync(jobId).ConfigureAwait(false);
    }

    /// <summary>
    /// Creates or updates a job scheduler (repeatable job factory) and enqueues
    /// its next iteration. Returns the job for that iteration, or null.
    /// </summary>
    public async Task<Job?> UpsertJobSchedulerAsync(
        string schedulerId, RepeatOptions repeat, JobSchedulerTemplate? template = null)
    {
        if (RepeatStrategy.ToMillis(repeat.EndDate) is { } end &&
            end < DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
        {
            throw new ArgumentException("End date must be greater than current timestamp");
        }

        var backend = await _backend.Value.ConfigureAwait(false);
        var scheduler = new JobScheduler(backend, Name);
        var opts = MergeOpts(template?.Opts);
        return await scheduler
            .UpsertJobSchedulerAsync(schedulerId, repeat, template?.Name ?? schedulerId, template?.Data, opts)
            .ConfigureAwait(false);
    }

    /// <summary>Returns a job scheduler by id, or null when absent.</summary>
    public async Task<JobSchedulerJson?> GetJobSchedulerAsync(string schedulerId)
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        return await new JobScheduler(backend, Name).GetSchedulerAsync(schedulerId).ConfigureAwait(false);
    }

    /// <summary>Returns a page of registered job schedulers.</summary>
    public async Task<IReadOnlyList<JobSchedulerJson>> GetJobSchedulersAsync(
        int start = 0, int end = -1, bool asc = false)
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        return await new JobScheduler(backend, Name).GetJobSchedulersAsync(start, end, asc).ConfigureAwait(false);
    }

    /// <summary>Returns the number of registered job schedulers.</summary>
    public async Task<long> GetJobSchedulersCountAsync()
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        return await new JobScheduler(backend, Name).GetSchedulersCountAsync().ConfigureAwait(false);
    }

    /// <summary>Removes a job scheduler. Returns true if it existed.</summary>
    public async Task<bool> RemoveJobSchedulerAsync(string schedulerId)
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        return await new JobScheduler(backend, Name).RemoveJobSchedulerAsync(schedulerId).ConfigureAwait(false);
    }

    /// <summary>Returns the jobs in the given states (each id resolved to a full job).</summary>
    public async Task<IReadOnlyList<Job>> GetJobsAsync(
        IReadOnlyList<string> types, int start = 0, int end = -1, bool asc = false)
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        var ids = await backend.GetRangesAsync(types, start, end, asc).ConfigureAwait(false);
        var jobs = new List<Job>(ids.Count);
        foreach (var id in ids)
        {
            var job = await Job.FromIdAsync(backend, Name, id).ConfigureAwait(false);
            if (job is not null)
            {
                jobs.Add(job);
            }
        }

        return jobs;
    }

    /// <summary>Returns the number of jobs for each requested priority.</summary>
    public async Task<long[]> GetCountsPerPriorityAsync(IReadOnlyList<long> priorities)
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        return await backend.GetCountsPerPriorityAsync(priorities).ConfigureAwait(false);
    }

    /// <summary>Returns waiting jobs.</summary>
    public Task<IReadOnlyList<Job>> GetWaitingAsync(int start = 0, int end = -1) =>
        GetJobsAsync(new[] { "waiting" }, start, end, asc: true);

    /// <summary>Returns active jobs.</summary>
    public Task<IReadOnlyList<Job>> GetActiveAsync(int start = 0, int end = -1) =>
        GetJobsAsync(new[] { "active" }, start, end, asc: true);

    /// <summary>Returns completed jobs.</summary>
    public Task<IReadOnlyList<Job>> GetCompletedAsync(int start = 0, int end = -1) =>
        GetJobsAsync(new[] { "completed" }, start, end);

    /// <summary>Returns failed jobs.</summary>
    public Task<IReadOnlyList<Job>> GetFailedAsync(int start = 0, int end = -1) =>
        GetJobsAsync(new[] { "failed" }, start, end);

    /// <summary>Returns delayed jobs.</summary>
    public Task<IReadOnlyList<Job>> GetDelayedAsync(int start = 0, int end = -1) =>
        GetJobsAsync(new[] { "delayed" }, start, end);

    /// <summary>Returns the number of active jobs.</summary>
    public async Task<long> GetActiveCountAsync() =>
        (await GetJobCountsAsync("active").ConfigureAwait(false))["active"];

    /// <summary>Returns the number of completed jobs.</summary>
    public async Task<long> GetCompletedCountAsync() =>
        (await GetJobCountsAsync("completed").ConfigureAwait(false))["completed"];

    /// <summary>Returns the number of failed jobs.</summary>
    public async Task<long> GetFailedCountAsync() =>
        (await GetJobCountsAsync("failed").ConfigureAwait(false))["failed"];

    /// <summary>Returns the number of delayed jobs.</summary>
    public async Task<long> GetDelayedCountAsync() =>
        (await GetJobCountsAsync("delayed").ConfigureAwait(false))["delayed"];

    /// <summary>Returns a page of a job's logs together with the total count.</summary>
    public async Task<JobLogs> GetJobLogsAsync(string jobId, int start = 0, int end = -1, bool asc = true)
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        return await backend.GetJobLogsAsync(jobId, start, end, asc).ConfigureAwait(false);
    }

    /// <summary>
    /// Removes jobs of the given type older than <paramref name="grace"/> ms.
    /// Returns the removed job ids.
    /// </summary>
    public async Task<IReadOnlyList<string>> CleanAsync(long grace, int limit, string type = "completed")
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        var set = type == "waiting" ? "wait" : type;
        return await backend.CleanJobsInSetAsync(set, grace, limit).ConfigureAwait(false);
    }

    /// <summary>Removes waiting (and optionally delayed) jobs from the queue.</summary>
    public async Task DrainAsync(bool delayed = false)
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        await backend.DrainAsync(delayed).ConfigureAwait(false);
    }

    /// <summary>Removes the given job (and optionally its children).</summary>
    public async Task<long> RemoveAsync(string jobId, bool removeChildren = true)
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        return await backend.RemoveAsync(jobId, removeChildren).ConfigureAwait(false);
    }

    /// <summary>Moves all failed (or completed) jobs back to wait.</summary>
    public async Task RetryJobsAsync(string state = "failed", int count = 1000, long? timestamp = null)
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        var ts = timestamp ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        long cursor;
        do
        {
            cursor = await backend.RetryJobsAsync(state, count, ts).ConfigureAwait(false);
        }
        while (cursor != 0);
    }

    /// <summary>Promotes all delayed jobs back to wait.</summary>
    public async Task PromoteJobsAsync(int count = 1000)
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        long cursor;
        do
        {
            cursor = await backend.PromoteJobsAsync(count).ConfigureAwait(false);
        }
        while (cursor != 0);
    }

    /// <summary>Returns the ttl (ms) of the current rate-limit window.</summary>
    public async Task<long> GetRateLimitTtlAsync()
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        return await backend.GetRateLimitTtlAsync().ConfigureAwait(false);
    }

    /// <summary>Returns the stored <c>meta.version</c> field, or null when unset.</summary>
    public async Task<string?> GetVersionAsync()
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        return await backend.GetQueueMetaFieldAsync("version").ConfigureAwait(false);
    }

    /// <summary>Completely destroys the queue and all of its contents irreversibly.</summary>
    public async Task ObliterateAsync(bool force = false, int count = 1000)
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        await backend.PauseAsync(true).ConfigureAwait(false);

        long cursor;
        do
        {
            cursor = await backend.ObliterateAsync(force, count).ConfigureAwait(false);
        }
        while (cursor != 0);
    }

    /// <summary>Closes the queue and its connection (when owned).</summary>
    public async Task CloseAsync()
    {
        if (_backend.IsValueCreated)
        {
            var backend = await _backend.Value.ConfigureAwait(false);
            await backend.CloseAsync().ConfigureAwait(false);
        }
    }

    public async ValueTask DisposeAsync() => await CloseAsync().ConfigureAwait(false);

    private JobsOptions MergeOpts(JobsOptions? opts)
    {
        var merged = _defaultJobOptions.Clone();
        if (opts is null)
        {
            return merged;
        }

        merged.JobId = opts.JobId ?? merged.JobId;
        merged.Delay = opts.Delay ?? merged.Delay;
        merged.Priority = opts.Priority ?? merged.Priority;
        merged.Attempts = opts.Attempts ?? merged.Attempts;
        merged.Backoff = opts.Backoff ?? merged.Backoff;
        merged.Lifo = opts.Lifo ?? merged.Lifo;
        merged.Timestamp = opts.Timestamp ?? merged.Timestamp;
        merged.RemoveOnComplete = opts.RemoveOnComplete ?? merged.RemoveOnComplete;
        merged.RemoveOnFail = opts.RemoveOnFail ?? merged.RemoveOnFail;
        merged.KeepLogs = opts.KeepLogs ?? merged.KeepLogs;
        return merged;
    }
}
