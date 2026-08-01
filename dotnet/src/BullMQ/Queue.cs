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
