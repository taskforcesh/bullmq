# Workers

Workers are the actual instances that perform some job based on the jobs that are added in the queue. A worker is equivalent to a "message" receiver in a traditional message queue. The worker's duty is to complete the job. If it succeeds, the job will be moved to the "completed" status. If the worker throws an exception during its processing, the job will automatically be moved to the "failed" status.

{% hint style="info" %}
Failed jobs can be automatically retried, see [Retrying failing jobs](../retrying-failing-jobs.md)
{% endhint %}

A worker is instantiated with the `Worker` class, and the work itself will be performed in the _process function_. Process functions are meant to be asynchronous, using either the `async` keyword or returning a promise.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Worker, Job } from 'bullmq';

const worker = new Worker(queueName, async (job: Job) => {
  // Optionally report some progress
  await job.updateProgress(42);

  // Optionally sending an object as progress
  await job.updateProgress({ foo: 'bar' });

  // Do something with job
  return 'some value';
});
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Worker

async def process(job, token):
    # Optionally report some progress
    await job.updateProgress(42)

    # Optionally sending an object as progress
    await job.updateProgress({"foo": "bar"})

    # Do something with job
    return "some value"

worker = Worker(queue_name, process)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: queue_name,
    connection: :my_redis,
    processor: fn job ->
      # Optionally report some progress
      BullMQ.Worker.update_progress(job, 42)

      # Optionally sending an object as progress
      BullMQ.Worker.update_progress(job, %{foo: "bar"})

      # Do something with job
      {:ok, "some value"}
    end
  )
```

{% endtab %}

{% tab title=".NET" %}

```csharp
using BullMQ;

var worker = new Worker(
    queueName,
    async (job, cancellationToken) =>
    {
        // Optionally report some progress
        await job.UpdateProgressAsync(42);

        // Optionally sending an object as progress
        await job.UpdateProgressAsync(new { foo = "bar" });

        // Do something with job
        return "some value";
    },
    new WorkerOptions { Connection = ConnectionOptions.FromString("localhost:6379") });
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::worker::CancellationToken;
use bullmq::{Job, JobProgress, Worker};

let worker = Worker::new(queue_name, |mut job: Job, _token: CancellationToken| async move {
    // Optionally report some progress
    job.update_progress(JobProgress::Number(42.0)).await?;

    // Optionally sending an object as progress
    job.update_progress(JobProgress::Object(serde_json::json!({ "foo": "bar" })))
        .await?;

    // Do something with job
    Ok(serde_json::json!("some value"))
})
.await?;
```

{% endtab %}
{% endtabs %}

The processor function can also receive an optional third parameter for job cancellation support:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const worker = new Worker(
  queueName,
  async (job: Job, token?: string, signal?: AbortSignal) => {
    // signal can be used to detect when a job has been cancelled
    return 'some value';
  },
);
```

{% endtab %}

{% tab title="Python" %}

```python
async def process(job, token, signal):
    # signal can be used to detect when a job has been cancelled
    return "some value"

worker = Worker(queue_name, process)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: queue_name,
    connection: :my_redis,
    processor: fn job, cancel_token ->
      # cancel_token can be used to detect when a job has been cancelled
      {:ok, "some value"}
    end
  )
```

{% endtab %}

{% tab title="Rust" %}

```rust
let worker = Worker::new(queue_name, |job: Job, token: CancellationToken| async move {
    // token can be used to detect when a job has been cancelled
    Ok(serde_json::json!("some value"))
})
.await?;
```

{% endtab %}
{% endtabs %}

{% hint style="info" %}
Learn more about [cancelling jobs](cancelling-jobs.md) in the dedicated guide.
{% endhint %}

{% hint style="info" %}
When a worker instance is created, it launches the processor immediately
{% endhint %}

In order to decide when your processor should start its execution, pass `autorun: false` as part of worker options:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Worker, Job } from 'bullmq';

const worker = new Worker(
  queueName,
  async (job: Job) => {
    // Optionally report some progress
    await job.updateProgress(42);

    // Optionally sending an object as progress
    await job.updateProgress({ foo: 'bar' });

    // Do something with job
    return 'some value';
  },
  { autorun: false },
);

worker.run();
```

{% endtab %}

{% tab title="Python" %}

```python
import asyncio
from bullmq import Worker

async def process(job, token):
    # Optionally report some progress
    await job.updateProgress(42)

    # Optionally sending an object as progress
    await job.updateProgress({"foo": "bar"})

    # Do something with job
    return "some value"

worker = Worker(queue_name, process, {"autorun": False})

