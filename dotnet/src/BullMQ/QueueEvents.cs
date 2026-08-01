namespace BullMQ;

/// <summary>
/// A single event read from a queue's event stream. <see cref="Fields"/> holds
/// the raw string fields as published; the convenience accessors expose the
/// common ones. The same instance is passed to both the typed events (e.g.
/// <see cref="QueueEvents.Completed"/>) and the catch-all
/// <see cref="QueueEvents.EventReceived"/>.
/// </summary>
public readonly record struct QueueEvent(
    string Name,
    string Id,
    IReadOnlyDictionary<string, string> Fields)
{
    private string? Get(string key) => Fields.TryGetValue(key, out var v) ? v : null;

    /// <summary>The id of the job this event refers to, when applicable.</summary>
    public string? JobId => Get("jobId");

    /// <summary>The job's previous state, when the event reports a transition.</summary>
    public string? Prev => Get("prev");

    /// <summary>The (JSON-encoded) return value for <c>completed</c> events.</summary>
    public string? ReturnValue => Get("returnvalue");

    /// <summary>The failure reason for <c>failed</c> events.</summary>
    public string? FailedReason => Get("failedReason");

    /// <summary>The (JSON-encoded) progress payload for <c>progress</c> events.</summary>
    public string? Data => Get("data");

    /// <summary>The job name for <c>added</c> events.</summary>
    public string? JobName => Get("name");

    /// <summary>The delay timestamp (ms since epoch) for <c>delayed</c> events.</summary>
    public string? Delay => Get("delay");
}

/// <summary>
/// Subscribes to a queue's global event stream and raises events as jobs move
/// through their lifecycle (added, active, completed, failed, progress, and so
/// on). It reads the same stream produced by workers on any runtime, so a .NET
/// listener observes jobs processed by Node.js, Python, Elixir, etc.
///
/// Use the strongly-typed events for the common cases, or
/// <see cref="EventReceived"/> to observe every event (including ones without a
/// dedicated typed event).
/// </summary>
public sealed class QueueEvents : IAsyncDisposable
{
    private readonly Lazy<Task<IQueueBackend>> _backend;
    private volatile bool _closing;
    private Task? _consuming;

    /// <summary>The queue name being observed.</summary>
    public string Name { get; }

    /// <summary>The options this listener was created with.</summary>
    public QueueEventsOptions Opts { get; }

    /// <summary>Raised for every event, after any matching typed event.</summary>
    public event Action<QueueEvent>? EventReceived;

    /// <summary>Raised when a job starts being processed.</summary>
    public event Action<QueueEvent>? Active;

    /// <summary>Raised when a job is added to the queue.</summary>
    public event Action<QueueEvent>? Added;

    /// <summary>Raised when a job completes successfully.</summary>
    public event Action<QueueEvent>? Completed;

    /// <summary>Raised when a job fails.</summary>
    public event Action<QueueEvent>? Failed;

    /// <summary>Raised when a job reports progress.</summary>
    public event Action<QueueEvent>? Progress;

    /// <summary>Raised when a job returns to the waiting state.</summary>
    public event Action<QueueEvent>? Waiting;

    /// <summary>Raised when a job is scheduled with a delay.</summary>
    public event Action<QueueEvent>? Delayed;

    /// <summary>Raised when a job is removed from the queue.</summary>
    public event Action<QueueEvent>? Removed;

    /// <summary>Raised when a job is detected as stalled.</summary>
    public event Action<QueueEvent>? Stalled;

    /// <summary>Raised when the queue's waiting list has drained.</summary>
    public event Action<QueueEvent>? Drained;

    /// <summary>Raised when the read loop encounters an error.</summary>
    public event Action<Exception>? Error;

    public QueueEvents(string name, QueueEventsOptions opts)
    {
        Name = name;
        Opts = opts ?? throw new ArgumentNullException(nameof(opts));

        if (opts.Postgres is null && opts.Connection is null)
        {
            throw new ArgumentException("QueueEvents requires a connection");
        }

        _backend = new Lazy<Task<IQueueBackend>>(InitBackendAsync);

        if (opts.Autorun)
        {
            _consuming = RunAsync();
        }
    }

    private async Task<IQueueBackend> InitBackendAsync()
    {
        // A dedicated blocking connection so the read loop can hold XREAD BLOCK
        // without stalling other operations.
        var backend = await BackendBuilder
            .CreateAsync(Name, Opts, withBlockingConnection: true)
            .ConfigureAwait(false);
        await backend.WaitUntilReadyAsync().ConfigureAwait(false);
        return backend;
    }

    /// <summary>Waits until the listener's connection is ready.</summary>
    public async Task WaitUntilReadyAsync() => await _backend.Value.ConfigureAwait(false);

    /// <summary>
    /// Starts consuming events (only needed when <see cref="QueueEventsOptions.Autorun"/>
    /// is disabled). Returns a task that completes when the listener stops.
    /// </summary>
    public Task RunAsync()
    {
        _consuming ??= ConsumeAsync();
        return _consuming;
    }

    private async Task ConsumeAsync()
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        var id = string.IsNullOrEmpty(Opts.LastEventId) ? "$" : Opts.LastEventId!;
        var blockSeconds = Math.Max(Opts.BlockingTimeout, 1) / 1000.0;

        while (!_closing)
        {
            IReadOnlyList<EventEntry> events;
            try
            {
                events = await backend.ReadEventsAsync(id, blockSeconds).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                if (_closing)
                {
                    break;
                }

                Error?.Invoke(ex);
                await Task.Delay(50).ConfigureAwait(false);
                continue;
            }

            foreach (var entry in events)
            {
                id = entry.Id;
                Dispatch(entry);
            }
        }
    }

    private void Dispatch(EventEntry entry)
    {
        var fields = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var i = 0; i + 1 < entry.Fields.Count; i += 2)
        {
            fields[entry.Fields[i]] = entry.Fields[i + 1];
        }

        fields.TryGetValue("event", out var name);
        var evt = new QueueEvent(name ?? string.Empty, entry.Id, fields);

        switch (evt.Name)
        {
            case "active":
                Active?.Invoke(evt);
                break;
            case "added":
                Added?.Invoke(evt);
                break;
            case "completed":
                Completed?.Invoke(evt);
                break;
            case "failed":
                Failed?.Invoke(evt);
                break;
            case "progress":
                Progress?.Invoke(evt);
                break;
            case "waiting":
                Waiting?.Invoke(evt);
                break;
            case "delayed":
                Delayed?.Invoke(evt);
                break;
            case "removed":
                Removed?.Invoke(evt);
                break;
            case "stalled":
                Stalled?.Invoke(evt);
                break;
            case "drained":
                Drained?.Invoke(evt);
                break;
        }

        EventReceived?.Invoke(evt);
    }

    /// <summary>Stops consuming events and closes the underlying connection.</summary>
    public async Task CloseAsync()
    {
        if (_closing)
        {
            if (_consuming is not null)
            {
                try
                {
                    await _consuming.ConfigureAwait(false);
                }
                catch
                {
                    // ignore
                }
            }

            return;
        }

        _closing = true;

        // Interrupt any in-flight blocking read by tearing down the connection.
        if (_backend.IsValueCreated)
        {
            var backend = await _backend.Value.ConfigureAwait(false);
            await backend.DisposeAsync().ConfigureAwait(false);
        }

        if (_consuming is not null)
        {
            try
            {
                await _consuming.ConfigureAwait(false);
            }
            catch
            {
                // ignore
            }
        }
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync() => await CloseAsync().ConfigureAwait(false);
}
