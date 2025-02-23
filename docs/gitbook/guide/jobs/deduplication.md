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

Note that you must provide a deduplication id that should represent your job. You can hash your entire job data or a subset of attributes for creating this identifier.

{% hint style="warning" %}
Any manual deletion will disable the deduplication. For example, when calling _job.remove_ method.
{% endhint %}

## Get Deduplication Job Id

If you need to know the id of the job that started the deduplicated state, you can call the **getDeduplicationJobId** method.

```typescript
const jobId = await myQueue.getDeduplicationJobId('customValue');
```

## Remove Deduplication Key

If you need to stop deduplication before ttl finishes or before finishing a job, you can call the **removeDeduplicationKey** method.

```typescript
await myQueue.removeDeduplicationKey('customValue');
```

## Read more:

- 💡 [Add Job API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#add)
- 💡 [Remove Deduplication Key API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#removeDeduplicationKey)
