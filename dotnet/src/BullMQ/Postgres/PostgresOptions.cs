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
}
