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
    private long _generation;
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

    /// <summary>Registers a job for lock renewal, replacing any earlier attempt's registration.</summary>
    public long TrackJob(string jobId, string token, long ts)
    {
        if (_closed || string.IsNullOrEmpty(jobId))
        {
            return 0;
        }

        var generation = Interlocked.Increment(ref _generation);
        _tracked[jobId] = new TrackedJob(token, ts == 0 ? NowMs() : ts, generation);
        return generation;
    }

    /// <summary>
    /// Stops renewing the lock for the given job, but only while it is still
    /// registered with <paramref name="token"/> and <paramref name="generation"/>.
    /// A newer attempt of the same job keeps its registration even when it reuses
    /// the same token.
    /// </summary>
    public void UntrackJob(string jobId, string token, long generation)
    {
        // Renewals replace the entry (new Ts), so retry the exact-value removal
        // until it succeeds or the registration has changed.
        while (_tracked.TryGetValue(jobId, out var tracked) &&
            tracked.Token == token && tracked.Generation == generation)
        {
            if (_tracked.TryRemove(new KeyValuePair<string, TrackedJob>(jobId, tracked)))
            {
                return;
            }
        }
    }

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
            var toExtend = new List<KeyValuePair<string, TrackedJob>>();

            foreach (var jobId in _tracked.Keys)
            {
                if (!_tracked.TryGetValue(jobId, out var tracked))
                {
                    continue;
                }

                // Compare-and-swap: a plain write could overwrite a newer
                // attempt's registration or restore an untracked one.
                if (tracked.Ts + threshold < now &&
                    _tracked.TryUpdate(jobId, tracked with { Ts = now }, tracked))
                {
                    toExtend.Add(new KeyValuePair<string, TrackedJob>(jobId, tracked with { Ts = now }));
                }
            }

            if (toExtend.Count > 0)
            {
                await ExtendLocksAsync(toExtend).ConfigureAwait(false);
            }
        }
    }

    private async Task ExtendLocksAsync(IReadOnlyList<KeyValuePair<string, TrackedJob>> registrations)
    {
        var ids = registrations.Select(registration => registration.Key).ToList();
        var tokens = registrations.Select(registration => registration.Value.Token).ToList();

        try
        {
            var failed = await _backend.ExtendLocksAsync(ids, tokens, _lockDuration).ConfigureAwait(false);
            if (failed.Count > 0)
            {
                foreach (var jobId in failed)
                {
                    var index = ids.IndexOf(jobId);
                    if (index >= 0)
                    {
                        UntrackJob(jobId, tokens[index], registrations[index].Value.Generation);
                    }
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

    private readonly record struct TrackedJob(string Token, long Ts, long Generation);
}
