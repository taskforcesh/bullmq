using System.Text.Json;

namespace BullMQ;

/// <summary>
/// Manages repeatable job factories ("job schedulers") on a queue. A scheduler
/// produces a delayed job for its next iteration; when that job is processed the
/// worker advances the scheduler to produce the following one.
///
/// This is backend-agnostic: it composes the option/metadata payloads and
/// delegates persistence to the <see cref="IQueueBackend"/> scheduler methods, so
/// it works identically on Redis and PostgreSQL.
/// </summary>
public sealed class JobScheduler
{
    private readonly IQueueBackend _backend;
    private readonly string _queueName;

    internal JobScheduler(IQueueBackend backend, string queueName)
    {
        _backend = backend;
        _queueName = queueName;
    }

    /// <summary>
    /// Creates or updates a job scheduler and enqueues its next iteration.
    /// Returns the <see cref="Job"/> for that iteration, or null when none was
    /// produced (limit reached or end date exceeded).
    /// </summary>
    public async Task<Job?> UpsertJobSchedulerAsync(
        string schedulerId,
        RepeatOptions repeat,
        string jobName,
        object? jobData,
        JobsOptions? opts = null,
        bool @override = true,
        string? producerId = null)
    {
        opts ??= new JobsOptions();

        if (repeat.Pattern is not null && repeat.Every is not null)
        {
            throw new ArgumentException(
                "Both .pattern and .every options are defined for this repeatable job");
        }

        if (repeat.Pattern is null && repeat.Every is null)
        {
            throw new ArgumentException(
                "Either .pattern or .every options must be defined for this repeatable job");
        }

        if ((repeat.Immediately ?? false) && repeat.StartDate is not null)
        {
            throw new ArgumentException(
                "Both .immediately and .startDate options are defined for this repeatable job");
        }

        var iterationCount = (repeat.Count ?? 0) + 1;
        if (repeat.Limit is { } limit && iterationCount > limit)
        {
            return null;
        }

        var now = NowMs();
        var endMs = RepeatStrategy.ToMillis(repeat.EndDate);
        if (endMs is { } end && now > end)
        {
            return null;
        }

        if (repeat.PrevMillis is { } prev && prev > now)
        {
            now = prev;
        }

        var newOffset = repeat.Every is not null && repeat.Offset is not null ? repeat.Offset : null;

        var nextMillis = RepeatStrategy.GetNextMillis(now, repeat);
        if (nextMillis is { } nm && nm < now)
        {
            nextMillis = now;
        }

        if (nextMillis is null && repeat.Every is null)
        {
            return null;
        }

        var templateData = JsonUtil.Serialize(jobData ?? new Dictionary<string, object?>());
        var mergedOpts = BuildNextJobOpts(nextMillis, schedulerId, opts, repeat, iterationCount, newOffset);

        if (@override)
        {
            var clampedNext = Math.Max(nextMillis ?? now, now);
            var schedulerOpts = BuildSchedulerOpts(repeat, jobName, newOffset, endMs);

            var (jobId, delay) = await _backend.AddJobSchedulerAsync(
                schedulerId,
                clampedNext,
                templateData,
                OptsCodec.ToStorageMap(opts),
                schedulerOpts,
                mergedOpts,
                producerId).ConfigureAwait(false);

            return BuildSchedulerJob(jobName, jobData, jobId, delay, schedulerId);
        }

        var updatedId = await _backend.UpdateJobSchedulerNextMillisAsync(
            schedulerId,
            nextMillis ?? now,
            templateData,
            mergedOpts,
            producerId).ConfigureAwait(false);

        if (string.IsNullOrEmpty(updatedId))
        {
            return null;
        }

        return BuildSchedulerJob(jobName, jobData, updatedId!, 0, schedulerId);
    }

    /// <summary>Removes a scheduler. Returns true when it existed.</summary>
    public async Task<bool> RemoveJobSchedulerAsync(string schedulerId) =>
        await _backend.RemoveJobSchedulerAsync(schedulerId).ConfigureAwait(false) == 0;

    /// <summary>Returns whether an id corresponds to a registered scheduler.</summary>
    public Task<bool> IsJobSchedulerAsync(string schedulerId) => _backend.IsJobSchedulerAsync(schedulerId);

    /// <summary>Returns the number of registered schedulers.</summary>
    public Task<long> GetSchedulersCountAsync() => _backend.GetJobSchedulersCountAsync();

    /// <summary>Returns a scheduler record, or null when absent.</summary>
    public async Task<JobSchedulerJson?> GetSchedulerAsync(string schedulerId)
    {
        var (raw, next) = await _backend.GetJobSchedulerAsync(schedulerId).ConfigureAwait(false);
        if (raw.Count == 0)
        {
            return null;
        }

        return Transform(schedulerId, FlatToDict(raw), next);
    }

