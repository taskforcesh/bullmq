# BullMQ for Elixir

[![Hex.pm](https://img.shields.io/hexpm/v/bullmq.svg)](https://hex.pm/packages/bullmq)
[![Hex.pm](https://img.shields.io/hexpm/dt/bullmq.svg)](https://hex.pm/packages/bullmq)
[![Documentation](https://img.shields.io/badge/docs-hexpm-blue.svg)](https://hexdocs.pm/bullmq)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/taskforcesh/bullmq/blob/master/LICENSE)

A powerful, fast, and robust job queue for Elixir backed by Redis. This is an Elixir port of the popular [BullMQ](https://bullmq.io) library for Node.js, providing full compatibility with existing BullMQ queues.

## Features

- ⚡ **High Performance** - Built on Redis for speed and reliability
- 🔄 **Automatic Retries** - Configurable retry strategies with exponential backoff
- ⏰ **Job Scheduling** - Delay jobs or schedule them with cron expressions
- 📊 **Priority Queues** - Process important jobs first
- 🚦 **Rate Limiting** - Control processing rates
- 👨‍👩‍👧‍👦 **Parent-Child Jobs** - Create complex workflows with dependencies
- 📡 **Real-time Events** - Subscribe to job lifecycle events via Worker callbacks or QueueEvents
- 🔒 **Reliable** - Stalled job detection and recovery
- 📈 **Observable** - Built-in Telemetry integration
- 🏗️ **OTP Native** - Built with GenServers and Supervisors
- 🔄 **Node.js Compatible** - Jobs can be shared between Elixir and Node.js workers

## Installation

Add `bullmq` to your list of dependencies in `mix.exs`:

```elixir
def deps do
  [
    {:bullmq, "~> 1.0"}
  ]
end
```

## Quick Start

### 1. Add Jobs to a Queue

```elixir
# Add a job using stateless API (recommended for most use cases)
{:ok, job} = BullMQ.Queue.add("emails", "send-welcome", %{
  to: "user@example.com",
  template: "welcome"
}, connection: :my_redis)

# Add a delayed job
{:ok, job} = BullMQ.Queue.add("emails", "reminder", %{message: "Don't forget!"},
  connection: :my_redis,
  delay: 60_000  # 1 minute
)

# Add a prioritized job
{:ok, job} = BullMQ.Queue.add("emails", "urgent", %{},
  connection: :my_redis,
  priority: 1  # Lower = higher priority
)
```

### 2. Process Jobs with a Worker

```elixir
defmodule MyApp.EmailWorker do
  def process(%BullMQ.Job{name: "send-welcome", data: data}) do
    MyApp.Mailer.send_welcome(data["to"], data["template"])
    {:ok, %{sent: true}}
  end

  def process(%BullMQ.Job{name: name}) do
    {:error, "Unknown job type: #{name}"}
  end
end

# Start a worker with event callbacks
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "emails",
  connection: :my_redis,
  processor: &MyApp.EmailWorker.process/1,
  concurrency: 5,
  on_completed: fn job, result ->
    IO.puts("Job #{job.id} completed with #{inspect(result)}")
  end,
  on_failed: fn job, reason ->
    IO.puts("Job #{job.id} failed: #{reason}")
  end
)
```

### 3. Add to Your Supervision Tree

```elixir
defmodule MyApp.Application do
  use Application

  def start(_type, _args) do
    children = [
      # Start Redis connection
      {Redix, name: :my_redis, host: "localhost", port: 6379},

      # Start email worker
      {BullMQ.Worker,
        queue: "emails",
        connection: :my_redis,
        processor: &MyApp.EmailWorker.process/1,
        concurrency: 5
      }
    ]

    Supervisor.start_link(children, strategy: :one_for_one)
  end
end
```

## Advanced Features

### Job Options

```elixir
BullMQ.Queue.add("tasks", "process-data", %{data: "..."},
  connection: :my_redis,
  priority: 1,              # Lower = higher priority
  delay: 60_000,            # Delay 60 seconds
  attempts: 5,              # Retry up to 5 times
  backoff: %{
    type: "exponential",
    delay: 1000
  },
  remove_on_complete: true, # Clean up after completion
  remove_on_fail: 100       # Keep last 100 failed jobs
)
```

### Worker Event Callbacks

Workers support event callbacks similar to Node.js:

```elixir
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "tasks",
  connection: :my_redis,
  processor: &process/1,
  on_completed: fn job, result -> handle_completion(job, result) end,
  on_failed: fn job, reason -> handle_failure(job, reason) end,
  on_active: fn job -> handle_active(job) end,
  on_stalled: fn job_id -> handle_stalled(job_id) end
)
```

### Queue Events (Real-time Subscriptions)

Subscribe to queue-level events using Redis Streams:

```elixir
{:ok, events} = BullMQ.QueueEvents.start_link(
  queue: "tasks",
  connection: :my_redis
)

BullMQ.QueueEvents.subscribe(events)

receive do
  {:bullmq_event, :completed, %{"jobId" => id}} ->
    IO.puts("Job #{id} completed!")
  {:bullmq_event, :failed, %{"jobId" => id, "failedReason" => reason}} ->
    IO.puts("Job #{id} failed: #{reason}")
end
```

### Rate Limiting

```elixir
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "api-calls",
  connection: :my_redis,
  processor: &process/1,
  limiter: %{max: 100, duration: 60_000}  # 100 per minute
)
```

### Job Schedulers (Repeatable Jobs)

```elixir
# Create a scheduler with cron pattern
{:ok, job} = BullMQ.JobScheduler.upsert(:my_redis, "maintenance", "cleanup",
  %{pattern: "0 * * * *"},  # Every hour
  "cleanup-job",
  %{type: "hourly"},
  prefix: "bull"
)

# Create an interval-based scheduler
{:ok, job} = BullMQ.JobScheduler.upsert(:my_redis, "heartbeats", "ping",
  %{every: 60_000},  # Every minute
  "heartbeat",
  %{},
  prefix: "bull"
)

# List schedulers
{:ok, schedulers} = BullMQ.JobScheduler.list(:my_redis, "maintenance", prefix: "bull")

# Remove a scheduler
{:ok, removed} = BullMQ.JobScheduler.remove(:my_redis, "maintenance", "cleanup", prefix: "bull")
```

### Job Progress

```elixir
def process(%BullMQ.Job{} = job) do
  Enum.each(1..100, fn i ->
    do_work(i)
    BullMQ.Worker.update_progress(job, i)
  end)

  {:ok, "done"}
end
```

### Queue Getters

```elixir
# Get job counts
{:ok, counts} = BullMQ.Queue.get_counts("emails", connection: :my_redis)
# => %{waiting: 10, active: 2, delayed: 5, completed: 100, failed: 3, ...}

# Get jobs in a specific state
{:ok, jobs} = BullMQ.Queue.get_jobs("emails", [:waiting, :delayed],
  connection: :my_redis, start: 0, end: 9)

# Get a specific job
{:ok, job} = BullMQ.Queue.get_job("emails", "job-id-123", connection: :my_redis)

# Get job state
{:ok, state} = BullMQ.Queue.get_job_state("emails", "job-id-123", connection: :my_redis)
# => :waiting | :active | :delayed | :completed | :failed
```

### Queue Operations

```elixir
# Pause the queue
:ok = BullMQ.Queue.pause("emails", connection: :my_redis)

# Resume the queue
:ok = BullMQ.Queue.resume("emails", connection: :my_redis)

# Check if paused
{:ok, is_paused} = BullMQ.Queue.paused?("emails", connection: :my_redis)

# Drain the queue (remove all waiting jobs)
:ok = BullMQ.Queue.drain("emails", connection: :my_redis)

# Remove a specific job
:ok = BullMQ.Queue.remove_job("emails", "job-id-123", connection: :my_redis)

# Retry a failed job
:ok = BullMQ.Queue.retry_job("emails", "job-id-123", connection: :my_redis)
```

### Graceful Shutdown

Workers automatically wait for active jobs to complete when closing:

```elixir
# Close worker and wait for active jobs to finish
:ok = BullMQ.Worker.close(worker)

# Force close without waiting
:ok = BullMQ.Worker.close(worker, force: true)
```

## Documentation

Full documentation is available at [HexDocs](https://hexdocs.pm/bullmq).

- [Getting Started](https://hexdocs.pm/bullmq/getting_started.html)
- [Workers](https://hexdocs.pm/bullmq/workers.html)
- [Job Options](https://hexdocs.pm/bullmq/job_options.html)
- [Queue Events](https://hexdocs.pm/bullmq/queue_events.html)
- [Rate Limiting](https://hexdocs.pm/bullmq/rate_limiting.html)
- [Job Schedulers](https://hexdocs.pm/bullmq/job_schedulers.html)
- [Telemetry](https://hexdocs.pm/bullmq/telemetry.html)

## Requirements

- Elixir 1.15+
- Erlang/OTP 26+
- Redis 6.0+

## Compatibility

This library is fully compatible with the Node.js BullMQ library. Jobs can be added from Node.js and processed by Elixir workers, and vice versa. They share the same Redis data structures and Lua scripts.

## License

MIT License - see [LICENSE](https://github.com/taskforcesh/bullmq/blob/master/LICENSE) for details.

## Contributing

Contributions are welcome! Please see our [Contributing Guide](https://github.com/taskforcesh/bullmq/blob/master/contributing.md).

### Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/) with automated releases via semantic-release. For Elixir-specific changes, add `[elixir]` tag to your commit message:

```bash
# Bug fix (patch release: 0.0.x)
git commit -m "fix(worker): handle job timeout correctly [elixir]"

# New feature (minor release: 0.x.0)
git commit -m "feat(queue): add bulk job operations [elixir]"

# Breaking change (major release: x.0.0)
git commit -m "feat(worker)!: change processor callback signature [elixir]"
```

| Commit Type                | Version Bump | Example                                     |
| -------------------------- | ------------ | ------------------------------------------- |
| `fix(...): ... [elixir]`   | Patch        | `fix(scripts): correct ARGV order [elixir]` |
| `feat(...): ... [elixir]`  | Minor        | `feat(queue): add getJobCounts [elixir]`    |
| `feat(...)!: ... [elixir]` | Major        | `feat(worker)!: new API [elixir]`           |
| `docs(...): ... [elixir]`  | None         | `docs(readme): update examples [elixir]`    |
| `chore(...): ... [elixir]` | None         | `chore(deps): update redix [elixir]`        |

## Credits

This is an Elixir port of [BullMQ](https://bullmq.io) by [Taskforce.sh](https://taskforce.sh).
