---
description: BullMQ is available as a native .NET package, running on Redis™ or PostgreSQL.
---

# Introduction

BullMQ for .NET is the official .NET port of BullMQ. It is built on top of the exact same Lua (Redis™) and SQL (PostgreSQL) scripts used by every other BullMQ SDK, which guarantees identical atomicity and semantics across languages: a queue produced by the Node.js library can be consumed by a .NET worker and vice versa.

The package provides the `Queue`, `Worker`, `Job`, `QueueEvents`, `FlowProducer` and job scheduler APIs, and all of them can run on either the Redis or the PostgreSQL backend.

## Installation

BullMQ is delivered as a [NuGet package](https://www.nuget.org/packages/BullMQ):

```bash
dotnet add package BullMQ
```

BullMQ for .NET requires:

- .NET 8.0 or newer
- Redis 6.2 or newer (or a compatible server such as Valkey or Dragonfly), **or** PostgreSQL 13 or newer when using the PostgreSQL backend

## Get started

### Adding jobs to a queue

```csharp
using BullMQ;

await using var queue = new Queue("emails", new QueueOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
});

await queue.AddAsync("welcome", new { to = "user@example.com" });

// Jobs can be customized with options such as delays, priorities or retries.
await queue.AddAsync("reminder", new { to = "user@example.com" }, new JobsOptions
{
    Delay = 60_000,
    Attempts = 3,
    Backoff = new BackoffOptions { Type = "exponential", Delay = 1000 },
});
```

### Processing jobs

Workers start consuming jobs as soon as they are created. The processor receives the job and a `CancellationToken`, and the value it returns is stored as the job's return value:

```csharp
using BullMQ;

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

worker.Failed += (job, error) =>
    Console.WriteLine($"Job {job?.Id} failed with {error.Message}");
```

### Listening to queue events

Use `QueueEvents` to listen to the events produced by all the workers of a queue, from any process:

```csharp
await using var queueEvents = new QueueEvents("emails", new QueueEventsOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
});

queueEvents.Completed += e =>
    Console.WriteLine($"Job {e.JobId} completed with {e.ReturnValue}");
```

### Job schedulers

Repeatable jobs are created with job schedulers, using either a cron pattern or a fixed interval:

```csharp
await queue.UpsertJobSchedulerAsync("daily-report", new RepeatOptions
{
    Pattern = "0 8 * * *",
});
```

### Sharing a connection

Pass an existing `IConnectionMultiplexer` to reuse a connection across queues and workers. BullMQ will not dispose a connection it does not own:

```csharp
var mux = await StackExchange.Redis.ConnectionMultiplexer.ConnectAsync("localhost:6379");

var options = new QueueOptions
{
    Connection = new ConnectionOptions { Multiplexer = mux },
};
```

## PostgreSQL backend

Set `Postgres` on the options to run the exact same API against PostgreSQL instead of Redis. All BullMQ objects live in a dedicated schema (`bullmq` by default), and the required tables and functions are migrated automatically on first use:

```csharp
using BullMQ;
using BullMQ.Postgres;

var pg = new PostgresOptions
{
    ConnectionString = "Host=localhost;Database=mydb;Username=postgres;Password=postgres",
    // Schema = "bullmq", // optional, this is the default
};

await using var queue = new Queue("emails", new QueueOptions { Postgres = pg });
await queue.AddAsync("welcome", new { to = "user@example.com" });

await using var worker = new Worker("emails", async (job, ct) => "sent",
    new WorkerOptions { Postgres = pg, Concurrency = 5 });
```

Read more about how this backend works in the [PostgreSQL backend](../guide/postgresql.md) section of the guide.

## Interoperability

Queues created with the .NET package are fully interoperable with the other BullMQ SDKs ([Node.js](../quick-start.md), [Python](../python/introduction.md), [Elixir](../elixir/introduction.md), [Rust](../rust/introduction.md) and [PHP](../php/introduction.md)) as long as they use the same backend and prefix (Redis) or schema (PostgreSQL).

For more details, see the [.NET README](https://github.com/taskforcesh/bullmq/tree/master/dotnet) on GitHub.
