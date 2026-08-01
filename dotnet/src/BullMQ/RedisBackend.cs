using BullMQ.Redis;
using BullMQ.Serialization;
using StackExchange.Redis;

namespace BullMQ;

/// <summary>
/// Redis implementation of <see cref="IQueueBackend"/>.
///
/// This adapter carries the queue identity (name / prefix) and a reference to a
/// <see cref="RedisConnection"/> (plus an optional dedicated blocking connection
/// for the worker's marker wait), and delegates every high-level operation to
/// the shared Lua scripts (the single source of truth shared with all other
/// BullMQ runtimes) or a small number of direct Redis commands. Only argument
/// marshalling and result parsing live here.
/// </summary>
public sealed class RedisBackend : IQueueBackend
{
    private static readonly HashSet<string> ZsetStates = new(StringComparer.Ordinal)
    {
        "completed", "failed", "delayed", "waiting-children", "prioritized",
    };

    private readonly RedisConnection _connection;
    private readonly RedisConnection? _blocking;
    private readonly bool _ownsConnection;
    private readonly QueueKeys _queueKeys;
    private readonly IReadOnlyDictionary<string, string> _keys;

    private readonly int _lockDuration;
    private readonly string? _workerName;

    private Task? _closing;

    /// <summary>The queue name this backend operates on.</summary>
    public string Name { get; }

    /// <summary>The key prefix.</summary>
    public string Prefix { get; }

    internal RedisBackend(
        string name,
        RedisConnection connection,
        string prefix,
        bool ownsConnection,
        RedisConnection? blocking = null,
        int lockDuration = 0,
        string? workerName = null)
    {
        Name = name;
        Prefix = prefix;
        _connection = connection;
        _blocking = blocking;
        _ownsConnection = ownsConnection;
        _lockDuration = lockDuration;
        _workerName = workerName;
        _queueKeys = new QueueKeys(prefix);
        _keys = _queueKeys.GetKeys(name);
    }

    /// <summary>Creates a Redis backend, establishing a connection from the options.</summary>
    public static async Task<RedisBackend> CreateAsync(
        string name,
        QueueBaseOptions options,
        int lockDuration = 0,
        string? workerName = null,
        bool withBlockingConnection = false)
    {
        var connection = await RedisConnection.CreateAsync(options.Connection).ConfigureAwait(false);
        var ownsConnection = options.Connection.Multiplexer is null;
        var blocking = withBlockingConnection
            ? await RedisConnection.CreateAsync(options.Connection, blocking: true).ConfigureAwait(false)
            : null;
        return new RedisBackend(name, connection, options.Prefix, ownsConnection, blocking, lockDuration, workerName);
    }

    // ============================================================
    // Connection lifecycle
    // ============================================================

    public async Task WaitUntilReadyAsync()
    {
        await _connection.WaitUntilReadyAsync().ConfigureAwait(false);
        if (_blocking is not null)
        {
            await _blocking.WaitUntilReadyAsync().ConfigureAwait(false);
        }
    }

    public bool Closing => _closing is not null;

    public Task CloseAsync(bool force = false)
    {
        _closing ??= CloseInternalAsync();
        return _closing;
    }

    private async Task CloseInternalAsync()
    {
        if (_blocking is not null)
        {
            await _blocking.CloseAsync().ConfigureAwait(false);
        }

        if (_ownsConnection)
        {
            await _connection.CloseAsync().ConfigureAwait(false);
        }
    }

    public Task DisconnectAsync() => CloseAsync(force: true);

    public async Task SetNameAsync(string name)
    {
        await _connection.SetClientNameAsync(name).ConfigureAwait(false);
        if (_blocking is not null)
        {
            await _blocking.SetClientNameAsync(name).ConfigureAwait(false);
        }
    }

    public async ValueTask DisposeAsync() => await CloseAsync(force: true).ConfigureAwait(false);

    public double MinimumBlockTimeout => Capabilities.CanBlockFor1Ms ? 0.001 : 0.002;

    public BackendCapabilities Capabilities => new(CanBlockFor1Ms: true, CanDoubleTimeout: false);

    // ============================================================
    // Identity & keys
    // ============================================================

