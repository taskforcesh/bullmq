# Manual Job Processing

BullMQ Elixir supports manual job processing, where you have full control over fetching jobs and managing their lifecycle instead of using automatic worker processing.

## Overview

Manual processing is useful when you need:

- Fine-grained control over job execution
- Custom job routing or filtering
- Integration with external systems that control processing flow
- Rate limiting at the application level
- Processing jobs in batches

## Basic Usage

### Creating a Worker for Manual Processing

Create a worker without automatic processing by setting `autorun: false`:

```elixir
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "my-queue",
  connection: :redis,
  processor: nil,  # No processor needed for manual processing
  autorun: false,  # Don't start automatic job fetching
  lock_duration: 30_000  # Lock duration for fetched jobs
)

# Start the stalled job checker (recommended)
:ok = BullMQ.Worker.start_stalled_check_timer(worker)
```

### Fetching and Processing Jobs

```elixir
alias BullMQ.{Job, Worker}

# Generate a unique token for this fetch operation
token = UUID.uuid4()

# Fetch the next job
case Worker.get_next_job(worker, token) do
  {:ok, nil} ->
    # No job available
    :ok

  {:ok, job} ->
    # Process the job
    case process_job(job) do
      {:ok, result} ->
        # Mark job as completed
        Job.move_to_completed(job, result, token)

      {:error, reason} ->
        # Mark job as failed
        Job.move_to_failed(job, reason, token)
    end
end
```

## API Reference

### Worker Functions

#### `Worker.get_next_job/3`

Fetches the next available job from the queue.

```elixir
@spec get_next_job(worker, token, opts) :: {:ok, Job.t() | nil} | {:error, term()}
```

**Parameters:**

- `worker` - The worker process
- `token` - A unique string representing ownership of the job lock
- `opts` - Options:
  - `:block` - If `true` (default), uses `BZPOPMIN` to efficiently wait for a job.
    If `false`, returns immediately with `nil` if no job available.
  - `:timeout` - Timeout in seconds for blocking wait (default: 5). Only used when
    `block: true`. After timeout, returns `{:ok, nil}`.

**Returns:**

- `{:ok, job}` - A job was fetched successfully
- `{:ok, nil}` - No job available (timeout or `block: false`) or worker is paused/closing
- `{:error, reason}` - An error occurred

**Blocking Behavior:**

When `block: true` (the default), this function uses Redis's `BZPOPMIN` command
to efficiently wait for jobs without polling. This is the same mechanism used
by Node.js BullMQ:

1. First tries to fetch a job immediately
2. If no job is available, waits using `BZPOPMIN` on the marker key
3. When a job becomes available (marker is set), fetches and returns it
4. If timeout is reached, returns `{:ok, nil}`

This approach is more efficient than polling because:

- No CPU cycles wasted on empty polls
- Immediate response when a job arrives
- Minimal Redis traffic

#### `Worker.start_stalled_check_timer/1`

Starts the stalled job checker. This is important for detecting jobs whose locks have expired.

```elixir
:ok = Worker.start_stalled_check_timer(worker)
```

#### `Worker.stop_stalled_check_timer/1`

Stops the stalled job checker.

```elixir
:ok = Worker.stop_stalled_check_timer(worker)
```

### Job Functions

#### `Job.move_to_completed/4`

Moves a job to the completed state.

```elixir
@spec move_to_completed(job, return_value, token, opts) :: {:ok, nil | {list(), String.t()}} | {:error, term()}
```

**Parameters:**

- `job` - The job struct
- `return_value` - The result to store with the completed job
- `token` - The lock token (same as used in `get_next_job`)
- `opts` - Options:
  - `:fetch_next` - If `true` (default), returns the next job data
  - `:remove_on_complete` - Job removal settings

**Returns:**

- `{:ok, nil}` - Job completed, no next job
- `{:ok, {job_data, job_id}}` - Job completed, next job data returned
- `{:error, reason}` - Failed to move job

#### `Job.move_to_failed/4`

Moves a job to the failed state.

```elixir
@spec move_to_failed(job, error, token, opts) :: {:ok, nil | {list(), String.t()}} | {:error, term()}
```

**Parameters:**

- `job` - The job struct
- `error` - The error (can be an Exception or a string)
- `token` - The lock token
- `opts` - Options:
  - `:fetch_next` - If `true`, returns the next job data (default: `false`)
  - `:remove_on_fail` - Job removal settings

#### `Job.move_to_wait/2`

Moves a job back to the waiting state. Useful for rate limiting.

```elixir
@spec move_to_wait(job, token) :: {:ok, non_neg_integer()} | {:error, term()}
```

**Parameters:**

- `job` - The job struct
- `token` - The lock token

**Returns:**

- `{:ok, pttl}` - Job moved back, returns rate limit TTL (or 0)

#### `Job.extend_lock/3`

Extends the lock on a job. Use this when processing takes longer than the lock duration.

```elixir
@spec extend_lock(job, token, duration) :: {:ok, term()} | {:error, term()}
```

**Parameters:**

- `job` - The job struct
- `token` - The lock token
- `duration` - Duration in milliseconds to extend the lock

## Patterns

### Processing Loop

A typical processing loop that handles multiple jobs:

