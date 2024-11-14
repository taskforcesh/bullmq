# Events

All classes in BullMQ emit useful events that inform on the lifecycles of the jobs that are running in the queue. Every class is an `EventEmitter` and emits different events.

Some examples:

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('Paint');

myQueue.on('waiting', (job: Job) => {
  // Job is waiting to be processed.
});
```

```typescript
import { Worker } from 'bullmq';

const myWorker = new Worker('Paint');

myWorker.on('drained', () => {
  // Queue is drained, no more jobs left
});

myWorker.on('completed', (job: Job) => {
  // job has completed
});

myWorker.on('failed', (job: Job) => {
  // job has failed
});
```

The events above are local for the workers that actually completed the jobs. However, in many situations you want to listen to all the events emitted by all the workers in one single place. For this you can use the [`QueueEvents`](https://api.docs.bullmq.io/classes/v5.QueueEvents.html) class:

```typescript
import { QueueEvents } from 'bullmq';

const queueEvents = new QueueEvents('Paint');

queueEvents.on('completed', ({ jobId: string }) => {
  // Called every time a job is completed in any worker.
});

queueEvents.on(
  'progress',
  ({ jobId, data }: { jobId: string; data: number | object }) => {
    // jobId received a progress event
  },
);
```

The `QueueEvents` class is implemented using [Redis streams](https://redis.io/topics/streams-intro). This has some nice properties, for example, it provides guarantees that the events are delivered and not lost during disconnections such as it would be the case with standard pub-sub.

{% hint style="danger" %}
The event stream is auto-trimmed so that its size does not grow too much, by default it is \~10.000 events, but this can be configured with the `streams.events.maxLen` option.
{% endhint %}

### Manual trim events

In case you need to trim your events manually, you can use **`trimEvents`** method:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

await queue.trimEvents(10); // leaves 10 events
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Queue

queue = Queue('paint')

await queue.trimEvents(10) # leaves 10 events
```

{% endtab %}
{% endtabs %}

## Read more:

- 💡 [Queue Events API Reference](https://api.docs.bullmq.io/classes/v5.QueueEvents.html)
- 💡 [Queue Events Listener API Reference](https://api.docs.bullmq.io/interfaces/v5.QueueEventsListener.html)
- 💡 [Queue Listener API Reference](https://api.docs.bullmq.io/interfaces/v5.QueueListener.html)
- 💡 [Worker Listener API Reference](https://api.docs.bullmq.io/interfaces/v5.WorkerListener.html)
