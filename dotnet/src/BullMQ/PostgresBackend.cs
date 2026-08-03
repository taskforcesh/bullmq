using System.Text.Json;
using BullMQ.Postgres;
using Npgsql;

namespace BullMQ;

/// <summary>
/// PostgreSQL implementation of <see cref="IQueueBackend"/>.
///
/// The heavy lifting lives in language-agnostic SQL: the schema and PL/pgSQL
/// operation functions are applied from the shared <c>migrations/*.sql</c>, and
/// every runtime operation runs a parameterized statement from
/// <c>commands/*.sql</c>. This adapter only builds the parameter lists and maps
/// result rows into the same shapes the high-level BullMQ classes already
/// consume from the Redis backend.
///
/// The connection-level <c>schema</c> is the namespace for all queues (the
/// SQL-native replacement for the Redis key prefix), so the <c>.sql</c> files
/// reference unqualified names and stay portable.
/// </summary>
public sealed class PostgresBackend : IQueueBackend
{
    private const string BullmqSqlState = "BM001";

    private static readonly HashSet<string> ListStates = new(StringComparer.Ordinal) { "wait", "waiting", "active", "paused" };

    private readonly PostgresConnection _connection;
    private readonly bool _ownsConnection;
    private readonly int _lockDuration;
    private readonly string? _workerName;
    private Task? _closing;

    public string Name { get; }

    public string Schema => _connection.Schema;

    internal PostgresBackend(
        string name,
        PostgresConnection connection,
        bool ownsConnection,
        int lockDuration = 0,
        string? workerName = null)
    {
        Name = name;
        _connection = connection;
        _ownsConnection = ownsConnection;
        _lockDuration = lockDuration;
        _workerName = workerName;
    }

    /// <summary>Creates a PostgreSQL backend from the given options.</summary>
    public static PostgresBackend Create(
        string name, PostgresOptions options, int lockDuration = 0, string? workerName = null)
    {
        var connection = new PostgresConnection(options);
        return new PostgresBackend(name, connection, ownsConnection: true, lockDuration, workerName);
    }

    // ============================================================
    // Connection lifecycle
    // ============================================================

    public Task WaitUntilReadyAsync() => _connection.WaitUntilReadyAsync();

    public bool Closing => _closing is not null;

    public Task CloseAsync(bool force = false)
    {
        _closing ??= _ownsConnection ? _connection.CloseAsync() : Task.CompletedTask;
        return _closing;
    }

    public Task DisconnectAsync() => CloseAsync(force: true);

    public Task SetNameAsync(string name) => _connection.SetApplicationNameAsync(name);

    public async ValueTask DisposeAsync() => await CloseAsync(force: true).ConfigureAwait(false);

    public double MinimumBlockTimeout => 0.001;

    public BackendCapabilities Capabilities => new(CanBlockFor1Ms: true, CanDoubleTimeout: true);

    // ============================================================
    // Identity & keys (schema-based namespace: no prefix)
    // ============================================================

    public string QualifiedName => Name;

    public IReadOnlyDictionary<string, string> Keys { get; } = new Dictionary<string, string>();

    public string ToKey(string type) => $"{Name}:{type}";

    public string ClientName(string? suffix = null) => $"{Schema}:{Name}{suffix ?? string.Empty}";

    public IQueueBackend ForQueue(string queueName, string? prefix = null)
    {
        if (prefix is not null && prefix != "bull")
        {
            throw new ArgumentException(
                "BullMQ: the PostgreSQL backend does not support a prefix; use the schema to namespace queues.");
        }

        return new PostgresBackend(queueName, _connection, ownsConnection: false);
    }

    // ============================================================
    // Adding jobs
    // ============================================================

    public async Task<string> AddJobAsync(Job job)
    {
        var (parentQueue, parentId) = ParentParts(job.Parent);
        var result = await RunAsync(
            "add_job",
            new object?[]
            {
                Name,
                job.Id ?? string.Empty,
                job.Name,
                job.DataJson(),
                OptsJson(job.Opts),
                job.Priority,
                job.Delay,
                job.Timestamp,
                job.Attempts > 0 ? job.Attempts : 1,
                parentQueue,
                parentId,
                job.ParentKey,
                job.DeduplicationId,
                job.RepeatJobKey,
                job.Opts.Lifo ?? false,
            },
            op: "addJob", jobId: job.Id, parentKey: job.ParentKey).ConfigureAwait(false);

        return Str(result.FirstMap()!["id"])!;
    }

    public async Task<IReadOnlyList<string>> AddJobsAsync(IReadOnlyList<Job> jobs)
    {
        if (jobs.Count == 0)
        {
            return Array.Empty<string>();
        }

        var entries = jobs.Select(j => BatchEntry(j, Name, addToWaitingChildren: false)).ToList();
        var result = await RunAsync("add_jobs_bulk", new object?[] { Name, JsonUtil.Serialize(entries) })
            .ConfigureAwait(false);

        var ids = result.Rows.Select(r => Str(r[0])!).ToArray();
        for (var i = 0; i < ids.Length && i < jobs.Count; i++)
        {
            jobs[i].Id = ids[i];
        }

        return ids;
    }

