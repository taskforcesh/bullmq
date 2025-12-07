# Queue Events

BullMQ provides real-time event subscriptions through Redis Streams, allowing you to monitor job lifecycle events across your queue.

## Overview

There are two ways to receive job events in BullMQ for Elixir:

1. **Worker Callbacks** - Direct callbacks on the worker for jobs it processes
2. **QueueEvents** - Centralized event listener for all jobs in a queue

Use **Worker Callbacks** when you want to react to events for jobs processed by a specific worker. Use **QueueEvents** when you need to monitor all events across a queue, regardless of which worker processes them.

## Worker Callbacks (Recommended)

The simplest way to handle events is through worker callbacks:

```elixir
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "emails",
  connection: :my_redis,
  processor: &process/1,

  on_completed: fn job, result ->
    Logger.info("Job #{job.id} completed: #{inspect(result)}")
  end,

  on_failed: fn job, reason ->
    Logger.error("Job #{job.id} failed: #{reason}")
  end,

  on_active: fn job ->
    Logger.debug("Job #{job.id} started")
  end
)
```

See [Workers](workers.md) for more details on worker callbacks.

## QueueEvents

For monitoring all queue events (including jobs processed by other workers or Node.js workers), use `BullMQ.QueueEvents`:

```elixir
{:ok, events} = BullMQ.QueueEvents.start_link(
  queue: "emails",
  connection: :my_redis
)

# Subscribe the current process
BullMQ.QueueEvents.subscribe(events)

# Receive events
receive do
  {:bullmq_event, :completed, data} ->
    IO.puts("Job #{data["jobId"]} completed!")

  {:bullmq_event, :failed, data} ->
    IO.puts("Job #{data["jobId"]} failed: #{data["failedReason"]}")

  {:bullmq_event, :waiting, data} ->
    IO.puts("Job #{data["jobId"]} waiting")
end
```

## Event Types

The following events are emitted:

| Event        | Description                    | Data Fields                     |
| ------------ | ------------------------------ | ------------------------------- |
| `:added`     | Job was added to the queue     | `jobId`, `name`                 |
| `:waiting`   | Job is waiting to be processed | `jobId`                         |
| `:active`    | Job started processing         | `jobId`, `prev`                 |
| `:progress`  | Job progress was updated       | `jobId`, `data`                 |
| `:completed` | Job completed successfully     | `jobId`, `returnvalue`, `prev`  |
| `:failed`    | Job failed                     | `jobId`, `failedReason`, `prev` |
| `:delayed`   | Job was delayed                | `jobId`, `delay`                |
| `:stalled`   | Job was detected as stalled    | `jobId`                         |
| `:removed`   | Job was removed                | `jobId`, `prev`                 |
| `:drained`   | Queue has no more waiting jobs | (no data)                       |
| `:paused`    | Queue was paused               | (no data)                       |
| `:resumed`   | Queue was resumed              | (no data)                       |

## Message Format

Events are sent as tuples with the format:

```elixir
{:bullmq_event, event_type, event_data}
```

Where:

- `event_type` is an atom (`:completed`, `:failed`, etc.)
- `event_data` is a map with string keys

```elixir
# Example completed event
{:bullmq_event, :completed, %{
  "event" => "completed",
  "jobId" => "abc123",
  "returnvalue" => "null",
  "prev" => "active"
}}
```

## QueueEvents Options

```elixir
{:ok, events} = BullMQ.QueueEvents.start_link(
  queue: "my_queue",           # Queue name (required)
  connection: :my_redis,       # Redis connection (required)
  prefix: "bull",              # Queue prefix (default: "bull")
  autorun: true,               # Start listening immediately (default: true)
  last_event_id: "$",          # Start from event ID (default: "$" = new events)
  handler: MyEventHandler,     # Handler module (optional)
  handler_state: %{}           # Initial handler state (optional)
)
```

## Multiple Subscribers

Multiple processes can subscribe to the same QueueEvents instance:

