namespace BullMQ.Postgres;

/// <summary>
/// Options for the PostgreSQL backend. The connection-level <see cref="Schema"/>
/// is the namespace for all queues (the SQL-native replacement for the Redis key
/// prefix); it is pinned on the connection's <c>search_path</c> so the shared
/// <c>.sql</c> files reference unqualified, portable names.
/// </summary>
public sealed class PostgresOptions
{
    /// <summary>An Npgsql connection string (e.g. <c>"Host=localhost;Database=bullmq_test"</c>).</summary>
    public string ConnectionString { get; set; } = string.Empty;

    /// <summary>The schema that namespaces all queues. Defaults to <c>"bullmq"</c>.</summary>
    public string Schema { get; set; } = "bullmq";

    /// <summary>Skip the minimum PostgreSQL server version check on startup.</summary>
    public bool SkipVersionCheck { get; set; }

    /// <summary>
    /// The <see cref="PoolSize"/> used when neither it nor the connection string
    /// sets one. Larger than node-postgres' per-pool default (10) because this
    /// pool is shared by the whole process rather than owned by each
    /// queue/worker, yet well below Npgsql's 100: past ~20 connections, extra
    /// sessions mostly add lock contention on a queue's hot rows.
    /// </summary>
    public const int DefaultPoolSize = 20;

    /// <summary>
    /// Maximum number of pooled connections used for regular queries (Npgsql's
    /// <c>Maximum Pool Size</c>). The pool is shared by every queue, worker,
    /// queue-events and flow producer in the process that uses the same
    /// connection string, schema and pool size; each worker / queue-events
    /// listener additionally holds its own dedicated <c>LISTEN</c> connection
    /// outside the pool. When null, a <c>Maximum Pool Size</c> given in
    /// <see cref="ConnectionString"/> is used, otherwise
    /// <see cref="DefaultPoolSize"/>. Other pool settings in the connection string
    /// (e.g. <c>Minimum Pool Size</c>, <c>Pooling=false</c>) are respected.
    /// Returned sessions are not reset (<c>No Reset On Close</c> defaults to
    /// true, preserving the server's cached plans) unless the connection string
    /// sets it.
    /// </summary>
    public int? PoolSize { get; set; }
}
