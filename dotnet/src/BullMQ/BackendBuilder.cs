namespace BullMQ;

/// <summary>
/// Builds the appropriate <see cref="IQueueBackend"/> for a queue/worker based on
/// its options: the PostgreSQL backend when
/// <see cref="QueueBaseOptions.Postgres"/> is set, otherwise the Redis backend.
///
/// This is the single place where the high-level classes (<see cref="Queue"/>,
/// <see cref="Worker"/>) select a datastore, so everything else depends only on
/// the <see cref="IQueueBackend"/> abstraction.
/// </summary>
internal static class BackendBuilder
{
    public static async Task<IQueueBackend> CreateAsync(
        string name,
        QueueBaseOptions options,
        int lockDuration = 0,
        string? workerName = null,
        bool withBlockingConnection = false)
    {
        if (options.Postgres is not null)
        {
            return PostgresBackend.Create(name, options.Postgres, lockDuration, workerName);
        }

        return await RedisBackend
            .CreateAsync(name, options, lockDuration, workerName, withBlockingConnection)
            .ConfigureAwait(false);
    }
}
