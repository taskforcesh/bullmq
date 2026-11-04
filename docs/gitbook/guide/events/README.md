# Events

All classes in BullMQ emit useful events that inform on the lifecycles of the jobs that are running in the queue. Every class is an `EventEmitter` and emits different events.

Some examples:

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('Paint');

myQueue.on('waiting', (job: Job) => {
  // Job is waiting to be processed.
});
```

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Worker } from 'bullmq';

const myWorker = new Worker('Paint');

myWorker.on('drained', () => {
  // Queue is drained, no more jobs left
});

myWorker.on('completed', (job: Job) => {
  // job has completed
});

myWorker.on('failed', (job: Job) => {
  // job has failed
});
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Worker

myWorker = Worker("Paint", process)

def on_completed(job, result):
    # job has completed
    pass

def on_failed(job, err):
    # job has failed
    pass

myWorker.on("completed", on_completed)
myWorker.on("failed", on_failed)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, my_worker} =
  BullMQ.Worker.start_link(
    queue: "Paint",
    connection: :my_redis,
    processor: &MyApp.process/1,
    on_completed: fn _job, _result ->
      # job has completed
      :ok
    end,
    on_failed: fn _job, _reason ->
      # job has failed
      :ok
    end
  )
```

{% endtab %}

{% tab title=".NET" %}

```csharp
using BullMQ;

var myWorker = new Worker("Paint", processor, new WorkerOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
});

myWorker.Drained += () =>
{
    // Queue is drained, no more jobs left
};

myWorker.Completed += (job, result) =>
{
    // job has completed
};

myWorker.Failed += (job, error) =>
{
    // job has failed
};
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::worker::WorkerEvent;
use bullmq::Worker;

let my_worker = Worker::new("Paint", processor).await?;

while let Some(event) = my_worker.next_event().await {
    match event {
        WorkerEvent::Drained => {
            // Queue is drained, no more jobs left
        }
        WorkerEvent::Completed { job_id, result } => {
            // job has completed
        }
        WorkerEvent::Failed { job_id, error } => {
            // job has failed
        }
        _ => {}
    }
}
```

{% endtab %}
{% endtabs %}

The events above are local for the workers that actually completed the jobs. However, in many situations you want to listen to all the events emitted by all the workers in one single place. For this you can use the [`QueueEvents`](https://docs.bullmq.io/api/classes/v6.QueueEvents.html) class:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { QueueEvents } from 'bullmq';

const queueEvents = new QueueEvents('Paint');

queueEvents.on('completed', ({ jobId }) => {
  // Called every time a job is completed in any worker.
});

queueEvents.on(
  'progress',
  ({ jobId, data }: { jobId: string; data: number | object }) => {
    // jobId received a progress event
  },
);
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import QueueEvents

queueEvents = QueueEvents("Paint")

def on_completed(args, id):
    jobId = args["jobId"]
    # Called every time a job is completed in any worker.

def on_progress(args, id):
    jobId, data = args["jobId"], args["data"]
    # jobId received a progress event

queueEvents.on("completed", on_completed)
queueEvents.on("progress", on_progress)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
defmodule PaintEvents do
  use BullMQ.QueueEvents.Handler

  @impl true
  def handle_event(:completed, %{"jobId" => _job_id}, state) do
    # Called every time a job is completed in any worker.
    {:ok, state}
  end

  def handle_event(:progress, %{"jobId" => _job_id, "data" => _data}, state) do
    # jobId received a progress event
    {:ok, state}
  end

  def handle_event(_event, _data, state), do: {:ok, state}
end

{:ok, queue_events} =
  BullMQ.QueueEvents.start_link(queue: "Paint", connection: :my_redis, handler: PaintEvents)
```

{% endtab %}

{% tab title=".NET" %}

```csharp
using BullMQ;

var queueEvents = new QueueEvents("Paint", new QueueEventsOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
});

queueEvents.Completed += e =>
{
    // Called every time a job is completed in any worker.
};

queueEvents.Progress += e =>
{
    // e.JobId received a progress event (e.Data)
};
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::{QueueEvent, QueueEvents};

let queue_events = QueueEvents::new("Paint").await?;