    public string QualifiedName => _queueKeys.GetQueueQualifiedName(Name);

    public IReadOnlyDictionary<string, string> Keys => _keys;

    public string ToKey(string type) => _queueKeys.ToKey(Name, type);

    public string ClientName(string? suffix = null) => $"{QualifiedName}{suffix ?? string.Empty}";

    public IQueueBackend ForQueue(string queueName, string? prefix = null) =>
        new RedisBackend(queueName, _connection, prefix ?? Prefix, ownsConnection: false);

    // ============================================================
    // Adding jobs
    // ============================================================

    public async Task<string> AddJobAsync(Job job)
    {
        var (cmd, keys, args) = BuildAddJob(job);
        var result = await _connection.EvalAsync(cmd, keys, args).ConfigureAwait(false);
        return ParseAddJobResult(result, job);
    }

    public async Task<IReadOnlyList<string>> AddJobsAsync(IReadOnlyList<Job> jobs)
    {
        if (jobs.Count == 0)
        {
            return Array.Empty<string>();
        }

        var batch = _connection.Db.CreateBatch();
        var tasks = new List<Task<RedisResult>>(jobs.Count);
        foreach (var job in jobs)
        {
            var (cmd, keys, args) = BuildAddJob(job);
            var scriptText = LuaScripts.Get(cmd).Content;
            tasks.Add(batch.ScriptEvaluateAsync(scriptText, keys, args));
        }

        batch.Execute();
        var results = await Task.WhenAll(tasks).ConfigureAwait(false);

        var ids = new string[jobs.Count];
        for (var i = 0; i < jobs.Count; i++)
        {
            ids[i] = ParseAddJobResult(results[i], jobs[i]);
            jobs[i].Id = ids[i];
        }

        return ids;
    }

    private (string cmd, RedisKey[] keys, RedisValue[] args) BuildAddJob(Job job)
    {
        if (job.Delay > 0)
        {
            var keys = MapKeys("marker", "meta", "id", "delayed", "completed", "events");
            return ("addDelayedJob", keys, AddJobArgs(job, job.Delay));
        }

        if (job.Priority > 0)
        {
            var keys = MapKeys("marker", "meta", "id", "prioritized", "delayed", "completed", "active", "events", "pc");
            return ("addPrioritizedJob", keys, AddJobArgs(job, job.Priority));
        }

        var standardKeys = MapKeys("wait", "paused", "meta", "id", "completed", "delayed", "active", "events", "marker");
        return ("addStandardJob", standardKeys, AddJobArgs(job, job.Timestamp));
    }

    private static string ParseAddJobResult(RedisResult result, Job job)
    {
        if (result.Resp2Type == ResultType.Integer)
        {
            var code = (long)result;
            if (code < 0)
            {
                throw FinishedErrors.Create((int)code, jobId: job.Id, parentKey: job.ParentKey, command: "addJob");
            }

            return code.ToString();
        }

        return (string?)result ?? throw new BullMQException("addJob returned no job id");
    }

    private RedisValue[] AddJobArgs(Job job, long trailingValue)
    {
        string? parentDepsKey = job.ParentKey is null ? null : $"{job.ParentKey}:dependencies";
        string? deduplicationKey = job.DeduplicationId is null
            ? null
            : $"{_keys[""]}de:{job.DeduplicationId}";

        var packedArgs = MsgPack.Encode(new object?[]
        {
            _keys[""],
            job.Id ?? string.Empty,
            job.Name,
            job.Timestamp,
            job.ParentKey,
            parentDepsKey,
            job.Parent,
            job.RepeatJobKey,
            deduplicationKey,
        });

        return new RedisValue[]
        {
            packedArgs,
            job.DataJson(),
            job.PackedOpts(),
            trailingValue,
        };
    }

    // ============================================================
    // State transitions
    // ============================================================

    public async Task<NextJobData> MoveToActiveAsync(string token, string? name = null)
    {
        var timestamp = NowMs();
        var keys = MapKeys(
            "wait", "active", "prioritized", "events", "stalled",
            "limiter", "delayed", "paused", "meta", "pc", "marker");

        var packedOpts = MsgPack.Encode(new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["token"] = token,
            ["lockDuration"] = _lockDuration,
            ["limiter"] = null,
            ["name"] = name ?? _workerName,
        });

