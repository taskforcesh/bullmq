using System.Text.Json;

namespace BullMQ;

/// <summary>
/// Represents a job in the queue. Jobs are normally created implicitly when you
/// add work to a <see cref="Queue"/> (e.g. <see cref="Queue.AddAsync"/>) and an
/// instance is handed to the worker's processor function.
/// </summary>
public class Job
{
    private readonly IQueueBackend _backend;

    internal IQueueBackend Backend => _backend;

    /// <summary>The name of the queue this job belongs to.</summary>
    public string QueueName { get; }

    /// <summary>The job id (assigned by the backend when added).</summary>
    public string? Id { get; set; }

    /// <summary>The job name.</summary>
    public string Name { get; }

    /// <summary>The user-supplied payload (JSON-serializable).</summary>
    public object? Data { get; set; }

    /// <summary>The options that govern how the job is processed.</summary>
    public JobsOptions Opts { get; }

    /// <summary>Creation timestamp (ms since epoch).</summary>
    public long Timestamp { get; set; }

    /// <summary>Delay in milliseconds before the job becomes available.</summary>
    public long Delay { get; set; }

    /// <summary>Job priority (0 = none).</summary>
    public int Priority { get; set; }

    /// <summary>Total number of attempts configured for this job.</summary>
    public int Attempts { get; set; }

    /// <summary>Number of attempts already made.</summary>
    public int AttemptsMade { get; set; }

    /// <summary>Number of times processing has started.</summary>
    public int AttemptsStarted { get; set; }

    /// <summary>Number of times the job has stalled.</summary>
    public int StalledCounter { get; set; }

    /// <summary>Current progress (number or object).</summary>
    public object? Progress { get; set; }

    /// <summary>Return value once completed.</summary>
    public object? ReturnValue { get; set; }

    /// <summary>The reason for the last failure.</summary>
    public string? FailedReason { get; set; }

    /// <summary>Collected stack traces from failed attempts.</summary>
    public List<string> StackTrace { get; set; } = new();

    public long? FinishedOn { get; set; }
    public long? ProcessedOn { get; set; }

    public string? ParentKey { get; set; }
    public object? Parent { get; set; }
    public string? RepeatJobKey { get; set; }
    public RepeatOptions? Repeat { get; set; }
    public string? DeduplicationId { get; set; }
    public string? DeferredFailure { get; set; }

    /// <summary>The worker token assigned while the job is active.</summary>
    public string? Token { get; set; }

    internal Job(IQueueBackend backend, string queueName, string name, object? data, JobsOptions opts)
    {
        _backend = backend;
        QueueName = queueName;
        Name = name;
        Data = data;
        Opts = opts;
        Id = opts.JobId;
        Timestamp = opts.Timestamp ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        Delay = opts.Delay ?? 0;
        Priority = opts.Priority ?? 0;
        Attempts = opts.Attempts ?? 0;
    }

    /// <summary>Creates a job and adds it to the queue via the backend.</summary>
    public static async Task<Job> CreateAsync(
        IQueueBackend backend, string queueName, string name, object? data, JobsOptions opts)
    {
        var job = new Job(backend, queueName, name, data, opts);
        var id = await backend.AddJobAsync(job).ConfigureAwait(false);
        job.Id = id;
        return job;
    }

    /// <summary>Rehydrates a job from its raw Redis representation.</summary>
    public static Job FromJson(IQueueBackend backend, string queueName, JobJson raw, string? jobId = null)
    {
        var opts = ParseOpts(raw.Opts);
        object? data = string.IsNullOrEmpty(raw.Data)
            ? null
            : JsonSerializer.Deserialize<JsonElement>(raw.Data);

        var job = new Job(backend, queueName, raw.Name ?? string.Empty, data, opts)
        {
            Id = jobId ?? raw.Id,
            Delay = raw.Delay,
            Timestamp = raw.Timestamp,
            AttemptsMade = raw.AttemptsMade,
            AttemptsStarted = raw.AttemptsStarted,
            StalledCounter = raw.StalledCounter,
            FinishedOn = raw.FinishedOn,
            ProcessedOn = raw.ProcessedOn,
            FailedReason = raw.FailedReason,
            RepeatJobKey = raw.RepeatJobKey,
            ParentKey = raw.ParentKey,
            DeferredFailure = raw.DeferredFailure,
        };

        if (!string.IsNullOrEmpty(raw.Progress))
        {
            job.Progress = JsonSerializer.Deserialize<JsonElement>(raw.Progress);
        }

        if (!string.IsNullOrEmpty(raw.ReturnValue))
        {
            job.ReturnValue = JsonSerializer.Deserialize<JsonElement>(raw.ReturnValue);
        }

        if (!string.IsNullOrEmpty(raw.StackTrace))
        {
            job.StackTrace = JsonSerializer.Deserialize<List<string>>(raw.StackTrace) ?? new();
        }

        job.Repeat = ParseRepeat(raw.Opts);

        return job;
    }

