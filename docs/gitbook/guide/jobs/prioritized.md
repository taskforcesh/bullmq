# Prioritized

Jobs can also include a priority option. Using priorities, job's processing order will be affected by the specified priority instead of following a FIFO or LIFO pattern.

{% hint style="warning" %}
Adding prioritized jobs is a slower operation than the other types of jobs, with a complexity O(log(n)) relative to the number of jobs in prioritized set in the Queue.
{% endhint %}

Note that the priorities go from 1 to 2 097 152, whereas a lower number is always a higher priority than higher numbers.

Jobs without a priority assigned will get the most priority.

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('Paint');

await myQueue.add('wall', { color: 'pink' }, { priority: 10 });
await myQueue.add('wall', { color: 'brown' }, { priority: 5 });
await myQueue.add('wall', { color: 'blue' }, { priority: 7 });

// The wall will be painted first brown, then blue and
// finally pink.
```

If several jobs are added with the same priority value, then the jobs within that priority will be processed in FIFO (First in first out) fashion.

## Change priority

If you want to change the priority after inserting a job, just use the **changePriority** method. For example, let's say that you want to change the priority from 16 to 1:

```typescript
const job = await Job.create(queue, 'test2', { foo: 'bar' }, { priority: 16 });

await job.changePriority({
  priority: 1,
});
```

or if you want to use lifo option:

```typescript
const job = await Job.create(queue, 'test2', { foo: 'bar' }, { priority: 16 });

await job.changePriority({
  lifo: true,
});
```

## Get Prioritized jobs

As prioritized is a new state. You must use **getJobs** or **getPrioritized** method as:

```typescript
const jobs = await queue.getJobs(['prioritized']);

const jobs2 = await queue.getPrioritized();
```

## Read more:

- 📋 [Faster Priority jobs](https://bullmq.io/news/062123/faster-priority-jobs/)
- 💡 [Change Priority API Reference](https://api.docs.bullmq.io/classes/v4.Job.html#changePriority)
- 💡 [Get Prioritized API Reference](https://api.docs.bullmq.io/classes/v4.Queue.html#getPrioritized)
