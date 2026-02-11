# Workers

Workers are the processes that fetch and execute jobs from queues.

## Basic Worker

The simplest worker configuration:

```elixir
defmodule MyApp.EmailWorker do
  def process(%BullMQ.Job{data: data}) do
    send_email(data["to"], data["subject"], data["body"])
    {:ok, %{sent: true}}
  end
end

{:ok, worker} = BullMQ.Worker.start_link(
  queue: "emails",
  connection: :my_redis,
  processor: &MyApp.EmailWorker.process/1
)
```

## Worker Options

```elixir
{:ok, worker} = BullMQ.Worker.start_link(
  # Required options
  queue: "my_queue",                    # Queue name
  connection: :my_redis,                # Redis connection (Redix name or pid)
  processor: &MyApp.Worker.process/1,   # Processor function

  # Optional options
  name: :my_worker,                     # Process registration name
  concurrency: 10,                      # Max concurrent jobs (default: 1)
  lock_duration: 30_000,                # Lock TTL in ms (default: 30000)
  stalled_interval: 30_000,             # Stalled check interval (default: 30000)
  max_stalled_count: 1,                 # Max stalls before failure (default: 1)
  prefix: "bull",                       # Queue prefix (default: "bull")
  autorun: true,                        # Start processing immediately (default: true)
  limiter: %{max: 100, duration: 60_000}, # Rate limiting config
  telemetry: BullMQ.Telemetry.OpenTelemetry, # OpenTelemetry integration (optional)

  # Event callbacks
  on_completed: fn job, result -> ... end,
  on_failed: fn job, reason -> ... end,
  on_active: fn job -> ... end,
  on_stalled: fn job_id -> ... end,
  on_error: fn error -> ... end,
  on_progress: fn job, progress -> ... end,
  on_lock_renewal_failed: fn job_ids -> ... end
)
```

## Concurrency

Process multiple jobs simultaneously:

```elixir
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "image-processing",
  connection: :my_redis,
  processor: &MyApp.ImageProcessor.process/1,
  concurrency: 20  # Process 20 images at once
)
```

Each concurrent job runs in its own process, providing isolation and fault tolerance. Unlike Node.js which uses a single thread with async operations, Elixir workers use true parallelism with multiple BEAM processes.

## Event Callbacks

Workers support event callbacks similar to Node.js `worker.on('completed', ...)`:

```elixir
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "tasks",
  connection: :my_redis,
  processor: &process/1,

  on_completed: fn job, result ->
    Logger.info("Job #{job.id} completed with result: #{inspect(result)}")
  end,

  on_failed: fn job, reason ->
    Logger.error("Job #{job.id} failed: #{reason}")
    MyApp.Alerts.notify("Job failed: #{reason}")
  end,

  on_active: fn job ->
    Logger.debug("Job #{job.id} started processing")
  end,

  on_stalled: fn job_id ->
    Logger.warning("Job #{job_id} stalled")
  end,

  on_error: fn error ->
    Logger.error("Worker error: #{inspect(error)}")
  end,

  on_progress: fn job, progress ->
    Logger.debug("Job #{job.id} progress: #{inspect(progress)}")
  end
)
```

### Using Callbacks for Testing

Callbacks are particularly useful in tests for waiting on job completion without polling:

```elixir
test "processes job successfully" do
  test_pid = self()

  {:ok, worker} = BullMQ.Worker.start_link(
    queue: "test-queue",
    connection: :my_redis,
    processor: fn job -> {:ok, job.data["value"] * 2} end,
    on_completed: fn job, result ->
      send(test_pid, {:completed, job.id, result})
    end
  )

  {:ok, job} = BullMQ.Queue.add("test-queue", "test", %{value: 21},
    connection: :my_redis)

  assert_receive {:completed, job_id, 42}, 5_000
  assert job_id == job.id
end
```

You can also test progress updates using the `on_progress` callback:

