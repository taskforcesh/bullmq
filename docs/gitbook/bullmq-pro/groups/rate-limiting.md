# Rate limiting

A useful feature when using groups is to be able to rate limit the groups independently of each other, so you can evenly process the jobs belonging to many groups and still limit how many jobs per group are allowed to be processed by unit of time.

The way the rate limiting works is that when the jobs for a given group exceed the maximum amount of jobs per unit of time, that particular group gets rate limited. The jobs that belong to this particular group will not be processed until the rate limit expires.

For example "group 2" is rate limited in the following chart:

![Rate limited group](<../../.gitbook/assets/image (3) (1).png>)

While one or more groups are rate limited, the rest of the jobs belonging to non rate limited groups will continue to be consumed normally or until they also get rate limited.

The rate limit is configured on the worker instances:

```typescript
import { WorkerPro } from '@taskforcesh/bullmq-pro';

const worker = new WorkerPro('myQueue', processFn, {
    group: {
      limit: {
        max: 100,  // Limit to 100 jobs per second per group
        duration: 1000,
      }
    },
    connection
});
```

### Manual rate-limit

Sometimes it's useful to rate-limit a group manually instead of based on some static options. For example, if you have an API that returns `429 Too Many Requests`, and you want to rate-limit the group based on that response.

For this purpose, you can use the worker method `rateLimitGroup` like this:

```typescript
import { WorkerPro } from '@taskforcesh/bullmq-pro';

const worker = new WorkerPro(
  'myQueue',
  async job => {
    const groupId = job.opts.group.id;
    const [isRateLimited, duration] = await doExternalCall(groupId);
    if (isRateLimited) {
      await worker.rateLimitGroup(job, duration);
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

### Get Group Rate Limit Ttl

Sometimes is useful to know if our group is rate limited.

For this purpose, you can use the **`getGroupRateLimitTtl`** method like this:

```typescript
import { QueuePro } from '@taskforcesh/bullmq-pro';

const queue = new QueuePro('myQueue', { connection });
const groupId = '0';
const maxJobs = 100;

const ttl = await queue.getGroupRateLimitTtl(groupId, maxJobs);

if (ttl > 0) {
  console.log('Group is rate limited');
}
```

## Read more:

* 💡 [Rate Limit Group API Reference](https://api.bullmq.pro/classes/v7.Worker.html#rateLimitGroup)
- 💡 [Get Group Rate Limit Ttl API Reference](https://api.bullmq.pro/classes/v7.Queue.html#getGroupRateLimitTtl)