asyncio.ensure_future(worker.run())
```

{% endtab %}

{% tab title=".NET" %}

```csharp
using BullMQ;

var worker = new Worker(
    queueName,
    async (job, cancellationToken) =>
    {
        // Optionally report some progress
        await job.UpdateProgressAsync(42);

        // Optionally sending an object as progress
        await job.UpdateProgressAsync(new { foo = "bar" });

        // Do something with job
        return "some value";
    },
    new WorkerOptions
    {
        Connection = ConnectionOptions.FromString("localhost:6379"),
        Autorun = false,
    });

_ = worker.RunAsync();
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::worker::CancellationToken;
use bullmq::{Job, JobProgress, Worker, WorkerOptions};

let worker = Worker::with_options(
    queue_name,
    |mut job: Job, _token: CancellationToken| async move {
        // Optionally report some progress
        job.update_progress(JobProgress::Number(42.0)).await?;

        // Optionally sending an object as progress
        job.update_progress(JobProgress::Object(serde_json::json!({ "foo": "bar" })))
            .await?;

        // Do something with job
        Ok(serde_json::json!("some value"))
    },
    WorkerOptions::new().autorun(false),
)
.await?;

worker.run().await?;
```

{% endtab %}
{% endtabs %}

Note that a processor can optionally return a value. This value can be retrieved either by getting the job and accessing the `returnvalue` property or by listening to the `completed` event:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
worker.on('completed', (job: Job, returnvalue: any) => {
  // Do something with the return value.
});
```

{% endtab %}

{% tab title="Python" %}

```python
def on_completed(job, returnvalue):
    # Do something with the return value.
    pass

worker.on("completed", on_completed)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: queue_name,
    connection: :my_redis,
    processor: &MyApp.Jobs.process/1,
    on_completed: fn job, return_value ->
      # Do something with the return value.
      :ok
    end
  )
```

{% endtab %}

{% tab title=".NET" %}

```csharp
worker.Completed += (job, returnValue) =>
{
    // Do something with the return value.
};
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::worker::WorkerEvent;

while let Some(event) = worker.next_event().await {
    if let WorkerEvent::Completed { job_id, result } = event {
        // Do something with the return value.
    }
}
```

{% endtab %}
{% endtabs %}

#### Progress

Inside the worker process function it is also possible to emit progress events. Calling `job.progress` you can specify a number or an object if you have more complex needs. The `progress` event can be listened for in the same way as the `completed` event:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
worker.on('progress', (job: Job, progress: number | object) => {
  // Do something with the return value.
});
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: queue_name,
    connection: :my_redis,
    processor: &MyApp.Jobs.process/1,
    on_progress: fn job, progress ->
      # Do something with the return value.
      :ok
    end
  )
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::worker::WorkerEvent;

while let Some(event) = worker.next_event().await {
    if let WorkerEvent::Progress { job_id, progress } = event {
        // Do something with the return value.
    }
}
```

{% endtab %}
{% endtabs %}

Finally, when the process fails with an exception it is possible to listen for the `failed` event too:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
worker.on('failed', (job: Job | undefined, error: Error, prev: string) => {
  // Do something with the return value.
});
```

{% endtab %}

{% tab title="Python" %}

```python
def on_failed(job, error):
    # Do something with the return value.
    pass

worker.on("failed", on_failed)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: queue_name,
    connection: :my_redis,
    processor: &MyApp.Jobs.process/1,
    on_failed: fn job, reason ->
      # Do something with the return value.
      :ok
    end
  )
```

{% endtab %}

{% tab title=".NET" %}

```csharp
worker.Failed += (job, error) =>
{
    // Do something with the return value.
};
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::worker::WorkerEvent;

while let Some(event) = worker.next_event().await {
    if let WorkerEvent::Failed { job_id, error } = event {
        // Do something with the return value.
    }
}
```

{% endtab %}
{% endtabs %}

It is also possible to listen to global events in order to get notifications of job completions, progress and failures:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { QueueEvents } from 'bullmq';

const queueEvents = new QueueEvents('Paint');

queueEvents.on('completed', ({ jobId, returnvalue }) => {
  // Called every time a job is completed by any worker.
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  // Called whenever a job is moved to failed by any worker.
});

queueEvents.on('progress', ({ jobId, data }) => {
  // jobId received a progress event
});
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import QueueEvents

queue_events = QueueEvents("Paint")

def on_completed(args, event_id):
    # Called every time a job is completed by any worker.
    job_id, returnvalue = args["jobId"], args["returnvalue"]

def on_failed(args, event_id):
    # Called whenever a job is moved to failed by any worker.
    job_id, failed_reason = args["jobId"], args["failedReason"]