```elixir
test "reports progress correctly" do
  test_pid = self()

  {:ok, worker} = BullMQ.Worker.start_link(
    queue: "test-queue",
    connection: :my_redis,
    processor: fn job ->
      BullMQ.Worker.update_progress(job, 50)
      BullMQ.Worker.update_progress(job, 100)
      :ok
    end,
    on_progress: fn job, progress ->
      send(test_pid, {:progress, job.id, progress})
    end,
    on_completed: fn _job, _result ->
      send(test_pid, :completed)
    end
  )

  {:ok, job} = BullMQ.Queue.add("test-queue", "test", %{},
    connection: :my_redis)

  job_id = job.id
  assert_receive {:progress, ^job_id, 50}, 5_000
  assert_receive {:progress, ^job_id, 100}, 5_000
  assert_receive :completed, 5_000
end
```

## Processor Return Values

Processors can return different values to control job outcome:

| Return Value        | Description                                                                        |
| ------------------- | ---------------------------------------------------------------------------------- |
| `{:ok, result}`     | Job completed successfully. Result is stored and `on_completed` callback fires.    |
| `:ok`               | Job completed successfully (no result stored).                                     |
| `{:error, reason}`  | Job failed. Triggers retry if attempts remain, otherwise moves to failed.          |
| `{:delay, ms}`      | Move job to delayed state for `ms` milliseconds. Does not increment attempt count. |
| `{:rate_limit, ms}` | Move job to delayed state due to rate limiting. Similar to `:delay`.               |
| `:waiting`          | Move job back to waiting queue immediately.                                        |
| `:waiting_children` | Move job to waiting-children state (waits for child jobs to complete).             |

```elixir
def process(job) do
  case do_work(job.data) do
    # Success - job moves to completed
    {:ok, result} ->
      {:ok, result}

    # Simple success (no return value stored)
    :ok ->
      :ok

    # Error that triggers retry (if attempts remaining)
    {:error, reason} ->
      {:error, reason}

    # Delay job for 5 seconds (without incrementing attempts)
    {:needs_delay, ms} ->
      {:delay, ms}

    # Manual rate limiting - delay due to external rate limit
    :rate_limited ->
      {:rate_limit, 60_000}

    # Move back to waiting queue (immediate retry by any worker)
    :should_wait ->
      :waiting

    # Wait for child jobs to complete
    :has_children ->
      :waiting_children
  end
end

# Raising an exception also triggers retry
def process(job) do
  if something_wrong?(job) do
    raise "Something went wrong"
  end
  :ok
end
```

### When to Use Each Return Value

#### `{:delay, ms}` - Delay for Later Processing

Use when the job needs to wait before being processed again:

```elixir
def process(job) do
  case check_resource_status(job.data["resource_id"]) do
    :ready ->
      process_resource(job.data)
      {:ok, :processed}

    :not_ready ->
      # Resource not ready yet, check again in 30 seconds
      {:delay, 30_000}

    :pending_approval ->
      # Wait for human approval, check every 5 minutes
      {:delay, 300_000}
  end
end
```

**Key behaviors:**

- Job moves to delayed queue for the specified duration
- Does NOT increment the attempt count
- Does NOT trigger `on_completed` callback
- Job will be picked up by any available worker after the delay

#### `{:rate_limit, ms}` - Manual Rate Limiting

Use when you detect rate limiting from an external service:

```elixir
def process(job) do
  case MyApp.ExternalAPI.call(job.data) do
    {:ok, response} ->
      {:ok, response}

    {:error, :rate_limited, retry_after} ->
      # API told us to wait, respect it
      {:rate_limit, retry_after * 1000}

    {:error, 429, headers} ->
      # HTTP 429 - extract Retry-After header
      retry_ms = parse_retry_after(headers) || 60_000
      {:rate_limit, retry_ms}
  end
end
```

**Key behaviors:**

- Identical to `{:delay, ms}` in execution
- Semantically indicates rate limiting (useful for logging/monitoring)
- Does NOT increment the attempt count
- Does NOT trigger `on_completed` callback

#### `:waiting` - Return to Waiting Queue

Use when the job should be retried immediately by any worker:

```elixir
def process(job) do
  case acquire_distributed_lock(job.data["resource"]) do
    {:ok, lock} ->
      result = do_work_with_lock(job.data, lock)
      release_lock(lock)
      {:ok, result}

    :locked_by_another ->
      # Another worker has the lock, let a different worker try
      # (maybe on a different node that has the lock)
      :waiting
  end
end

# Another use case: load balancing across workers
def process(job) do
  if worker_overloaded?() do
    # Let another worker handle this
    :waiting
  else
    do_work(job)
  end
end
```

**Key behaviors:**