        var args = new RedisValue[] { _keys[""], timestamp, packedOpts };
        var result = await _connection.EvalAsync("moveToActive", keys, args).ConfigureAwait(false);
        return ParseNextJobData(result);
    }

    public Task<MoveToFinishedResult> MoveToCompletedAsync(
        Job job, string returnValueJson, object? removeOnComplete, string token, bool fetchNext) =>
        MoveToFinishedAsync(job, returnValueJson, "returnvalue", removeOnComplete, "completed", token, fetchNext, null);

    public Task<MoveToFinishedResult> MoveToFailedAsync(
        Job job, string failedReason, object? removeOnFail, string token, bool fetchNext,
        string? stackTraceJson = null) =>
        MoveToFinishedAsync(job, failedReason, "failedReason", removeOnFail, "failed", token, fetchNext, stackTraceJson);

    private async Task<MoveToFinishedResult> MoveToFinishedAsync(
        Job job, string value, string propVal, object? shouldRemove, string target, string token,
        bool fetchNext, string? stackTraceJson)
    {
        var timestamp = NowMs();
        var metricsKey = ToKey($"metrics:{target}");

        var keys = MapKeys(
            "wait", "active", "prioritized", "events", "stalled",
            "limiter", "delayed", "paused", "meta", "pc", target);
        var keyList = new List<RedisKey>(keys)
        {
            ToKey(job.Id!),
            metricsKey,
            _keys["marker"],
        };

        var packedOpts = MsgPack.Encode(new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["token"] = token,
            ["name"] = _workerName,
            ["keepJobs"] = GetKeepJobs(shouldRemove),
            ["limiter"] = null,
            ["lockDuration"] = _lockDuration,
            ["attempts"] = job.Attempts,
            ["attemptsMade"] = job.AttemptsMade,
            ["maxMetricsSize"] = string.Empty,
            ["fpof"] = false,
            ["cpof"] = false,
            ["idof"] = false,
            ["rdof"] = false,
        });

        var args = new List<RedisValue>
        {
            job.Id!,
            timestamp,
            propVal,
            string.IsNullOrEmpty(value) ? string.Empty : value,
            target,
            fetchNext ? "1" : string.Empty,
            _keys[""],
            packedOpts,
        };

        var result = await _connection
            .EvalAsync("moveToFinished", keyList.ToArray(), args.ToArray())
            .ConfigureAwait(false);

        if (result.Resp2Type == ResultType.Integer)
        {
            var code = (long)result;
            if (code < 0)
            {
                throw FinishedErrors.Create((int)code, jobId: job.Id, command: "moveToFinished", state: "active");
            }
        }

        return new MoveToFinishedResult { Next = ParseNextJobData(result), FinishedOn = timestamp };
    }

    public async Task<NextJobData?> MoveToDelayedAsync(
        string jobId, long timestamp, long delay, string token = "0", bool fetchNext = false)
    {
        var keys = MapKeys("marker", "active", "prioritized", "delayed");
        var keyList = new List<RedisKey>(keys)
        {
            ToKey(jobId),
            _keys["events"],
            _keys["meta"],
            _keys["stalled"],
            _keys["wait"],
            _keys["limiter"],
            _keys["paused"],
            _keys["pc"],
        };

        var args = new List<RedisValue>
        {
            _keys[""],
            timestamp.ToString(),
            jobId,
            token,
            delay,
            "0", // skipAttempt
            string.Empty, // fieldsToUpdate placeholder
            fetchNext ? "1" : "0",
        };

        if (fetchNext)
        {
            args.Add(MsgPack.Encode(new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["token"] = token,
                ["lockDuration"] = _lockDuration,
                ["limiter"] = null,
            }));
        }

        var result = await _connection
            .EvalAsync("moveToDelayed", keyList.ToArray(), args.ToArray())
            .ConfigureAwait(false);

        if (result.Resp2Type == ResultType.Integer)
        {
            var code = (long)result;
            if (code < 0)
            {
                throw FinishedErrors.Create((int)code, jobId: jobId, command: "moveToDelayed", state: "active");
            }

            return null;
        }

        return ParseNextJobData(result);
    }

    public async Task<bool> MoveToWaitingChildrenAsync(string jobId, string token, string? childKey = null)
    {
        var keys = new RedisKey[]
        {
            _keys["active"],
            _keys["waiting-children"],
            ToKey(jobId),
            $"{ToKey(jobId)}:dependencies",
            $"{ToKey(jobId)}:unsuccessful",
            _keys["stalled"],
            _keys["events"],
        };

        var args = new RedisValue[] { token, childKey ?? string.Empty, NowMs(), jobId, _keys[""] };
        var result = await _connection.EvalAsync("moveToWaitingChildren", keys, args).ConfigureAwait(false);

        if (result.Resp2Type == ResultType.Integer)
        {
            var code = (long)result;
            if (code == 1)
            {
                return false;
            }

            if (code == 0)
            {
                return true;
            }

            if (code < 0)
            {
                throw FinishedErrors.Create((int)code, jobId: jobId, command: "moveToWaitingChildren", state: "active");
            }
        }

        return false;
    }

    public async Task RetryJobAsync(string jobId, bool lifo, string token = "0")
    {
        var keys = MapKeys("active", "wait", "paused");
        var keyList = new List<RedisKey>(keys)
        {
            ToKey(jobId),
            _keys["meta"],
            _keys["events"],
            _keys["delayed"],
            _keys["prioritized"],
            _keys["pc"],
            _keys["marker"],
            _keys["stalled"],
        };

        var pushCmd = lifo ? "RPUSH" : "LPUSH";
        var args = new RedisValue[] { _keys[""], NowMs(), pushCmd, jobId, token };

        var result = await _connection.EvalAsync("retryJob", keyList.ToArray(), args).ConfigureAwait(false);
        ThrowIfNegative(result, jobId, "retryJob", "active");
    }

    public async Task ReprocessJobAsync(
        Job job, string state, bool resetAttemptsMade = false, bool resetAttemptsStarted = false)
    {
        var keys = new RedisKey[]
        {
            ToKey(job.Id!),
            _keys["events"],
            _keys[state],
            _keys["wait"],
            _keys["meta"],
            _keys["paused"],
            _keys["active"],
            _keys["marker"],
        };

        var pushCmd = (job.Opts.Lifo ?? false) ? "RPUSH" : "LPUSH";
        var propVal = state == "failed" ? "failedReason" : "returnvalue";
        var args = new RedisValue[]
        {
            job.Id!,
            pushCmd,
            propVal,
            state,
            resetAttemptsMade ? "1" : "0",
            resetAttemptsStarted ? "1" : "0",
        };

        var result = await _connection.EvalAsync("reprocessJob", keys, args).ConfigureAwait(false);
        ThrowIfNegative(result, job.Id, "reprocessJob", state);
    }

    public async Task PromoteAsync(string jobId)
    {
        var keys = MapKeys("delayed", "wait", "paused", "meta", "prioritized", "active", "pc", "events", "marker");
        var keyList = new List<RedisKey>(keys)
        {
            ToKey(jobId),
            _keys["events"],
            _keys["paused"],
            _keys["meta"],
        };

        var args = new RedisValue[] { _keys[""], jobId };
        var result = await _connection.EvalAsync("promote", keyList.ToArray(), args).ConfigureAwait(false);
        ThrowIfNegative(result, jobId, "promote", "delayed");
    }

    public async Task<IReadOnlyList<string>> MoveStalledJobsToWaitAsync(int maxStalledCount, int stalledInterval)
    {
        var keys = MapKeys(
            "stalled", "wait", "active", "stalled-check", "meta", "paused", "marker", "events", "repeat");
        var args = new RedisValue[] { maxStalledCount, _keys[""], NowMs(), stalledInterval };
        var result = await _connection.EvalAsync("moveStalledJobsToWait", keys, args).ConfigureAwait(false);
        return ToStringList(result);
    }

    // ============================================================
    // Bulk admin transitions
    // ============================================================

    public Task<long> RetryJobsAsync(string state, int count, long timestamp) =>
        MoveJobsToWaitAsync(string.IsNullOrEmpty(state) ? "failed" : state, count, timestamp);

    public Task<long> PromoteJobsAsync(int count) =>
        MoveJobsToWaitAsync("delayed", count, long.MaxValue);

    private async Task<long> MoveJobsToWaitAsync(string state, int count, long timestamp)
    {
        var keys = MapKeys("", "events", state, "wait", "paused", "meta", "active", "marker");
        var args = new RedisValue[] { count > 0 ? count : 1000, timestamp, state };
        var result = await _connection.EvalAsync("moveJobsToWait", keys, args).ConfigureAwait(false);
        return result.Resp2Type == ResultType.Integer ? (long)result : 0;
    }

    public async Task PauseAsync(bool pause)
    {
        var src = pause ? "wait" : "paused";
        var dst = pause ? "paused" : "wait";
        var keys = MapKeys(src, dst, "meta", "prioritized", "events", "delayed", "marker");
        var args = new RedisValue[] { pause ? "paused" : "resumed" };
        await _connection.EvalAsync("pause", keys, args).ConfigureAwait(false);
    }

    public async Task DrainAsync(bool delayed)
    {
        var keys = MapKeys("wait", "paused", "delayed", "prioritized", "repeat");
        var args = new RedisValue[] { _keys[""], delayed ? "1" : "0" };
        await _connection.EvalAsync("drain", keys, args).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<string>> CleanJobsInSetAsync(string set, long grace, int limit)
    {
        var keys = new RedisKey[] { ToKey(set), _keys["events"], _keys["repeat"] };
        var args = new RedisValue[] { _keys[""], NowMs() - grace, limit, set };
        var result = await _connection.EvalAsync("cleanJobsInSet", keys, args).ConfigureAwait(false);
        return ToStringList(result);
    }

    public async Task<long> ObliterateAsync(bool force, int count)
    {
        var keys = MapKeys("meta", "");
        var args = new RedisValue[] { count, force ? "force" : string.Empty };
        var result = await _connection.EvalAsync("obliterate", keys, args).ConfigureAwait(false);
        var cursor = (long)result;
        if (cursor < 0)
        {
            throw new BullMQException(cursor == -1
                ? "Cannot obliterate non-paused queue"
                : "Cannot obliterate queue with active jobs");
        }

        return cursor;
    }

    public async Task<long> RemoveAsync(string jobId, bool removeChildren)
    {
        var keys = new RedisKey[] { ToKey(jobId), _keys["repeat"] };
        var args = new RedisValue[] { jobId, removeChildren ? 1 : 0, _keys[""] };
        var result = await _connection.EvalAsync("removeJob", keys, args).ConfigureAwait(false);
        return result.Resp2Type == ResultType.Integer ? (long)result : 0;
    }

    // ============================================================
    // Locks
    // ============================================================

    public async Task<long> ExtendLockAsync(string jobId, string token, int duration)
    {
        var keys = new RedisKey[] { $"{ToKey(jobId)}:lock", _keys["stalled"] };
        var args = new RedisValue[] { token, duration, jobId };
        var result = await _connection.EvalAsync("extendLock", keys, args).ConfigureAwait(false);
        return result.Resp2Type == ResultType.Integer ? (long)result : 0;
    }

    public async Task<IReadOnlyList<string>> ExtendLocksAsync(
        IReadOnlyList<string> jobIds, IReadOnlyList<string> tokens, int duration)
    {
        var keys = new RedisKey[] { _keys["stalled"] };
        var args = new RedisValue[]
        {
            _keys[""],
            MsgPack.Encode(tokens.Cast<object?>().ToList()),
            MsgPack.Encode(jobIds.Cast<object?>().ToList()),
            duration,
        };
        var result = await _connection.EvalAsync("extendLocks", keys, args).ConfigureAwait(false);
        return ToStringList(result);
    }

    // ============================================================
    // Job mutations
    // ============================================================

    public async Task UpdateDataAsync(string jobId, object? data)
    {
        var keys = new RedisKey[] { ToKey(jobId) };
        var args = new RedisValue[] { JsonUtil.Serialize(data) };
        var result = await _connection.EvalAsync("updateData", keys, args).ConfigureAwait(false);
        ThrowIfNegative(result, jobId, "updateData", null);
    }

    public async Task UpdateProgressAsync(string jobId, object? progress)
    {
        var keys = new RedisKey[] { ToKey(jobId), _keys["events"], _keys["meta"] };
        var args = new RedisValue[] { jobId, JsonUtil.Serialize(progress) };
        var result = await _connection.EvalAsync("updateProgress", keys, args).ConfigureAwait(false);
        ThrowIfNegative(result, jobId, "updateProgress", null);
    }

    public async Task ChangePriorityAsync(string jobId, int priority = 0, bool lifo = false)
    {
        var keys = MapKeys("wait", "paused", "meta", "prioritized", "active", "pc", "marker");
        var args = new RedisValue[] { priority, ToKey(jobId), jobId, lifo ? 1 : 0 };
        var result = await _connection.EvalAsync("changePriority", keys, args).ConfigureAwait(false);
        ThrowIfNegative(result, jobId, "changePriority", null);
    }

    public async Task<long> AddLogAsync(string jobId, string logRow, int keepLogs = 0)
    {
        var logsKey = ToKey($"{jobId}:logs");
        var length = await _connection.Db.ListRightPushAsync(logsKey, logRow).ConfigureAwait(false);
        if (keepLogs > 0)
        {
            await _connection.Db.ListTrimAsync(logsKey, -keepLogs, -1).ConfigureAwait(false);
            return Math.Min(keepLogs, length);
        }

        return length;
    }

    // ============================================================
    // Queries
    // ============================================================

    public async Task<JobState> GetStateAsync(string jobId)
    {
        var keys = MapKeys(
            "completed", "failed", "delayed", "active", "wait", "paused", "waiting-children", "prioritized");
        var args = new RedisValue[] { jobId, ToKey(jobId) };
        var result = await _connection.EvalAsync("getStateV2", keys, args).ConfigureAwait(false);
        return JobStateExtensions.FromWireString((string?)result);
    }

    public async Task<bool> IsJobInStateAsync(string state, string jobId)
    {
        if (ZsetStates.Contains(state))
        {
            var score = await _connection.Db.SortedSetScoreAsync(ToKey(state), jobId).ConfigureAwait(false);
            return score.HasValue;
        }

        var pos = await _connection.Db
            .ExecuteAsync("LPOS", ToKey(state), jobId)
            .ConfigureAwait(false);
        return !pos.IsNull;
    }

    public async Task<JobJson?> GetJobDataAsync(string jobId)
    {
        var entries = await _connection.Db.HashGetAllAsync(ToKey(jobId)).ConfigureAwait(false);
        return JobJson.FromHash(entries, jobId);
    }

    public async Task<JobLogs> GetJobLogsAsync(string jobId, int start = 0, int end = -1, bool asc = true)
    {
        var logsKey = ToKey($"{jobId}:logs");
        RedisValue[] logsRaw;
        if (asc)
        {
            logsRaw = await _connection.Db.ListRangeAsync(logsKey, start, end).ConfigureAwait(false);
        }
        else
        {
            logsRaw = await _connection.Db.ListRangeAsync(logsKey, -(end + 1), -(start + 1)).ConfigureAwait(false);
            Array.Reverse(logsRaw);
        }

        var count = await _connection.Db.ListLengthAsync(logsKey).ConfigureAwait(false);
        var logs = logsRaw.Select(v => v.ToString()).ToArray();
        return new JobLogs(logs, count);
    }

    public async Task<long> GetRateLimitTtlAsync()
    {
        var result = await _connection.Db.ExecuteAsync("PTTL", _keys["limiter"]).ConfigureAwait(false);
        return (long)result;
    }

    public async Task<long[]> GetCountsAsync(params string[] types)
    {
        var keys = MapKeys("");
        var args = types.Select(t => (RedisValue)(t == "waiting" ? "wait" : t)).ToArray();
        var result = await _connection.EvalAsync("getCounts", keys, args).ConfigureAwait(false);
        var arr = (RedisResult[]?)result ?? Array.Empty<RedisResult>();
        return arr.Select(r => r.IsNull ? 0L : (long)r).ToArray();
    }

    public async Task<long[]> GetCountsPerPriorityAsync(IReadOnlyList<long> priorities)
    {
        var keys = MapKeys("wait", "paused", "meta", "prioritized");
        var args = priorities.Select(p => (RedisValue)p).ToArray();
        var result = await _connection.EvalAsync("getCountsPerPriority", keys, args).ConfigureAwait(false);
        var arr = (RedisResult[]?)result ?? Array.Empty<RedisResult>();
        return arr.Select(r => r.IsNull ? 0L : (long)r).ToArray();
    }

    public async Task<IReadOnlyList<string>> GetRangesAsync(
        IReadOnlyList<string> types, int start = 0, int end = 1, bool asc = false)
    {
        var transformed = types.Select(t => t == "waiting" ? "wait" : t).ToArray();
        var keys = MapKeys("");
        var args = new List<RedisValue> { start, end, asc ? "1" : "0" };
        args.AddRange(transformed.Select(t => (RedisValue)t));

        var result = await _connection.EvalAsync("getRanges", keys, args.ToArray()).ConfigureAwait(false);
        var responses = (RedisResult[]?)result ?? Array.Empty<RedisResult>();

        var listStates = new HashSet<string>(StringComparer.Ordinal) { "wait", "active", "paused" };
        var ids = new List<string>();
        for (var i = 0; i < responses.Length; i++)
        {
            var page = ToStringList(responses[i]).ToList();
            if (asc && i < transformed.Length && listStates.Contains(transformed[i]))
            {
                page.Reverse();
            }

            ids.AddRange(page);
        }

        return ids;
    }

    public async Task<IReadOnlyDictionary<string, string>> GetProcessedChildrenValuesAsync(string jobId)
    {
        var entries = await _connection.Db.HashGetAllAsync(ToKey($"{jobId}:processed")).ConfigureAwait(false);
        return entries.ToDictionary(e => e.Name.ToString(), e => e.Value.ToString(), StringComparer.Ordinal);
    }

    public async Task<bool> IsPausedAsync() =>
        await _connection.Db.HashExistsAsync(_keys["meta"], "paused").ConfigureAwait(false);

    public async Task<IReadOnlyList<string>> GetClientListAsync()
    {
        foreach (var endpoint in _connection.Multiplexer.GetEndPoints())
        {
            var server = _connection.Multiplexer.GetServer(endpoint);
            if (server.IsConnected && !server.IsReplica)
            {
                var result = await server.ExecuteAsync("CLIENT", "LIST").ConfigureAwait(false);
                return new[] { result.ToString() ?? string.Empty };
            }
        }

        return Array.Empty<string>();
    }

    // ============================================================
    // Metadata & maintenance
    // ============================================================

    public async Task SetQueueMetaAsync(IReadOnlyDictionary<string, object> values)
    {
        var entries = values.Select(kv => new HashEntry(kv.Key, kv.Value.ToString())).ToArray();
        await _connection.Db.HashSetAsync(_keys["meta"], entries).ConfigureAwait(false);
    }

    public async Task<string?> GetQueueMetaFieldAsync(string field)
    {
        var value = await _connection.Db.HashGetAsync(_keys["meta"], field).ConfigureAwait(false);
        return value.IsNull ? null : value.ToString();
    }

    public async Task<bool> HasQueueMetaFieldAsync(string field) =>
        await _connection.Db.HashExistsAsync(_keys["meta"], field).ConfigureAwait(false);

    public async Task<long> TrimEventsAsync(long maxLength) =>
        await _connection.Db.StreamTrimAsync(_keys["events"], (int)maxLength, useApproximateMaxLength: true)
            .ConfigureAwait(false);

    public async Task<long> RemoveDeprecatedPriorityKeyAsync()
    {
        var removed = await _connection.Db.KeyDeleteAsync(ToKey("priority")).ConfigureAwait(false);
        return removed ? 1 : 0;
    }

    // ============================================================
    // Worker blocking primitive
    // ============================================================

    public async Task<MarkerResult?> WaitForJobAsync(double blockTimeoutSeconds)
    {
        var db = (_blocking ?? _connection).Db;
        var result = await db
            .ExecuteAsync("BZPOPMIN", _keys["marker"], blockTimeoutSeconds)
            .ConfigureAwait(false);

        if (result.IsNull)
        {
            return null;
        }

        var arr = (RedisResult[]?)result;
        if (arr is null || arr.Length < 3)
        {
            return null;
        }

        var member = (string?)arr[1] ?? string.Empty;
        var score = (double)arr[2];
        return new MarkerResult(member, score);
    }

    // ============================================================
    // Helpers
    // ============================================================

    private RedisKey[] MapKeys(params string[] names)
    {
        var result = new RedisKey[names.Length];
        for (var i = 0; i < names.Length; i++)
        {
            result[i] = _keys[names[i]];
        }

        return result;
    }

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private static void ThrowIfNegative(RedisResult result, string? jobId, string command, string? state)
    {
        if (result.Resp2Type == ResultType.Integer)
        {
            var code = (long)result;
            if (code < 0)
            {
                throw FinishedErrors.Create((int)code, jobId: jobId, command: command, state: state);
            }
        }
    }

    private static IReadOnlyList<string> ToStringList(RedisResult result)
    {
        if (result.IsNull)
        {
            return Array.Empty<string>();
        }

        var arr = (RedisResult[]?)result;
        if (arr is null)
        {
            return Array.Empty<string>();
        }

        var list = new List<string>(arr.Length);
        foreach (var item in arr)
        {
            if (!item.IsNull)
            {
                list.Add((string?)item ?? string.Empty);
            }
        }

        return list;
    }

    private static Dictionary<string, object?> GetKeepJobs(object? shouldRemove) => shouldRemove switch
    {
        null => new() { ["count"] = -1 },
        bool b => new() { ["count"] = b ? 0 : -1 },
        int count => new() { ["count"] = count },
        long count => new() { ["count"] = count },
        KeepJobs keep => KeepJobsToMap(keep),
        _ => new() { ["count"] = -1 },
    };

    private static Dictionary<string, object?> KeepJobsToMap(KeepJobs keep)
    {
        var map = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (keep.Count is { } count)
        {
            map["count"] = count;
        }

        if (keep.Age is { } age)
        {
            map["age"] = age;
        }

        return map;
    }

    private NextJobData ParseNextJobData(RedisResult result)
    {
        if (result.IsNull || result.Resp2Type == ResultType.Integer)
        {
            return NextJobData.Empty;
        }

        var arr = (RedisResult[]?)result;
        if (arr is null || arr.Length == 0)
        {
            return NextJobData.Empty;
        }

        JobJson? job = null;
        if (!arr[0].IsNull)
        {
            var flat = (RedisResult[]?)arr[0];
            if (flat is { Length: > 0 })
            {
                job = FlatToJobJson(flat);
            }
        }

        string? jobId = arr.Length > 1 && !arr[1].IsNull ? (string?)arr[1] : null;
        long rateLimitDelay = arr.Length > 2 ? ToLong(arr[2]) : 0;
        long delayUntil = arr.Length > 3 ? ToLong(arr[3]) : 0;

        return new NextJobData
        {
            Job = job,
            JobId = jobId,
            RateLimitDelay = rateLimitDelay,
            DelayUntil = delayUntil,
        };
    }

    private static JobJson FlatToJobJson(RedisResult[] flat)
    {
        var map = new Dictionary<string, string?>(StringComparer.Ordinal);
        for (var i = 0; i + 1 < flat.Length; i += 2)
        {
            var key = (string?)flat[i];
            if (key is not null)
            {
                map[key] = (string?)flat[i + 1];
            }
        }

        return JobJson.FromMap(map);
    }

    private static long ToLong(RedisResult result)
    {
        if (result.IsNull)
        {
            return 0;
        }

        return result.Resp2Type == ResultType.Integer
            ? (long)result
            : long.TryParse((string?)result, out var v) ? v : 0;
    }
}
