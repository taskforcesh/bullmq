# Debouncing

Debouncing in BullMQ is a process where job execution is delayed and deduplicated based on specific identifiers. It ensures that within a specified period, or until a specific job is completed or failed, no new jobs with the same identifier will be added to the queue. Instead, these attempts will trigger a debounced event.

## Fixed Mode

In the Fixed Mode, debouncing works by assigning a delay (Time to Live, TTL) to a job upon its creation. If a similar job (identified by a unique debouncer ID) is added during this delay period, it is ignored. This prevents the queue from being overwhelmed with multiple instances of the same task, thus optimizing the processing time and resource utilization.

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('Paint');

// Add a job that will be debounced for 5 seconds.
await myQueue.add(
  'house',
  { color: 'white' },
  { debounce: { id: 'customValue', ttl: 5000 } },
);
```

In this example, after adding the house painting job with the debouncing parameters (id and ttl), any subsequent job with the same debouncing ID customValue added within 5 seconds will be ignored. This is useful for scenarios where rapid, repetitive requests are made, such as multiple users or processes attempting to trigger the same job.

Note that you must provide a debounce id that should represent your job. You can hash your entire job data or a subset of attributes for creating this identifier.

## Extended Mode

The Extended Mode takes a different approach by extending the debouncing duration until the job's completion or failure. This means as long as the job remains in an incomplete state (neither succeeded nor failed), any subsequent job with the same debouncer ID will be ignored.

```typescript
// Add a job that will be debounced as this record is not finished (completed or failed).
await myQueue.add(
  'house',
  { color: 'white' },
  { debounce: { id: 'customValue' } },
);
```

While this job is not moved to completed or failed state, next jobs added with same **debounce id** will be ignored and a _debounced_ event will be triggered by our QueueEvent class.

This mode is particularly useful for jobs that have a long running time or those that must not be duplicated until they are resolved, such as processing a file upload or performing a critical update that should not be repeated if the initial attempt is still in progress.

## Read more:

- 💡 [Add Job API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#add)