- Job returns to waiting queue immediately (no delay)
- Will be picked up by the next available worker (possibly different node)
- Does NOT increment the attempt count
- Does NOT trigger `on_completed` callback
- Useful for distributed coordination scenarios

#### `:waiting_children` - Wait for Child Jobs

Use with parent-child job flows when the parent needs to wait for children:

```elixir
def process(%{name: "process-batch"} = job) do
  # Create child jobs for each item in the batch
  Enum.each(job.data["items"], fn item ->
    BullMQ.FlowProducer.add_child(job, "process-item", item)
  end)

  # Wait for all children to complete before this job continues
  :waiting_children
end

def process(%{name: "process-item"} = job) do
  # Process individual item
  result = process_item(job.data)
  {:ok, result}
end
```

**Key behaviors:**

- Job moves to waiting-children state
- Automatically resumed when all child jobs complete
- Parent can access child results via `BullMQ.Job.get_children_values/1`
- Does NOT trigger `on_completed` callback (until children complete and job finishes)
- See [Flows & Parent-Child Jobs](flows.md) for details

### Comparison Summary

| Return Value        | Queue State      | Delay     | Increment Attempts | on_completed                |
| ------------------- | ---------------- | --------- | ------------------ | --------------------------- |
| `{:ok, result}`     | completed        | -         | -                  | ✅ Yes                      |
| `:ok`               | completed        | -         | -                  | ✅ Yes                      |
| `{:error, reason}`  | delayed/failed   | backoff   | ✅ Yes             | ❌ No (until final failure) |
| `{:error, reason}`  | delayed/failed   | backoff   | ✅ Yes             | ❌ No (until final failure) |
| `{:delay, ms}`      | delayed          | specified | ❌ No              | ❌ No                       |
| `{:rate_limit, ms}` | delayed          | specified | ❌ No              | ❌ No                       |
| `:waiting`          | waiting          | none      | ❌ No              | ❌ No                       |
| `:waiting_children` | waiting-children | none      | ❌ No              | ❌ No                       |

### Failures: `{:error, reason}` vs Exceptions

Both `{:error, reason}` return values and exceptions trigger the same retry behavior:

```elixir
# These two are equivalent in terms of retry behavior:

# Option 1: Return error tuple (idiomatic Elixir)
def process(job) do
  case external_api_call(job.data) do
    {:ok, result} -> {:ok, result}
    {:error, reason} -> {:error, reason}  # Triggers retry
  end
end

# Option 2: Raise exception (Node.js style)
def process(job) do
  result = external_api_call!(job.data)  # Raises on error
  {:ok, result}
end
```

**When to use each:**

| Approach           | Best For                                                                         |
| ------------------ | -------------------------------------------------------------------------------- |
| `{:error, reason}` | Expected failures from API calls, validation errors, pattern matching on results |
| `raise`            | Unexpected errors, assertion failures, "this should never happen" cases          |
| `throw`            | Non-local returns (rare in typical code)                                         |
| `exit`             | Process termination signals                                                      |

All of these:

- Trigger retry if `attempts` remain
- Move job to `failed` after max retries
- Store the error reason/message with the job
- Call `on_failed` callback (only on final failure)

### Exception Handling

If your processor raises an exception, exits, or throws a value, BullMQ catches it
automatically and treats it as a job failure. **The worker process does NOT crash** -
all errors are safely contained within the job processing context.

```elixir
def process(job) do
  # If this raises, the job will fail (and retry if attempts remain)
  result = dangerous_operation!(job.data)
  {:ok, result}
end

def process(job) do
  # Explicit validation with raise
  if invalid?(job.data) do
    raise ArgumentError, "Invalid job data: #{inspect(job.data)}"
  end

  do_work(job.data)
end
```

**All error types are caught:**

```elixir
# These all result in job failure:

# 1. raise - Elixir exceptions
def process(_job), do: raise "Something went wrong"

# 2. exit - Process exit signals
def process(_job), do: exit(:abnormal_termination)

# 3. throw - Thrown values (non-local returns)
def process(_job), do: throw(:abort_processing)
```

**Exception behavior:**

