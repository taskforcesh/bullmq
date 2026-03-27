# Deduplication

Deduplication in BullMQ is a process where job execution is delayed and deduplicated based on specific identifiers. It ensures that within a specified period, or until a specific job is completed or failed, no new jobs with the same identifier will be added to the queue. Instead, these attempts will trigger a deduplicated event.

## Simple Mode

The Simple Mode extends the deduplication duration until the job's completion or failure. This means that as long as the job remains in an incomplete state (neither succeeded nor failed), any subsequent job with the same deduplication ID will be ignored.

```typescript
// Add a job that will be deduplicated as this record is not finished (completed or failed).
await myQueue.add(
  'house',
  { color: 'white' },
  { deduplication: { id: 'customValue' } },
);
```

While this job is not moved to completed or failed state, next jobs added with same **deduplication id** will be ignored and a _deduplicated_ event will be triggered by our QueueEvent class.

This mode is particularly useful for jobs that have a long running time or those that must not be duplicated until they are resolved, such as processing a file upload or performing a critical update that should not be repeated if the initial attempt is still in progress.

## Throttle Mode

In the Throttle Mode, deduplication works by assigning a delay (Time to Live, TTL) to a job upon its creation. If a similar job (identified by a unique deduplication ID) is added during this delay period, it is ignored. This prevents the queue from being overwhelmed with multiple instances of the same task, thus optimizing the processing time and resource utilization.

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

In this example, after adding the house painting job with the deduplicated parameters (id and ttl), any subsequent job with the same deduplication ID customValue added within 5 seconds will be ignored. This is useful for scenarios where rapid, repetitive requests are made, such as multiple users or processes attempting to trigger the same job.

## Debounce Mode

Debounce Mode can be achieved by delaying a job upon creation while providing a matching TTL as well as having extend and replace options set as true. Debounce is achieved because if another job with the same deduplication ID is added during this delay (and TTL period) it will replace the previous job with the new one, as well as reseting the TTL, thus ensuring that only the most recent job is kept. This mechanism avoids flooding the queue with duplicates while maintaining the latest job's data.

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

In this example, after adding the house painting job with the deduplicated parameters (id, ttl and replace) and 5 seconds as delay, any subsequent job with the same deduplication options added within 5 seconds will replace previous job information. This is useful for scenarios where rapid, repetitive requests are made, such as multiple users or processes attempting to trigger the same job but with different payloads, this way you will get the last updated data when processing a job.

Note that you must provide a deduplication id that should represent your job. You can hash your entire job data or a subset of attributes for creating this identifier.

{% hint style="warning" %}
Any manual deletion will disable the deduplication. For example, when calling _job.remove_ method.
{% endhint %}

## The Deduplicated Event

The **deduplicated** event is emitted whenever a job is deduplicated (ignored or replaced) due to deduplication in Simple Mode, Throttle Mode, or Debounce Mode. This event allows you to monitor deduplication activity and take action if needed, such as logging the occurrence or notifying a user that their request was ignored.

### Listening for the Deduplicated Event

To listen for the **deduplicated** event, use the `QueueEvents` class from BullMQ:

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

In this example:

- `jobId`: The Id of the job that will be retained in the queue.
- `deduplicationId`: The deduplication Id that caused the deduplication.
- `deduplicatedJobId`: The Id of the job that was deduplicated (ignored or replaced).

## Get Deduplication Job Id

If you need to know the id of the job that started the deduplicated state, you can call the **getDeduplicationJobId** method.

```typescript
const jobId = await myQueue.getDeduplicationJobId('customValue');
```

## Remove Deduplication Key

If you need to stop deduplication before ttl finishes or before finishing a job, you can call the **queue.removeDeduplicationKey** method.

```typescript
await myQueue.removeDeduplicationKey('customValue');
```

Or if you want to stop deduplication only if a specific job is the one that caused the deduplication

```typescript
const isDeduplicatedKeyRemoved = await job.removeDeduplicationKey();
```

## Keep Last If Active Mode

In some use cases, you need to ensure that a job runs at least once after each time new data becomes available, even if a job with the same deduplication ID is already being processed. Common examples include data synchronization, cache invalidation, and deployment pipelines.

With `keepLastIfActive: true`, when a job is added while an existing job with the same deduplication ID is already active (being processed), the new job's data is stored internally. Once the active job finishes (either completes or fails), a new job is automatically created with the latest stored data and added to the queue.

If multiple jobs are added while the active job is running, only the most recent data is kept — earlier additions are overwritten. This guarantees:

- **No parallel execution**: At most 1 job per deduplication ID is active at any time.
- **At most 2 jobs**: 1 active + 1 waiting (created on completion/failure).
- **Latest data wins**: The next job always uses the most recently added data.
- **Normal deduplication when not active**: If the existing job is in waiting or delayed state, jobs are deduplicated as usual.

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

- 💡 [Add Job API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#add)
- 💡 [Queue Remove Deduplication Key API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#removededuplicationkey)
- 💡 [Job Remove Deduplication Key API Reference](https://api.docs.bullmq.io/classes/v5.Job.html#removededuplicationkey)
- 💡 [Deduplication Patterns](../../patterns/deduplication.md)
