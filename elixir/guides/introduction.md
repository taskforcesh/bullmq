# Introduction

BullMQ is a robust, feature-rich message queue and job scheduling library for Elixir, built on top of Redis. It's a port of the popular [BullMQ](https://bullmq.io) library from the Node.js ecosystem, providing full compatibility with existing BullMQ queues.

## Features

- **High Performance**: Leverages Redis for fast, reliable message passing
- **Job Scheduling**: Schedule jobs to run at specific times or intervals
- **Priority Queues**: Process high-priority jobs first
- **Retry Strategies**: Automatic retries with configurable backoff
- **Rate Limiting**: Control job processing rates
- **Parent-Child Jobs**: Create complex job hierarchies with dependencies
- **Real-time Events**: Subscribe to job lifecycle events via Worker callbacks or QueueEvents
- **Concurrency Control**: Process multiple jobs simultaneously
- **Stalled Job Recovery**: Automatically recover jobs from crashed workers
- **Telemetry Integration**: Built-in observability with Telemetry
- **OTP Design**: Built using GenServers, Supervisors, and other OTP patterns
- **Node.js Compatibility**: Share queues between Elixir and Node.js workers

## Quick Start

Add BullMQ to your dependencies:

```elixir
def deps do
  [
    {:bullmq, "~> 1.0"}
  ]
end
```

Add jobs to a queue:

```elixir
# Add a job (stateless API)
{:ok, job} = BullMQ.Queue.add("emails", "send-welcome", %{
  to: "user@example.com",
  template: "welcome"
}, connection: :my_redis)
```

Process jobs with a worker:

```elixir
defmodule MyApp.EmailWorker do
  def process(%BullMQ.Job{name: "send-welcome", data: data}) do
    MyApp.Mailer.send_welcome(data["to"], data["template"])
    {:ok, %{sent: true}}
  end
end

# Start the worker with event callbacks
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

BullMQ uses Redis data structures to implement a reliable, distributed job queue:

- **Lists** for FIFO job queues (waiting, active)
- **Sorted Sets** for priority queues, delayed jobs, and rate limiting
- **Hashes** for job data storage
- **Streams** for real-time event delivery
- **Lua Scripts** for atomic operations

The Elixir port leverages OTP patterns:

- **GenServer** for stateful components (Worker, QueueEvents)
- **Supervisor** for fault tolerance
- **Telemetry** for observability
- **True Parallelism** using multiple BEAM processes for concurrent job processing

### Lua Scripts

BullMQ relies heavily on Lua scripts for atomic Redis operations. All scripts are
automatically loaded into Redis's script cache when the connection starts, ensuring
the connection is fully ready for BullMQ operations before it's used.

Unlike Node.js BullMQ which uses ioredis's `defineCommand` to pre-register scripts
client-side, the Elixir version loads scripts via `SCRIPT LOAD` during initialization
and uses `EVALSHA` for execution. If Redis is restarted and loses its script cache,
the `EVALSHA` will automatically fall back to `EVAL`.

## API Design

BullMQ for Elixir provides both stateless and stateful APIs:

### Stateless API (Recommended)

Most queue operations work as simple function calls with a connection:

```elixir
# Add a job
{:ok, job} = BullMQ.Queue.add("my_queue", "job_name", %{data: "value"},
  connection: :my_redis)

# Get job counts
{:ok, counts} = BullMQ.Queue.get_counts("my_queue", connection: :my_redis)

# Pause queue
:ok = BullMQ.Queue.pause("my_queue", connection: :my_redis)
```

### Stateful API (GenServer)

Workers and QueueEvents run as supervised processes:

```elixir
# Worker as GenServer
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "my_queue",
  connection: :my_redis,
  processor: &process/1
)

# QueueEvents as GenServer
{:ok, events} = BullMQ.QueueEvents.start_link(
  queue: "my_queue",
  connection: :my_redis
)
```

## Connection Behavior

BullMQ follows idiomatic Erlang/OTP and Redix connection patterns:

- **Supervised** - Redis connections are supervised and automatically reconnect on TCP drops
- **Fail-fast** - Commands fail immediately if the connection is unavailable (no hidden retries)
- **Caller-controlled retries** - Workers handle job retries based on job configuration

This means transient Redis connection issues cause jobs to fail and be retried according
to their retry settings. See [Workers - Connection Error Handling](workers.md#connection-error-handling)
for details on configuring retry behavior for connection failures.

## Next Steps

- Read the [Getting Started](getting_started.md) guide
- Learn about [Workers](workers.md)
- Explore [Job Options](job_options.md)
- Understand [Queue Events](queue_events.md)
- Set up [Job Schedulers](job_schedulers.md)
- Configure [Rate Limiting](rate_limiting.md)
- Add [Telemetry](telemetry.md)
