---
description: BullMQ for Elixir - Full-featured job queue with OTP design.
---

# Introduction

BullMQ for Elixir is a robust, feature-rich message queue and job scheduling library that runs on top of Redis™ or PostgreSQL. It's a port of the popular [BullMQ](https://bullmq.io) library, providing full compatibility with existing BullMQ queues from Node.js, Python, .NET, Rust and PHP.

{% hint style="info" %}
The Elixir package is available on [Hex.pm](https://hex.pm/packages/bullmq). Full API documentation is available on [HexDocs](https://hexdocs.pm/bullmq).
{% endhint %}

## Features

- **High Performance**: Optimized backends for Redis and PostgreSQL
- **Job Scheduling**: Schedule jobs to run at specific times or intervals
- **Priority Queues**: Process high-priority jobs first
- **Retry Strategies**: Automatic retries with configurable backoff
- **Rate Limiting**: Control job processing rates
- **Parent-Child Jobs**: Create complex job hierarchies with dependencies
- **Real-time Events**: Subscribe to job lifecycle events via Worker callbacks or QueueEvents
- **Concurrency Control**: Process multiple jobs simultaneously with true BEAM parallelism
- **Stalled Job Recovery**: Automatically recover jobs from crashed workers
- **Telemetry Integration**: Built-in observability with Telemetry
- **OTP Design**: Built using GenServers, Supervisors, and other OTP patterns
- **Pluggable Backends**: Run the same API on Redis or PostgreSQL
- **Cross-language Compatibility**: Share queues between Elixir, Node.js, Python, .NET, Rust and PHP

## Installation

Add BullMQ to your `mix.exs`:

```elixir
def deps do
  [
    {:bullmq, "~> 2.3"},
    {:redix, "~> 1.2"}  # Redis client
  ]
end
```

Then run:

```bash
mix deps.get
```

## Quick Start

### Setting Up Redis Connection

Add a Redix connection to your supervision tree:

```elixir
defmodule MyApp.Application do
  use Application

  def start(_type, _args) do
    children = [
      {Redix, name: :my_redis, host: "localhost", port: 6379}
    ]

    Supervisor.start_link(children, strategy: :one_for_one)
  end
end
```

### Adding Jobs

```elixir
# Add a job to a queue
{:ok, job} = BullMQ.Queue.add("emails", "send-welcome", %{
  to: "user@example.com",
  template: "welcome"
}, connection: :my_redis)

IO.puts("Created job: #{job.id}")
```

### Processing Jobs

```elixir
defmodule MyApp.EmailWorker do
  def process(%BullMQ.Job{name: "send-welcome", data: data}) do
    MyApp.Mailer.send_welcome(data["to"], data["template"])
    {:ok, %{sent: true}}
  end
end

# Start the worker
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "emails",
  connection: :my_redis,
  processor: &MyApp.EmailWorker.process/1,
  concurrency: 5,
  on_completed: fn job, result ->
    Logger.info("Job #{job.id} completed")
  end
)
```

## PostgreSQL Backend

The high-level modules (`Queue`, `Worker`, `Job`, `QueueEvents`, `FlowProducer` and `JobScheduler`) are backend agnostic. To use PostgreSQL instead of Redis, add [Postgrex](https://hex.pm/packages/postgrex) to your dependencies:

```elixir
def deps do
  [
    {:bullmq, "~> 2.3"},
    {:postgrex, "~> 0.22"}
  ]
end
```

Start a PostgreSQL connection in your supervision tree. The required tables and functions are migrated automatically when the connection starts:

```elixir
children = [
  {BullMQ.Backends.Postgres.Connection,
   name: :my_pg, url: "postgresql://localhost:5432/mydb", schema: "bullmq"}
]
```

Then select the backend per call, or globally with `config :bullmq, :backend, BullMQ.Backends.Postgres`:

```elixir
{:ok, job} =
  BullMQ.Queue.add("emails", "send-welcome", %{to: "user@example.com"},
    connection: :my_pg,
    backend: BullMQ.Backends.Postgres
  )

{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: "emails",
    connection: :my_pg,
    backend: BullMQ.Backends.Postgres,
    processor: &MyApp.EmailWorker.process/1
  )
```

Read more about how this backend works in the [PostgreSQL backend](../guide/postgresql.md) section of the guide.

## Architecture

BullMQ for Elixir leverages OTP patterns for reliability:

- **GenServer** for stateful components (Worker, QueueEvents)
- **Supervisor** for fault tolerance
- **Telemetry** for observability
- **True Parallelism** using multiple BEAM processes for concurrent job processing

## Documentation

For comprehensive documentation, see:

- [HexDocs - Full API Reference](https://hexdocs.pm/bullmq)
- [Getting Started Guide](https://hexdocs.pm/bullmq/getting_started.html)
- [Workers Guide](https://hexdocs.pm/bullmq/workers.html)
- [Job Options](https://hexdocs.pm/bullmq/job_options.html)
- [Rate Limiting](https://hexdocs.pm/bullmq/rate_limiting.html)
- [Telemetry](https://hexdocs.pm/bullmq/telemetry.html)

## Requirements

- Elixir 1.15 or later
- Erlang/OTP 26 or later
- Redis 6.0 or later (6.2+ recommended), or PostgreSQL 13 or later when using the PostgreSQL backend
