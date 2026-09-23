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
