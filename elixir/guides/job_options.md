# Job Options

BullMQ provides extensive options for customizing job behavior.

## Adding Jobs

Jobs are added using the `BullMQ.Queue.add/4` function:

```elixir
{:ok, job} = BullMQ.Queue.add(queue_name, job_name, data, opts)
```

Where:

- `queue_name` - The queue name (string)
- `job_name` - Job type/name for pattern matching (string)
- `data` - Job payload (map)
- `opts` - Options including `:connection` and job-specific options

## Priority

Jobs with lower priority values are processed first:

```elixir
# High priority job (processed first)
BullMQ.Queue.add("tasks", "urgent-task", %{},
  connection: :my_redis,
  priority: 1
)

# Normal priority (default)
BullMQ.Queue.add("tasks", "normal-task", %{},
  connection: :my_redis
)

# Low priority job (processed last)
BullMQ.Queue.add("tasks", "batch-task", %{},
  connection: :my_redis,
  priority: 100
)
```

Priority uses a Redis sorted set, so jobs are always processed in priority order.

## Delay

Schedule jobs to run after a delay:

```elixir
# Run in 5 minutes
BullMQ.Queue.add("reminders", "send-reminder", %{message: "Don't forget!"},
  connection: :my_redis,
  delay: 5 * 60 * 1000  # 5 minutes in milliseconds
)

# Run at a specific time
future_time = DateTime.utc_now() |> DateTime.add(3600, :second)
delay = DateTime.diff(future_time, DateTime.utc_now(), :millisecond)

BullMQ.Queue.add("reports", "scheduled-report", %{},
  connection: :my_redis,
  delay: delay
)
```

## Retries and Backoff

Configure automatic retry behavior:

```elixir
# 3 retries with exponential backoff
BullMQ.Queue.add("api-calls", "call-api", %{url: "..."},
  connection: :my_redis,
  attempts: 3,
  backoff: %{type: "exponential", delay: 1000}
)
# Delays: 1s, 2s, 4s

# Fixed backoff
BullMQ.Queue.add("api-calls", "call-api", %{url: "..."},
  connection: :my_redis,
  attempts: 5,
  backoff: %{type: "fixed", delay: 5000}
)
# Delays: 5s, 5s, 5s, 5s
```

### Backoff Types

- **exponential** - Delay doubles each attempt: `delay * 2^attempt`
- **fixed** - Same delay each time

## Custom Job IDs

By default, jobs get a unique ID. You can specify a custom ID:

```elixir
# Using custom job ID
BullMQ.Queue.add("users", "process-user", %{user_id: 123},
  connection: :my_redis,
  job_id: "user-123-process"
)

# Adding the same job ID again will return the existing job
```

## Deduplication

Prevent duplicate jobs from being added to the queue. See the [Deduplication Guide](deduplication.md) for full details.

```elixir
# Simple mode: deduplicate until job completes
BullMQ.Queue.add("tasks", "process", %{},
  connection: :my_redis,
  deduplication: %{id: "unique-task-id"}
)

# Throttle mode: deduplicate for 5 seconds
BullMQ.Queue.add("tasks", "process", %{},
  connection: :my_redis,
  deduplication: %{id: "unique-task-id", ttl: 5_000}
)

# Debounce mode: replace and extend TTL
BullMQ.Queue.add("tasks", "process", %{data: "latest"},
  connection: :my_redis,
  delay: 5_000,
  deduplication: %{id: "unique-task-id", ttl: 5_000, extend: true, replace: true}
)
```

## LIFO Processing

By default, jobs are processed FIFO (first in, first out). Use LIFO for stack-like behavior:

```elixir
# This job will be processed before older jobs
BullMQ.Queue.add("urgent", "urgent-task", %{},
  connection: :my_redis,
  lifo: true
)
```

## Job Cleanup

Control when completed/failed jobs are removed:

