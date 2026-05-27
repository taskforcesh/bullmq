# Job Cancellation

BullMQ Elixir provides cooperative job cancellation, allowing you to gracefully stop running jobs. This is useful for implementing timeouts, user-initiated cancellations, or graceful shutdown.

## Overview

Job cancellation in BullMQ Elixir is:

- **Cooperative**: Processors must check for cancellation; BullMQ cannot forcibly stop a running function
- **Efficient**: O(1) cancellation checks using Erlang's native message passing
- **Scalable**: Zero overhead per job - tokens are just references, no ETS or GenServer
- **Non-blocking**: Uses `receive after 0` pattern for instant checks

## How It Works

When you define a processor with arity 2 (two arguments), it receives the job and a cancellation token:

```elixir
processor: fn job, cancel_token ->
  # cancel_token is a reference
  # Check your mailbox for {:cancel, ^cancel_token, reason}
  {:ok, result}
end
```

When `Worker.cancel_job/3` is called, BullMQ sends a `{:cancel, token, reason}` message to the task running your processor. Your processor can check for this message using various patterns.

## Usage Patterns

### Pattern 1: Receive After 0 (Recommended)

Best for processors that do chunked work. The `receive after 0` pattern is non-blocking and O(1):

```elixir
processor: fn job, cancel_token ->
  Enum.reduce_while(job.data.items, {:ok, []}, fn item, {:ok, acc} ->
    receive do
      {:cancel, ^cancel_token, reason} ->
        # Cancellation requested
        {:halt, {:error, {:cancelled, reason}}}
    after
      0 ->
        # No cancellation, process this item
        result = process_item(item)
        {:cont, {:ok, [result | acc]}}
    end
  end)
end
```

Key points:

- `^cancel_token` uses pin operator to match your specific token
- `after 0` makes the receive non-blocking
- Returns immediately if no cancellation message

### Pattern 2: Wrap Blocking Operations

For operations that block (HTTP calls, database queries, etc.), wrap them in a Task:

```elixir
processor: fn job, cancel_token ->
  # Start the blocking operation in a Task
  task = Task.async(fn ->
    HTTPClient.post(job.data.url, job.data.body)
  end)

  # Wait for either completion or cancellation
  receive do
    {:cancel, ^cancel_token, reason} ->
      # Cancel requested - kill the task
      Task.shutdown(task, :brutal_kill)
      {:error, {:cancelled, reason}}

    {^task, {:ok, response}} ->
      {:ok, response}

    {^task, {:error, _} = error} ->
      error
  end
end
```

### Pattern 3: Using CancellationToken.check/1

For simpler checkpoint-style cancellation:

```elixir
alias BullMQ.CancellationToken

processor: fn job, cancel_token ->
  result1 = step_one(job.data)

  case CancellationToken.check(cancel_token) do
    {:cancelled, reason} -> {:error, {:cancelled, reason}}
    :ok ->
      result2 = step_two(result1)

      case CancellationToken.check(cancel_token) do
        {:cancelled, reason} -> {:error, {:cancelled, reason}}
        :ok -> {:ok, step_three(result2)}
      end
  end
end
```

Or use `check!/1` which raises on cancellation:

```elixir
processor: fn job, cancel_token ->
  CancellationToken.check!(cancel_token)
  result1 = step_one(job.data)

  CancellationToken.check!(cancel_token)
  result2 = step_two(result1)

  CancellationToken.check!(cancel_token)
  {:ok, step_three(result2)}
end
```

### Pattern 4: Recursive Processing

For recursive algorithms:

```elixir
defmodule MyProcessor do
  def process(job, cancel_token) do
    process_items(job.data.items, cancel_token, [])
  end

  defp process_items([], _token, acc), do: {:ok, Enum.reverse(acc)}

  defp process_items([item | rest], token, acc) do
    receive do
      {:cancel, ^token, reason} ->
        {:error, {:cancelled, reason}}
    after
      0 ->
        result = process_item(item)
        process_items(rest, token, [result | acc])
    end
  end

  defp process_item(item), do: item * 2
end

# Use in worker
processor: &MyProcessor.process/2
```

## Cancelling Jobs

### Cancel a Specific Job

```elixir
# Cancel by job ID
:ok = Worker.cancel_job(worker, job_id, "User requested cancellation")

# Returns {:error, :not_found} if job is not active
{:error, :not_found} = Worker.cancel_job(worker, "unknown-id", "reason")
```

### Cancel All Active Jobs

Useful for graceful shutdown:

```elixir
:ok = Worker.cancel_all_jobs(worker, "Worker shutting down")
```

### Automatic Cancellation on Lock Loss

BullMQ automatically cancels jobs when their lock renewal fails. This can happen due to:

- Network connectivity issues with Redis
- Redis server problems or restarts
- Lock TTL expired before renewal could complete

When a lock is lost, the processor receives a cancellation with reason `{:lock_lost, job_id}`:

