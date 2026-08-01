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

    /// <summary>
    /// Moves the job to the completed state, optionally fetching the next job to
    /// process (used by the worker to chain fetches efficiently).
    /// </summary>
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
}
