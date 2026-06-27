# Getting Started

This guide walks you through setting up BullMQ in your Elixir application.

## Prerequisites

- Elixir 1.15 or later
- Erlang/OTP 26 or later
- Redis 6.0 or later

## Installation

Add BullMQ to your `mix.exs`:

```elixir
def deps do
  [
    {:bullmq, "~> 1.0"},
    {:redix, "~> 1.2"}  # Redis client
  ]
end
```

Then run:

```bash
mix deps.get
```

## Setting Up Redis Connection

BullMQ uses [Redix](https://hexdocs.pm/redix) for Redis connections. Add a Redix connection to your supervision tree:

```elixir
defmodule MyApp.Application do
  use Application

  def start(_type, _args) do
    children = [
      # Redis connection
      {Redix, name: :my_redis, host: "localhost", port: 6379}
    ]

    Supervisor.start_link(children, strategy: :one_for_one)
  end
end
```

For production with authentication:

```elixir
{Redix,
  name: :my_redis,
  host: System.get_env("REDIS_HOST", "localhost"),
  port: String.to_integer(System.get_env("REDIS_PORT", "6379")),
  password: System.get_env("REDIS_PASSWORD")
}
```

## Adding Your First Job

Jobs are added using the `BullMQ.Queue.add/4` function:

```elixir
# Add a simple job
{:ok, job} = BullMQ.Queue.add("notifications", "push-notification", %{
  user_id: 123,
  message: "You have a new message!"
}, connection: :my_redis)

IO.puts("Created job: #{job.id}")
# => Created job: 5f8a9b2c3d4e5f6a7b8c9d0e
```

The function takes:

1. Queue name (string)
2. Job name/type (string)
3. Job data (map)
4. Options (keyword list with `:connection` required)

## Creating Your First Worker

A worker processes jobs from a queue:

```elixir
defmodule MyApp.NotificationWorker do
  alias BullMQ.Job

  def process(%Job{name: "push-notification", data: data}) do
    user = MyApp.Users.get(data["user_id"])
    MyApp.PushService.send(user.device_token, data["message"])

    {:ok, %{sent: true}}
  end

  def process(%Job{name: name}) do
    {:error, "Unknown job type: #{name}"}
  end
end
```

Start the worker:

```elixir
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "notifications",
  connection: :my_redis,
  processor: &MyApp.NotificationWorker.process/1,
  concurrency: 10
)
```

## Complete Application Setup

Here's a complete supervision tree setup:

```elixir
defmodule MyApp.Application do
  use Application

  def start(_type, _args) do
    children = [
      # Redis connection
      {Redix, name: :my_redis, host: "localhost", port: 6379},

      # Notification worker
      {BullMQ.Worker,
        queue: "notifications",
        connection: :my_redis,
        processor: &MyApp.NotificationWorker.process/1,
        concurrency: 10,
        on_completed: fn job, result ->
          Logger.info("Job #{job.id} completed: #{inspect(result)}")
        end,
        on_failed: fn job, reason ->
          Logger.error("Job #{job.id} failed: #{reason}")
        end
      },

      # Email worker
      {BullMQ.Worker,
        queue: "emails",
        connection: :my_redis,
        processor: &MyApp.EmailWorker.process/1,
        concurrency: 5
      }
    ]

    opts = [strategy: :one_for_one, name: MyApp.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
```

## Job Lifecycle

Jobs go through several states:

1. **waiting** - Job is waiting to be picked up
2. **active** - Job is being processed
3. **completed** - Job finished successfully
4. **failed** - Job failed after all retries
5. **delayed** - Job is scheduled for future execution

```elixir
# Check job state
{:ok, state} = BullMQ.Queue.get_job_state("notifications", job.id,
  connection: :my_redis)

IO.puts("Job state: #{state}")
# => Job state: completed
```

## Processor Return Values

Your processor function should return one of:

```elixir
def process(job) do
  case do_work(job.data) do
    # Success with result - job moves to completed
    {:ok, result} ->
      {:ok, result}

    # Simple success
    :ok ->
      :ok

    # Failure - triggers retry if attempts remaining, otherwise moves to failed
    {:error, reason} ->
      {:error, reason}
  end
end

# Raising an exception also triggers retry (if attempts remaining)
def process(job) do
  if something_wrong?(job) do
    raise "Something went wrong"
  end
  :ok
end
```

Both `{:error, reason}` and raising exceptions trigger the same retry behavior.
See [Workers](workers.md) for more details on return values.

## Adding Jobs with Options

Customize job behavior with options:

```elixir
# Delayed job
BullMQ.Queue.add("emails", "send-reminder", %{user_id: 123},
  connection: :my_redis,
  delay: 60_000  # 1 minute delay
)

# Priority job
BullMQ.Queue.add("emails", "urgent-alert", %{},
  connection: :my_redis,
  priority: 1  # Lower = higher priority
)

# Job with retries
BullMQ.Queue.add("api-sync", "sync-data", %{},
  connection: :my_redis,
  attempts: 5,
  backoff: %{type: "exponential", delay: 1000}
)
```

## Queue Prefix

By default, BullMQ uses `"bull"` as a prefix for all Redis keys. You can customize this:

```elixir
# When adding jobs
BullMQ.Queue.add("emails", "send", %{},
  connection: :my_redis,
  prefix: "myapp"
)

# When starting workers
BullMQ.Worker.start_link(
  queue: "emails",
  connection: :my_redis,
  prefix: "myapp",
  processor: &process/1
)
```

**Important**: All components accessing the same queue must use the same prefix.

## Next Steps

- Learn about [Workers](workers.md) for advanced processing options
- Explore [Job Options](job_options.md) for customizing job behavior
- Set up [Queue Events](queue_events.md) for real-time monitoring
- Configure [Rate Limiting](rate_limiting.md) to control throughput
- Create recurring jobs with [Job Schedulers](job_schedulers.md)
- Use [Job Flows](flows.md) for complex workflows
- Monitor with [Telemetry](telemetry.md)