| Scenario               | Result                                          | Failure Reason    |
| ---------------------- | ----------------------------------------------- | ----------------- |
| `raise "error"`        | Job fails, retries if `attempts` remaining      | Exception message |
| `exit(:reason)`        | Job fails, retries if `attempts` remaining      | Inspected reason  |
| `throw(:value)`        | Job fails, retries if `attempts` remaining      | Inspected value   |
| Timeout (lock expires) | Job becomes stalled, handled by stalled checker | N/A               |

**What gets captured:**

- Exception message via `Exception.message(e)` for raised exceptions
- Inspected value for `exit` and `throw`
- Full stacktrace (stored with the job for debugging)
- Exit reasons from linked processes

**Example with retries:**

```elixir
# Add job with 3 attempts
{:ok, job} = BullMQ.Queue.add("emails", "send", %{to: "user@example.com"},
  connection: :redis,
  attempts: 3,
  backoff: %{type: :exponential, delay: 1000}
)

# In processor - exceptions trigger retry with backoff
def process(job) do
  case send_email(job.data) do
    :ok ->
      {:ok, :sent}

    {:error, :temporary_failure} ->
      # Explicit error - will retry
      {:error, "Temporary failure, will retry"}

    {:error, :permanent_failure} ->
      # You could also raise for permanent failures
      raise "Permanent failure: email address invalid"
  end
end
```

**Viewing failure information:**

When a job fails, the error message and stacktrace are stored:

```elixir
{:ok, job} = BullMQ.Queue.get_job("my-queue", job_id, connection: :redis)

# Access failure info
job.failed_reason      # "ArgumentError: Invalid job data: %{...}"
job.stacktrace         # ["    (my_app 1.0.0) lib/my_app/worker.ex:15: ..."]
job.attempts_made      # Number of attempts so far
```

**Best practices:**

1. **Let it crash for unexpected errors** - BullMQ handles retries automatically
2. **Use `{:error, reason}` for expected failures** - More explicit control
3. **Configure appropriate retry attempts** - Default is 0 (no retries)
4. **Use backoff strategies** - Exponential backoff for transient failures
5. **Monitor failed jobs** - Use `on_failed` callback or QueueEvents

```elixir
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "critical-jobs",
  connection: :redis,
  processor: &process/1,

  # Get notified when jobs exhaust all retries
  on_failed: fn job, reason ->
    Logger.error("Job #{job.id} failed permanently: #{reason}")
    MyApp.Alerts.notify("Critical job failed", job: job, reason: reason)
  end
)
```

## Connection Error Handling

BullMQ follows the same philosophy as Redix for connection error handling:

- **Supervised connections** - Redis connections automatically reconnect when the TCP connection drops
- **Fail-fast** - Commands fail immediately if the connection is unavailable (no hidden retries)
- **Caller handles retries** - The Worker automatically retries failed jobs based on job configuration

This design follows Erlang/OTP principles: let the connection supervision handle reconnection,
and let callers (the Worker) decide retry policy based on job-specific needs.

### Connection Errors in Processors

If your processor makes Redis calls and the connection drops, the job will fail and be retried
according to the job's retry configuration:

```elixir
def process(job) do
  # If Redis is down, this will return {:error, %Redix.ConnectionError{}}
  # which will trigger a job retry (if attempts remaining)
  case BullMQ.RedisConnection.command(:my_redis, ["GET", "cache:#{job.data["key"]}"]) do
    {:ok, cached} ->
      {:ok, %{cached: true, value: cached}}

    {:error, %Redix.ConnectionError{}} ->
      # Let the job retry system handle this
      {:error, :redis_connection_error}

    {:error, reason} ->
      {:error, reason}
  end
end
```

### Configuring Retries for Transient Failures

For jobs that may fail due to transient connection issues, configure appropriate retry settings:

```elixir
{:ok, job} = BullMQ.Queue.add("my-queue", "job", %{data: "value"},
  connection: :my_redis,
  attempts: 5,
  backoff: %{
    type: :exponential,
    delay: 1000  # Start with 1 second, doubles each retry
  }
)
```

### Monitoring Connection Health

Use the `on_error` callback to monitor worker-level errors including connection issues:

```elixir
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "my-queue",
  connection: :my_redis,
  processor: &MyApp.process/1,
  on_error: fn error ->
    case error do
      %Redix.ConnectionError{reason: reason} ->
        Logger.error("Redis connection error: #{inspect(reason)}")
        MyApp.Alerts.notify(:redis_connection_error, reason)

      _ ->
        Logger.error("Worker error: #{inspect(error)}")
    end
  end
)
```