    /// <summary>Fetches a job by id, or null when it does not exist.</summary>
    public static async Task<Job?> FromIdAsync(IQueueBackend backend, string queueName, string jobId)
    {
        var raw = await backend.GetJobDataAsync(jobId).ConfigureAwait(false);
        return raw is null ? null : FromJson(backend, queueName, raw, jobId);
    }

    /// <summary>Returns the current state of this job.</summary>
    public Task<JobState> GetStateAsync() => _backend.GetStateAsync(Id!);

    /// <summary>Appends a row to this job's log. Returns the total log count.</summary>
    public Task<long> LogAsync(string logRow) =>
        _backend.AddLogAsync(Id!, logRow, Opts.KeepLogs ?? 0);

    /// <summary>Updates this job's progress and notifies listeners.</summary>
    public async Task UpdateProgressAsync(object? progress)
    {
        await _backend.UpdateProgressAsync(Id!, progress).ConfigureAwait(false);
        Progress = progress;
    }

    /// <summary>Replaces this job's data payload.</summary>
    public async Task UpdateDataAsync(object? data)
    {
        await _backend.UpdateDataAsync(Id!, data).ConfigureAwait(false);
        Data = data;
    }

    /// <summary>Changes this job's priority (and optionally lifo) while waiting.</summary>
    public Task ChangePriorityAsync(int priority = 0, bool lifo = false) =>
        _backend.ChangePriorityAsync(Id!, priority, lifo);

    /// <summary>Promotes this delayed job so it can be processed as soon as possible.</summary>
    public Task PromoteAsync() => _backend.PromoteAsync(Id!);

    /// <summary>Reprocesses a finished job (moving it back to wait).</summary>
    public Task RetryAsync(string state = "failed") => _backend.ReprocessJobAsync(this, state);

    /// <summary>Removes this job (and optionally its children).</summary>
    public Task<long> RemoveAsync(bool removeChildren = true) => _backend.RemoveAsync(Id!, removeChildren);

    /// <summary>Moves this (parent) job to the waiting-children state.</summary>
    public Task<bool> MoveToWaitingChildrenAsync(string token, string? childKey = null) =>
        _backend.MoveToWaitingChildrenAsync(Id!, token, childKey);

