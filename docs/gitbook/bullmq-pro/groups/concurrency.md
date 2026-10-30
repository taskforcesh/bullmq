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

## Changing the group concurrency at runtime

The group concurrency of a worker can be updated at runtime with the `groupConcurrency` property, without having to recreate the worker:

```typescript
import { QueuePro, WorkerPro } from '@taskforcesh/bullmq-pro';

const worker = new WorkerPro('myQueue', processFn, {
  group: {
    concurrency: 3,
  },
  connection,
});

const queue = new QueuePro('myQueue', { connection });

// Local concurrency for a specific group, not affected by the change below.
await queue.setGroupConcurrency('vip', 10);

// Applies to every group that does not have a local concurrency.
worker.groupConcurrency = 5;
```

The new value acts as the default for all groups that do not have a [local group concurrency](local-group-concurrency.md). Groups with a local concurrency set via `setGroupConcurrency` keep using their own value.

Some things to keep in mind:

- The value must be an integer greater than 0, otherwise an error is thrown.
- It can only be changed on workers created with the `group.concurrency` option. Workers created without it do not track active jobs per group, so trying to set it throws an error.
- When raising the value, a group that has already reached the old limit picks up the new value as soon as one of its active jobs finishes.
- When lowering the value, jobs that are already running are not affected; the new limit applies to jobs started afterwards.

{% hint style="warning" %}
`groupConcurrency` is a property of the worker instance, it is not stored in Redis. You need to update every running worker, and workers started later will use the value passed in their constructor options.
{% endhint %}

### Updating workers in multiple processes

If your workers run in several processes, you can, for example, publish the new value on a Redis Pub/Sub channel and have every process update its local workers:

```typescript
import IORedis from 'ioredis';
import { WorkerPro } from '@taskforcesh/bullmq-pro';

const channel = 'myQueue:group-concurrency';
const subscriber = new IORedis(redisOptions);
const workers: WorkerPro[] = []; // Add your WorkerPro instances here.

subscriber.on('message', (receivedChannel, message) => {
  if (receivedChannel !== channel) {
    return;
  }

  const concurrency = Number(message);
  if (Number.isInteger(concurrency) && concurrency > 0) {
    for (const worker of workers) {
      worker.groupConcurrency = concurrency;
    }
  }
});
await subscriber.subscribe(channel);
```

And then, from any process:

```typescript
await publisher.publish(channel, String(nextConcurrency));
```

Use a dedicated Redis connection for the subscriber. Note that Pub/Sub messages are not stored, so a process that is disconnected or starts later can miss an update. Keep the latest value in your application configuration or in a Redis key, and apply it when workers start or reconnect.

## Read more:

- 💡 [Group Concurrency API Reference](https://api.bullmq.pro/classes/v7.WorkerPro.html#groupconcurrency)
- 💡 [Local Group Concurrency](local-group-concurrency.md)
