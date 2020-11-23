# Retrying failing jobs

When a processor throws an exception, the worker will catch it and move the job to the failed set. But sometimes it may be desirable to retry a failed job.

BullMQ support retries of failed jobs using backoff functions. It is possible to use the built in backoff functions or provide custom ones.

For BullMQ to reschedule failed jobs, make sure you create a `QueueScheduler` for your queue.

The code below shows how to specify a "exponential" backoff function with a 1 second delay as seed value, so it will retry at most 3 times spaced after 1 second, 2 seconds and 4 seconds:

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('foo');
 
await queue.add(
  'test-retry',
  { foo: 'bar' },
  {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
);
```

The current built-in backoff functions are "exponential" and "fixed".

If you want to define your custom backoff you need to define it at the worker:

```typescript
import { Worker } from 'bullmq';

const worker = new Worker(
  'foo',
  async job => doSomeProcessing(),
  {
    settings: {
      backoffStrategies: {
        custom(attemptsMade: number) {
          return attemptsMade * 1000;
        },
      },
    },
  },
);
```

You can then use your "custom" strategy when adding jobs:

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('foo');
 
await queue.add(
  'test-retry',
  { foo: 'bar' },
  {
    attempts: 3,
    backoff: {
      type: 'custom',
    },
  },
);
```

