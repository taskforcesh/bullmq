# Metrics

BullMQ provides a simple metrics gathering functionality that allows you to track the performance of your queues.
The workers can count the number of jobs they have processed per minute and store this data in a list to be consumed later.

You enable it on the worker settings by specifying how many data points you want to keep, we recommend 2 weeks of metrics data which should take a very small amount of space, just around 120Kb of RAM per queue.

```typescript
import { Worker, MetricsTime } from 'bullmq';

const myWorker = new Worker('Paint', {
  connection,
  metrics: {
    maxDataPoints: MetricsTime.ONE_WEEK * 2,
  },
});
```

{% hint style="warning" %}
You need to use the same setting on all your workers to get consistent metrics.
{% endhint %}

In order to get the metrics you just use the `getMetrics` method on the Queue class. You can choose to get the metrics for the completed or failed jobs:

```typescript
import { Queue } from 'bullmq';
const myQueue = new Queue('Paint', {
  connection,
});

const metrics = await queue.getMetrics('completed');

/* Returns a Metrics object:
{
    meta: {
      count: number;
      prevTS: number;
      prevCount: number;
    };
    data: number[];
    count: number;
  }
*/
```

Note that the `getMetrics` method also accepts a start and end argument (0 and -1 by default), that you can
use if you want to implement pagination.
