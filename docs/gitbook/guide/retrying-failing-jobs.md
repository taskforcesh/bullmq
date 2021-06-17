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

You can also define it in the queue's `defaultJobOptions`, and it will apply to all jobs added to the queue, unless overridden. For example:

```typescript
import { Queue } from "bullmq";

const myQueue = new Queue("foo", {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000
    }
  }
});

await queue.add(
  "test-retry",
  { foo: "bar" }
);
```

The current built-in backoff functions are "exponential" and "fixed".

With an exponential backoff, it will retry after `2 ^ attempts * delay` milliseconds. For example, with a delay of 3000 milliseconds, for the 7th attempt, it will retry 2^7 * 3000 milliseconds = 6.4 minutes after the previous attempt. With a fixed backoff, it will retry after `delay` milliseconds, so with a delay of 3000 milliseconds, it will retry _every_ attempt 3000 milliseconds after the previous attempt.

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

