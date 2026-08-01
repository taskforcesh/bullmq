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
/// This initial implementation fetches jobs by polling
/// <see cref="IQueueBackend.MoveToActiveAsync"/>. A marker-based blocking wait
/// (matching the reference <c>BZPOPMIN</c> primitive) will replace the idle poll
/// in a subsequent iteration.
/// </para>
/// </summary>
public sealed class Worker : IAsyncDisposable
{
    // Idle poll interval used when the queue is drained. Replaced by a blocking
    // marker wait in a later iteration.
    private const int IdlePollMs = 100;

    private readonly Lazy<Task<IQueueBackend>> _backend;
    private readonly Processor _processor;
    private readonly CancellationTokenSource _cts = new();

    private long _tokenCounter;
    private volatile bool _closing;
    private volatile bool _drained;
    private Task? _running;

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
        var lockRenew = Opts.LockRenewTime ?? Opts.LockDuration / 2;
        _ = lockRenew; // reserved for the lock manager (added in a later iteration)

        var backend = await BackendBuilder
            .CreateAsync(Name, Opts, Opts.LockDuration, Opts.Name)
            .ConfigureAwait(false);
        await backend.WaitUntilReadyAsync().ConfigureAwait(false);
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

        var loops = new Task[Opts.Concurrency];
        for (var i = 0; i < Opts.Concurrency; i++)
        {
            loops[i] = WorkerLoop(backend);
        }

        await Task.WhenAll(loops).ConfigureAwait(false);
    }

    private async Task WorkerLoop(IQueueBackend backend)
    {
        while (!_closing)
        {
            var token = $"{Id}:{Interlocked.Increment(ref _tokenCounter)}";

            NextJobData next;
            try
            {
                next = await backend.MoveToActiveAsync(token, Opts.Name).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                Error?.Invoke(ex);
                await DelayIdle().ConfigureAwait(false);
                continue;
            }

            if (next.Job is not null)
            {
                _drained = false;
                var job = Job.FromJson(backend, Name, next.Job, next.JobId);
                job.Token = token;
                await ProcessJob(job, token).ConfigureAwait(false);
            }
            else
            {
                if (!_drained)
                {
                    _drained = true;
                    Drained?.Invoke();
                }

                await DelayIdle().ConfigureAwait(false);
            }
        }
    }

    private async Task ProcessJob(Job job, string token)
    {
        Active?.Invoke(job);
        try
        {
            var result = await _processor(job, _cts.Token).ConfigureAwait(false);
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
    }

    private async Task DelayIdle()
    {
        try
        {
            await Task.Delay(IdlePollMs, _cts.Token).ConfigureAwait(false);
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
        _cts.Cancel();

        if (_running is not null && !force)
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

        if (_backend.IsValueCreated)
        {
            var backend = await _backend.Value.ConfigureAwait(false);
            await backend.CloseAsync(force).ConfigureAwait(false);
        }

        _cts.Dispose();
    }

    public async ValueTask DisposeAsync() => await CloseAsync().ConfigureAwait(false);
}
