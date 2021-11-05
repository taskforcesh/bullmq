# Manually fetching jobs

If you want the actual job processing to be done in a seperate repo/service than where `bull` is running, this pattern may be for you.

Manually transitioning states for jobs can be done with a few simple methods.

1. Adding a job to the 'waiting' queue. Grab the queue and call `add`.

```typescript
import Queue from 'bull';

const queue = new Queue({
  limiter: {
    max: 5,
    duration: 5000,
    bounceBack: true // important
  },
  ...queueOptions
});
queue.add({ random_attr: 'random_value' });
```

1. Pulling a job from 'waiting' and moving it to 'active'.

```typescript
const job: Job = await queue.getNextJob();
```

1. Move the job to the 'failed' queue if something goes wrong.

```typescript
const (nextJobData, nextJobId) = await job.moveToFailed(
  {
    message: 'Call to external service failed!',
  },
  true,
);
```

1. Move the job to the 'completed' queue.

```typescript
const (nextJobData, nextJobId) = await job.moveToCompleted('succeeded', true);
```

1. Return the next job if one is returned.

```typescript
if (nextJobdata) {
  return Job.fromJSON(queue, nextJobData, nextJobId);
}
```

**Note**

By default the lock duration for a job that has been returned by `getNextJob` or `moveToCompleted` is 30 seconds, if it takes more time than that the job will be automatically marked as stalled and depending on the max stalled options be moved back to the wait state or marked as failed. In order to avoid this you must use `job.extendLock(duration)` in order to give you some more time before the lock expires. The recommended is to extend the lock when half the lock time has passsed.
