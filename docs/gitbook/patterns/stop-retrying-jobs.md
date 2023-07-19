# Stop retrying jobs

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

## Fail job when manual rate-limit

When we set our queue as rate limited and it's being reprocessed, attempts check is ignored as this case is not considered as a real Error, but in case you want to consider the max attempt as an error you can do the following:

```typescript
import { Worker, UnrecoverableError } from 'bullmq';

const worker = new Worker(
  'myQueue',
  async job => {
    const [isRateLimited, duration] = await doExternalCall();
    if (isRateLimited) {
      await worker.rateLimit(duration);
      if (job.attemptsMade >= job.opts.attempts) {
        throw new UnrecoverableError('Unrecoverable');
      }
      // Do not forget to throw this special exception,
      // since the job is no longer active after being rate limited.
      throw Worker.RateLimitError();
    }
  },
  {
    connection,
  },
);
```

## Read more:

- 💡 [Rate Limit API Reference](https://api.docs.bullmq.io/classes/v4.Worker.html#rateLimit)
