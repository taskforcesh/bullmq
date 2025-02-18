# Concurrency

By default, there is no limit on the number of jobs that workers can run in parallel for every group. Even using a rate limit, that would only limit the processing speed, but still you could have an unbounded number of jobs processed simultaneously in every group.

It is possible to constrain how many jobs are allowed to be processed concurrently per group. For example, if you choose 3 as max concurrency factor, the workers will never work on more than 3 jobs at the same time for any given group. This limits only the group; you could have any number of concurrent jobs as long as they are not from the same group.

The concurrency factor is configured as follows:

```typescript
import { WorkerPro } from '@taskforcesh/bullmq-pro';

const worker = new WorkerPro('myQueue', processFn, {
  group: {
    concurrency: 3, // Limit to max 3 parallel jobs per group
  },
  concurrency: 100,
  connection,
});
```

The concurrency factor is global, so in the example above, independently of the concurrency factor per worker or the number of workers that you instantiate in your application, it will never process more than 3 jobs per group at any given time.
