# Prioritized

Jobs can also include a `priority` option. Using priorities, job processing order will be affected by the specified `priority` instead of following a FIFO or LIFO pattern.

{% hint style="warning" %}
Adding prioritized jobs is a slower operation than the other types of jobs, with a complexity `O(log(n))` relative to the number of jobs in the prioritized set in the queue.
{% endhint %}

Note that the priorities go from `1` to `2 097 152`, where a lower number is always a **higher** priority than higher numbers.

{% hint style="danger" %}
Jobs without a `priority` assigned will get the highest priority, being processed before jobs with priorities assigned to them.
{% endhint %}

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('Paint');

await myQueue.add('wall', { color: 'pink' }, { priority: 10 });
await myQueue.add('wall', { color: 'brown' }, { priority: 5 });
await myQueue.add('wall', { color: 'blue' }, { priority: 7 });

// The wall will be painted first brown, then blue and
// finally pink.
```

If several jobs are added with the same priority value, then the jobs within that priority will be processed in [FIFO (_First in, first out_)](../fifo.md) fashion.

## Change priority

If you want to change the `priority` after inserting a job, use the **`changePriority`** method. For example, let's say that you want to change the `priority` from `16` to `1`:

```typescript
const job = await Job.create(queue, 'test2', { foo: 'bar' }, { priority: 16 });

await job.changePriority({
  priority: 1,
});
```

or if you want to use the [LIFO (_Last In, First Out_)](lifo.md) option:

```typescript
const job = await Job.create(queue, 'test2', { foo: 'bar' }, { priority: 16 });

await job.changePriority({
  lifo: true,
});
```

## Get Prioritized jobs

As prioritized is a new state. You must use **`getJobs`** or **`getPrioritized`** method as:

```typescript
const jobs = await queue.getJobs(['prioritized']);

const jobs2 = await queue.getPrioritized();
```

## Get Counts per Priority

If you want to get the `count` of jobs in `prioritized` status (priorities higher than 0) or in `waiting` status (priority 0), use the **`getCountsPerPriority`** method. For example, let's say that you want to get counts for `priority` `1` and `0`:

```typescript
const counts = await queue.getCountsPerPriority([1, 0]);
/*
{
  '1': 11,
  '0': 10
}
*/
```

## Read more:

* 📋 [Faster Priority jobs](https://bullmq.io/news/062123/faster-priority-jobs/)
* 💡 [Change Priority API Reference](https://api.docs.bullmq.io/classes/v5.Job.html#changePriority)
* 💡 [Get Prioritized API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#getPrioritized)
* 💡 [Get Counts per Priority API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#getCountsPerPriority)
