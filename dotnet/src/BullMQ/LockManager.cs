using System.Collections.Concurrent;

namespace BullMQ;

/// <summary>
/// Keeps track of every job currently being processed by a worker and
/// periodically renews their locks (via <see cref="IQueueBackend.ExtendLocksAsync"/>)
/// so other workers do not consider them stalled while they are still running.
///
/// Port of the reference <c>LockManager</c>. The renewal loop wakes every
/// <c>lockRenewTime / 2</c> ms and renews any tracked job whose stored timestamp
/// is older than half the renewal window.
/// </summary>
internal sealed class LockManager
{
    private readonly IQueueBackend _backend;
    private readonly int _lockRenewTime;
    private readonly int _lockDuration;
    private readonly Action<Exception> _onError;
    private readonly Action<IReadOnlyList<string>> _onRenewalFailed;
    private readonly Action<IReadOnlyList<string>> _onRenewed;

    private readonly ConcurrentDictionary<string, TrackedJob> _tracked = new(StringComparer.Ordinal);
    private CancellationTokenSource? _cts;
    private Task? _loop;
    private volatile bool _closed;

    public LockManager(
        IQueueBackend backend,
        int lockRenewTime,
        int lockDuration,
        Action<Exception> onError,
        Action<IReadOnlyList<string>> onRenewalFailed,
        Action<IReadOnlyList<string>> onRenewed)
    {
        _backend = backend;
        _lockRenewTime = lockRenewTime;
        _lockDuration = lockDuration;
        _onError = onError;
        _onRenewalFailed = onRenewalFailed;
        _onRenewed = onRenewed;
    }

    /// <summary>Starts the background renewal loop. Idempotent.</summary>
    public void Start()
    {
        if (_closed || _loop is not null || _lockRenewTime <= 0)
        {
            return;
        }

        _cts = new CancellationTokenSource();
        _loop = RenewalLoopAsync(_cts.Token);
    }

    /// <summary>Registers a job for lock renewal.</summary>
    public void TrackJob(string jobId, string token, long ts)
    {
        if (_closed || string.IsNullOrEmpty(jobId))
        {
            return;
        }

        _tracked[jobId] = new TrackedJob(token, ts == 0 ? NowMs() : ts);
    }

    /// <summary>Stops renewing the lock for the given job.</summary>
    public void UntrackJob(string jobId) => _tracked.TryRemove(jobId, out _);

    public int ActiveJobCount => _tracked.Count;

    public async Task CloseAsync()
    {
        if (_closed)
        {
            return;
        }

        _closed = true;
        _cts?.Cancel();
        if (_loop is not null)
        {
            try
            {
                await _loop.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // expected
            }
            catch (Exception err)
            {
                _onError(err);
            }
        }

        _cts?.Dispose();
        _tracked.Clear();
    }

    private async Task RenewalLoopAsync(CancellationToken token)
    {
        var interval = TimeSpan.FromMilliseconds(_lockRenewTime / 2.0);
        while (!_closed)
        {
            try
            {
                await Task.Delay(interval, token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }

            if (_closed)
            {
                break;
            }

            var now = NowMs();
            var threshold = _lockRenewTime / 2.0;
            var toExtend = new List<string>();

            foreach (var jobId in _tracked.Keys)
            {
                if (!_tracked.TryGetValue(jobId, out var tracked))
                {
                    continue;
                }

                if (tracked.Ts + threshold < now)
                {
                    _tracked[jobId] = tracked with { Ts = now };
                    toExtend.Add(jobId);
                }
            }

            if (toExtend.Count > 0)
            {
                await ExtendLocksAsync(toExtend).ConfigureAwait(false);
            }
        }
    }

    private async Task ExtendLocksAsync(IReadOnlyList<string> jobIds)
    {
        var tokens = new List<string>(jobIds.Count);
        var ids = new List<string>(jobIds.Count);
        foreach (var jobId in jobIds)
        {
            if (_tracked.TryGetValue(jobId, out var tracked))
            {
                ids.Add(jobId);
                tokens.Add(tracked.Token);
            }
        }

        if (ids.Count == 0)
        {
            return;
        }

        try
        {
            var failed = await _backend.ExtendLocksAsync(ids, tokens, _lockDuration).ConfigureAwait(false);
            if (failed.Count > 0)
            {
                foreach (var jobId in failed)
                {
                    UntrackJob(jobId);
                }

                _onRenewalFailed(failed);
            }

            var renewed = ids.Where(id => !failed.Contains(id)).ToList();
            if (renewed.Count > 0)
            {
                _onRenewed(renewed);
            }
        }
        catch (Exception err)
        {
            _onError(err);
        }
    }

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private readonly record struct TrackedJob(string Token, long Ts);
}
