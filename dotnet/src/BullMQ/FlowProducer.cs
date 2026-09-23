namespace BullMQ;

/// <summary>A node in a flow (job tree) to be added atomically via <see cref="FlowProducer"/>.</summary>
public sealed class FlowJob
{
    /// <summary>The job name.</summary>
    public required string Name { get; set; }

    /// <summary>The queue this node belongs to.</summary>
    public required string QueueName { get; set; }

    /// <summary>The user payload.</summary>
    public object? Data { get; set; }

    /// <summary>Options for this node's job.</summary>
    public JobsOptions? Opts { get; set; }

    /// <summary>Key prefix for this node's queue (defaults to the producer's prefix).</summary>
    public string? Prefix { get; set; }

    /// <summary>Child nodes. A node with children is added as a parent job.</summary>
    public IReadOnlyList<FlowJob>? Children { get; set; }
}

/// <summary>The result of adding a flow: the created job and its child results.</summary>
public sealed class FlowJobNode
{
    public required Job Job { get; init; }
    public IReadOnlyList<FlowJobNode>? Children { get; init; }
}

/// <summary>
/// A single, self-describing entry in a flattened flow, passed to
/// <see cref="IQueueBackend.AddFlowAsync"/>. Entries are ordered roots-first and
/// a parent appears before its children.
/// </summary>
public sealed class FlowJobEntry
{
    public Job Job { get; }
    public string QueueName { get; }
    public string Prefix { get; }
    public bool IsParent { get; }

    internal FlowJobEntry(Job job, string queueName, string prefix, bool isParent)
    {
        Job = job;
        QueueName = queueName;
        Prefix = prefix;
        IsParent = isParent;
    }
}

/// <summary>
/// Adds flows (job trees) whose parent jobs wait for their children to complete.
/// The whole tree is inserted atomically (a single Redis <c>MULTI</c> or a single
/// PostgreSQL transaction), so it works identically on both backends.
/// </summary>
public sealed class FlowProducer : IAsyncDisposable
{
    private readonly Lazy<Task<IQueueBackend>> _backend;
    private readonly string _prefix;

    public FlowProducer(QueueBaseOptions opts)
    {
        _prefix = opts.Prefix;
        _backend = new Lazy<Task<IQueueBackend>>(() => BackendBuilder.CreateAsync("__default__", opts));
    }

    /// <summary>Adds a flow atomically and returns the created job tree.</summary>
    public async Task<FlowJobNode> AddAsync(FlowJob flow)
    {
        var backend = await _backend.Value.ConfigureAwait(false);
        await backend.WaitUntilReadyAsync().ConfigureAwait(false);

        var entries = new List<FlowJobEntry>();
        var tree = AddNode(backend, flow, parentOpts: null, entries);
        await backend.AddFlowAsync(entries).ConfigureAwait(false);
        return tree;
    }

    private FlowJobNode AddNode(
        IQueueBackend backend,
        FlowJob node,
        IReadOnlyDictionary<string, object?>? parentOpts,
        List<FlowJobEntry> entries)
    {
        var prefix = node.Prefix ?? _prefix;
        var queueBackend = backend.ForQueue(node.QueueName, prefix);
        var opts = node.Opts ?? new JobsOptions();
        var jobId = opts.JobId ?? Guid.NewGuid().ToString("N");

        var job = new Job(queueBackend, node.QueueName, node.Name, node.Data, opts) { Id = jobId };
        if (parentOpts is not null)
        {
            // Stored parent uses `queueKey` (matching the reference Job, which
            // maps the public `parent.queue` option to `parent.queueKey`).
            job.Parent = parentOpts;
            job.ParentKey = $"{parentOpts["queueKey"]}:{parentOpts["id"]}";
        }

        if (node.Children is { Count: > 0 })
        {
            entries.Add(new FlowJobEntry(job, node.QueueName, prefix, isParent: true));

            var childParent = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["id"] = jobId,
                ["queueKey"] = queueBackend.QualifiedName,
            };

            var children = node.Children
                .Select(child => AddNode(backend, child, childParent, entries))
                .ToList();

            return new FlowJobNode { Job = job, Children = children };
        }

        entries.Add(new FlowJobEntry(job, node.QueueName, prefix, isParent: false));
        return new FlowJobNode { Job = job };
    }

    /// <summary>Closes the producer and its connection (when owned).</summary>
    public async Task CloseAsync()
    {
        if (_backend.IsValueCreated)
        {
            var backend = await _backend.Value.ConfigureAwait(false);
            await backend.CloseAsync().ConfigureAwait(false);
        }
    }

    public async ValueTask DisposeAsync() => await CloseAsync().ConfigureAwait(false);
}