    /// <summary>
    /// Moves this active job to delayed until <paramref name="timestamp"/> (ms
    /// since Unix epoch). Commonly used by manual processors right before
    /// throwing <see cref="DelayedException"/>.
    /// </summary>
    public async Task MoveToDelayedAsync(long timestamp, string? token = null)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var delay = Math.Max(timestamp - now, 0);
        await _backend
            .MoveToDelayedAsync(
                Id!,
                now,
                delay,
                token ?? Token ?? "0",
                fetchNext: false,
                skipAttempt: true)
            .ConfigureAwait(false);
        Delay = delay;
    }

    /// <summary>Returns the processed children values (child key -&gt; deserialized value).</summary>
    public async Task<IReadOnlyDictionary<string, object?>> GetChildrenValuesAsync()
    {
        var raw = await _backend.GetProcessedChildrenValuesAsync(Id!).ConfigureAwait(false);
        var result = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var (key, value) in raw)
        {
            result[key] = string.IsNullOrEmpty(value)
                ? null
                : JsonSerializer.Deserialize<JsonElement>(value);
        }

        return result;
    }

    /// <summary>Returns whether this job has completed.</summary>
    public async Task<bool> IsCompletedAsync() => await GetStateAsync().ConfigureAwait(false) == JobState.Completed;

    /// <summary>Returns whether this job has failed.</summary>
    public async Task<bool> IsFailedAsync() => await GetStateAsync().ConfigureAwait(false) == JobState.Failed;

    /// <summary>Returns whether this job is delayed.</summary>
    public async Task<bool> IsDelayedAsync() => await GetStateAsync().ConfigureAwait(false) == JobState.Delayed;

    /// <summary>Returns whether this job is active.</summary>
    public async Task<bool> IsActiveAsync() => await GetStateAsync().ConfigureAwait(false) == JobState.Active;

    /// <summary>Returns whether this job is waiting (or prioritized).</summary>
    public async Task<bool> IsWaitingAsync()
    {
        var state = await GetStateAsync().ConfigureAwait(false);
        return state is JobState.Waiting or JobState.Prioritized;
    }

    /// <summary>Returns whether this job is waiting for its children.</summary>
    public async Task<bool> IsWaitingChildrenAsync() =>
        await GetStateAsync().ConfigureAwait(false) == JobState.WaitingChildren;


    public async Task<NextJobData?> MoveToCompletedAsync(
        object? returnValue, string token, bool fetchNext = true)
    {
        var json = JsonUtil.Serialize(returnValue);
        var result = await _backend
            .MoveToCompletedAsync(this, json, Opts.RemoveOnComplete, token, fetchNext)
            .ConfigureAwait(false);

        ReturnValue = returnValue;
        if (result.FinishedOn > 0)
        {
            FinishedOn = result.FinishedOn;
        }

        AttemptsMade += 1;
        return result.Next;
    }

    /// <summary>
    /// Moves the job to the failed state, optionally fetching the next job to
    /// process. Retries are handled by the shared scripts based on the job's
    /// attempts/backoff configuration.
    /// </summary>
    public async Task<NextJobData?> MoveToFailedAsync(
        Exception error, string token, bool fetchNext = true)
    {
        var message = error.Message;
        FailedReason = message;
        StackTrace.Add(error.StackTrace ?? string.Empty);

        var result = await _backend
            .MoveToFailedAsync(this, message, Opts.RemoveOnFail, token, fetchNext)
            .ConfigureAwait(false);

        if (result.FinishedOn > 0)
        {
            FinishedOn = result.FinishedOn;
        }

        AttemptsMade += 1;
        return result.Next;
    }

    // -- Internal serialization helpers used by the backend --

    internal string DataJson() => Data switch
    {
        null => "{}",
        JsonElement el => el.GetRawText(),
        _ => JsonUtil.Serialize(Data),
    };

    internal byte[] PackedOpts()
    {
        var storage = OptsCodec.ToStorageMap(Opts);
        var encoded = OptsCodec.Encode(storage);
        return Serialization.MsgPack.Encode(encoded);
    }

    private static JobsOptions ParseOpts(string optsJson)
    {
        var opts = new JobsOptions();
        if (string.IsNullOrEmpty(optsJson))
        {
            return opts;
        }

        using var doc = JsonDocument.Parse(optsJson);
        var root = doc.RootElement;

        if (root.TryGetProperty("attempts", out var attempts) &&
            attempts.TryGetInt32(out var a))
        {
            opts.Attempts = a;
        }

        if (root.TryGetProperty("delay", out var delay) &&
            delay.TryGetInt64(out var d))
        {
            opts.Delay = d;
        }

        if (root.TryGetProperty("priority", out var priority) &&
            priority.TryGetInt32(out var p))
        {
            opts.Priority = p;
        }

        if (root.TryGetProperty("backoff", out var backoff) &&
            backoff.ValueKind == JsonValueKind.Object)
        {
            var bo = new BackoffOptions();
            if (backoff.TryGetProperty("type", out var t) && t.ValueKind == JsonValueKind.String)
            {
                bo.Type = t.GetString()!;
            }

            if (backoff.TryGetProperty("delay", out var bd) && bd.TryGetInt64(out var bdv))
            {
                bo.Delay = bdv;
            }

            opts.Backoff = bo;
        }

        if (root.TryGetProperty("lifo", out var lifo) &&
            (lifo.ValueKind == JsonValueKind.True || lifo.ValueKind == JsonValueKind.False))
        {
            opts.Lifo = lifo.GetBoolean();
        }

        if (root.TryGetProperty("kl", out var kl) && kl.TryGetInt32(out var klv))
        {
            opts.KeepLogs = klv;
        }

        return opts;
    }

    private static RepeatOptions? ParseRepeat(string optsJson)
    {
        if (string.IsNullOrEmpty(optsJson))
        {
            return null;
        }

        using var doc = JsonDocument.Parse(optsJson);
        var root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty("repeat", out var repeat) ||
            repeat.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var options = new RepeatOptions();

        if (repeat.TryGetProperty("pattern", out var pattern) && pattern.ValueKind == JsonValueKind.String)
        {
            options.Pattern = pattern.GetString();
        }

        if (repeat.TryGetProperty("every", out var every) && every.TryGetInt64(out var e))
        {
            options.Every = e;
        }

        if (repeat.TryGetProperty("limit", out var limit) && limit.TryGetInt32(out var l))
        {
            options.Limit = l;
        }

        if (repeat.TryGetProperty("offset", out var offset) && offset.TryGetInt64(out var o))
        {
            options.Offset = o;
        }

        if (repeat.TryGetProperty("tz", out var tz) && tz.ValueKind == JsonValueKind.String)
        {
            options.Tz = tz.GetString();
        }

        if (repeat.TryGetProperty("count", out var count) && count.TryGetInt32(out var c))
        {
            options.Count = c;
        }

        if (repeat.TryGetProperty("startDate", out var sd) && sd.TryGetInt64(out var sdv))
        {
            options.StartDate = sdv;
        }

        if (repeat.TryGetProperty("endDate", out var ed) && ed.TryGetInt64(out var edv))
        {
            options.EndDate = edv;
        }

        // prevMillis lives at the top level of the job opts, not inside repeat.
        if (root.TryGetProperty("prevMillis", out var prev) && prev.TryGetInt64(out var pm))
        {
            options.PrevMillis = pm;
        }

        return options;
    }
}
