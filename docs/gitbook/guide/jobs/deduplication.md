# Deduplication

Deduplication in BullMQ is a process where job execution is delayed and deduplicated based on specific identifiers. It ensures that within a specified period, or until a specific job is completed or failed, no new jobs with the same identifier will be added to the queue. Instead, these attempts will trigger a deduplicated event.

## Simple Mode

The Simple Mode extends the deduplication duration until the job's completion or failure. This means that as long as the job remains in an incomplete state (neither succeeded nor failed), any subsequent job with the same deduplication ID will be ignored.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
// Add a job that will be deduplicated as this record is not finished (completed or failed).
await myQueue.add(
  'house',
  { color: 'white' },
  { deduplication: { id: 'customValue' } },
);
```

{% endtab %}

{% tab title="Python" %}

```python
# Add a job that will be deduplicated as this record is not finished (completed or failed).
await queue.add(
    'house',
    {'color': 'white'},
    {'deduplication': {'id': 'customValue'}},
)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
# Add a job that will be deduplicated as this record is not finished (completed or failed).
BullMQ.Queue.add("Paint", "house", %{color: "white"},
  connection: :my_redis,
  deduplication: %{id: "customValue"}
)
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::DeduplicationOptions;

// Add a job that will be deduplicated as this record is not finished (completed or failed).
queue
    .add("house", serde_json::json!({ "color": "white" }))
    .deduplication(DeduplicationOptions {
        id: "customValue".into(),
        ..Default::default()
    })
    .await?;
```

{% endtab %}

{% tab title="PHP" %}

```php
// Add a job that will be deduplicated as this record is not finished (completed or failed).
$queue->add('house', ['color' => 'white'], [
    'deduplication' => ['id' => 'customValue'],
]);
```

{% endtab %}
{% endtabs %}

While this job is not moved to completed or failed state, next jobs added with same **deduplication id** will be ignored and a _deduplicated_ event will be triggered by our QueueEvent class.

This mode is particularly useful for jobs that have a long running time or those that must not be duplicated until they are resolved, such as processing a file upload or performing a critical update that should not be repeated if the initial attempt is still in progress.

## Rescheduling a Delayed Job

On PostgreSQL, intermediate obliteration batches lock only deduplication rows
pointing to their selected jobs, using an indexed winner lookup. Deleting a
parent cascades to its logs and dependency records, not its child jobs. The
final batch locks all remaining queue deduplication rows before deleting jobs
and cleaning up keys. This preserves bounded intermediate batches and prevents
the dedup/job lock inversion during concurrent rescheduling and final cleanup.
Producers are not excluded for the entire multi-batch obliteration; pausing a
queue only pauses processing, not adds.

Completion and failure acquire shared transaction advisory locks for their
queue and any direct parent's queue before locking rows. Obliteration acquires
the corresponding exclusive lock for each batch, so forced deletion cannot
invert job/dedup locks with finalization. Finish-and-fetch retains the shared
lock through its fetch; ordinary finalizations can still run concurrently.

PostgreSQL bulk adds and flows acquire all deduplication advisory locks in
lock-key order before modifying jobs. This prevents a bulk reschedule from
holding a delayed job row while waiting on a finishing job's deduplication
lock, allowing finish-and-fetch to promote that delayed job safely.

Set `reschedule: true` to apply the incoming job's delay to an existing job with
the same deduplication ID, but only while that job is still delayed. Unlike
`replace`, this preserves the original job ID, name, data, and other options.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
await myQueue.add(
  'house',
  { color: 'white' },
  {
    delay: 5000,
    deduplication: { id: 'house', reschedule: true },
  },
);

await myQueue.add(
  'house',
  { color: 'blue' },
  {
    delay: 8000,
    deduplication: { id: 'house', reschedule: true },
  },
);
```

{% endtab %}
{% tab title="Python" %}

```python
await myQueue.add("house", {"color": "white"}, {
    "delay": 5000,
    "deduplication": {"id": "house", "reschedule": True},
})
await myQueue.add("house", {"color": "blue"}, {
    "delay": 8000,
    "deduplication": {"id": "house", "reschedule": True},
})
```

{% endtab %}
{% tab title="Elixir" %}

```elixir
BullMQ.Queue.add("Paint", "house", %{color: "white"},
  connection: :my_redis,
  delay: 5000,
  deduplication: %{id: "house", reschedule: true}
)
BullMQ.Queue.add("Paint", "house", %{color: "blue"},
  connection: :my_redis,
  delay: 8000,
  deduplication: %{id: "house", reschedule: true}
)
```

