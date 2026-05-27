# Manual retrying

There are situations when it is useful to retry a job right away when it is being processed.

This can be handled using the `moveToWait` method. However, it is important to note that when a job is being processed by a worker, the worker keeps a lock on this job with a certain token value. For the `moveToWait` method to work, we need to pass said token so that it can unlock without error. Finally, we need to exit from the processor by throwing a special error (`WaitingError`) that will signal to the worker that the job has been retried so that it does not try to complete (or fail the job) instead.

```typescript
import { WaitingError, Worker } from 'bullmq';

const worker = new Worker(
  'queueName',
  async (job: Job, token?: string) => {
    try {
      await doSomething();
    } catch (error) {
      await job.moveToWait(token);
      throw new WaitingError();
    }
  },
  { connection },
);
```

## Read more:

- 💡 [Move To Wait API Reference](https://api.docs.bullmq.io/classes/v5.Job.html#movetowait)
