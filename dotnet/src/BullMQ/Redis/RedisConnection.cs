using StackExchange.Redis;

namespace BullMQ.Redis;

/// <summary>
/// Owns (or borrows) a StackExchange.Redis connection and provides the single
/// entry point used by the Redis backend to execute the shared Lua commands.
///
/// When constructed from an <see cref="ConnectionOptions.Multiplexer"/> the
/// connection is treated as borrowed and is not disposed on <see cref="CloseAsync"/>.
/// </summary>
public sealed class RedisConnection : IAsyncDisposable
{
    private readonly bool _ownsConnection;
    private readonly int _database;

    public IConnectionMultiplexer Multiplexer { get; }

    /// <summary>The default database used for every command.</summary>
    public IDatabase Db => Multiplexer.GetDatabase(_database);

    private RedisConnection(IConnectionMultiplexer multiplexer, bool ownsConnection, int database)
    {
        Multiplexer = multiplexer;
        _ownsConnection = ownsConnection;
        _database = database;
    }

    /// <summary>Establishes (or reuses) a connection from the given options.</summary>
    public static async Task<RedisConnection> CreateAsync(ConnectionOptions options, bool blocking = false)
    {
        if (options.Multiplexer is not null)
        {
            return new RedisConnection(options.Multiplexer, ownsConnection: false, options.Database);
        }

        var config = options.Configuration ?? BuildConfiguration(options);
        if (blocking)
        {
            // A dedicated blocking connection issues BZPOPMIN with a server-side
            // timeout, so the client must not time out before the server does.
            config.SyncTimeout = Math.Max(config.SyncTimeout, 60000);
            config.AsyncTimeout = Math.Max(config.AsyncTimeout, 60000);
        }

        var multiplexer = await ConnectionMultiplexer.ConnectAsync(config).ConfigureAwait(false);
        return new RedisConnection(multiplexer, ownsConnection: true, options.Database);
    }

    private static ConfigurationOptions BuildConfiguration(ConnectionOptions options)
    {
        if (string.IsNullOrWhiteSpace(options.ConnectionString))
        {
            throw new ArgumentException(
                "ConnectionOptions requires either a Multiplexer, Configuration or ConnectionString.");
        }

        var config = ConfigurationOptions.Parse(options.ConnectionString);
        config.AbortOnConnectFail = false;
        return config;
    }

    /// <summary>Pings the server to confirm the connection is ready.</summary>
    public Task WaitUntilReadyAsync() => Db.PingAsync();

    /// <summary>Sets a human-readable client name on the underlying connection.</summary>
    public async Task SetClientNameAsync(string name)
    {
        foreach (var endpoint in Multiplexer.GetEndPoints())
        {
            var server = Multiplexer.GetServer(endpoint);
            if (server.IsConnected && !server.IsReplica)
            {
                await server.ExecuteAsync("CLIENT", "SETNAME", name).ConfigureAwait(false);
            }
        }
    }

    /// <summary>
    /// Evaluates a shared Lua command by name, letting StackExchange.Redis cache
    /// the script hash and transparently fall back from <c>EVALSHA</c> to
    /// <c>EVAL</c>.
    /// </summary>
    public Task<RedisResult> EvalAsync(string command, RedisKey[] keys, RedisValue[] args)
    {
        var script = LuaScripts.Get(command);
        return Db.ScriptEvaluateAsync(script.Content, keys, args);
    }

    /// <summary>Closes the connection, disposing it only when owned.</summary>
    public async Task CloseAsync()
    {
        if (_ownsConnection)
        {
            await Multiplexer.CloseAsync().ConfigureAwait(false);
            Multiplexer.Dispose();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_ownsConnection)
        {
            await CloseAsync().ConfigureAwait(false);
        }
    }
}