{% endtab %}
{% tab title="Rust" %}

```rust
use bullmq::DeduplicationOptions;
use std::time::Duration;

for (color, delay) in [("white", 5000), ("blue", 8000)] {
    queue
        .add("house", serde_json::json!({ "color": color }))
        .delay(Duration::from_millis(delay))
        .deduplication(DeduplicationOptions {
            id: "house".into(),
            reschedule: Some(true),
            ..Default::default()
        })
        .await?;
}
```

{% endtab %}
{% tab title="PHP" %}

```php
$queue->add('house', ['color' => 'white'], [
    'delay' => 5000,
    'deduplication' => ['id' => 'house', 'reschedule' => true],
]);
$queue->add('house', ['color' => 'blue'], [
    'delay' => 8000,
    'deduplication' => ['id' => 'house', 'reschedule' => true],
]);
```

{% endtab %}
{% tab title=".NET" %}

```csharp
await queue.AddAsync("house", new { color = "white" }, new JobsOptions
{
    Delay = 5000,
    Deduplication = new DeduplicationOptions { Id = "house", Reschedule = true },
});
await queue.AddAsync("house", new { color = "blue" }, new JobsOptions
{
    Delay = 8000,
    Deduplication = new DeduplicationOptions { Id = "house", Reschedule = true },
});
```

{% endtab %}
{% endtabs %}

The original job keeps `{ color: 'white' }` and becomes eligible for processing
8000 milliseconds after the second add's timestamp. The delay can be shortened
or lengthened; an omitted or zero delay makes the delayed job eligible
immediately, subject to worker availability.

Rescheduling is independent of TTL management. Combine it with `ttl` and
`extend: true` to refresh the deduplication window as well. If the deduplication
key has expired, a new job is added normally instead.

Jobs that are no longer delayed are not rescheduled, and existing deduplication
behavior (including `keepLastIfActive`) is preserved. If `replace: true` is also
provided, replacement takes precedence over rescheduling. Rescheduling emits a
`delayed` event for the existing job as well as the usual `deduplicated` event.

## Throttle Mode

In the Throttle Mode, deduplication works by assigning a delay (Time to Live, TTL) to a job upon its creation. If a similar job (identified by a unique deduplication ID) is added during this delay period, it is ignored. This prevents the queue from being overwhelmed with multiple instances of the same task, thus optimizing the processing time and resource utilization.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('Paint');

// Add a job that will be deduplicated for 5 seconds.
await myQueue.add(
  'house',
  { color: 'white' },
  { deduplication: { id: 'customValue', ttl: 5000 } },
);
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Queue

queue = Queue('Paint')

# Add a job that will be deduplicated for 5 seconds.
await queue.add(
    'house',
    {'color': 'white'},
    {'deduplication': {'id': 'customValue', 'ttl': 5000}},
)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
# Add a job that will be deduplicated for 5 seconds.
BullMQ.Queue.add("Paint", "house", %{color: "white"},
  connection: :my_redis,
  deduplication: %{id: "customValue", ttl: 5000}
)
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::{DeduplicationOptions, Queue};

let queue = Queue::new("Paint").await?;

// Add a job that will be deduplicated for 5 seconds.
queue
    .add("house", serde_json::json!({ "color": "white" }))
    .deduplication(DeduplicationOptions {
        id: "customValue".into(),
        ttl: Some(5000),
        ..Default::default()
    })
    .await?;
```

{% endtab %}

{% tab title="PHP" %}

```php
<?php

use BullMQ\Queue;

$queue = new Queue('Paint');

