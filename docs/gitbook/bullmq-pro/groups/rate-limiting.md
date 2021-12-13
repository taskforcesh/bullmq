# Rate limiting

A useful feature when using groups is to be able to rate limit the groups independently of each other, so you can evenly process the jobs belonging to many groups and still limit how many jobs per group are allowed to be processed by unit of time.

The way the rate limiting works is that when the jobs for a given group exceed the maximum amount of jobs per unit of time that particular group gets rate limited. The jobs that belongs to this particular group will not be processed until the rate limit expires.

For example "group 2" is rate limited in the following chart:

![Rate limited group](<../../.gitbook/assets/image (3).png>)

While one or more groups are rate limited, the rest of the jobs belonging to non rate limited groups will continue to be consumed normally or until they also get rate limited.

The rate limit is configured on the worker instances:

```typescript
import { WorkerPro } from '@taskforcesh/bullmq-pro';

const worker = new WorkerPro('myQueue', processFn, {
    groups: {
      limit: {
        max: 100,  // Limit to 100 jobs per second per group
        duration 1000,
      }
    },
    connection
});
```

