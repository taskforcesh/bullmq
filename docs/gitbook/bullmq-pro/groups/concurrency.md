# Concurrency

By default, there is no limit on the number of jobs that the workers can run in parallel for every group. Even using a rate limit, that would only limit the processing speed, but still you could have an unbounded number of jobs processed simultaneously in every group.

It is possible to constraint how many jobs are allowed to be processed concurrently per group, so for example, if you choose 3 as max concurrency factor, the workers will never work on more than 3 jobs at the same time for any given group. This limits only the group, you could have any number of concurrent jobs as long as they are not from the same group.

You enable the concurrency setting like this:

```typescript
import { WorkerPro } from '@taskforcesh/bullmq-pro';

const worker = new WorkerPro('myQueue', processFn, {
    groups: {
      concurrency: 3 // Limit to max 3 parallel jobs per group
    },
    concurrency: 100
    connection
});
```

The concurrency factor is global, so in the example above, independently of the concurrency factor per worker or the number of workers that you instantiate in your application, it will never process more than 3 jobs per group at any given time.