// Add a job that will be deduplicated for 5 seconds.
$queue->add('house', ['color' => 'white'], [
    'deduplication' => ['id' => 'customValue', 'ttl' => 5000],
]);
```

{% endtab %}
{% endtabs %}

In this example, after adding the house painting job with the deduplicated parameters (id and ttl), any subsequent job with the same deduplication ID customValue added within 5 seconds will be ignored. This is useful for scenarios where rapid, repetitive requests are made, such as multiple users or processes attempting to trigger the same job.

## Debounce Mode

Debounce Mode can be achieved by delaying a job upon creation while providing a matching TTL as well as having extend and replace options set as true. Debounce is achieved because if another job with the same deduplication ID is added during this delay (and TTL period) it will replace the previous job with the new one, as well as resetting the TTL, thus ensuring that only the most recent job is kept. This mechanism avoids flooding the queue with duplicates while maintaining the latest job's data.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('Paint');

const worker = new Worker('Paint', async () => {});

worker.once('completed', job => {
  // only one instance is completed and
  // 9 additions were ignored
  console.log(job.data.color); // `white 10`
});

// Add 10 jobs with deduplication option in debounce mode.
for (let i = 1; i < 11; i++) {
  await myQueue.add(
    'house1',
    { color: `white ${i}` },
    {
      deduplication: {
        id: 'customValue',
        ttl: 5000,
        extend: true,
        replace: true,
      },
      delay: 5000,
    },
  );
}
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Queue, Worker

queue = Queue('Paint')

async def process(job, token):
    pass

worker = Worker('Paint', process)

def on_completed(job, result):
    # only one instance is completed and
    # 9 additions were ignored
    print(job.data['color'])  # `white 10`

worker.on('completed', on_completed)

# Add 10 jobs with deduplication option in debounce mode.
for i in range(1, 11):
    await queue.add(
        'house1',
        {'color': f'white {i}'},
        {
            'deduplication': {
                'id': 'customValue',
                'ttl': 5000,
                'extend': True,
                'replace': True,
            },
            'delay': 5000,
        },
    )
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, _worker} =
  BullMQ.Worker.start_link(
    queue: "Paint",
    connection: :my_redis,
    processor: fn _job -> :ok end,
    on_completed: fn job, _result ->
      # only one instance is completed and
      # 9 additions were ignored
      IO.puts(job.data["color"]) # `white 10`
    end
  )

# Add 10 jobs with deduplication option in debounce mode.
for i <- 1..10 do
  BullMQ.Queue.add("Paint", "house1", %{color: "white #{i}"},
    connection: :my_redis,
    deduplication: %{
      id: "customValue",
      ttl: 5000,
      extend: true,
      replace: true
    },
    delay: 5000
  )
end
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::worker::WorkerEvent;
use bullmq::{DeduplicationOptions, Job, Queue, Worker};
use std::time::Duration;

let queue = Queue::new("Paint").await?;

let worker = Worker::new("Paint", |_job: Job, _token| async move {
    Ok(serde_json::Value::Null)
})
.await?;

// Add 10 jobs with deduplication option in debounce mode.
for i in 1..11 {
    queue
        .add("house1", serde_json::json!({ "color": format!("white {i}") }))
        .deduplication(DeduplicationOptions {
            id: "customValue".into(),
            ttl: Some(5000),
            extend: Some(true),
            replace: Some(true),
            ..Default::default()
        })
        .delay(Duration::from_millis(5000))
        .await?;
}

while let Some(event) = worker.next_event().await {
    if let WorkerEvent::Completed { job_id, .. } = event {
        // only one instance is completed and
        // 9 additions were ignored
        let job = queue.get_job(&job_id).await?.unwrap();
        println!("{}", job.data()["color"]); // `white 10`
        break;
    }
}
```

{% endtab %}
{% endtabs %}

In this example, after adding the house painting job with the deduplicated parameters (id, ttl and replace) and 5 seconds as delay, any subsequent job with the same deduplication options added within 5 seconds will replace previous job information. This is useful for scenarios where rapid, repetitive requests are made, such as multiple users or processes attempting to trigger the same job but with different payloads, this way you will get the last updated data when processing a job.

Note that you must provide a deduplication id that should represent your job. You can hash your entire job data or a subset of attributes for creating this identifier.

{% hint style="warning" %}
Any manual deletion will disable the deduplication. For example, when calling _job.remove_ method.
{% endhint %}

## The Deduplicated Event

The **deduplicated** event is emitted whenever a job is deduplicated (ignored or replaced) due to deduplication in Simple Mode, Throttle Mode, or Debounce Mode. This event allows you to monitor deduplication activity and take action if needed, such as logging the occurrence or notifying a user that their request was ignored.

### Listening for the Deduplicated Event

To listen for the **deduplicated** event, use the `QueueEvents` class from BullMQ:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { QueueEvents } from 'bullmq';

const queueEvents = new QueueEvents('myQueue');

queueEvents.on(
  'deduplicated',
  ({ jobId, deduplicationId, deduplicatedJobId }, id) => {
    console.log(`Job ${deduplicatedJobId} was deduplicated due to existing job ${jobId} 
  with deduplication ID ${deduplicationId}`);
  },
);
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import QueueEvents

queue_events = QueueEvents('myQueue')

def on_deduplicated(args, id):
    print(f"Job {args['deduplicatedJobId']} was deduplicated due to existing job {args['jobId']} "
          f"with deduplication ID {args['deduplicationId']}")

