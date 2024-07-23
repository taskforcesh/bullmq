# Debouncing

Debouncing a job implies delaying and deduplicating it.

## Fixed Mode

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('Paint');

// Add a job that will be debounced for 5 seconds.
await myQueue.add(
  'house',
  { color: 'white' },
  { debouncing: { id: 'customValue', ttl: 5000 } },
);
```

For the next 5 seconds, after adding this job, next jobs added with same **debounce id** will be ignored and a _debounced_ event will be triggered by our QueueEvent class.

Note that you must provide a debounce id that should represent your job. You can hash your entire job data or a subset of attributes for creating this identifier.

## Extended Mode

```typescript
// Add a job that will be debounced as this record is not finished (completed or failed).
await myQueue.add(
  'house',
  { color: 'white' },
  { debouncing: { id: 'customValue' } },
);
```

While this job is not moved to completed or failed state, next jobs added with same **debounce id** will be ignored and a _debounced_ event will be triggered by our QueueEvent class.

## Read more:

- 💡 [Add Job API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#add)
