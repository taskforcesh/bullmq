using StackExchange.Redis;

namespace BullMQ;

/// <summary>
/// The raw, string-valued representation of a job as it is stored in the Redis
/// job hash. Field names match the keys written by the shared Lua scripts.
/// </summary>
public sealed class JobJson
{
    public string? Id { get; set; }
    public string? Name { get; set; }

    /// <summary>JSON-encoded job payload.</summary>
    public string Data { get; set; } = "{}";

    /// <summary>JSON-encoded job options (with short-form keys).</summary>
    public string Opts { get; set; } = "{}";

    /// <summary>JSON-encoded progress (number or object).</summary>
    public string? Progress { get; set; }

    public long Delay { get; set; }
    public long Timestamp { get; set; }
    public int AttemptsMade { get; set; }
    public int AttemptsStarted { get; set; }
    public int StalledCounter { get; set; }
    public long? FinishedOn { get; set; }
    public long? ProcessedOn { get; set; }
    public string? FailedReason { get; set; }
    public string? ReturnValue { get; set; }

    /// <summary>JSON-encoded stack trace array.</summary>
    public string? StackTrace { get; set; }

    public string? RepeatJobKey { get; set; }
    public string? ParentKey { get; set; }
    public string? Parent { get; set; }
    public string? DeferredFailure { get; set; }

    /// <summary>Builds a <see cref="JobJson"/> from a flat key/value map.</summary>
    public static JobJson FromMap(IReadOnlyDictionary<string, string?> map, string? jobId = null)
    {
        string? Get(string key) => map.TryGetValue(key, out var v) ? v : null;

        long GetLong(string key, long fallback = 0) =>
            long.TryParse(Get(key), out var v) ? v : fallback;

        int GetInt(string key, int fallback = 0) =>
            int.TryParse(Get(key), out var v) ? v : fallback;

        var job = new JobJson
        {
            Id = jobId ?? Get("id"),
            Name = Get("name"),
            Data = Get("data") ?? "{}",
            Opts = Get("opts") ?? "{}",
            Progress = Get("progress"),
            Delay = GetLong("delay"),
            Timestamp = GetLong("timestamp"),
            AttemptsMade = GetInt("attemptsMade", GetInt("atm")),
            AttemptsStarted = GetInt("ats"),
            StalledCounter = GetInt("stc"),
            FailedReason = Get("failedReason"),
            ReturnValue = Get("returnvalue"),
            StackTrace = Get("stacktrace"),
            RepeatJobKey = Get("rjk"),
            ParentKey = Get("parentKey"),
            Parent = Get("parent"),
            DeferredFailure = Get("defa"),
        };

        if (long.TryParse(Get("finishedOn"), out var fo))
        {
            job.FinishedOn = fo;
        }

        if (long.TryParse(Get("processedOn"), out var po))
        {
            job.ProcessedOn = po;
        }

        return job;
    }

    /// <summary>Builds a <see cref="JobJson"/> from a Redis hash result.</summary>
    public static JobJson? FromHash(HashEntry[] entries, string? jobId = null)
    {
        if (entries.Length == 0)
        {
            return null;
        }

        var map = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (var entry in entries)
        {
            map[entry.Name!] = entry.Value.IsNull ? null : entry.Value.ToString();
        }

        return FromMap(map, jobId);
    }
}

/// <summary>
/// The tuple returned by the fetch/finish scripts: the next job to process (if
/// any), together with the rate-limit and delay-until signals.
/// </summary>
public readonly struct NextJobData
{
    public JobJson? Job { get; init; }
    public string? JobId { get; init; }
    public long RateLimitDelay { get; init; }
    public long DelayUntil { get; init; }

    public bool HasJob => Job is not null || JobId is not null;

    public static readonly NextJobData Empty = default;
}