queue_events.on('deduplicated', on_deduplicated)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, queue_events} =
  BullMQ.QueueEvents.start_link(queue: "myQueue", connection: :my_redis)

:ok = BullMQ.QueueEvents.subscribe(queue_events)

receive do
  {:bullmq_event, :deduplicated,
   %{
     "jobId" => job_id,
     "deduplicationId" => deduplication_id,
     "deduplicatedJobId" => deduplicated_job_id
   }} ->
    IO.puts("""
    Job #{deduplicated_job_id} was deduplicated due to existing job #{job_id}
    with deduplication ID #{deduplication_id}
    """)
end
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::{QueueEvent, QueueEvents};

let queue_events = QueueEvents::new("myQueue").await?;

while let Some(entry) = queue_events.next_event().await {
    if let QueueEvent::Deduplicated {
        job_id,
        deduplication_id,
        deduplicated_job_id,
    } = entry.event
    {
        println!(
            "Job {} was deduplicated due to existing job {job_id} with deduplication ID {deduplication_id}",
            deduplicated_job_id.unwrap_or_default()
        );
    }
}
```

{% endtab %}
{% endtabs %}

In this example:

- `jobId`: The Id of the job that will be retained in the queue.
- `deduplicationId`: The deduplication Id that caused the deduplication.
- `deduplicatedJobId`: The Id of the job that was deduplicated (ignored or replaced).

## Get Deduplication Job Id

If you need to know the id of the job that started the deduplicated state, you can call the **getDeduplicationJobId** method.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const jobId = await myQueue.getDeduplicationJobId('customValue');
```

{% endtab %}

{% tab title="Python" %}

```python
job_id = await queue.getDeduplicationJobId('customValue')
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, job_id} =
  BullMQ.Queue.get_deduplication_job_id("Paint", "customValue", connection: :my_redis)
```

{% endtab %}

{% tab title="Rust" %}

```rust
let job_id = queue.get_deduplication_job_id("customValue").await?;
```

{% endtab %}
{% endtabs %}

## Remove Deduplication Key

If you need to stop deduplication before ttl finishes or before finishing a job, you can call the **queue.removeDeduplicationKey** method.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
await myQueue.removeDeduplicationKey('customValue');
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, _removed} =
  BullMQ.Queue.remove_deduplication_key("Paint", "customValue", connection: :my_redis)
```

{% endtab %}
{% endtabs %}

Or if you want to stop deduplication only if a specific job is the one that caused the deduplication

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const isDeduplicatedKeyRemoved = await job.removeDeduplicationKey();
```

{% endtab %}

{% tab title="Rust" %}

```rust
let is_deduplicated_key_removed = queue
    .remove_deduplication_key("customValue", job.id())
    .await?;
```

{% endtab %}
{% endtabs %}

## Keep Last If Active Mode

In some use cases, you need to ensure that a job runs at least once after each time new data becomes available, even if a job with the same deduplication ID is already being processed. Common examples include data synchronization, cache invalidation, and deployment pipelines.

With `keepLastIfActive: true`, when a job is added while an existing job with the same deduplication ID is already active (being processed), the new job's data is stored internally. Once the active job finishes (either completes or fails), a new job is automatically created with the latest stored data and added to the queue.

If multiple jobs are added while the active job is running, only the most recent data is kept — earlier additions are overwritten. This guarantees:

- **No parallel execution**: At most 1 job per deduplication ID is active at any time.
- **At most 2 jobs**: 1 active + 1 waiting (created on completion/failure).
- **Latest data wins**: The next job always uses the most recently added data.
- **Normal deduplication when not active**: If the existing job is in waiting or delayed state, jobs are deduplicated as usual.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue, Worker } from 'bullmq';

const deployQueue = new Queue('Deploy');

const worker = new Worker('Deploy', async job => {
  console.log(`Deploying commit ${job.data.commit}`);
  // ... perform deployment
});

// Webhook handler: multiple pushes may arrive while a deploy is running
async function onGitPush(commitData) {
  await deployQueue.add(
    'deploy',
    { commit: commitData.sha },
    {
      deduplication: {
        id: `deploy-${commitData.repo}`,
        keepLastIfActive: true,
      },
    },
  );
}

// Push 1 at 0ms: Job added and starts processing
// Push 2 at 100ms (job active): Data stored, deduplicated event emitted
// Push 3 at 5000ms (job still active): Data overwritten with latest
// Push 4 at 5100ms (job still active): Data overwritten again
// Job completes at 10000ms: New job created with Push 4's data
// Result: Exactly 2 deployments, the last one always reflects the latest push
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Queue, Worker

