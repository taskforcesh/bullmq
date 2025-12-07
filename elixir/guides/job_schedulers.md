# Job Schedulers

Job Schedulers allow you to create recurring jobs that run on a schedule, using either cron expressions or fixed intervals.

## Overview

The `BullMQ.JobScheduler` module provides functions for creating, listing, and managing scheduled jobs. Unlike one-time jobs, schedulers automatically create new jobs at specified intervals.

## Creating a Scheduler

### Interval-based Scheduler

Create a scheduler that runs at fixed intervals:

```elixir
# Run every minute
{:ok, job} = BullMQ.JobScheduler.upsert(:my_redis, "my_queue", "heartbeat",
  %{every: 60_000},  # 60 seconds in milliseconds
  "ping",            # Job name
  %{type: "health"}, # Job data
  prefix: "bull"
)

# Run every 5 seconds
{:ok, job} = BullMQ.JobScheduler.upsert(:my_redis, "my_queue", "fast-check",
  %{every: 5_000},
  "check",
  %{},
  prefix: "bull"
)
```

### Cron-based Scheduler

Create a scheduler using cron expressions:

```elixir
# Run every hour at minute 0
{:ok, job} = BullMQ.JobScheduler.upsert(:my_redis, "reports", "hourly-report",
  %{pattern: "0 * * * *"},
  "generate-report",
  %{type: "hourly"},
  prefix: "bull"
)

# Run every day at 9 AM
{:ok, job} = BullMQ.JobScheduler.upsert(:my_redis, "emails", "daily-digest",
  %{pattern: "0 9 * * *"},
  "send-digest",
  %{},
  prefix: "bull"
)

# Run every weekday at 6 PM
{:ok, job} = BullMQ.JobScheduler.upsert(:my_redis, "notifications", "workday-reminder",
  %{pattern: "0 18 * * 1-5"},
  "send-reminder",
  %{},
  prefix: "bull"
)
```

## Cron Expression Format

Cron expressions follow the standard format:

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (1 - 7) (Monday to Sunday)
│ │ │ │ │
* * * * *
```

> ⚠️ **Important: Weekday Compatibility with Node.js**
>
> The Elixir implementation uses the `crontab` library which has **different weekday numbering**
> than Node.js's `cron-parser`:
>
> | Day       | Elixir (`crontab`) | Node.js (`cron-parser`) |
> | --------- | ------------------ | ----------------------- |
> | Monday    | 1                  | 1                       |
> | Tuesday   | 2                  | 2                       |
> | Wednesday | 3                  | 3                       |
> | Thursday  | 4                  | 4                       |
> | Friday    | 5                  | 5                       |
> | Saturday  | 6                  | 6                       |
> | Sunday    | **7**              | **0** (or 7)            |
>
> **If you're sharing schedulers between Node.js and Elixir**, be aware that expressions
> with weekday specifications may behave differently. Consider using interval-based
> schedulers (`every`) for cross-platform compatibility, or adjust your cron patterns accordingly.

### Examples

| Pattern       | Description                                             |
| ------------- | ------------------------------------------------------- |
| `* * * * *`   | Every minute                                            |
| `*/5 * * * *` | Every 5 minutes                                         |
| `0 * * * *`   | Every hour                                              |
| `0 0 * * *`   | Every day at midnight                                   |
| `0 9 * * 1-5` | Every weekday at 9 AM                                   |
| `0 0 1 * *`   | First day of every month                                |
| `0 0 * * 7`   | Every Sunday at midnight (Elixir)                       |
| `0 0 * * 0`   | Every Sunday at midnight (Node.js - **not compatible**) |

## Scheduler Options

```elixir
{:ok, job} = BullMQ.JobScheduler.upsert(
  :my_redis,           # Redis connection
  "queue_name",        # Queue name
  "scheduler_key",     # Unique scheduler identifier
  %{
    # Required: one of pattern or every
    pattern: "0 * * * *",    # Cron pattern (mutually exclusive with every)
    every: 60_000,           # Interval in ms (mutually exclusive with pattern)

    # Optional scheduling options
    limit: 10,               # Max number of iterations
    start_date: timestamp,   # When to start (milliseconds)
    end_date: timestamp,     # When to stop (milliseconds)
    tz: "America/New_York",  # Timezone for cron patterns
    immediately: true,       # Run first job immediately (pattern only)
    offset: 5000,            # Offset for interval-based schedulers
  },
  "job_name",          # Name for created jobs
  %{data: "value"},    # Job data template

  # Job options
  prefix: "bull",
  priority: 1,
  attempts: 3,
  backoff: %{type: "exponential", delay: 1000}
)
```

## Managing Schedulers

### List All Schedulers

```elixir
{:ok, schedulers} = BullMQ.JobScheduler.list(:my_redis, "my_queue", prefix: "bull")

