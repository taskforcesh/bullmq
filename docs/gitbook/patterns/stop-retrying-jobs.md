# Stop retrying jobs

When a processor throws an exception that is considered unrecoverable, you should use the `UnrecoverableError` class. In this case, BullMQ will just move the job to the failed set without performing any retries, overriding any `attempts` settings used when adding the job to the queue.

```typescript
import { Worker, UnrecoverableError } from 'bullmq';

const worker = new Worker(
  'foo',
  async job => {
    doSomeProcessing();
    throw new UnrecoverableError('Unrecoverable');
  },
  { connection },
);

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

When a job is rate limited using `RateLimitError` and tried again, the `attempts` check is ignored, as rate limiting is not considered a real error. However, if you want to manually check the attempts and avoid retrying the job, you can check `job.attemptsStarted` as following:

```typescript
import { Worker, RateLimitError, UnrecoverableError } from 'bullmq';

const worker = new Worker(
  'myQueue',
  async job => {
    const [isRateLimited, duration] = await doExternalCall();
    if (isRateLimited) {
      await queue.rateLimit(duration);
      if (job.attemptsStarted >= job.opts.attempts) {
        throw new UnrecoverableError('Unrecoverable');
      }
      // Do not forget to throw this special exception,
      // since we must differentiate this case from a failure
      // in order to move the job to wait again.
      throw new RateLimitError();
    }
  },
  {
    connection,
    limiter: {
      max: 1,
      duration: 500,
    },
  },
);
```

{% hint style="info" %}
`job.attemptsMade` is increased when any error different than `RateLimitError`, `DelayedError` or `WaitingChildrenError` is thrown. While `job.attemptsStarted` is increased every time that a job is moved to active.
{% endhint %}

## Read more:

- 💡 [Rate Limit API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#ratelimit)