```elixir
processor: fn job, cancel_token ->
  Enum.reduce_while(job.data.items, {:ok, []}, fn item, {:ok, acc} ->
    receive do
      {:cancel, ^cancel_token, {:lock_lost, _job_id}} ->
        # Lock was lost - another worker may process this job
        Logger.warning("Lock lost, stopping to avoid duplicates")
        {:halt, {:error, :lock_lost}}
      {:cancel, ^cancel_token, reason} ->
        {:halt, {:error, {:cancelled, reason}}}
    after
      0 ->
        result = process_item(item)
        {:cont, {:ok, [result | acc]}}
    end
  end)
end
```

This prevents duplicate processing when another worker picks up the same job after the lock expires.

## Backward Compatibility

Processors with arity 1 continue to work without cancellation support:

```elixir
# Old-style processor - still works
processor: fn job ->
  {:ok, process(job)}
end
```

## Best Practices

### 1. Check Cancellation at Safe Points

Only check for cancellation when it's safe to stop:

```elixir
processor: fn job, cancel_token ->
  # Start transaction
  {:ok, tx} = Database.begin_transaction()

  try do
    # Do work within transaction
    result = do_work(tx, job.data)

    # Check cancellation AFTER transaction work but BEFORE commit
    case CancellationToken.check(cancel_token) do
      {:cancelled, reason} ->
        Database.rollback(tx)
        {:error, {:cancelled, reason}}
      :ok ->
        Database.commit(tx)
        {:ok, result}
    end
  rescue
    e ->
      Database.rollback(tx)
      reraise e, __STACKTRACE__
  end
end
```

### 2. Clean Up Resources on Cancellation

```elixir
processor: fn job, cancel_token ->
  {:ok, file} = File.open(job.data.path, [:write])

  try do
    write_with_cancellation(file, job.data.content, cancel_token)
  after
    File.close(file)
  end
end

defp write_with_cancellation(file, content, token) do
  chunks = chunk_content(content)

  Enum.reduce_while(chunks, :ok, fn chunk, :ok ->
    receive do
      {:cancel, ^token, reason} ->
        {:halt, {:error, {:cancelled, reason}}}
    after
      0 ->
        IO.write(file, chunk)
        {:cont, :ok}
    end
  end)
end
```

### 3. Use Appropriate Timeouts for Tasks

```elixir
processor: fn job, cancel_token ->
  task = Task.async(fn -> external_api_call(job.data) end)

  receive do
    {:cancel, ^cancel_token, reason} ->
      Task.shutdown(task, :brutal_kill)
      {:error, {:cancelled, reason}}

    {^task, result} ->
      result
  after
    30_000 ->
      # Timeout - treat as failure
      Task.shutdown(task, :brutal_kill)
      {:error, :timeout}
  end
end
```

## Error Handling

When a job is cancelled, you can return an error or let it fail:

```elixir
# Return error tuple - job will be marked as failed
{:error, {:cancelled, reason}}

# Raise exception - same result
raise "Job cancelled: #{reason}"
```

The job will follow normal failure/retry logic based on its configuration.

## Distributed Cancellation

When running workers across multiple Elixir nodes, you can use OTP's built-in distributed messaging to propagate cancellation requests. This is more efficient and reliable than Redis Pub/Sub for Elixir-to-Elixir communication.

### Using Process Groups (`:pg`)

The recommended approach uses Erlang's `:pg` module (process groups) to track all workers and broadcast cancellations:

```elixir
defmodule MyApp.WorkerRegistry do
  @moduledoc """
  Registry for distributed worker cancellation using :pg process groups.
  """

  @group :bullmq_workers

  def start_link do
    # Ensure :pg is started (usually in application.ex)
    :pg.start_link(@group)
  end

  @doc "Register a worker in the process group"
  def register(worker_pid, queue_name) do
    :pg.join(@group, {__MODULE__, queue_name}, worker_pid)
  end

  @doc "Unregister a worker"
  def unregister(worker_pid, queue_name) do
    :pg.leave(@group, {__MODULE__, queue_name}, worker_pid)
  end

  @doc "Cancel a job across all workers on all nodes"
  def cancel_job(queue_name, job_id, reason \\ nil) do
    workers = :pg.get_members(@group, {__MODULE__, queue_name})

    for worker <- workers do
      Worker.cancel_job(worker, job_id, reason)
    end

    :ok
  end

  @doc "Cancel a job on workers in a specific node"
  def cancel_job(queue_name, job_id, reason, node) do
    workers = :pg.get_local_members(@group, {__MODULE__, queue_name})
    |> Enum.filter(&(node(&1) == node))

    for worker <- workers do
      Worker.cancel_job(worker, job_id, reason)
    end

    :ok
  end
end
```

Usage:

```elixir
# In your application.ex
def start(_type, _args) do
  children = [
    {MyApp.WorkerRegistry, []},
    # ... other children
  ]

  Supervisor.start_link(children, strategy: :one_for_one)
end

# When starting a worker
{:ok, worker} = Worker.start_link(
  queue: "my-queue",
  connection: conn,
  processor: &MyProcessor.process/2
)
MyApp.WorkerRegistry.register(worker, "my-queue")

# Cancel from anywhere in the cluster
MyApp.WorkerRegistry.cancel_job("my-queue", job_id, "User cancelled")
```