## Lock Duration

Workers hold a lock on jobs to prevent duplicate processing. If the lock expires before the job completes, another worker might pick it up:

```elixir
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "long-running",
  connection: :my_redis,
  processor: &MyApp.LongRunning.process/1,
  lock_duration: 300_000  # 5 minutes (default: 30 seconds)
)
```

BullMQ automatically renews locks at half the lock duration interval.

### Automatic Cancellation on Lock Loss

If a lock renewal fails (e.g., due to network issues or Redis problems), the worker automatically cancels the affected job. This prevents duplicate processing if another worker picks up the job.

When a lock is lost, the processor receives a cancellation message with reason `{:lock_lost, job_id}`:

```elixir
processor: fn job, cancel_token ->
  receive do
    {:cancel, ^cancel_token, {:lock_lost, _job_id}} ->
      # Lock was lost - stop processing to avoid duplicates
      Logger.warning("Lock lost for job #{job.id}, stopping")
      {:error, :lock_lost}
    {:cancel, ^cancel_token, reason} ->
      {:error, {:cancelled, reason}}
  after
    0 ->
      do_work(job)
  end
end
```

You can also use the `on_lock_renewal_failed` callback to be notified:

```elixir
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "my-queue",
  connection: :my_redis,
  processor: &MyApp.process/2,
  on_lock_renewal_failed: fn job_ids ->
    Logger.error("Lock renewal failed for jobs: #{inspect(job_ids)}")
    # Alert monitoring, etc.
  end
)
```

## Stalled Job Recovery

Jobs can "stall" when a worker crashes or loses connection before completing a job.
BullMQ automatically detects and recovers stalled jobs.

### Default Configuration

The stalled job detection has sensible defaults that should normally not be changed:

| Option              | Default  | Description                          |
| ------------------- | -------- | ------------------------------------ |
| `lock_duration`     | 30,000ms | Time before a job lock expires       |
| `stalled_interval`  | 30,000ms | How often to check for stalled jobs  |
| `max_stalled_count` | 1        | Times a job can stall before failing |

### Why max_stalled_count defaults to 1

Stalled jobs are considered a rare occurrence. If a job stalls more than once, it
typically indicates a more serious issue:

- Repeated worker crashes on specific job data
- Resource exhaustion (memory, CPU)
- External service failures
- Bugs in job processing logic

Instead of increasing `max_stalled_count`, investigate and fix the underlying issue.

### Monitoring Stalled Jobs

Use the `on_stalled` callback to monitor when jobs stall:

```elixir
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "important",
  connection: :my_redis,
  processor: &MyApp.Important.process/1,
  on_stalled: fn job_id ->
    Logger.warning("Job #{job_id} stalled - investigating...")
    # Alert your monitoring system
  end
)
```

### When to Adjust Settings

Only change these settings if you have a specific need:

```elixir
# Only if jobs legitimately take > 30s between progress updates
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "long-running",
  connection: :my_redis,
  processor: &MyApp.LongJob.process/1,
  lock_duration: 120_000  # 2 minutes for very long jobs
)
```

## Rate Limiting

Control how many jobs are processed per time window:

```elixir
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "api-calls",
  connection: :my_redis,
  processor: &MyApp.ApiCaller.process/1,
  limiter: %{
    max: 100,           # Max 100 jobs
    duration: 60_000    # Per minute
  }
)
```

See the [Rate Limiting](rate_limiting.md) guide for more details.

## Pattern Matching on Job Names

Process different job types with pattern matching:

```elixir
defmodule MyApp.NotificationWorker do
  alias BullMQ.Job

  def process(%Job{name: "email", data: data}) do
    send_email(data)
  end

  def process(%Job{name: "sms", data: data}) do
    send_sms(data)
  end

  def process(%Job{name: "push", data: data}) do
    send_push_notification(data)
  end

  def process(%Job{name: name}) do
    {:error, "Unknown notification type: #{name}"}
  end
end
```

## Job Progress

Report progress for long-running jobs:

