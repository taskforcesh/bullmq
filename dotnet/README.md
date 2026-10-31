# BullMQ for .NET

The official .NET port of [BullMQ](https://bullmq.io), the fast and robust
Redis- and PostgreSQL-based distributed queue.

This binding is **glue code** on top of the exact same Lua (Redis) and SQL
(PostgreSQL) scripts used by every other BullMQ runtime (Node.js, Python, PHP,
Elixir, Rust). Sharing the scripts is what guarantees identical, battle-tested
atomicity and semantics across languages: a queue produced by the Node.js
library can be consumed by a .NET worker and vice versa.

> Status: the database-agnostic **queue-backend contract is fully implemented
> for both Redis and PostgreSQL** and validated by a shared conformance suite
> (the exact same tests run against both adapters). The high-level `Queue`,
> `Worker` and `Job` classes run on **either backend** — select PostgreSQL by
> setting `Postgres` on the options. `FlowProducer`, `QueueEvents` and
> `JobScheduler` are also implemented.

## Requirements

- .NET 8.0 or newer
- A Redis 6.2+ server (or a compatible server such as Valkey/Dragonfly), **or**
  a PostgreSQL 13+ server when using the PostgreSQL backend

## Installation

```bash
dotnet add package BullMQ
```

## Quick start

```csharp
using BullMQ;

// Create a queue and add a job.
await using var queue = new Queue("emails", new QueueOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
});

await queue.AddAsync("welcome", new { to = "user@example.com" });

// Process jobs with a worker.
await using var worker = new Worker("emails", async (job, ct) =>
{
    Console.WriteLine($"Processing {job.Name} #{job.Id}");
    // ... do the work ...
    return "sent";
}, new WorkerOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
    Concurrency = 5,
});

worker.Completed += (job, result) =>
    Console.WriteLine($"Job {job.Id} completed with '{result}'");
```

### Sharing a connection

Pass an existing `IConnectionMultiplexer` to reuse a connection across queues and
workers (BullMQ will not dispose a connection it does not own):

```csharp
var mux = await StackExchange.Redis.ConnectionMultiplexer.ConnectAsync("localhost:6379");
var options = new QueueOptions
{
    Connection = new ConnectionOptions { Multiplexer = mux },
};
```

### Using PostgreSQL

Set `Postgres` on the options to run the exact same `Queue`/`Worker`/`Job` API
against PostgreSQL instead of Redis. The schema (default `bullmq`) namespaces all
queues and the required tables/functions are migrated automatically on first use.

```csharp
using BullMQ;
using BullMQ.Postgres;

var pg = new PostgresOptions
{
    ConnectionString = "Host=localhost;Database=bullmq;Username=postgres;Password=postgres",
    // Schema = "bullmq", // optional, this is the default
};

await using var queue = new Queue("emails", new QueueOptions { Postgres = pg });
await queue.AddAsync("welcome", new { to = "user@example.com" });

await using var worker = new Worker("emails", async (job, ct) => "sent",
    new WorkerOptions { Postgres = pg, Concurrency = 5 });
```

## Deduplication

Set `JobsOptions.Deduplication` to suppress jobs with the same identifier.
The same options work with Redis and PostgreSQL, single and bulk adds, and
`QueueOptions.DefaultJobOptions`.

```csharp
await queue.AddAsync("refresh", new { version = 1 }, new JobsOptions
{
    Delay = 5000,
    Deduplication = new DeduplicationOptions
    {
        Id = "refresh",
        Reschedule = true,
        Ttl = 10000,
        Extend = true,
    },
});
```

- **Simple:** only `Id`; suppress duplicates until completion or failure.
- **Throttle:** set `Ttl` in milliseconds to suppress duplicates for that window.
- **Extend:** refresh the TTL on duplicate adds.
- **Replace:** replace the existing delayed job with the incoming ID and payload.
- **Reschedule:** retain the delayed job's ID, name and payload, but apply the
  incoming delay relative to its timestamp. Omitted/zero delay makes it due.
  Non-delayed jobs are unchanged. TTL extension is independent; `Replace`
  takes precedence if both flags are enabled.
- **KeepLastIfActive:** retain only the latest successor payload while the
  winner is active; create it when that winner completes or fails. TTL is
  ignored and the key stays live for the job lifecycle.

A per-job deduplication object replaces the entire queue-default object.
Duplicate adds return the winning ID, but their returned object still describes
the incoming payload; use `queue.GetJobAsync(id)` to inspect stored job data.
This matches the reference BullMQ API.

```csharp
var winner = await queue.GetDeduplicationJobIdAsync("refresh");
await queue.RemoveDeduplicationKeyAsync("refresh"); // Unconditional removal.
if (winner is not null && await queue.GetJobAsync(winner) is { } job)
{
    await job.RemoveDeduplicationKeyAsync(); // Removes only if still the owner.
}
```

`QueueEvents.Deduplicated` exposes `DeduplicationId`, `JobId` and
`DeduplicatedJobId`. The event is also delivered to `EventReceived`. Rescheduling
additionally emits `Delayed`; replacement retains the scripts' `Removed` events.

Flow validation happens before any writes. **Deduplication is forbidden on all
nodes with children**, including root and nested parents. `Replace` must be
omitted in flows, and `KeepLastIfActive` cannot be enabled on nodes with a parent.
Eligible leaves support the other modes; standalone root leaves can also use
`KeepLastIfActive`.

Adding deduplication management extends `IQueueBackend` with winner lookup,
unconditional deletion and conditional owner deletion; custom backend
implementations must supply these operations.

## Development

The shared Lua scripts live at the repository root under `rawScripts/` and are
copied into `dotnet/src/BullMQ/Commands/` (embedded into the assembly) and, for
the PostgreSQL backend, `src/postgres/**` is copied into
`dotnet/src/BullMQ/Postgres/`. These copies are **generated** and git-ignored.

From the repository root:

```bash
# Populate the generated script copies (requires `yarn install` once).
yarn copy:lua:dotnet
yarn copy:sql:dotnet

# Build and test.
cd dotnet
dotnet build
dotnet test          # requires a Redis server on localhost:6379
```

Or just run the helper, which copies the shared scripts if needed, sets the
default test connections, and runs the suite (any arguments are passed straight
through to `dotnet test`):

```bash
cd dotnet
./scripts/test.sh                      # whole suite (Redis + PostgreSQL)
./scripts/test.sh --filter Name~Flow   # a subset
```

Set `BULLMQ_TEST_REDIS` and/or `BULLMQ_TEST_POSTGRES` to point the integration
tests at different servers.

## License

MIT — see [LICENSE](../LICENSE).
