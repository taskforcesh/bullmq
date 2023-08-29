# Delayed

Delayed jobs are a special type of job that is placed into a special "delayed set", instead of being processed as fast as possible. After the delay time has passed, the job is processed as a regular job.

In order to add delayed jobs to the queue, use the `delay` option with the amount of time (in milliseconds) that you want to delay the job with.

Note that it is not guaranteed that the job will be processed at the _exact_ delayed time specified, as it depends on how busy the workers are when the time has passed, and how many other delayed jobs are scheduled at that exact time. In practice, however, the delay time is quite accurate in most cases.

This is an example of how to add delayed jobs to a queue:

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('Paint');

// Add a job that will be delayed by at least 5 seconds.
await myQueue.add('house', { color: 'white' }, { delay: 5000 });
```

If you want to process the job after a specific point in time, just add the time remaining to that point in time. For example, let's say you want to process the job on the third of July 2035 at 10:30:

```typescript
const targetTime = new Date('03-07-2035 10:30');
const delay = Number(targetTime) - Number(new Date());

await myQueue.add('house', { color: 'white' }, { delay });
```

## Change delay

If you want to change the delay _after_ inserting a delayed job, use **`changeDelay`** method. For example, let's say you want to change the delay from 2000 to 4000 milliseconds:

```typescript
const job = await Job.create(queue, 'test', { foo: 'bar' }, { delay: 2000 });

await job.changeDelay(4000);
```

{% hint style="warning" %}
Only jobs currently in the **delayed** state can have their delay changed.
{% endhint %}

## Read more:

- 💡 [Change Delay API Reference](https://api.docs.bullmq.io/classes/v4.Job.html#changeDelay)
