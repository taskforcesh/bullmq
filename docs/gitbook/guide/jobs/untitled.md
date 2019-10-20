# Delayed

The jobs added to a queue will normally be processed as quick as some worker is available for dispatching them. However, it is also possible to add a delay parameter so that jobs will wait at least that amount of time before being processed. Note that this does not guarantee that the job will be processed at that exact delayed time, it depends on how busy the queue is when the time has passed and how many other delayed jobs are scheduled at that exact time.

{% hint style="info" %}
Delayed jobs will only be processed if there is at least one [`QueueScheduler`](../queuescheduler.md) instance configured in the Queue.
{% endhint %}

This is an example on how to add delayed jobs:

```typescript
import { Queue, QueueScheduler } from 'bullmq'

const myQueueScheduler = new QueueScheduler('Paint');
const myQueue = new Queue('Paint');

// Add a job that will be delayed at least 5 seconds.
await myQueue.add('house', { color: 'white' }, { delay: 5000 });

```