Enum.each(schedulers, fn scheduler ->
  IO.puts("#{scheduler.key}: next run at #{scheduler.next}")
end)
```

### Get a Specific Scheduler

```elixir
{:ok, scheduler} = BullMQ.JobScheduler.get(:my_redis, "my_queue", "hourly-report",
  prefix: "bull")

if scheduler do
  IO.inspect(scheduler)
  # %{
  #   key: "hourly-report",
  #   name: "generate-report",
  #   pattern: "0 * * * *",
  #   next: 1700000000000,
  #   iteration_count: 42,
  #   template: %{data: %{type: "hourly"}, opts: %{}}
  # }
end
```

### Count Schedulers

```elixir
{:ok, count} = BullMQ.JobScheduler.count(:my_redis, "my_queue", prefix: "bull")
IO.puts("Total schedulers: #{count}")
```

### Remove a Scheduler

```elixir
{:ok, removed} = BullMQ.JobScheduler.remove(:my_redis, "my_queue", "hourly-report",
  prefix: "bull")

if removed do
  IO.puts("Scheduler removed")
else
  IO.puts("Scheduler not found")
end
```

## Updating a Scheduler

The `upsert` function updates an existing scheduler if the key already exists:

```elixir
# Create initial scheduler
{:ok, _} = BullMQ.JobScheduler.upsert(:my_redis, "my_queue", "my-scheduler",
  %{every: 60_000},
  "job-name",
  %{version: 1},
  prefix: "bull"
)

# Update with new interval and data
{:ok, _} = BullMQ.JobScheduler.upsert(:my_redis, "my_queue", "my-scheduler",
  %{every: 30_000},  # Changed interval
  "job-name",
  %{version: 2},     # Updated data
  prefix: "bull"
)
```

## Limits and Boundaries

### Iteration Limit

Stop after a certain number of executions:

```elixir
# Run only 5 times
{:ok, job} = BullMQ.JobScheduler.upsert(:my_redis, "my_queue", "limited",
  %{every: 60_000, limit: 5},
  "limited-job",
  %{},
  prefix: "bull"
)
```

### Start Date

Begin scheduling from a future date:

```elixir
# Start in 1 hour
start = System.system_time(:millisecond) + 3_600_000

{:ok, job} = BullMQ.JobScheduler.upsert(:my_redis, "my_queue", "delayed-start",
  %{every: 60_000, start_date: start},
  "job",
  %{},
  prefix: "bull"
)
```

### End Date

Stop scheduling after a date:

```elixir
# Stop after 24 hours
end_time = System.system_time(:millisecond) + 86_400_000

{:ok, job} = BullMQ.JobScheduler.upsert(:my_redis, "my_queue", "time-limited",
  %{every: 60_000, end_date: end_time},
  "job",
  %{},
  prefix: "bull"
)
```

## Immediate Execution

Run the first job immediately (cron patterns only):

```elixir
{:ok, job} = BullMQ.JobScheduler.upsert(:my_redis, "my_queue", "immediate",
  %{pattern: "0 * * * *", immediately: true},
  "job",
  %{},
  prefix: "bull"
)
# First job runs now, then every hour
```

## Timezone Support

Specify a timezone for cron patterns:

```elixir
# Run at 9 AM New York time
{:ok, job} = BullMQ.JobScheduler.upsert(:my_redis, "my_queue", "tz-aware",
  %{pattern: "0 9 * * *", tz: "America/New_York"},
  "morning-job",
  %{},
  prefix: "bull"
)
```

## Job Options for Scheduled Jobs

Apply job options to all jobs created by a scheduler:

```elixir
{:ok, job} = BullMQ.JobScheduler.upsert(:my_redis, "my_queue", "with-options",
  %{every: 60_000},
  "job-name",
  %{data: "value"},
  prefix: "bull",
  priority: 1,           # All created jobs have priority 1
  attempts: 5,           # All jobs retry up to 5 times
  backoff: %{type: "exponential", delay: 1000},
  remove_on_complete: true
)
```

## Scheduler Data Structure

When you retrieve a scheduler, you get:

```elixir
%{
  key: "scheduler-key",           # Unique identifier
  name: "job-name",               # Job name for created jobs
  pattern: "0 * * * *",           # Cron pattern (if cron-based)
  every: 60_000,                  # Interval (if interval-based)
  next: 1700000000000,            # Next scheduled run (ms timestamp)
  iteration_count: 42,            # How many times it has run
  limit: nil,                     # Max iterations (nil = unlimited)
  start_date: nil,                # Start date constraint
  end_date: nil,                  # End date constraint
  tz: "UTC",                      # Timezone
  offset: 0,                      # Offset for interval-based
  template: %{
    data: %{...},                 # Job data template
    opts: %{...}                  # Job options template
  }
}
```

## Processing Scheduled Jobs

Scheduled jobs are processed by workers like any other job. The worker must be running on the same queue:

```elixir
# Create scheduler
{:ok, _} = BullMQ.JobScheduler.upsert(:my_redis, "maintenance", "cleanup",
  %{pattern: "0 * * * *"},
  "run-cleanup",
  %{type: "hourly"},
  prefix: "bull"
)