```elixir
{:ok, events} = BullMQ.QueueEvents.start_link(
  queue: "tasks",
  connection: :my_redis
)

# Subscribe multiple processes
BullMQ.QueueEvents.subscribe(events)  # subscribes self()
BullMQ.QueueEvents.subscribe(events, other_pid)

# Unsubscribe when done
BullMQ.QueueEvents.unsubscribe(events)
BullMQ.QueueEvents.unsubscribe(events, other_pid)
```

## Handler Module Pattern

For more structured event handling, implement a handler module:

```elixir
defmodule MyApp.QueueHandler do
  @behaviour BullMQ.QueueEvents.Handler

  require Logger

  @impl true
  def handle_event(:completed, %{"jobId" => id, "returnvalue" => value}, state) do
    Logger.info("Job #{id} completed with: #{value}")
    {:ok, state}
  end

  @impl true
  def handle_event(:failed, %{"jobId" => id, "failedReason" => reason}, state) do
    Logger.error("Job #{id} failed: #{reason}")
    MyApp.Alerts.notify_failure(id, reason)
    {:ok, state}
  end

  @impl true
  def handle_event(:drained, _data, state) do
    Logger.info("Queue drained - no more waiting jobs")
    {:ok, state}
  end

  @impl true
  def handle_event(_event, _data, state) do
    # Ignore other events
    {:ok, state}
  end
end

# Use the handler
{:ok, events} = BullMQ.QueueEvents.start_link(
  queue: "tasks",
  connection: :my_redis,
  handler: MyApp.QueueHandler,
  handler_state: %{notifications_sent: 0}
)
```

## Delayed Start

You can start QueueEvents without immediately listening for events:

```elixir
{:ok, events} = BullMQ.QueueEvents.start_link(
  queue: "tasks",
  connection: :my_redis,
  autorun: false  # Don't start listening yet
)

# Later, start listening
BullMQ.QueueEvents.run(events)
```

## Closing QueueEvents

```elixir
# Close the event listener
BullMQ.QueueEvents.close(events)
```

## Example: Monitoring Dashboard

Here's an example of using QueueEvents for a simple monitoring dashboard:

```elixir
defmodule MyApp.QueueMonitor do
  use GenServer

  def start_link(queue_name) do
    GenServer.start_link(__MODULE__, queue_name, name: __MODULE__)
  end

  def init(queue_name) do
    {:ok, events} = BullMQ.QueueEvents.start_link(
      queue: queue_name,
      connection: :my_redis
    )
    BullMQ.QueueEvents.subscribe(events)

    {:ok, %{
      events: events,
      completed: 0,
      failed: 0,
      active: 0
    }}
  end

  def handle_info({:bullmq_event, :completed, _data}, state) do
    {:noreply, %{state | completed: state.completed + 1, active: state.active - 1}}
  end

  def handle_info({:bullmq_event, :failed, _data}, state) do
    {:noreply, %{state | failed: state.failed + 1, active: state.active - 1}}
  end

  def handle_info({:bullmq_event, :active, _data}, state) do
    {:noreply, %{state | active: state.active + 1}}
  end

  def handle_info({:bullmq_event, _event, _data}, state) do
    {:noreply, state}
  end

  def get_stats do
    GenServer.call(__MODULE__, :get_stats)
  end

  def handle_call(:get_stats, _from, state) do
    {:reply, %{
      completed: state.completed,
      failed: state.failed,
      active: state.active
    }, state}
  end
end
```

## Supervision

Add QueueEvents to your supervision tree:

```elixir
children = [
  {Redix, name: :my_redis, host: "localhost"},

  {BullMQ.QueueEvents,
    queue: "important-queue",
    connection: :my_redis,
    handler: MyApp.ImportantQueueHandler
  }
]
```

## Node.js Compatibility

QueueEvents is fully compatible with Node.js BullMQ. Events emitted by Node.js workers are received by Elixir QueueEvents listeners, and vice versa.

## Next Steps

- Learn about [Workers](workers.md) and their callbacks
- Set up [Telemetry](telemetry.md) for metrics
- Create recurring jobs with [Job Schedulers](job_schedulers.md)
