# Stalled

{% hint style="info" %}
Stalled jobs checks will only work if there is at least one [`QueueScheduler`](../queuescheduler.md) instance configured in the Queue.
{% endhint %}

{% hint style="danger" %}
From BullMQ 2.0 and onwards, the QueueScheduler is not needed anymore.
{% endhint %}

When a job is in an active state, i.e., it is being processed by a worker, it needs to continuously update the queue to notify that the worker is still working on the job. This mechanism prevents a worker that crashes or enters an endless loop from keeping a job in an active state for ever.

When a worker is not able to notify the queue that it is still working on a given job, that job is moved back to the waiting list, or to the failed set. We then say that the job has stalled and the queue will emit the 'stalled' event.

{% hint style="info" %}
There is not a 'stalled' state, only a 'stalled' event emitted when a job is automatically moved from active to waiting state.
{% endhint %}

In order to avoid stalled jobs, make sure that your worker does not keep Node.js event loop too busy, the default max stalled check duration is 30 seconds, so as long as you do not perform CPU operations exceeding that value you should not get stalled jobs.

Another way to reduce the chance for stalled jobs is using so called "sandboxed" processors. In this case, the workers will spawn new separate Node.js processes, running separately from the main process.

{% code title="main.ts" %}
```typescript
import { Worker } from 'bullmq';

const worker = new Worker('Paint', painter);
```
{% endcode %}

{% code title="painter.ts" %}
```typescript
export default = (job) => {
    // Paint something
}
```
{% endcode %}

## Read more:

* 💡 [Queue Scheduler API Reference](https://api.docs.bullmq.io/classes/QueueScheduler.html)