deploy_queue = Queue('Deploy')

async def process(job, token):
    print(f"Deploying commit {job.data['commit']}")
    # ... perform deployment

worker = Worker('Deploy', process)

# Webhook handler: multiple pushes may arrive while a deploy is running
async def on_git_push(commit_data):
    await deploy_queue.add(
        'deploy',
        {'commit': commit_data['sha']},
        {
            'deduplication': {
                'id': f"deploy-{commit_data['repo']}",
                'keepLastIfActive': True,
            },
        },
    )

# Push 1 at 0ms: Job added and starts processing
# Push 2 at 100ms (job active): Data stored, deduplicated event emitted
# Push 3 at 5000ms (job still active): Data overwritten with latest
# Push 4 at 5100ms (job still active): Data overwritten again
# Job completes at 10000ms: New job created with Push 4's data
# Result: Exactly 2 deployments, the last one always reflects the latest push
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, _worker} =
  BullMQ.Worker.start_link(
    queue: "Deploy",
    connection: :my_redis,
    processor: fn job ->
      IO.puts("Deploying commit #{job.data["commit"]}")
      # ... perform deployment
      :ok
    end
  )

# Webhook handler: multiple pushes may arrive while a deploy is running
on_git_push = fn commit_data ->
  BullMQ.Queue.add("Deploy", "deploy", %{commit: commit_data.sha},
    connection: :my_redis,
    deduplication: %{
      id: "deploy-#{commit_data.repo}",
      keep_last_if_active: true
    }
  )
end

# Push 1 at 0ms: Job added and starts processing
# Push 2 at 100ms (job active): Data stored, deduplicated event emitted
# Push 3 at 5000ms (job still active): Data overwritten with latest
# Push 4 at 5100ms (job still active): Data overwritten again
# Job completes at 10000ms: New job created with Push 4's data
# Result: Exactly 2 deployments, the last one always reflects the latest push
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::{DeduplicationOptions, Job, Queue, Worker};

let deploy_queue = Queue::new("Deploy").await?;

let worker = Worker::new("Deploy", |job: Job, _token| async move {
    println!("Deploying commit {}", job.data()["commit"]);
    // ... perform deployment
    Ok(serde_json::Value::Null)
})
.await?;

// Webhook handler: multiple pushes may arrive while a deploy is running
async fn on_git_push(deploy_queue: &Queue, sha: &str, repo: &str) -> bullmq::Result<()> {
    deploy_queue
        .add("deploy", serde_json::json!({ "commit": sha }))
        .deduplication(DeduplicationOptions {
            id: format!("deploy-{repo}"),
            keep_last_if_active: Some(true),
            ..Default::default()
        })
        .await?;
    Ok(())
}

// Push 1 at 0ms: Job added and starts processing
// Push 2 at 100ms (job active): Data stored, deduplicated event emitted
// Push 3 at 5000ms (job still active): Data overwritten with latest
// Push 4 at 5100ms (job still active): Data overwritten again
// Job completes at 10000ms: New job created with Push 4's data
// Result: Exactly 2 deployments, the last one always reflects the latest push
```

{% endtab %}
{% endtabs %}

{% hint style="info" %}
When `keepLastIfActive` is set, the `ttl` option is ignored. The dedup key is kept alive (without expiry) for the entire duration the job exists, ensuring no parallel execution regardless of processing time. The key is cleaned up automatically when the job completes or fails.
{% endhint %}

{% hint style="warning" %}
When the active job is retried (e.g., due to `attempts` configuration), the stored next-job data is preserved and the new job will only be created once the active job ultimately completes or exhausts all retries.
{% endhint %}

{% hint style="info" %}
`keepLastIfActive` can be combined with the `delay` option to create a **continuous debounce** pattern. When a delayed job is waiting and a new job arrives, the waiting job is replaced with the latest data. When the active job completes and a stored next-job exists, it is requeued with the original delay, restarting the debounce window. This ensures that rapid bursts of data are collapsed while still guaranteeing processing of the most recent update.
{% endhint %}

## Read more:

- 💡 [Add Job API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#add)
- 💡 [Queue Remove Deduplication Key API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#removededuplicationkey)
- 💡 [Job Remove Deduplication Key API Reference](https://docs.bullmq.io/api/classes/v6.Job.html#removededuplicationkey)
- 💡 [Deduplication Patterns](../../patterns/deduplication.md)
