# Deduplication

Sometimes, you may want to decide when you want to stop deduplicating jobs. 

## Until job is active

As soon as job is moved to active, you must call **removeDeduplicationKey** method:

```typescript
import { Job, Queue, Worker } from 'bullmq';

const myQueue = new Queue('Paint');

const worker = new Worker('Paint', async (job: Job) => {
  await myQueue.removeDeduplicationKey(job.deduplicationId)
  console.log('Do something with job');
  return 'some value';
});

myQueue.add('house', { color: 'white' }, { deduplication: { id: 'house'} });
```

{% hint style="info" %}
Previous example uses [Simple Mode](../guide/jobs/deduplication.md#simple-mode) but it can be combined with [Throttle Mode](../guide/jobs/deduplication.md#throttle-mode) or [Debounce Mode](../guide/jobs/deduplication.md#debounce-mode).
{% endhint %}

## Read more:

- 💡 [Remove Deduplication Key API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#removededuplicationkey)
- 💡 [Deduplication Reference](../guide/jobs/deduplication.md)
