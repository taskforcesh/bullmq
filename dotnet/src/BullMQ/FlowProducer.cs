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

/// <summary>Options for <see cref="FlowProducer.GetFlowAsync"/>.</summary>
public sealed class GetFlowOptions
{
    /// <summary>The id of the root job of the tree.</summary>
    public required string Id { get; set; }

    /// <summary>The queue of the root job.</summary>
    public required string QueueName { get; set; }

    /// <summary>Key prefix of the root job's queue (defaults to the producer's prefix).</summary>
    public string? Prefix { get; set; }

    /// <summary>Maximum depth of the returned tree (the root counts as 1). Default 10.</summary>
    public int Depth { get; set; } = 10;

    /// <summary>
    /// Maximum number of children fetched per category (processed, unprocessed,
    /// failed and ignored) for each node. Default 20.
    /// </summary>
    public int MaxChildren { get; set; } = 20;
}

/// <summary>
/// A node of a job tree: the job and its children. Returned by
/// <see cref="FlowProducer.AddAsync"/> and <see cref="FlowProducer.GetFlowAsync"/>.
/// </summary>
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
        // The root can have a parent outside the flow (Opts.Parent)
        ValidateDeduplication(flow, hasParent: flow.Opts?.Parent is not null);
        var backend = await _backend.Value.ConfigureAwait(false);
        await backend.WaitUntilReadyAsync().ConfigureAwait(false);

        var entries = new List<FlowJobEntry>();
        var tree = AddNode(backend, flow, parent: null, entries);
        await backend.AddFlowAsync(entries).ConfigureAwait(false);
        return tree;
    }

    private static void ValidateDeduplication(FlowJob node, bool hasParent)
    {
        if (node.Opts is { } opts)
        {
            // Child failure policies; deduplication is checked below, with
            // the flow-specific messages
            Job.ValidateOptions(opts, hasParent: false);
        }

        if (node.Opts?.Deduplication is { } dedup)
        {
            if (node.Children is { Count: > 0 })
            {
                throw new ArgumentException("Deduplication cannot be used on flow nodes with children");
            }
            if (dedup.Replace.HasValue)
            {
                throw new ArgumentException("Replace deduplication cannot be used in flows");
            }
            if (hasParent)
            {
                throw new ArgumentException("Deduplication cannot be used on flow nodes with a parent");
            }
        }
        if (node.Children is { } children)
        {
            foreach (var child in children)
            {
                ValidateDeduplication(child, hasParent: true);
            }
        }
    }

    private FlowJobNode AddNode(
        IQueueBackend backend,
        FlowJob node,
        (string Id, string QueueKey)? parent,
        List<FlowJobEntry> entries)
    {
        var prefix = node.Prefix ?? _prefix;
        var queueBackend = backend.ForQueue(node.QueueName, prefix);
        var opts = node.Opts ?? new JobsOptions();
        var jobId = opts.JobId ?? Guid.NewGuid().ToString("N");

        var job = new Job(queueBackend, node.QueueName, node.Name, node.Data, opts) { Id = jobId };
        if (parent is { } p)
        {
            // Stored parent uses `queueKey` (matching the reference Job, which
            // maps the public `parent.queue` option to `parent.queueKey`), plus
            // this child's failure flags (fpof/cpof/idof/rdof).
            job.Parent = Job.BuildParent(p.Id, p.QueueKey, opts);
            job.ParentKey = $"{p.QueueKey}:{p.Id}";
        }

        if (node.Children is { Count: > 0 })
        {
            entries.Add(new FlowJobEntry(job, node.QueueName, prefix, isParent: true));

            var childParent = (jobId, queueBackend.QualifiedName);

            var children = node.Children
                .Select(child => AddNode(backend, child, childParent, entries))
                .ToList();

            return new FlowJobNode { Job = job, Children = children };
        }

        entries.Add(new FlowJobEntry(job, node.QueueName, prefix, isParent: false));
        return new FlowJobNode { Job = job };
    }

    /// <summary>
    /// Returns the job tree rooted at the given job, with the children of each
    /// node (processed, unprocessed, failed and ignored) fetched recursively up
    /// to <see cref="GetFlowOptions.Depth"/> levels. Returns null when the root
    /// job does not exist.
    /// </summary>
    public async Task<FlowJobNode?> GetFlowAsync(GetFlowOptions opts)
    {
        ArgumentNullException.ThrowIfNull(opts);
        // Redis rejects a scan COUNT of 0 or less: read at least one child
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(opts.MaxChildren, nameof(opts.MaxChildren));
        var backend = await _backend.Value.ConfigureAwait(false);
        await backend.WaitUntilReadyAsync().ConfigureAwait(false);
        return await GetNodeAsync(
            backend, opts.QueueName, opts.Prefix ?? _prefix, opts.Id, opts.Depth, opts.MaxChildren)
            .ConfigureAwait(false);
    }

    private async Task<FlowJobNode?> GetNodeAsync(
        IQueueBackend backend, string queueName, string? prefix, string id, int depth, int maxChildren)
    {
        var queueBackend = backend.ForQueue(queueName, prefix);
        var job = await Job.FromIdAsync(queueBackend, queueName, id).ConfigureAwait(false);
        if (job is null)
        {
            return null;
        }

        var newDepth = depth - 1;
        if (newDepth <= 0)
        {
            return new FlowJobNode { Job = job };
        }

        var childKeys = await queueBackend.GetDependencyKeysAsync(id, maxChildren).ConfigureAwait(false);
        if (childKeys.Count == 0)
        {
            return new FlowJobNode { Job = job };
        }

        var children = await Task.WhenAll(childKeys.Select(key =>
        {
            var (childPrefix, childQueue, childId) = queueBackend.ParseNodeKey(key);
            return GetNodeAsync(backend, childQueue, childPrefix, childId, newDepth, maxChildren);
        })).ConfigureAwait(false);

        // A child removed after its key was read is skipped.
        return new FlowJobNode { Job = job, Children = children.OfType<FlowJobNode>().ToList() };
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
