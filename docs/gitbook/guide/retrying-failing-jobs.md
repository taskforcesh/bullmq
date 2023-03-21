# Retrying failing jobs

As your queues processes jobs, it is inevitable that over time some of these jobs will fail. In BullMQ, a job is considered failed in the following scenarios:

* The processor function defined in your [Worker](https://docs.bullmq.io/guide/workers) has thrown an exception.
* The job has become [stalled](https://docs.bullmq.io/guide/jobs/stalled) and it has consumed the "max stalled count" setting.

{% hint style="danger" %}
The exceptions thrown in a processor must be an [Error](https://nodejs.org/api/errors.html#class-error) object for BullMQ to work correctly.

In general, as a best practice, it is better to always throw Error objects. There is even an eslint rule if you want to enforce it: https://eslint.org/docs/latest/rules/no-throw-literal
{% endhint %}

## Retrying failing jobs

When a processor throws an exception, the worker will catch it and move the job to the failed set. Depending on your [Queue settings](https://docs.bullmq.io/guide/queues/auto-removal-of-jobs), the job may stay in the failed set forever, or it could be automatically removed.&#x20;

Often it is desirable to automatically retry failed jobs so that we do not give up until a certain amount of retries have failed. In order to activate automatic job retries you should use the [attempts](https://api.docs.bullmq.io/interfaces/BaseJobOptions.html#attempts) setting with a value larger than 1 (see the examples below).

BullMQ supports retries of failed jobs using back-off functions. It is possible to use the **built-in** backoff functions or provide **custom** ones. If you do not specify a back-off function, the jobs will be retried without delay as soon as they fail.

#### Built-in backoff strategies

The current built-in backoff functions are "exponential" and "fixed".

With exponential backoff, it will retry after `2 ^ (attempts - 1) * delay` milliseconds. For example, with a delay of 3000 milliseconds, for the 7th attempt, it will retry 2^6 \* 3000 milliseconds = 3.2 minutes after the previous attempt.&#x20;

With a fixed backoff, it will retry after `delay` milliseconds, so with a delay of 3000 milliseconds, it will retry _every_ attempt 3000 milliseconds after the previous attempt.

The code below shows how to specify the built-in "exponential" backoff function with a 1-second delay as a seed value, so it will retry at most 3 times spaced after 1 second, 2 seconds, and 4 seconds respectively:

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

You can also define the back-off strategy in the queue's `defaultJobOptions`, and it will apply to all jobs added to the queue unless overridden when adding the job. For example:

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('foo', {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

await queue.add('test-retry', { foo: 'bar' });
```

#### Custom back-off strategies

If you want to define your custom backoff function, you need to define it in the worker settings:

```typescript
import { Worker } from 'bullmq';

const worker = new Worker('foo', async job => doSomeProcessing(), {
  settings: {
    backoffStrategy: (attemptsMade: number) => {
      return attemptsMade * 1000;
    },
  },
});
```

You can then use your custom strategy when adding jobs:

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

If you want to define multiple custom backoff types you need to define them like in the following example:

```typescript
import { Worker } from 'bullmq';

const worker = new Worker('foo', async job => doSomeProcessing(), {
  settings: {
    backoffStrategy: (
      attemptsMade: number,
      type: string,
      err: Error,
      job: Job,
    ) => {
      switch (type) {
        case 'custom1': {
          return attemptsMade * 1000;
        }
        case 'custom2': {
          return attemptsMade * 2000;
        }
        default: {
          throw new Error('invalid type');
        }
      }
    },
  },
});
```

## Stop retrying jobs

When a processor throws an exception that is considered unrecoverable, you should use the `UnrecoverableError` class. In this case, BullMQ will just move the job to the failed set without performing any retries overriding any attempts settings used when adding the job to the queue.

```typescript
import { Worker, UnrecoverableError } from 'bullmq';

const worker = new Worker('foo', async job => {doSomeProcessing();
throw new UnrecoverableError('Unrecoverable');
}, {
  connection
  },
});

await queue.add(
  'test-retry',
  { foo: 'bar' },
  {
    attempts: 3,
    backoff: 1000,
  },
);
```