    public async Task<IReadOnlyList<string>> AddFlowAsync(IReadOnlyList<FlowJobEntry> entries)
    {
        if (entries.Count == 0)
        {
            return Array.Empty<string>();
        }

        var batch = entries.Select(e => BatchEntry(e.Job, e.QueueName, e.IsParent)).ToList();
        var result = await RunAsync("add_flow", new object?[] { JsonUtil.Serialize(batch) }, op: "addJob")
            .ConfigureAwait(false);

        var ids = result.Rows.Select(r => Str(r[0])!).ToArray();
        for (var i = 0; i < ids.Length && i < entries.Count; i++)
        {
            entries[i].Job.Id = ids[i];
        }

        return ids;
    }

    private Dictionary<string, object?> BatchEntry(Job job, string queueName, bool addToWaitingChildren)
    {
        var (parentQueue, parentId) = ParentParts(job.Parent);
        return new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["queue"] = queueName,
            ["id"] = job.Id ?? string.Empty,
            ["name"] = job.Name,
            ["data"] = job.Data ?? new Dictionary<string, object?>(),
            ["opts"] = OptsCodec.ToStorageMap(job.Opts),
            ["priority"] = job.Priority,
            ["delay"] = job.Delay,
            ["timestamp"] = job.Timestamp,
            ["attempts"] = job.Attempts > 0 ? job.Attempts : 1,
            ["parentQueue"] = parentQueue,
            ["parentId"] = parentId,
            ["parentKey"] = job.ParentKey,
            ["dedupId"] = job.DeduplicationId,
            ["schedulerId"] = job.RepeatJobKey,
            ["lifo"] = job.Opts.Lifo ?? false,
            ["addToWaitingChildren"] = addToWaitingChildren,
        };
    }

    // ============================================================
    // State transitions
    // ============================================================

    public async Task<NextJobData> MoveToActiveAsync(string token, string? name = null)
    {
        var now = NowMs();
        var result = await RunAsync(
            "move_to_active",
            new object?[] { Name, token, _lockDuration > 0 ? _lockDuration : 30000, now, name ?? _workerName, null, null })
            .ConfigureAwait(false);

        return await NextJobResultAsync(result, null, now).ConfigureAwait(false);
    }

    public Task<MoveToFinishedResult> MoveToCompletedAsync(
        Job job, string returnValueJson, object? removeOnComplete, string token, bool fetchNext) =>
        MoveToFinishedAsync(job, "completed", returnValueJson, null, removeOnComplete, token, fetchNext);

    public Task<MoveToFinishedResult> MoveToFailedAsync(
        Job job, string failedReason, object? removeOnFail, string token, bool fetchNext,
        string? stackTraceJson = null) =>
        MoveToFinishedAsync(job, "failed", failedReason, stackTraceJson, removeOnFail, token, fetchNext);

    private async Task<MoveToFinishedResult> MoveToFinishedAsync(
        Job job, string target, string value, string? stackTraceJson, object? shouldRemove, string token, bool fetchNext)
    {
        var (removeAll, keepAge, keepCount) = NormalizeKeep(shouldRemove);
        var finishedOn = NowMs();
        var completed = target == "completed";

        if (fetchNext)
        {
            var now = NowMs();
            var command = completed ? "move_to_completed_fetch" : "move_to_failed_fetch";
            var parameters = completed
                ? new object?[] { Name, job.Id, token, value, finishedOn, removeAll, keepAge, keepCount, _lockDuration > 0 ? _lockDuration : 30000, now, _workerName, null, null }
                : new object?[] { Name, job.Id, token, value, stackTraceJson, finishedOn, removeAll, keepAge, keepCount, _lockDuration > 0 ? _lockDuration : 30000, now, _workerName, null, null };

            var result = await RunAsync(command, parameters, op: "moveToFinished", jobId: job.Id, state: "active")
                .ConfigureAwait(false);
            var next = await NextJobResultAsync(result, null, now).ConfigureAwait(false);
            return new MoveToFinishedResult { Next = next, FinishedOn = finishedOn };
        }

        var noFetchCommand = completed ? "move_to_completed" : "move_to_failed";
        var noFetchParams = completed
            ? new object?[] { Name, job.Id, token, value, finishedOn, removeAll, keepAge, keepCount }
            : new object?[] { Name, job.Id, token, value, stackTraceJson, finishedOn, removeAll, keepAge, keepCount };

        await RunAsync(noFetchCommand, noFetchParams, op: "moveToFinished", jobId: job.Id, state: "active")
            .ConfigureAwait(false);
        return new MoveToFinishedResult { Next = NextJobData.Empty, FinishedOn = finishedOn };
    }

    public async Task<NextJobData?> MoveToDelayedAsync(
        string jobId, long timestamp, long delay, string token = "0", bool fetchNext = false)
    {
        var processAt = timestamp + delay;
        await RunAsync(
            "move_to_delayed",
            new object?[] { Name, jobId, string.IsNullOrEmpty(token) ? "0" : token, processAt, delay, false, null, null },
            op: "moveToFinished", jobId: jobId, state: "active").ConfigureAwait(false);

        if (fetchNext && token != "0" && !string.IsNullOrEmpty(token))
        {
            var next = await MoveToActiveAsync(token).ConfigureAwait(false);
            return next.Job is not null ? next : null;
        }

        return null;
    }

    public async Task<bool> MoveToWaitingChildrenAsync(string jobId, string token, string? childKey = null)
    {
        var result = await RunAsync("move_to_waiting_children", new object?[] { Name, jobId, token }).ConfigureAwait(false);
        var row = result.FirstMap();
        return row is not null && ToInt(row.GetValueOrDefault("code")) == 1;
    }

    public async Task RetryJobAsync(string jobId, bool lifo, string token = "0")
    {
        await RunAsync(
            "retry_job",
            new object?[] { Name, jobId, token ?? string.Empty, lifo, null, null },
            op: "retryJob", jobId: jobId, state: "active").ConfigureAwait(false);
    }

    public async Task ReprocessJobAsync(
        Job job, string state, bool resetAttemptsMade = false, bool resetAttemptsStarted = false)
    {
        await RunAsync(
            "reprocess_job",
            new object?[] { Name, job.Id, state, job.Opts.Lifo ?? false, resetAttemptsMade, resetAttemptsStarted })
            .ConfigureAwait(false);
    }

    public async Task PromoteAsync(string jobId)
    {
        await RunAsync("promote", new object?[] { Name, jobId }, op: "promote", jobId: jobId, state: "delayed")
            .ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<string>> MoveStalledJobsToWaitAsync(int maxStalledCount, int stalledInterval)
    {
        var result = await RunAsync(
            "move_stalled_jobs_to_wait",
            new object?[] { Name, maxStalledCount, NowMs(), stalledInterval }).ConfigureAwait(false);
        return result.Maps().Select(m => Str(m.GetValueOrDefault("id"))!).ToList();
    }

    // ============================================================
    // Bulk admin transitions
    // ============================================================

    public async Task<long> RetryJobsAsync(string state, int count, long timestamp)
    {
        var result = await RunAsync(
            "retry_jobs",
            new object?[] { Name, string.IsNullOrEmpty(state) ? "failed" : state, count > 0 ? count : 1000, timestamp > 0 ? timestamp : NowMs() })
            .ConfigureAwait(false);
        return ToInt(result.FirstMap()?.GetValueOrDefault("n"));
    }

    public async Task<long> PromoteJobsAsync(int count)
    {
        var result = await RunAsync("promote_jobs", new object?[] { Name, count > 0 ? count : 1000 }).ConfigureAwait(false);
        return ToInt(result.FirstMap()?.GetValueOrDefault("n"));
    }

    public async Task PauseAsync(bool pause) =>
        await RunAsync("pause", new object?[] { Name, pause }).ConfigureAwait(false);

    public async Task DrainAsync(bool delayed) =>
        await RunAsync("drain", new object?[] { Name, delayed }).ConfigureAwait(false);

    public async Task<IReadOnlyList<string>> CleanJobsInSetAsync(string set, long grace, int limit)
    {
        var timestamp = NowMs() - grace;
        var result = await RunAsync("clean", new object?[] { Name, set, timestamp, limit }).ConfigureAwait(false);
        return result.Maps().Select(m => Str(m.GetValueOrDefault("id"))!).ToList();
    }

    public async Task<long> ObliterateAsync(bool force, int count)
    {
        var result = await RunAsync("obliterate", new object?[] { Name, count, force }).ConfigureAwait(false);
        var cursor = ToInt(result.FirstMap()?.GetValueOrDefault("cursor"));
        if (cursor == -1)
        {
            throw new BullMQException("Cannot obliterate non-paused queue");
        }

        if (cursor == -2)
        {
            throw new BullMQException("Cannot obliterate queue with active jobs");
        }

        return cursor;
    }

    public async Task<long> RemoveAsync(string jobId, bool removeChildren)
    {
        var result = await RunAsync("remove", new object?[] { Name, jobId, removeChildren }).ConfigureAwait(false);
        return ToInt(result.FirstMap()?.GetValueOrDefault("n"));
    }

    // ============================================================
    // Locks
    // ============================================================

    public async Task<long> ExtendLockAsync(string jobId, string token, int duration)
    {
        var result = await RunAsync("extend_lock", new object?[] { Name, jobId, token, duration, NowMs() }).ConfigureAwait(false);
        return ToInt(result.FirstMap()?.GetValueOrDefault("n"));
    }

    public async Task<IReadOnlyList<string>> ExtendLocksAsync(
        IReadOnlyList<string> jobIds, IReadOnlyList<string> tokens, int duration)
    {
        var result = await RunAsync(
            "extend_locks",
            new object?[] { Name, jobIds.ToArray(), tokens.ToArray(), duration, NowMs() }).ConfigureAwait(false);
        return result.Maps().Select(m => Str(m.GetValueOrDefault("id"))!).ToList();
    }

    // ============================================================
    // Job mutations
    // ============================================================

    public async Task UpdateDataAsync(string jobId, object? data)
    {
        var result = await RunAsync("update_data", new object?[] { Name, jobId, JsonUtil.Serialize(data) }).ConfigureAwait(false);
        if (result.Rows.Count == 0)
        {
            throw FinishedErrors.Create(-1, jobId: jobId, command: "updateData");
        }
    }

    public async Task UpdateProgressAsync(string jobId, object? progress) =>
        await RunAsync("update_progress", new object?[] { Name, jobId, JsonUtil.Serialize(progress) },
            op: "updateProgress", jobId: jobId).ConfigureAwait(false);

    public async Task ChangePriorityAsync(string jobId, int priority = 0, bool lifo = false) =>
        await RunAsync("change_priority", new object?[] { Name, jobId, priority, lifo },
            op: "changePriority", jobId: jobId).ConfigureAwait(false);

    public async Task<long> AddLogAsync(string jobId, string logRow, int keepLogs = 0)
    {
        var result = await RunAsync("add_log", new object?[] { Name, jobId, logRow }).ConfigureAwait(false);
        var count = ToInt(result.FirstMap()?.GetValueOrDefault("idx")) + 1;
        if (keepLogs > 0 && count > keepLogs)
        {
            await RunAsync("trim_logs", new object?[] { Name, jobId, count - keepLogs }).ConfigureAwait(false);
            return keepLogs;
        }

        return count;
    }

    // ============================================================
    // Queries
    // ============================================================

    public async Task<JobState> GetStateAsync(string jobId)
    {
        var result = await RunAsync("get_state", new object?[] { Name, jobId }).ConfigureAwait(false);
        var row = result.FirstMap();
        if (row is null)
        {
            return JobState.Unknown;
        }

        var state = Str(row.GetValueOrDefault("state"));
        if (state == "waiting" && ToInt(row.GetValueOrDefault("priority")) > 0)
        {
            return JobState.Prioritized;
        }

        return JobStateExtensions.FromWireString(state);
    }

    public async Task<bool> IsJobInStateAsync(string state, string jobId)
    {
        var target = state is "wait" or "paused" ? "waiting" : state;
        var result = await RunAsync("is_job_in_state", new object?[] { Name, jobId, target }).ConfigureAwait(false);
        return ToBool(result.FirstMap()?.GetValueOrDefault("present"));
    }

    public async Task<JobJson?> GetJobDataAsync(string jobId)
    {
        var result = await RunAsync("get_job_data", new object?[] { Name, jobId }).ConfigureAwait(false);
        var row = result.FirstMap();
        return row is null ? null : JobJson.FromMap(RowToJobMap(row), jobId);
    }

    public async Task<JobLogs> GetJobLogsAsync(string jobId, int start = 0, int end = -1, bool asc = true)
    {
        var countResult = await RunAsync("get_job_logs_count", new object?[] { Name, jobId }).ConfigureAwait(false);
        var count = ToInt(countResult.FirstMap()?.GetValueOrDefault("count"));

        var from = start < 0 ? Math.Max(count + start, 0) : start;
        var to = end < 0 ? count + end : end;
        var limit = to - from + 1;
        if (limit <= 0)
        {
            return new JobLogs(Array.Empty<string>(), count);
        }

        var command = asc ? "get_job_logs_asc" : "get_job_logs_desc";
        var result = await RunAsync(command, new object?[] { Name, jobId, from, limit }).ConfigureAwait(false);
        var logs = result.Maps().Select(m => Str(m.GetValueOrDefault("row")) ?? string.Empty).ToArray();
        return new JobLogs(logs, count);
    }

    public async Task<long> GetRateLimitTtlAsync()
    {
        var result = await RunAsync("get_rate_limit_ttl", new object?[] { Name, 0, NowMs() }).ConfigureAwait(false);
        return ToInt(result.FirstMap()?.GetValueOrDefault("ttl"));
    }

    public async Task<long[]> GetCountsAsync(params string[] types)
    {
        var lookup = await CountLookupAsync().ConfigureAwait(false);
        return types.Select(t => lookup.GetValueOrDefault(t == "waiting" ? "wait" : t, 0)).ToArray();
    }

    private async Task<IReadOnlyDictionary<string, long>> CountLookupAsync()
    {
        var result = await RunAsync("get_counts", new object?[] { Name }).ConfigureAwait(false);
        var row = result.FirstMap() ?? new Dictionary<string, object?>();
        var waiting = ToInt(row.GetValueOrDefault("waiting"));
        var isPaused = Str(row.GetValueOrDefault("paused")) == "1";

        return new Dictionary<string, long>(StringComparer.Ordinal)
        {
            ["active"] = ToInt(row.GetValueOrDefault("active")),
            ["completed"] = ToInt(row.GetValueOrDefault("completed")),
            ["failed"] = ToInt(row.GetValueOrDefault("failed")),
            ["delayed"] = ToInt(row.GetValueOrDefault("delayed")),
            ["wait"] = isPaused ? 0 : waiting,
            ["waiting"] = isPaused ? 0 : waiting,
            ["prioritized"] = ToInt(row.GetValueOrDefault("prioritized")),
            ["waiting-children"] = ToInt(row.GetValueOrDefault("waiting-children")),
            ["paused"] = isPaused ? waiting : 0,
        };
    }

    public async Task<long[]> GetCountsPerPriorityAsync(IReadOnlyList<long> priorities)
    {
        var result = await RunAsync(
            "get_counts_per_priority",
            new object?[] { Name, priorities.Select(p => (int)p).ToArray() }).ConfigureAwait(false);
        return result.Maps().Select(m => ToInt(m.GetValueOrDefault("cnt"))).ToArray();
    }

    public async Task<IReadOnlyList<string>> GetRangesAsync(
        IReadOnlyList<string> types, int start = 0, int end = 1, bool asc = false)
    {
        var ids = new List<string>();
        foreach (var type in types)
        {
            var result = await RunAsync("get_range", new object?[] { Name, type, start, end, asc }).ConfigureAwait(false);
            var page = result.Maps().Select(m => Str(m.GetValueOrDefault("id"))!).ToList();
            if (asc && ListStates.Contains(type))
            {
                page.Reverse();
            }

            ids.AddRange(page);
        }

        return ids;
    }

    public async Task<IReadOnlyDictionary<string, string>> GetProcessedChildrenValuesAsync(string jobId)
    {
        var result = await RunAsync("get_processed_children_values", new object?[] { Name, jobId }).ConfigureAwait(false);
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var m in result.Maps())
        {
            var key = Str(m.GetValueOrDefault("child_key") ?? m.GetValueOrDefault("k"));
            var value = Str(m.GetValueOrDefault("value") ?? m.GetValueOrDefault("v"));
            if (key is not null)
            {
                map[key] = value ?? "null";
            }
        }

        return map;
    }

    public async Task<bool> IsPausedAsync()
    {
        var result = await RunAsync("get_queue_meta_field", new object?[] { Name, "paused" }).ConfigureAwait(false);
        return Str(result.FirstMap()?.GetValueOrDefault("value")) == "1";
    }

    public async Task<IReadOnlyList<string>> GetClientListAsync()
    {
        var result = await RunAsync("get_client_list", Array.Empty<object?>()).ConfigureAwait(false);
        var lines = string.Join("\n", result.Maps().Select(m => $"name={Str(m.GetValueOrDefault("application_name"))}"));
        return new[] { lines };
    }

    // ============================================================
    // Metadata & maintenance
    // ============================================================

    public async Task SetQueueMetaAsync(IReadOnlyDictionary<string, object> values)
    {
        var fields = values.Keys.ToArray();
        var vals = values.Values.Select(v => v.ToString()).ToArray();
        await RunAsync("set_queue_meta", new object?[] { Name, fields, vals }).ConfigureAwait(false);
    }

    public async Task<string?> GetQueueMetaFieldAsync(string field)
    {
        var result = await RunAsync("get_queue_meta_field", new object?[] { Name, field }).ConfigureAwait(false);
        return Str(result.FirstMap()?.GetValueOrDefault("value"));
    }

    public async Task<bool> HasQueueMetaFieldAsync(string field)
    {
        var result = await RunAsync("has_queue_meta_field", new object?[] { Name, field }).ConfigureAwait(false);
        return ToBool(result.FirstMap()?.GetValueOrDefault("exists"));
    }

    public Task<long> TrimEventsAsync(long maxLength) => Task.FromResult(0L);

    public Task<long> RemoveDeprecatedPriorityKeyAsync() => Task.FromResult(0L);

    // ============================================================
    // Job schedulers
    // ============================================================

    public async Task<(string JobId, long Delay)> AddJobSchedulerAsync(
        string schedulerId,
        long? nextMillis,
        string templateData,
        IReadOnlyDictionary<string, object?> templateOpts,
        IReadOnlyDictionary<string, object?> schedulerOpts,
        IReadOnlyDictionary<string, object?> delayedJobOpts,
        string? producerId = null)
    {
        var result = await RunAsync(
            "add_job_scheduler",
            new object?[]
            {
                Name,
                schedulerId,
                nextMillis,
                string.IsNullOrEmpty(templateData) ? "{}" : templateData,
                Json(templateOpts),
                Json(schedulerOpts),
                Json(delayedJobOpts),
                NowMs(),
                producerId,
            },
            op: "addJobScheduler").ConfigureAwait(false);

        var row = result.FirstMap();
        var jobId = Str(row?.GetValueOrDefault("job_id")) ?? string.Empty;
        var delay = ToInt(row?.GetValueOrDefault("delay"));
        return (jobId, delay);
    }

    public async Task<string?> UpdateJobSchedulerNextMillisAsync(
        string schedulerId,
        long nextMillis,
        string templateData,
        IReadOnlyDictionary<string, object?> delayedJobOpts,
        string? producerId = null)
    {
        var result = await RunAsync(
            "update_job_scheduler",
            new object?[]
            {
                Name,
                schedulerId,
                nextMillis,
                string.IsNullOrEmpty(templateData) ? "{}" : templateData,
                Json(delayedJobOpts),
                NowMs(),
                producerId,
            }).ConfigureAwait(false);

        return Str(result.FirstMap()?.GetValueOrDefault("job_id"));
    }

    public async Task<long> RemoveJobSchedulerAsync(string schedulerId)
    {
        var result = await RunAsync("remove_job_scheduler", new object?[] { Name, schedulerId }).ConfigureAwait(false);
        return ToInt(result.FirstMap()?.GetValueOrDefault("removed"));
    }

    public async Task<(IReadOnlyList<string> Raw, long? Next)> GetJobSchedulerAsync(string id)
    {
        var result = await RunAsync("get_job_scheduler", new object?[] { Name, id }).ConfigureAwait(false);
        var row = result.FirstMap();
        if (row is null)
        {
            return (Array.Empty<string>(), null);
        }

        var (hash, next) = MapSchedulerRow(row);
        var flat = new List<string>(hash.Count * 2);
        foreach (var (key, value) in hash)
        {
            flat.Add(key);
            flat.Add(value);
        }

        return (flat, next);
    }

    public async Task<bool> IsJobSchedulerAsync(string id)
    {
        var result = await RunAsync("is_job_scheduler", new object?[] { Name, id }).ConfigureAwait(false);
        return ToBool(result.FirstMap()?.GetValueOrDefault("exists"));
    }

    public async Task<IReadOnlyDictionary<string, string>> GetJobSchedulerDataAsync(string key)
    {
        var result = await RunAsync("get_job_scheduler", new object?[] { Name, key }).ConfigureAwait(false);
        var row = result.FirstMap();
        return row is null ? new Dictionary<string, string>() : MapSchedulerRow(row).Hash;
    }

    public async Task<IReadOnlyList<string>> GetJobSchedulersRangeAsync(int start, int end, bool asc)
    {
        int? count = end < 0 ? null : end - start + 1;
        var result = await RunAsync(
            "get_job_schedulers_range", new object?[] { Name, asc, start, count }).ConfigureAwait(false);

        var flat = new List<string>();
        foreach (var m in result.Maps())
        {
            flat.Add(Str(m.GetValueOrDefault("scheduler_id")) ?? string.Empty);
            flat.Add(ToInt(m.GetValueOrDefault("next_run_ms")).ToString());
        }

        return flat;
    }

    public async Task<long> GetJobSchedulersCountAsync()
    {
        var result = await RunAsync("get_job_schedulers_count", new object?[] { Name }).ConfigureAwait(false);
        return ToInt(result.FirstMap()?.GetValueOrDefault("count"));
    }

    private static (Dictionary<string, string> Hash, long? Next) MapSchedulerRow(
        IReadOnlyDictionary<string, object?> row)
    {
        var hash = new Dictionary<string, string>(StringComparer.Ordinal);

        void Put(string key, string column)
        {
            var value = Str(row.GetValueOrDefault(column));
            if (value is not null)
            {
                hash[key] = value;
            }
        }

        Put("name", "name");
        Put("ic", "iteration_count");
        Put("limit", "limit_count");
        Put("startDate", "start_date_ms");
        Put("endDate", "end_date_ms");
        Put("tz", "tz");
        Put("pattern", "pattern");
        Put("every", "every_ms");
        Put("offset", "offset_ms");
        Put("data", "template_data");
        Put("opts", "template_opts");

        var next = row.GetValueOrDefault("next_run_ms") is { } n ? ToInt(n) : (long?)null;
        return (hash, next);
    }

    // ============================================================
    // Worker blocking primitive
    // ============================================================

    public async Task<MarkerResult?> WaitForJobAsync(double blockTimeoutSeconds, CancellationToken cancellationToken = default)
    {
        var listen = await _connection.EnsureJobChannelAsync().ConfigureAwait(false);

        if (await HasWaitingJobAsync().ConfigureAwait(false))
        {
            return new MarkerResult(Name, 0);
        }

        var baseMs = Math.Max((long)Math.Round(blockTimeoutSeconds * 1000), 1);
        var dueIn = await NextDelayMsAsync().ConfigureAwait(false);
        if (dueIn is { } d)
        {
            if (d <= 0)
            {
                return new MarkerResult(Name, 0);
            }

            baseMs = Math.Min(d, baseMs);
        }

        var deadline = DateTime.UtcNow.AddMilliseconds(baseMs);
        while (true)
        {
            if (cancellationToken.IsCancellationRequested)
            {
                return null;
            }

            var remaining = deadline - DateTime.UtcNow;
            if (remaining <= TimeSpan.Zero)
            {
                var due = await NextDelayMsAsync().ConfigureAwait(false);
                if (due is { } dd)
                {
                    return dd <= 0 ? new MarkerResult(Name, 0) : new MarkerResult(Name, NowMs() + dd);
                }

                return null;
            }

            // Block until a NOTIFY on the jobs channel wakes us or the deadline
            // elapses — no fixed-interval polling. `remaining` already accounts
            // for the next delayed job's due time (a delayed job's promotion is
            // not announced by a NOTIFY), so an idle worker issues no queries
            // until something actually changes. A NOTIFY for another queue on
            // the shared channel wakes us too; the has_waiting_job probe then
            // simply finds nothing and we wait out the rest of the deadline.
            //
            // Re-acquire the LISTEN connection every iteration: a failed wait
            // tears it down (ResetJobChannelAsync), and EnsureJobChannelAsync
            // transparently reconnects and re-subscribes rather than leaving us
            // spinning on a disposed handle. Any NOTIFY missed during a reconnect
            // is still caught by the has_waiting_job probe below (or on timeout).
            listen = await _connection.EnsureJobChannelAsync().ConfigureAwait(false);
            await _connection.WaitForNotificationAsync(listen, remaining, cancellationToken).ConfigureAwait(false);
            if (cancellationToken.IsCancellationRequested)
            {
                return null;
            }

            if (await HasWaitingJobAsync().ConfigureAwait(false))
            {
                return new MarkerResult(Name, 0);
            }
        }
    }

    private async Task<bool> HasWaitingJobAsync()
    {
        var result = await RunAsync("has_waiting_job", new object?[] { Name }).ConfigureAwait(false);
        return ToBool(result.FirstMap()?.GetValueOrDefault("present"));
    }

    private async Task<long?> NextDelayMsAsync()
    {
        var result = await RunAsync("next_delay", new object?[] { Name }).ConfigureAwait(false);
        var next = result.FirstMap()?.GetValueOrDefault("next_delay");
        return next is null ? null : ToInt(next) - NowMs();
    }

    // ============================================================
    // Event stream
    // ============================================================

    public async Task<string> PublishEventAsync(IReadOnlyList<string> fields, int maxEvents)
    {
        // fields is a flattened [field, value, ...] list whose first pair is
        // ("event", <name>); everything else becomes the event's JSON payload.
        string eventName = string.Empty;
        var data = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var i = 0; i + 1 < fields.Count; i += 2)
        {
            var key = fields[i];
            var value = fields[i + 1];
            if (string.Equals(key, "event", StringComparison.Ordinal) && eventName.Length == 0)
            {
                eventName = value;
            }
            else
            {
                data[key] = value;
            }
        }

        var result = await RunAsync(
            "publish_event",
            new object?[] { Name, eventName, JsonUtil.Serialize(data) }).ConfigureAwait(false);

        return Str(result.FirstMap()?.GetValueOrDefault("id")) ?? string.Empty;
    }

    public async Task<IReadOnlyList<EventEntry>> ReadEventsAsync(string id, double blockTimeoutSeconds)
    {
        // Stop cleanly once the backend/connection is closing rather than
        // reconnecting and blocking again (which would hang shutdown).
        if (Closing || _connection.IsClosing)
        {
            return Array.Empty<EventEntry>();
        }

        var listen = await _connection.EnsureEventsChannelAsync().ConfigureAwait(false);

        // Resolve the cursor: "$" means "only events from now on".
        var cursor = id;
        if (id == "$")
        {
            var maxResult = await RunAsync("read_events_max", new object?[] { Name }).ConfigureAwait(false);
            cursor = Str(maxResult.FirstMap()?.GetValueOrDefault("max")) ?? "0";
        }

        var events = await FetchEventsAsync(cursor).ConfigureAwait(false);
        if (events.Count == 0)
        {
            var wait = TimeSpan.FromMilliseconds(Math.Max((long)Math.Round(blockTimeoutSeconds * 1000), 1));
            await _connection.WaitForEventsNotificationAsync(listen, wait).ConfigureAwait(false);
            if (Closing || _connection.IsClosing)
            {
                return Array.Empty<EventEntry>();
            }

            events = await FetchEventsAsync(cursor).ConfigureAwait(false);
        }

        return events;
    }

    private async Task<IReadOnlyList<EventEntry>> FetchEventsAsync(string cursor)
    {
        const int batch = 100;
        var result = await RunAsync(
            "read_events",
            new object?[] { Name, cursor, batch }).ConfigureAwait(false);

        var list = new List<EventEntry>();
        foreach (var row in result.Maps())
        {
            var entryId = Str(row.GetValueOrDefault("id")) ?? string.Empty;
            var eventName = Str(row.GetValueOrDefault("event")) ?? string.Empty;

            var fields = new List<string> { "event", eventName };
            var dataRaw = Str(row.GetValueOrDefault("data"));
            if (!string.IsNullOrEmpty(dataRaw))
            {
                var data = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(dataRaw);
                if (data is not null)
                {
                    foreach (var kv in data)
                    {
                        fields.Add(kv.Key);
                        fields.Add(kv.Value.ValueKind == JsonValueKind.String
                            ? kv.Value.GetString() ?? string.Empty
                            : kv.Value.GetRawText());
                    }
                }
            }

            list.Add(new EventEntry(entryId, fields));
        }

        return list;
    }

    // ============================================================
    // Helpers
    // ============================================================

    private async Task<PgResult> RunAsync(
        string command,
        IReadOnlyList<object?> parameters,
        string? op = null,
        string? jobId = null,
        string? parentKey = null,
        string? state = null)
    {
        try
        {
            return await _connection.RunAsync(SqlLoader.LoadCommand(command), parameters).ConfigureAwait(false);
        }
        catch (PostgresException err) when (op is not null && err.SqlState == BullmqSqlState)
        {
            var code = int.TryParse(err.Detail, out var c) ? c : 0;
            throw FinishedErrors.Create(code, jobId: jobId, parentKey: parentKey, command: op, state: state);
        }
    }

    private async Task<NextJobData> NextJobResultAsync(PgResult result, int? limiterMax, long now)
    {
        var maps = result.Maps();
        if (maps.Count > 0)
        {
            var row = maps[0];
            return new NextJobData
            {
                Job = JobJson.FromMap(RowToJobMap(row)),
                JobId = Str(row.GetValueOrDefault("id")),
                RateLimitDelay = 0,
                DelayUntil = 0,
            };
        }

        var sig = await RunAsync("next_signal", new object?[] { Name, limiterMax, now }).ConfigureAwait(false);
        var sigRow = sig.FirstMap();
        var ttl = ToInt(sigRow?.GetValueOrDefault("rate_limit_ttl"));
        if (ttl > 0)
        {
            return new NextJobData { RateLimitDelay = ttl };
        }

        return new NextJobData { DelayUntil = ToInt(sigRow?.GetValueOrDefault("next_delay")) };
    }

    private static (string? parentQueue, string? parentId) ParentParts(object? parent)
    {
        if (parent is IReadOnlyDictionary<string, object?> dict)
        {
            var queue = dict.GetValueOrDefault("queue") ?? dict.GetValueOrDefault("queueKey");
            return (queue?.ToString(), dict.GetValueOrDefault("id")?.ToString());
        }

        return (null, null);
    }

    private static string OptsJson(JobsOptions opts) =>
        JsonSerializer.Serialize(OptsCodec.ToStorageMap(opts), JsonUtil.Compact);

    private static string Json(IReadOnlyDictionary<string, object?> map) =>
        JsonSerializer.Serialize(map, JsonUtil.Compact);

    private static (bool removeAll, int? keepAge, int? keepCount) NormalizeKeep(object? removeOn) => removeOn switch
    {
        true => (true, null, null),
        null or false => (false, null, null),
        int count => (false, null, count),
        long count => (false, null, (int)count),
        KeepJobs keep => (false, keep.Age, keep.Count),
        _ => (false, null, null),
    };

    private static Dictionary<string, string?> RowToJobMap(IReadOnlyDictionary<string, object?> row)
    {
        object? Get(string key) => row.GetValueOrDefault(key);

        var parentId = Get("parent_id");
        string? parent = parentId is null
            ? null
            : JsonUtil.Serialize(new Dictionary<string, object?>
            {
                ["id"] = parentId.ToString(),
                ["queueKey"] = Get("parent_queue")?.ToString() ?? string.Empty,
            });

        var mapped = new Dictionary<string, string?>(StringComparer.Ordinal)
        {
            ["name"] = Str(Get("name")),
            ["data"] = Str(Get("data")) ?? "{}",
            ["opts"] = Str(Get("opts")) ?? "{}",
            ["progress"] = Str(Get("progress")) ?? "0",
            ["attemptsMade"] = ToInt(Get("attempts_made")).ToString(),
            ["ats"] = ToInt(Get("attempts_started")).ToString(),
            ["stc"] = ToInt(Get("stalled_count")).ToString(),
            ["timestamp"] = Str(Get("added_at_ms")),
            ["delay"] = Str(Get("delay_ms")),
            ["priority"] = ToInt(Get("priority")).ToString(),
            ["processedOn"] = Str(Get("processed_at_ms")),
            ["finishedOn"] = Str(Get("finished_at_ms")),
            ["failedReason"] = Str(Get("failed_reason")),
            ["stacktrace"] = Str(Get("stacktrace")) ?? "[]",
            ["returnvalue"] = Str(Get("return_value")) ?? "null",
            ["parentKey"] = Str(Get("parent_key")),
            ["parent"] = parent,
            ["rjk"] = Str(Get("scheduler_id")),
            ["defa"] = Str(Get("deferred_failure")),
        };

        return mapped.Where(kv => kv.Value is not null).ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.Ordinal);
    }

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private static string? Str(object? value) => value switch
    {
        null => null,
        string s => s,
        JsonElement je => je.GetRawText(),
        JsonDocument jd => jd.RootElement.GetRawText(),
        bool b => b ? "true" : "false",
        _ => value.ToString(),
    };

    private static long ToInt(object? value) => value switch
    {
        null => 0,
        long l => l,
        int i => i,
        short s => s,
        decimal d => (long)d,
        double db => (long)db,
        bool b => b ? 1 : 0,
        string s => long.TryParse(s, out var v) ? v : 0,
        _ => long.TryParse(value.ToString(), out var v) ? v : 0,
    };

    private static bool ToBool(object? value) => value switch
    {
        null => false,
        bool b => b,
        string s => s is "1" or "t" or "true" or "True",
        _ => ToInt(value) != 0,
    };
}