### Using GenServer.multi_call

For simpler cases, you can use `GenServer.multi_call/4` to call all workers directly:

```elixir
defmodule MyApp.DistributedCancellation do
  @doc "Cancel a job across all connected nodes"
  def cancel_job(worker_name, job_id, reason \\ nil) do
    nodes = [node() | Node.list()]

    # Call all workers registered with the same name across nodes
    {replies, bad_nodes} = GenServer.multi_call(
      nodes,
      worker_name,
      {:cancel_job, job_id, reason},
      5_000
    )

    case bad_nodes do
      [] -> :ok
      _ -> {:partial, replies, bad_nodes}
    end
  end
end
```

This requires workers to be registered with the same name across nodes.

## Node.js Interoperability

If you need to cancel jobs from Node.js (or vice versa), you can create a simple Redis Pub/Sub bridge. This keeps the Elixir side clean while enabling cross-language cancellation.

### Redis Pub/Sub Bridge

```elixir
defmodule MyApp.CancellationBridge do
  @moduledoc """
  Bridges Redis Pub/Sub cancellation messages to Elixir workers.

  Node.js can publish to Redis, and this bridge forwards
  cancellation requests to the appropriate Elixir workers.
  """

  use GenServer
  require Logger

  @channel "bullmq:cancel"

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(opts) do
    redis_opts = Keyword.fetch!(opts, :redis)
    worker_registry = Keyword.get(opts, :worker_registry, MyApp.WorkerRegistry)

    # Start a dedicated Redis connection for Pub/Sub
    {:ok, pubsub} = Redix.PubSub.start_link(redis_opts)
    {:ok, _ref} = Redix.PubSub.subscribe(pubsub, @channel, self())

    {:ok, %{pubsub: pubsub, worker_registry: worker_registry}}
  end

  @impl true
  def handle_info(
    {:redix_pubsub, _pubsub, _ref, :message, %{channel: @channel, payload: payload}},
    state
  ) do
    case Jason.decode(payload) do
      {:ok, %{"queue" => queue, "jobId" => job_id, "reason" => reason}} ->
        Logger.info("Received cancellation from Redis: #{queue}/#{job_id}")
        state.worker_registry.cancel_job(queue, job_id, reason)

      {:ok, %{"queue" => queue, "jobId" => job_id}} ->
        Logger.info("Received cancellation from Redis: #{queue}/#{job_id}")
        state.worker_registry.cancel_job(queue, job_id, nil)

      {:error, error} ->
        Logger.warning("Invalid cancellation payload: #{inspect(error)}")
    end

    {:noreply, state}
  end

  def handle_info({:redix_pubsub, _pubsub, _ref, :subscribed, _}, state) do
    Logger.info("CancellationBridge subscribed to #{@channel}")
    {:noreply, state}
  end

  def handle_info(msg, state) do
    Logger.debug("CancellationBridge received: #{inspect(msg)}")
    {:noreply, state}
  end

  @impl true
  def terminate(_reason, state) do
    Redix.PubSub.stop(state.pubsub)
    :ok
  end
end
```

### Node.js Side

```typescript
import { createClient } from 'redis';

const CANCEL_CHANNEL = 'bullmq:cancel';

async function cancelJob(queue: string, jobId: string, reason?: string) {
  const client = createClient();
  await client.connect();

  const message = JSON.stringify({ queue, jobId, reason });
  await client.publish(CANCEL_CHANNEL, message);

  await client.quit();
}

// Usage
await cancelJob('my-queue', 'job-123', 'User cancelled');
```

### Complete Setup Example

```elixir
# In your application.ex
def start(_type, _args) do
  redis_opts = [host: "localhost", port: 6379]

  children = [
    # Worker registry for distributed cancellation
    {MyApp.WorkerRegistry, []},

    # Redis bridge for Node.js interop (optional)
    {MyApp.CancellationBridge, redis: redis_opts, worker_registry: MyApp.WorkerRegistry},

    # Your workers
    {Worker,
      name: :my_worker,
      queue: "my-queue",
      connection: redis_opts,
      processor: &MyProcessor.process/2
    }
  ]

  Supervisor.start_link(children, strategy: :one_for_one)
end
```

This architecture gives you:

1. **Elixir-to-Elixir**: Fast, reliable cancellation via OTP's `:pg` (no Redis overhead)
2. **Node.js-to-Elixir**: Redis Pub/Sub bridge forwards to Elixir workers
3. **Elixir-to-Node.js**: Publish to Redis from Elixir if needed
4. **Separation of concerns**: The bridge is optional and isolated

## Performance Considerations

- **Token creation**: O(1) - just `make_ref()`
- **Cancellation check**: O(1) - `receive after 0` scans mailbox once
- **Cancel notification**: O(1) - direct `send/2` to task process
- **Memory**: One reference per active job (8 bytes on 64-bit)

The implementation has zero overhead for jobs that don't use cancellation - processors with arity 1 don't create or check tokens.
