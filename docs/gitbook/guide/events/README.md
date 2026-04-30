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

queueEvents.on('completed', ({ jobId }) => {
  // Called every time a job is completed in any worker.
});

queueEvents.on(
  'progress',
  ({ jobId, data }: { jobId: string; data: number | object }) => {
    // jobId received a progress event
  },
);
```

The `QueueEvents` class is implemented using [Redis streams](https://redis.io/topics/streams-intro). Compared to standard pub-sub this is more robust across short consumer disconnections, since events buffered in the stream while the consumer is offline can still be read once it reconnects — up to the limits described below.

{% hint style="danger" %}
**`QueueEvents` is best-effort, not at-least-once.** The events stream is auto-trimmed on every job state transition with `XTRIM MAXLEN ~ <maxLenEvents>` (default `10000`). If producers (e.g. workers completing jobs) emit events faster than your `QueueEvents` instance drains them, the backlog can exceed `maxLenEvents` and the oldest unread events will be evicted by Redis before the consumer ever reads them. This is consistent with the internal `QueueMeta.maxLenEvents` documentation, which already describes the cap as best-effort — note also that the `~` modifier in `XTRIM` is approximate, so the actual length may briefly exceed `maxLenEvents` by a small amount, but it remains a hard cap.

You can widen the buffer with the [`streams.events.maxLen`](https://api.docs.bullmq.io/interfaces/v5.QueueOptions.html#streams) option on the `Queue` (e.g. `100000` or higher) to reduce the risk of loss when producer and consumer rates differ. Note that this only reduces the risk; it does not eliminate it. Under sustained back-pressure — many concurrent workers finishing jobs faster than a single Node process can drain via `XREAD` — events can still be lost regardless of how large `maxLen` is set.

If you need guaranteed delivery of completion notifications (for example, to count exactly how many jobs finished), prefer the per-`Worker` `'completed'` and `'failed'` listeners. Those are driven by the worker's own active-list bookkeeping and are not subject to stream trimming. Use `QueueEvents` for monitoring, dashboards, and aggregation across workers — scenarios where occasional missed events are acceptable.
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