def on_progress(args, event_id):
    # jobId received a progress event
    job_id, data = args["jobId"], args["data"]

queue_events.on("completed", on_completed)
queue_events.on("failed", on_failed)
queue_events.on("progress", on_progress)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, queue_events} =
  BullMQ.QueueEvents.start_link(queue: "Paint", connection: :my_redis)

:ok = BullMQ.QueueEvents.subscribe(queue_events)

receive do
  {:bullmq_event, :completed, %{"jobId" => job_id, "returnvalue" => returnvalue}} ->
    # Called every time a job is completed by any worker.
    :ok

  {:bullmq_event, :failed, %{"jobId" => job_id, "failedReason" => failed_reason}} ->
    # Called whenever a job is moved to failed by any worker.
    :ok

  {:bullmq_event, :progress, %{"jobId" => job_id, "data" => data}} ->
    # jobId received a progress event
    :ok
end
```

{% endtab %}

{% tab title=".NET" %}

```csharp
using BullMQ;

var queueEvents = new QueueEvents(
    "Paint",
    new QueueEventsOptions { Connection = ConnectionOptions.FromString("localhost:6379") });

queueEvents.Completed += e =>
{
    // Called every time a job is completed by any worker.
    var (jobId, returnValue) = (e.JobId, e.ReturnValue);
};

queueEvents.Failed += e =>
{
    // Called whenever a job is moved to failed by any worker.
    var (jobId, failedReason) = (e.JobId, e.FailedReason);
};

queueEvents.Progress += e =>
{
    // jobId received a progress event
    var (jobId, data) = (e.JobId, e.Data);
};
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::{QueueEvent, QueueEvents};

let queue_events = QueueEvents::new("Paint").await?;

while let Some(entry) = queue_events.next_event().await {
    match entry.event {
        QueueEvent::Completed { job_id, return_value, .. } => {
            // Called every time a job is completed by any worker.
        }
        QueueEvent::Failed { job_id, failed_reason, .. } => {
            // Called whenever a job is moved to failed by any worker.
        }
        QueueEvent::Progress { job_id, data } => {
            // jobId received a progress event
        }
        _ => {}
    }
}
```

{% endtab %}
{% endtabs %}

Finally, you should attach an error listener to your worker to avoid NodeJS raising an unhandled exception when an error occurs. For example:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
worker.on('error', err => {
  // log the error
  console.error(err);
});
```

{% endtab %}

{% tab title="Python" %}

```python
def on_error(err, job=None):
    # log the error
    print(err)

worker.on("error", on_error)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: queue_name,
    connection: :my_redis,
    processor: &MyApp.Jobs.process/1,
    on_error: fn err ->
      # log the error
      IO.inspect(err, label: "error")
    end
  )
```

{% endtab %}

{% tab title=".NET" %}

```csharp
worker.Error += err =>
{
    // log the error
    Console.Error.WriteLine(err);
};
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::worker::WorkerEvent;

while let Some(event) = worker.next_event().await {
    if let WorkerEvent::Error(err) = event {
        // log the error
        eprintln!("{err}");
    }
}
```

{% endtab %}
{% endtabs %}

{% hint style="danger" %}
If the error handler is missing, your worker may stop processing jobs when an error is emitted! Find more info [here](https://nodejs.org/api/events.html#events_error_events).
{% endhint %}

## Typescript typings

It is also possible to specify the data types for the Job data and return value using generics:

```typescript
const worker = new Worker<MyData, MyReturn>(queueName, async (job: Job) => {});
```

By default the job progress is typed as `string | boolean | number | object`. If you report progress with a specific shape, you can also specify a progress type so that `updateProgress` and the `progress` event are type-safe:

```typescript
import { Worker, RedisQueueBackend } from 'bullmq';

type MyProgress = { percentage: number; message: string };

const worker = new Worker<
  MyData,
  MyReturn,
  string,
  RedisQueueBackend,
  MyProgress
>(queueName, async job => {
  // progress is checked against MyProgress
  await job.updateProgress({ percentage: 42, message: 'halfway' });
});

worker.on('progress', (job, progress) => {
  console.log(progress.percentage, progress.message);
});
```

{% hint style="info" %}
The progress type must be JSON-serializable, as progress is persisted in the queue's backend. Sandboxed processors always receive the default progress type, since the value crosses a process boundary.
{% endhint %}

## Read more:

- 💡 [Worker API Reference](https://docs.bullmq.io/api/classes/v6.Worker.html)
- 💡 [Queue Events API Reference](https://docs.bullmq.io/api/classes/v6.QueueEvents.html)
