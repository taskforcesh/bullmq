using StackExchange.Redis;

namespace BullMQ;

/// <summary>
/// How to connect to Redis. Provide either a connection string / configuration,
/// or an already-connected <see cref="IConnectionMultiplexer"/> to share it
/// across queues and workers.
/// </summary>
public sealed class ConnectionOptions
{
    /// <summary>
    /// A StackExchange.Redis connection string (e.g. <c>"localhost:6379"</c>) or
    /// full configuration string. Ignored when <see cref="Multiplexer"/> is set.
    /// </summary>
    public string? ConnectionString { get; set; }

    /// <summary>Parsed configuration. Ignored when <see cref="Multiplexer"/> is set.</summary>
    public ConfigurationOptions? Configuration { get; set; }

    /// <summary>
    /// An existing multiplexer to reuse. When provided, the queue/worker does not
    /// own the connection and will not dispose it on close.
    /// </summary>
    public IConnectionMultiplexer? Multiplexer { get; set; }

    /// <summary>Logical Redis database index to use.</summary>
    public int Database { get; set; } = -1;

    public static ConnectionOptions FromString(string connectionString) =>
        new() { ConnectionString = connectionString };
}

/// <summary>Options shared by every high-level class.</summary>
public class QueueBaseOptions
{
    /// <summary>Connection settings for the Redis backend (the default backend).</summary>
    public ConnectionOptions Connection { get; set; } = new();

    /// <summary>Redis key prefix. Defaults to <c>"bull"</c>.</summary>
    public string Prefix { get; set; } = "bull";

    /// <summary>
    /// PostgreSQL backend settings. When set, the queue/worker uses the
    /// PostgreSQL backend instead of Redis, and <see cref="Connection"/> is
    /// ignored.
    /// </summary>
    public Postgres.PostgresOptions? Postgres { get; set; }
}

/// <summary>Options for a <see cref="Queue"/>.</summary>
public sealed class QueueOptions : QueueBaseOptions
{
    /// <summary>Default options merged into every job added to this queue.</summary>
    public JobsOptions? DefaultJobOptions { get; set; }

    /// <summary>When true, the queue meta hash is not written on startup.</summary>
    public bool SkipMetasUpdate { get; set; }
}

/// <summary>Options for a <see cref="Worker"/>.</summary>
public sealed class WorkerOptions : QueueBaseOptions
{
    /// <summary>Maximum number of jobs processed concurrently. Defaults to 1.</summary>
    public int Concurrency { get; set; } = 1;

    /// <summary>Lock duration in milliseconds for a job being processed.</summary>
    public int LockDuration { get; set; } = 30000;

    /// <summary>How often (ms) to renew the lock. Defaults to half of <see cref="LockDuration"/>.</summary>
    public int? LockRenewTime { get; set; }

    /// <summary>Seconds the worker blocks waiting for a job before looping. Defaults to 5.</summary>
    public int DrainDelay { get; set; } = 5;

    /// <summary>Optional human-readable worker name (used for observability).</summary>
    public string? Name { get; set; }

    /// <summary>When true (default) the worker starts processing immediately.</summary>
    public bool Autorun { get; set; } = true;

    /// <summary>Max number of times a job can be recovered from stalled before failing. Default 1.</summary>
    public int MaxStalledCount { get; set; } = 1;

    /// <summary>How often (ms) to run the stalled-job check. Default 30000.</summary>
    public int StalledInterval { get; set; } = 30000;

    /// <summary>Disable the stalled-job checker.</summary>
    public bool SkipStalledCheck { get; set; }

    /// <summary>Disable periodic lock renewal.</summary>
    public bool SkipLockRenewal { get; set; }
}

/// <summary>Options for a <see cref="QueueEvents"/> listener.</summary>
public sealed class QueueEventsOptions : QueueBaseOptions
{
    /// <summary>When true (default) the listener starts consuming events immediately.</summary>
    public bool Autorun { get; set; } = true;

    /// <summary>
    /// Cursor to start from. Defaults to <c>"$"</c> (only events produced after
    /// the listener starts). Provide a known event id to resume from it.
    /// </summary>
    public string? LastEventId { get; set; }

    /// <summary>Timeout in milliseconds for each blocking read of the event stream. Default 10000.</summary>
    public int BlockingTimeout { get; set; } = 10000;
}

/// <summary>Backoff configuration for retrying failed jobs.</summary>
public sealed class BackoffOptions
{
    /// <summary>Strategy type (e.g. <c>"fixed"</c>, <c>"exponential"</c>).</summary>
    public string Type { get; set; } = "fixed";

    /// <summary>Base delay in milliseconds.</summary>
    public long Delay { get; set; }
}

/// <summary>Options that control how a single job is added and processed.</summary>
public sealed class JobsOptions
{
    /// <summary>Optional explicit job id. Cannot be <c>"0"</c> or start with <c>"0:"</c>.</summary>
    public string? JobId { get; set; }

    /// <summary>Delay in milliseconds before the job becomes available.</summary>
    public long? Delay { get; set; }

    /// <summary>Job priority (1 = highest). 0 (or null) means no priority.</summary>
    public int? Priority { get; set; }

    /// <summary>Number of total attempts to run the job until it completes.</summary>
    public int? Attempts { get; set; }

    /// <summary>Backoff setting for automatic retries.</summary>
    public BackoffOptions? Backoff { get; set; }

    /// <summary>When true the job is added to the right of the wait list (LIFO).</summary>
    public bool? Lifo { get; set; }

    /// <summary>Creation timestamp (ms since epoch). Defaults to now.</summary>
    public long? Timestamp { get; set; }

    /// <summary>
    /// Remove the job when it completes: <c>true</c> to remove, a number to keep
    /// that many, or a <see cref="KeepJobs"/> policy.
    /// </summary>
    public object? RemoveOnComplete { get; set; }

    /// <summary>Remove the job when it fails. Same shape as <see cref="RemoveOnComplete"/>.</summary>
    public object? RemoveOnFail { get; set; }

    /// <summary>Maximum number of log entries to keep for the job (0 = unlimited).</summary>
    public int? KeepLogs { get; set; }

    /// <summary>Creates a shallow copy of these options.</summary>
    public JobsOptions Clone() => (JobsOptions)MemberwiseClone();
}

/// <summary>Policy for keeping completed/failed jobs.</summary>
public sealed class KeepJobs
{
    /// <summary>Maximum number of jobs to keep.</summary>
    public int? Count { get; set; }

    /// <summary>Maximum age in seconds of jobs to keep.</summary>
    public int? Age { get; set; }
}