```elixir
# Remove immediately when completed
BullMQ.Queue.add("temporary", "temp-job", %{},
  connection: :my_redis,
  remove_on_complete: true
)

# Keep last 100 completed jobs
BullMQ.Queue.add("with-history", "job", %{},
  connection: :my_redis,
  remove_on_complete: %{count: 100}
)

# Remove completed jobs older than 1 hour (in ms)
BullMQ.Queue.add("time-limited", "job", %{},
  connection: :my_redis,
  remove_on_complete: %{age: 3_600_000}
)

# Remove failed jobs after keeping 50
BullMQ.Queue.add("cleanup-failures", "job", %{},
  connection: :my_redis,
  remove_on_fail: %{count: 50}
)

# Keep completed jobs but remove failed ones
BullMQ.Queue.add("success-matters", "job", %{},
  connection: :my_redis,
  remove_on_complete: false,
  remove_on_fail: true
)
```

## Bulk Operations

Add multiple jobs atomically using `add_bulk/3`. This function uses Redis MULTI/EXEC transactions to ensure all jobs are added atomically (all or nothing), achieving up to 10x higher throughput than individual `add/4` calls.

### Basic Usage

```elixir
jobs = [
  {"email", %{to: "user1@example.com"}, [priority: 1]},
  {"email", %{to: "user2@example.com"}, []},
  {"email", %{to: "user3@example.com"}, [delay: 60_000]}
]

# All jobs are added atomically - either all succeed or none do
{:ok, added_jobs} = BullMQ.Queue.add_bulk("emails", jobs, connection: :my_redis)
```

### High-Performance Bulk Addition

For adding large numbers of jobs (10,000+), use a connection pool for parallel processing:

```elixir
# Create a pool of 8 connections
pool = for i <- 1..8 do
  name = :"redis_pool_#{i}"
  {:ok, _} = BullMQ.RedisConnection.start_link(name: name, host: "localhost")
  name
end

# Add 100,000 jobs at ~60,000 jobs/sec
# Each chunk is added atomically
jobs = for i <- 1..100_000, do: {"job", %{index: i}, []}

{:ok, added} = BullMQ.Queue.add_bulk("my-queue", jobs,
  connection: :redis,
  connection_pool: pool
)
```

### Bulk Options

| Option              | Default  | Description                                                                                                                                                   |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline`          | `true`   | Use pipelining for efficiency                                                                                                                                 |
| `atomic`            | `true`   | Wrap batches in MULTI/EXEC transactions. When `false`, uses plain pipelines (slightly faster, not atomic). With `connection_pool`, each batch is independent. |
| `connection_pool`   | `nil`    | List of connections for parallel processing                                                                                                                   |
| `max_pipeline_size` | `10_000` | Maximum jobs per pipeline batch                                                                                                                               |

See [Benchmarks](benchmarks.md#bulk-job-addition-performance) for detailed performance data.

## All Options Reference

| Option               | Type     | Default    | Description                                          |
| -------------------- | -------- | ---------- | ---------------------------------------------------- |
| `connection`         | atom/pid | _required_ | Redis connection                                     |
| `prefix`             | string   | "bull"     | Queue prefix                                         |
| `priority`           | integer  | 0          | Lower = higher priority                              |
| `delay`              | integer  | 0          | Delay in milliseconds                                |
| `attempts`           | integer  | 1          | Total attempts including first                       |
| `backoff`            | map      | nil        | Retry strategy config                                |
| `lifo`               | boolean  | false      | Add to front of queue                                |
| `job_id`             | string   | auto       | Custom job identifier                                |
| `deduplication`      | map      | nil        | Deduplication config (see [guide](deduplication.md)) |
| `remove_on_complete` | bool/map | false      | Cleanup config                                       |
| `remove_on_fail`     | bool/map | false      | Cleanup config                                       |
| `keep_logs`          | integer  | nil        | Maximum log entries to keep                          |
| `timestamp`          | integer  | now        | Job creation timestamp                               |
| `telemetry_metadata` | string   | nil        | Serialized trace context (auto-set by telemetry)     |
| `omit_context`       | boolean  | false      | Skip trace context propagation                       |

## Next Steps

- Learn about [Workers](workers.md) for processing jobs
- Set up [Rate Limiting](rate_limiting.md) to control throughput
- Create recurring jobs with [Job Schedulers](job_schedulers.md)
- Use [Deduplication](deduplication.md) to prevent duplicate jobs
- Configure [Telemetry](telemetry.md) for observability and distributed tracing
