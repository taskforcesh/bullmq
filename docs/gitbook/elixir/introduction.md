---
description: BullMQ for Elixir - Full-featured job queue with OTP design.
---

# Introduction

BullMQ for Elixir is a robust, feature-rich message queue and job scheduling library built on top of Redis. It's a port of the popular [BullMQ](https://bullmq.io) library, providing full compatibility with existing BullMQ queues from Node.js, Python, and PHP.

{% hint style="info" %}
The Elixir package is available on [Hex.pm](https://hex.pm/packages/bullmq). Full API documentation is available on [HexDocs](https://hexdocs.pm/bullmq).
{% endhint %}

## Features

- **High Performance**: Leverages Redis for fast, reliable message passing
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
- **Cross-language Compatibility**: Share queues between Elixir, Node.js, Python, and PHP

## Installation

Add BullMQ to your `mix.exs`:

```elixir
def deps do
  [
    {:bullmq, "~> 0.1.0"},
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
- Redis 6.0 or later (6.2+ recommended)