# Worker to process the scheduled jobs
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "maintenance",
  connection: :my_redis,
  processor: fn job ->
    case job.name do
      "run-cleanup" ->
        MyApp.Cleanup.run(job.data)
        {:ok, %{cleaned: true}}
      _ ->
        {:error, "Unknown job"}
    end
  end
)
```

## Node.js Interoperability

There are two compatibility differences between Elixir and Node.js cron parsing:

### 1. Seconds Field

| Format                 | Elixir           | Node.js            |
| ---------------------- | ---------------- | ------------------ |
| 5-field (standard)     | ✅ `"0 9 * * *"` | ✅ `"0 9 * * *"`   |
| 6-field (with seconds) | ❌ Not supported | ✅ `"0 0 9 * * *"` |

Node.js `cron-parser` supports an optional seconds field at the **beginning**:

```
second minute hour day month weekday
   0      0     9   *   *     *
```

Elixir's `crontab` uses standard 5-field format only. **6-field expressions
created in Node.js will fail to parse in Elixir.**

### 2. Sunday Numbering

| Day               | Elixir | Node.js    | Cross-Platform? |
| ----------------- | ------ | ---------- | --------------- |
| Monday - Saturday | 1-6    | 1-6        | ✅ Compatible   |
| Sunday            | **7**  | **0** or 7 | ⚠️ Use `7`      |

### Compatible Expressions

```elixir
# These 5-field expressions work identically in both:
"* * * * *"      # Every minute
"*/5 * * * *"    # Every 5 minutes
"0 * * * *"      # Every hour
"0 9 * * *"      # Every day at 9 AM
"0 0 1 * *"      # First day of month
"0 9 * * 1-5"    # Monday-Friday at 9 AM ✅
"0 9 * * 6"      # Saturday at 9 AM ✅
"0 9 * * 7"      # Sunday at 9 AM ✅ (works in both!)
"0 0 * * 6,7"    # Weekend ✅
%{every: 60_000} # Interval-based (always compatible)
```

### Incompatible Expressions (avoid)

```elixir
# These will NOT work in Elixir:
"0 0 9 * * *"    # ❌ 6-field with seconds (Node.js only)
"30 0 9 * * *"   # ❌ 6-field with seconds (Node.js only)
"0 9 * * 0"      # ❌ Sunday=0 (Node.js only, fails in Elixir)
```

### Recommendations

1. **Use 5-field cron expressions** (no seconds) for cross-platform compatibility
2. **Use `7` for Sunday** instead of `0`
3. **Use interval-based schedulers** (`every`) when sub-minute precision is needed:
   ```elixir
   %{every: 30_000}  # Every 30 seconds - works everywhere
   ```

## Common Patterns

### Periodic Health Checks

```elixir
BullMQ.JobScheduler.upsert(:my_redis, "health", "api-health",
  %{every: 30_000},  # Every 30 seconds
  "health-check",
  %{endpoints: ["api", "db", "cache"]},
  prefix: "bull"
)
```

### Daily Reports

```elixir
BullMQ.JobScheduler.upsert(:my_redis, "reports", "daily-summary",
  %{pattern: "0 6 * * *", tz: "America/New_York"},
  "generate-daily-report",
  %{report_type: "summary"},
  prefix: "bull"
)
```

### Cache Refresh

```elixir
BullMQ.JobScheduler.upsert(:my_redis, "cache", "refresh-cache",
  %{every: 300_000},  # Every 5 minutes
  "refresh-cache",
  %{cache_keys: ["users", "products"]},
  prefix: "bull",
  priority: 10  # Low priority
)
```

## Next Steps

- Learn about [Workers](workers.md) to process scheduled jobs
- Set up [Queue Events](queue_events.md) to monitor job execution
- Configure [Rate Limiting](rate_limiting.md) for scheduled jobs