```elixir
def process(%BullMQ.Job{} = job) do
  items = fetch_items(job.data)
  total = length(items)

  items
  |> Enum.with_index()
  |> Enum.each(fn {item, index} ->
    process_item(item)

    # Report progress (any value - typically 0-100)
    progress = round((index + 1) / total * 100)
    BullMQ.Worker.update_progress(job, progress)
  end)

  {:ok, %{processed: total}}
end
```

Progress updates emit a `progress` event in Redis Streams and trigger the `on_progress` callback.

## Job Logging

Add log entries to a job. Logs are stored in Redis and can be retrieved later for debugging or tracking progress.

You can use either `Job.log/2` or `Worker.log/2`:

```elixir
def process(%BullMQ.Job{} = job) do
  # Using Job.log (returns {:ok, log_count})
  {:ok, 1} = BullMQ.Job.log(job, "Starting processing")

  result = do_work(job.data)

  {:ok, 2} = BullMQ.Job.log(job, "Completed with result: #{inspect(result)}")
  {:ok, result}
end
```

Or using `Worker.log/2`:

```elixir
def process(%BullMQ.Job{} = job) do
  # Using Worker.log (returns :ok)
  :ok = BullMQ.Worker.log(job, "Starting processing")

  result = do_work(job.data)

  :ok = BullMQ.Worker.log(job, "Completed with result: #{inspect(result)}")
  {:ok, result}
end
```

### Limiting Log Entries

Use the `keep_logs` option to limit the number of log entries stored:

```elixir
# Only keep the last 10 log entries
BullMQ.Job.log(job, "Processing step 1", keep_logs: 10)
BullMQ.Job.log(job, "Processing step 2", keep_logs: 10)
```

You can also set this globally when adding a job:

```elixir
{:ok, job} = BullMQ.Queue.add("my-queue", "job-name", %{data: "value"},
  keep_logs: 100)
```

## Graceful Shutdown

Workers automatically complete in-progress jobs before shutting down:

```elixir
# Close the worker and wait for active jobs to complete
:ok = BullMQ.Worker.close(worker)

# Force close without waiting for jobs
:ok = BullMQ.Worker.close(worker, force: true)
```

For supervised workers, configure the shutdown timeout:

```elixir
children = [
  %{
    id: MyWorker,
    start: {BullMQ.Worker, :start_link, [[
      queue: "jobs",
      connection: :my_redis,
      processor: &MyApp.process/1
    ]]},
    shutdown: 60_000  # Wait up to 60 seconds for jobs to complete
  }
]
```

## Pause and Resume

Pause and resume job processing:

```elixir
# Pause the worker (finishes current jobs, stops picking new ones)
:ok = BullMQ.Worker.pause(worker)

# Resume processing
:ok = BullMQ.Worker.resume(worker)

# Check if paused
BullMQ.Worker.paused?(worker)
# => true
```

## Supervision

Add workers to your supervision tree for automatic restarts:

```elixir
defmodule MyApp.Application do
  use Application

  def start(_type, _args) do
    children = [
      # Redis connection
      {Redix, name: :my_redis, host: "localhost", port: 6379},

      # Email worker
      {BullMQ.Worker,
        name: :email_worker,
        queue: "emails",
        connection: :my_redis,
        processor: &MyApp.EmailWorker.process/1,
        concurrency: 5
      },

      # Heavy processing worker
      {BullMQ.Worker,
        name: :heavy_worker,
        queue: "heavy",
        connection: :my_redis,
        processor: &MyApp.HeavyWorker.process/1,
        concurrency: 2,
        lock_duration: 300_000
      }
    ]

    Supervisor.start_link(children, strategy: :one_for_one)
  end
end
```

## Worker Telemetry

Workers emit telemetry events for observability and support OpenTelemetry for distributed tracing.

### OpenTelemetry

Enable distributed tracing by passing a telemetry module:

```elixir
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "my-queue",
  connection: :my_redis,
  processor: &MyApp.Worker.process/1,
  telemetry: BullMQ.Telemetry.OpenTelemetry
)
```

When enabled, the worker automatically:

- Restores trace context from the job's `tm` (telemetry_metadata) option
- Creates spans linked to the producer's trace
- Records errors and exceptions on spans

See the [Telemetry](telemetry.md) guide for full OpenTelemetry setup.

## Next Steps

- Learn about [Rate Limiting](rate_limiting.md)
- Create [Job Flows](flows.md)
- Set up [Telemetry](telemetry.md)