```elixir
defmodule MyApp.ManualProcessor do
  alias BullMQ.{Job, Worker}

  def start(worker) do
    # Start stalled job checker
    Worker.start_stalled_check_timer(worker)

    # Start processing loop
    loop(worker)
  end

  defp loop(worker) do
    token = generate_token()

    case Worker.get_next_job(worker, token) do
      {:ok, nil} ->
        # No job, wait a bit
        Process.sleep(100)
        loop(worker)

      {:ok, job} ->
        process_job(job, token)
        loop(worker)
    end
  end

  defp process_job(job, token) do
    case do_work(job.data) do
      {:ok, result} ->
        Job.move_to_completed(job, result, token, fetch_next: false)

      {:error, reason} ->
        Job.move_to_failed(job, reason, token)
    end
  end

  defp do_work(data) do
    # Your processing logic
    {:ok, %{processed: true}}
  end

  defp generate_token do
    Base.encode16(:crypto.strong_rand_bytes(16), case: :lower)
  end
end
```

### Rate Limiting

Handle rate limiting by moving jobs back to wait:

```elixir
defp process_job(job, token) do
  case check_rate_limit() do
    :ok ->
      case do_work(job.data) do
        {:ok, result} ->
          Job.move_to_completed(job, result, token)
        {:error, reason} ->
          Job.move_to_failed(job, reason, token)
      end

    {:rate_limited, _delay} ->
      # Move job back to wait
      Job.move_to_wait(job, token)
  end
end
```

### Long-Running Jobs with Lock Extension

For jobs that take longer than the lock duration:

```elixir
defp process_long_job(job, token) do
  # Start a task to extend the lock periodically
  lock_task = Task.async(fn ->
    extend_lock_loop(job, token)
  end)

  try do
    result = do_long_work(job.data)
    Job.move_to_completed(job, result, token)
  rescue
    e ->
      Job.move_to_failed(job, Exception.message(e), token)
  after
    Task.shutdown(lock_task, :brutal_kill)
  end
end

defp extend_lock_loop(job, token) do
  # Extend every 10 seconds (assuming 30s lock duration)
  Process.sleep(10_000)

  case Job.extend_lock(job, token, 30_000) do
    {:ok, _} ->
      extend_lock_loop(job, token)
    {:error, _} ->
      # Lock lost, job will be picked up by another worker
      :ok
  end
end
```

### Chained Processing with Fetch Next

Efficiently process jobs by fetching the next job with completion:

```elixir
defp process_chain(worker, nil, _token) do
  # No more jobs, fetch fresh
  token = generate_token()
  case Worker.get_next_job(worker, token, block: false) do
    {:ok, job} when not is_nil(job) ->
      process_chain(worker, job, token)
    _ ->
      :done
  end
end

defp process_chain(worker, job, token) do
  result = do_work(job.data)

  # Complete job and get next in one call
  case Job.move_to_completed(job, result, token, fetch_next: true) do
    {:ok, nil} ->
      # No more jobs
      :done

    {:ok, {job_data, job_id}} ->
      # Got next job, reconstruct and continue
      next_job = Job.from_redis(job_id, job.queue_name, list_to_map(job_data),
        prefix: job.prefix,
        token: token,
        connection: job.connection
      )
      process_chain(worker, next_job, token)
  end
end
```

## Token Management

Tokens represent ownership of a job's lock. Best practices:

1. **Use unique tokens** - Generate a new token for each job fetch
2. **Keep tokens consistent** - Use the same token for `get_next_job`, `move_to_completed`/`move_to_failed`, and `extend_lock`
3. **Don't reuse tokens across jobs** - Each job should have its own token

```elixir
# Good: UUID-based tokens
defp generate_token do
  UUID.uuid4()
end

# Also good: Crypto-random tokens
defp generate_token do
  Base.encode16(:crypto.strong_rand_bytes(16), case: :lower)
end
```

## Stalled Jobs

When processing manually, enable the stalled job checker to handle jobs whose locks have expired:

```elixir
# Configure stalled job behavior
{:ok, worker} = Worker.start_link(
  queue: "my-queue",
  connection: :redis,
  processor: nil,
  autorun: false,
  stalled_interval: 30_000,    # Check every 30 seconds
  max_stalled_count: 1         # Fail after 1 stall (default)
)

# Start the checker
Worker.start_stalled_check_timer(worker)
```

If a job's lock expires before completion:

- It's moved back to waiting (if `max_stalled_count` not exceeded)
- It's moved to failed (if `max_stalled_count` exceeded)

## Comparison with Node.js

The Elixir API closely mirrors the Node.js BullMQ manual processing API:

| Node.js                             | Elixir                                     |
| ----------------------------------- | ------------------------------------------ |
| `worker.getNextJob(token)`          | `Worker.get_next_job(worker, token)`       |
| `job.moveToCompleted(value, token)` | `Job.move_to_completed(job, value, token)` |
| `job.moveToFailed(error, token)`    | `Job.move_to_failed(job, error, token)`    |
| `job.moveToWait(token)`             | `Job.move_to_wait(job, token)`             |
| `job.extendLock(token, duration)`   | `Job.extend_lock(job, token, duration)`    |
| `worker.startStalledCheckTimer()`   | `Worker.start_stalled_check_timer(worker)` |

## See Also

- [Job Cancellation](job_cancellation.md) - Cooperative cancellation for long-running jobs
- [Rate Limiting](rate_limiting.md) - Built-in rate limiting support
