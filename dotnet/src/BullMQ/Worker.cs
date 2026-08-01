namespace BullMQ;

/// <summary>
/// A processor function that handles a job and returns its result. The returned
/// value is stored as the job's return value on completion.
/// </summary>
public delegate Task<object?> Processor(Job job, CancellationToken cancellationToken);

/// <summary>
/// Processes jobs from a queue. As soon as it is created (and unless
/// <see cref="WorkerOptions.Autorun"/> is disabled) it starts fetching and
/// processing jobs concurrently up to <see cref="WorkerOptions.Concurrency"/>.
///
/// <para>
/// Jobs are fetched using the backend's blocking wait primitive
/// (Redis <c>BZPOPMIN</c> on the marker set / PostgreSQL <c>LISTEN</c>), so an
/// idle worker does not busy-poll. Locks are renewed periodically by a
/// <see cref="LockManager"/>, and a background stalled-job checker recovers jobs
/// whose lock expired.
/// </para>
/// </summary>
public sealed class Worker : IAsyncDisposable
{
    private readonly Lazy<Task<IQueueBackend>> _backend;
    private readonly Processor _processor;

    // Cancels the processor's abort signal (force close only).
    private readonly CancellationTokenSource _abortCts = new();

    // Interrupts the fetcher's waits (any close).
    private readonly CancellationTokenSource _closeCts = new();

    private SemaphoreSlim? _slots;
    private long _tokenCounter;
    private volatile bool _closing;
    private volatile bool _forceClosing;
    private volatile bool _drained;
    private Task? _running;
    private LockManager? _lockManager;
    private Task? _stalledChecker;

    /// <summary>A unique id for this worker instance.</summary>
    public string Id { get; } = Guid.NewGuid().ToString();

    /// <summary>The queue name this worker consumes from.</summary>
    public string Name { get; }

    /// <summary>The options this worker was created with.</summary>
    public WorkerOptions Opts { get; }

    /// <summary>Raised when a job becomes active (starts processing).</summary>
    public event Action<Job>? Active;

    /// <summary>Raised when a job completes successfully.</summary>
    public event Action<Job, object?>? Completed;

    /// <summary>Raised when a job fails.</summary>
    public event Action<Job?, Exception>? Failed;

    /// <summary>Raised when the worker drains the waiting list.</summary>
    public event Action? Drained;

    /// <summary>Raised when a non-fatal error occurs (e.g. a fetch failure).</summary>
    public event Action<Exception>? Error;

    /// <summary>Raised when a job has stalled and been moved back to wait.</summary>
    public event Action<string>? Stalled;

    /// <summary>Raised when lock renewal fails for one or more jobs.</summary>
    public event Action<IReadOnlyList<string>>? LockRenewalFailed;

    /// <summary>Raised when locks are successfully renewed.</summary>
    public event Action<IReadOnlyList<string>>? LocksRenewed;

    public Worker(string name, Processor processor, WorkerOptions opts)
    {
        Name = name;
        _processor = processor ?? throw new ArgumentNullException(nameof(processor));
        Opts = opts ?? throw new ArgumentNullException(nameof(opts));

        if (opts.Postgres is null && opts.Connection is null)
        {
            throw new ArgumentException("Worker requires a connection");
        }

        _backend = new Lazy<Task<IQueueBackend>>(InitBackendAsync);

        if (opts.Autorun)
        {
            _running = RunAsync();
        }
    }

    private async Task<IQueueBackend> InitBackendAsync()
    {
        var backend = await BackendBuilder
            .CreateAsync(Name, Opts, Opts.LockDuration, Opts.Name, withBlockingConnection: true)
            .ConfigureAwait(false);
        await backend.WaitUntilReadyAsync().ConfigureAwait(false);

        var lockRenewTime = Opts.LockRenewTime ?? Opts.LockDuration / 2;
        _lockManager = new LockManager(
            backend,
            lockRenewTime,
            Opts.LockDuration,
            err => Error?.Invoke(err),
            ids => LockRenewalFailed?.Invoke(ids),
            ids => LocksRenewed?.Invoke(ids));

        return backend;
    }