    /// <summary>Returns a page of registered schedulers.</summary>
    public async Task<IReadOnlyList<JobSchedulerJson>> GetJobSchedulersAsync(
        int start = 0, int end = -1, bool asc = false)
    {
        var flat = await _backend.GetJobSchedulersRangeAsync(start, end, asc).ConfigureAwait(false);
        var result = new List<JobSchedulerJson>();
        for (var i = 0; i + 1 < flat.Count; i += 2)
        {
            var key = flat[i];
            var next = long.TryParse(flat[i + 1], out var n) ? n : (long?)null;
            var fields = await _backend.GetJobSchedulerDataAsync(key).ConfigureAwait(false);
            var record = Transform(key, fields, next);
            if (record is not null)
            {
                result.Add(record);
            }
        }

        return result;
    }

    private static Dictionary<string, object?> BuildSchedulerOpts(
        RepeatOptions repeat, string jobName, long? offset, long? endMs)
    {
        var map = new Dictionary<string, object?>(StringComparer.Ordinal) { ["name"] = jobName };

        void Add(string key, object? value)
        {
            if (value is not null)
            {
                map[key] = value;
            }
        }

        Add("tz", repeat.Tz);
        Add("pattern", repeat.Pattern);
        Add("every", repeat.Every);
        Add("limit", repeat.Limit);
        Add("offset", offset);
        Add("startDate", RepeatStrategy.ToMillis(repeat.StartDate));
        Add("endDate", endMs);
        return map;
    }

    private static Dictionary<string, object?> BuildNextJobOpts(
        long? nextMillis,
        string schedulerId,
        JobsOptions opts,
        RepeatOptions repeat,
        int iterationCount,
        long? offset)
    {
        var now = NowMs();
        var baseNext = nextMillis ?? now;
        var delay = baseNext + (offset ?? 0) - now;
        if (delay < 0)
        {
            delay = 0;
        }

        var mergedRepeat = new Dictionary<string, object?>(StringComparer.Ordinal);

        void AddRepeat(string key, object? value)
        {
            if (value is not null)
            {
                mergedRepeat[key] = value;
            }
        }

        AddRepeat("pattern", repeat.Pattern);
        AddRepeat("every", repeat.Every);
        AddRepeat("limit", repeat.Limit);
        AddRepeat("tz", repeat.Tz);
        AddRepeat("offset", offset);
        AddRepeat("count", iterationCount);
        AddRepeat("startDate", RepeatStrategy.ToMillis(repeat.StartDate));
        AddRepeat("endDate", RepeatStrategy.ToMillis(repeat.EndDate));

        var merged = OptsCodec.ToStorageMap(opts);
        merged["jobId"] = $"repeat:{schedulerId}:{baseNext}";
        merged["delay"] = delay;
        merged["timestamp"] = now;
        merged["prevMillis"] = baseNext;
        merged["repeatJobKey"] = schedulerId;
        merged["repeat"] = mergedRepeat;
        return merged;
    }

    private Job BuildSchedulerJob(string jobName, object? jobData, string jobId, long delay, string schedulerId)
    {
        var job = new Job(_backend, _queueName, jobName, jobData, new JobsOptions { JobId = jobId, Delay = delay })
        {
            Id = jobId,
            RepeatJobKey = schedulerId,
        };
        return job;
    }

    private static JobSchedulerJson? Transform(string key, IReadOnlyDictionary<string, string> fields, long? next)
    {
        if (fields.Count == 0)
        {
            return null;
        }

        var record = new JobSchedulerJson
        {
            Key = key,
            Name = fields.GetValueOrDefault("name"),
            Next = next,
            Tz = fields.GetValueOrDefault("tz"),
            Pattern = fields.GetValueOrDefault("pattern"),
        };

        if (int.TryParse(fields.GetValueOrDefault("ic"), out var ic))
        {
            record.IterationCount = ic;
        }

        if (int.TryParse(fields.GetValueOrDefault("limit"), out var limit))
        {
            record.Limit = limit;
        }

        if (long.TryParse(fields.GetValueOrDefault("startDate"), out var sd))
        {
            record.StartDate = sd;
        }

        if (long.TryParse(fields.GetValueOrDefault("endDate"), out var ed))
        {
            record.EndDate = ed;
        }

        if (long.TryParse(fields.GetValueOrDefault("every"), out var every))
        {
            record.Every = every;
        }

        if (long.TryParse(fields.GetValueOrDefault("offset"), out var offset))
        {
            record.Offset = offset;
        }

        var data = fields.GetValueOrDefault("data");
        if (!string.IsNullOrEmpty(data))
        {
            record.Template = JsonSerializer.Deserialize<JsonElement>(data);
        }

        return record;
    }

    private static IReadOnlyDictionary<string, string> FlatToDict(IReadOnlyList<string> flat)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var i = 0; i + 1 < flat.Count; i += 2)
        {
            map[flat[i]] = flat[i + 1];
        }

        return map;
    }

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}