while let Some(entry) = queue_events.next_event().await {
    match entry.event {
        QueueEvent::Completed { job_id, .. } => {
            // Called every time a job is completed in any worker.
        }
        QueueEvent::Progress { job_id, data } => {
            // job_id received a progress event
        }
        _ => {}
    }
}
```

{% endtab %}
{% endtabs %}

The `QueueEvents` class is implemented using [Redis streams](https://redis.io/topics/streams-intro). This has some nice properties, for example, it provides guarantees that the events are delivered and not lost during disconnections such as it would be the case with standard pub-sub.

{% hint style="danger" %}
The event stream is auto-trimmed so that its size does not grow too much, by default it is \~10.000 events, but this can be configured with the `streams.events.maxLen` option.
{% endhint %}

## Real-time updates

Local `Worker` / `Queue` listeners only see events in the current process.
`QueueEvents` is the usual building block for **real-time updates** across
workers: dashboards, websockets, SSE, or another service that must react while
jobs run.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { QueueEvents } from 'bullmq';

const queueEvents = new QueueEvents('Paint', { connection });

queueEvents.on('completed', ({ jobId, returnvalue }) => {
  sendToDashboard({ type: 'completed', jobId, returnvalue });
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  sendToDashboard({ type: 'failed', jobId, failedReason });
});

queueEvents.on(
  'progress',
  ({ jobId, data }: { jobId: string; data: number | object }) => {
    sendToDashboard({ type: 'progress', jobId, data });
  },
);
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import QueueEvents

queueEvents = QueueEvents("Paint", {"connection": connection})

queueEvents.on("completed", lambda args, id: sendToDashboard(
    {"type": "completed", "jobId": args["jobId"], "returnvalue": args["returnvalue"]}
))

queueEvents.on("failed", lambda args, id: sendToDashboard(
    {"type": "failed", "jobId": args["jobId"], "failedReason": args["failedReason"]}
))

queueEvents.on("progress", lambda args, id: sendToDashboard(
    {"type": "progress", "jobId": args["jobId"], "data": args["data"]}
))
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
defmodule DashboardEvents do
  use BullMQ.QueueEvents.Handler

  @impl true
  def handle_event(:completed, %{"jobId" => job_id, "returnvalue" => returnvalue}, state) do
    send_to_dashboard(%{type: "completed", job_id: job_id, returnvalue: returnvalue})
    {:ok, state}
  end

  def handle_event(:failed, %{"jobId" => job_id, "failedReason" => failed_reason}, state) do
    send_to_dashboard(%{type: "failed", job_id: job_id, failed_reason: failed_reason})
    {:ok, state}
  end

  def handle_event(:progress, %{"jobId" => job_id, "data" => data}, state) do
    send_to_dashboard(%{type: "progress", job_id: job_id, data: data})
    {:ok, state}
  end

  def handle_event(_event, _data, state), do: {:ok, state}
end

{:ok, queue_events} =
  BullMQ.QueueEvents.start_link(
    queue: "Paint",
    connection: :my_redis,
    handler: DashboardEvents
  )
```

{% endtab %}

{% tab title=".NET" %}

```csharp
using BullMQ;

var queueEvents = new QueueEvents("Paint", new QueueEventsOptions { Connection = connection });

queueEvents.Completed += e =>
    SendToDashboard(new { type = "completed", jobId = e.JobId, returnvalue = e.ReturnValue });

queueEvents.Failed += e =>
    SendToDashboard(new { type = "failed", jobId = e.JobId, failedReason = e.FailedReason });

queueEvents.Progress += e =>
    SendToDashboard(new { type = "progress", jobId = e.JobId, data = e.Data });
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::{QueueEvent, QueueEvents, QueueEventsOptions};
use serde_json::json;

let queue_events = QueueEvents::with_options(
    "Paint",
    QueueEventsOptions {
        connection,
        ..Default::default()
    },
)
.await?;

while let Some(entry) = queue_events.next_event().await {
    match entry.event {
        QueueEvent::Completed { job_id, return_value, .. } => {
            send_to_dashboard(json!({ "type": "completed", "jobId": job_id, "returnvalue": return_value }));
        }
        QueueEvent::Failed { job_id, failed_reason, .. } => {
            send_to_dashboard(json!({ "type": "failed", "jobId": job_id, "failedReason": failed_reason }));
        }
        QueueEvent::Progress { job_id, data } => {
            send_to_dashboard(json!({ "type": "progress", "jobId": job_id, "data": data }));
        }
        _ => {}
    }
}
```

{% endtab %}
{% endtabs %}

Publish progress from the worker with `job.updateProgress(...)` (number or
object). That pairs well with [working with batches](../queues/batches.md)
when one job represents many items, or when you want a live bar for a long job:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
await job.updateProgress({ completed: 3, total: 10 });
```

{% endtab %}

{% tab title="Python" %}

```python
await job.updateProgress({"completed": 3, "total": 10})
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
:ok = BullMQ.Worker.update_progress(job, %{completed: 3, total: 10})
```

{% endtab %}

{% tab title=".NET" %}

```csharp
await job.UpdateProgressAsync(new { completed = 3, total = 10 });
```

{% endtab %}

{% tab title="Rust" %}

```rust
job.update_progress(bullmq::JobProgress::Object(serde_json::json!({ "completed": 3, "total": 10 })))
    .await?;
```

{% endtab %}
{% endtabs %}

Close `QueueEvents` on shutdown so its Redis connection is released:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
await queueEvents.close();
```

{% endtab %}

{% tab title="Python" %}

```python
await queueEvents.close()
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
:ok = BullMQ.QueueEvents.close(queue_events)
```

{% endtab %}

{% tab title=".NET" %}

```csharp
await queueEvents.CloseAsync();
```

{% endtab %}

{% tab title="Rust" %}

```rust
queue_events.close().await;
```

{% endtab %}
{% endtabs %}

{% hint style="info" %}
For jobs processed with [BullMQ Pro batches](../../bullmq-pro/batches.md),
worker-local `completed` / `failed` listeners see the wrapper batch job. Use
`QueueEvents` / `QueueEventsPro` when you need per-job lifecycle events.
{% endhint %}

### Manual trim events

In case you need to trim your events manually, you can use **`trimEvents`** method:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

await queue.trimEvents(10); // leaves 10 events
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Queue

queue = Queue("paint")

await queue.trimEvents(10)  # leaves 10 events
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::Queue;

let queue = Queue::new("paint").await?;

queue.trim_events(10).await?; // leaves 10 events
```

{% endtab %}
{% endtabs %}

## Read more:

- 💡 [Queue Events API Reference](https://docs.bullmq.io/api/classes/v6.QueueEvents.html)
- 💡 [Queue Events Listener API Reference](https://docs.bullmq.io/api/interfaces/v6.QueueEventsListener.html)
- 💡 [Queue Listener API Reference](https://docs.bullmq.io/api/interfaces/v6.QueueListener.html)
- 💡 [Worker Listener API Reference](https://docs.bullmq.io/api/interfaces/v6.WorkerListener.html)