    /// <summary>Waits until the worker's connection is ready.</summary>
    public async Task WaitUntilReadyAsync() => await _backend.Value.ConfigureAwait(false);

    /// <summary>
    /// Starts processing (only needed when <see cref="WorkerOptions.Autorun"/> is
    /// disabled). Returns a task that completes when the worker stops.
    /// </summary>
    public Task RunAsync()
    {
        _running ??= RunInternalAsync();
        return _running;
    }

    private async Task RunInternalAsync()
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        _slots = new SemaphoreSlim(Opts.Concurrency, Opts.Concurrency);

        if (!Opts.SkipLockRenewal)
        {
            _lockManager?.Start();
        }

        if (!Opts.SkipStalledCheck)
        {
            _stalledChecker = StalledCheckerLoopAsync(backend);
        }

        await MainLoopAsync(backend).ConfigureAwait(false);
    }

    /// <summary>
    /// The main fetch loop. A semaphore bounds in-flight processing to
    /// <see cref="WorkerOptions.Concurrency"/>: each free slot triggers a fetch,
    /// jobs are processed fire-and-forget (releasing their slot on completion),
    /// and an idle worker blocks on the backend's wait primitive instead of
    /// busy-polling.
    /// </summary>
    private async Task MainLoopAsync(IQueueBackend backend)
    {
        while (!_closing)
        {
            try
            {
                await _slots!.WaitAsync(_closeCts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }

            if (_closing)
            {
                _slots!.Release();
                break;
            }

            var token = $"{Id}:{Interlocked.Increment(ref _tokenCounter)}";
            NextJobData next;
            try
            {
                next = await backend.MoveToActiveAsync(token, Opts.Name).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _slots!.Release();
                if (!_closing)
                {
                    Error?.Invoke(ex);
                }

                await SafeDelayAsync(200).ConfigureAwait(false);
                continue;
            }

            if (next.Job is not null)
            {
                _drained = false;
                var job = Job.FromJson(backend, Name, next.Job, next.JobId);
                job.Token = token;
                if (!string.IsNullOrEmpty(job.RepeatJobKey))
                {
                    await ScheduleNextIterationAsync(backend, job).ConfigureAwait(false);
                }

                _ = RunJobAsync(backend, job, token);
            }
            else
            {
                if (!_drained)
                {
                    _drained = true;
                    Drained?.Invoke();
                }

                _slots!.Release();
                await WaitForJobAsync(backend, next.DelayUntil).ConfigureAwait(false);
            }
        }

        // Drain: wait for every in-flight job to finish (skipped on force close).
        if (!_forceClosing)
        {
            for (var i = 0; i < Opts.Concurrency; i++)
            {
                await _slots!.WaitAsync().ConfigureAwait(false);
            }
        }
    }

    private async Task RunJobAsync(IQueueBackend backend, Job job, string token)
    {
        try
        {
            await ProcessJob(backend, job, token).ConfigureAwait(false);
        }
        finally
        {
            _slots!.Release();
        }
    }

    /// <summary>
    /// When a fetched job was produced by a scheduler, enqueue the scheduler's
    /// next iteration (matching the reference worker's reschedule-on-fetch).
    /// </summary>
    private async Task ScheduleNextIterationAsync(IQueueBackend backend, Job job)
    {
        try
        {
            if (job.Repeat is null)
            {
                return;
            }

            if (!await backend.IsJobSchedulerAsync(job.RepeatJobKey!).ConfigureAwait(false))
            {
                return;
            }

            var scheduler = new JobScheduler(backend, Name);
            await scheduler.UpsertJobSchedulerAsync(
                job.RepeatJobKey!, job.Repeat, job.Name, job.Data, job.Opts,
                @override: false, producerId: job.Id).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            Error?.Invoke(new BullMQException(
                $"Failed to add repeatable job for next iteration: {ex.Message}", ex));
        }
    }

    private async Task ProcessJob(IQueueBackend backend, Job job, string token)
    {
        var ts = job.ProcessedOn ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        _lockManager?.TrackJob(job.Id!, token, ts);
        Active?.Invoke(job);
        try
        {
            var result = await _processor(job, _abortCts.Token).ConfigureAwait(false);
            await job.MoveToCompletedAsync(result, token, fetchNext: false).ConfigureAwait(false);
            Completed?.Invoke(job, result);
        }
        catch (Exception ex)
        {
            try
            {
                await job.MoveToFailedAsync(ex, token, fetchNext: false).ConfigureAwait(false);
            }
            catch (Exception moveError)
            {
                Error?.Invoke(moveError);
            }

            Failed?.Invoke(job, ex);
        }
        finally
        {
            _lockManager?.UntrackJob(job.Id!);
        }
    }

    /// <summary>Blocks on the backend's wait primitive until a job may be available.</summary>
    private async Task WaitForJobAsync(IQueueBackend backend, long delayUntil = 0)
    {
        var maxBlockSeconds = Math.Min(Math.Max(Opts.DrainDelay, 1), 10);

        // When the next job is a delayed job due at `delayUntil`, sleep until it
        // is due (bounded) rather than blocking indefinitely on the marker.
        if (delayUntil > 0)
        {
            var delta = delayUntil - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (delta <= 0)
            {
                return;
            }

            await SafeDelayAsync((int)Math.Min(delta, maxBlockSeconds * 1000L)).ConfigureAwait(false);
            return;
        }

        try
        {
            var waitTask = backend.WaitForJobAsync(maxBlockSeconds);

            // Race the (server-side) blocking wait against the close signal so a
            // closing worker does not have to wait for the block timeout. An
            // abandoned wait completes harmlessly in the background.
            var cancelTask = Task.Delay(Timeout.Infinite, _closeCts.Token);
            var done = await Task.WhenAny(waitTask, cancelTask).ConfigureAwait(false);
            if (done == waitTask)
            {
                await waitTask.ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // Worker is closing.
        }
        catch (Exception ex)
        {
            if (!_closing)
            {
                Error?.Invoke(ex);
            }

            await SafeDelayAsync(200).ConfigureAwait(false);
        }
    }

    private async Task StalledCheckerLoopAsync(IQueueBackend backend)
    {
        while (!_closing)
        {
            try
            {
                var stalled = await backend
                    .MoveStalledJobsToWaitAsync(Opts.MaxStalledCount, Opts.StalledInterval)
                    .ConfigureAwait(false);
                foreach (var jobId in stalled)
                {
                    Stalled?.Invoke(jobId);
                }
            }
            catch (Exception ex)
            {
                if (!_closing)
                {
                    Error?.Invoke(ex);
                }
            }

            try
            {
                await Task.Delay(Opts.StalledInterval, _closeCts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task SafeDelayAsync(int ms)
    {
        try
        {
            await Task.Delay(ms, _closeCts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Worker is closing.
        }
    }

    /// <summary>Closes the worker, waiting for in-flight work to settle.</summary>
    public async Task CloseAsync(bool force = false)
    {
        if (_closing)
        {
            return;
        }

        _closing = true;
        _forceClosing = force;

        // Interrupt the fetcher's blocking waits. On force close also cancel the
        // processor abort signal so cooperating processors stop promptly.
        _closeCts.Cancel();
        if (force)
        {
            _abortCts.Cancel();
        }

        if (_running is not null)
        {
            try
            {
                await _running.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Expected on cancellation.
            }
        }

        if (_stalledChecker is not null)
        {
            try
            {
                await _stalledChecker.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Expected.
            }
        }

        if (_lockManager is not null)
        {
            await _lockManager.CloseAsync().ConfigureAwait(false);
        }

        if (_backend.IsValueCreated)
        {
            var backend = await _backend.Value.ConfigureAwait(false);
            await backend.CloseAsync(force).ConfigureAwait(false);
        }

        _closeCts.Dispose();
        _abortCts.Dispose();
        _slots?.Dispose();
    }

    public async ValueTask DisposeAsync() => await CloseAsync().ConfigureAwait(false);
}
