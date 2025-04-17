---
description: Built-in Metrics for your queues.
---

# Metrics

BullMQ provides a simple metrics gathering functionality that allows you to track the performance of your queues. Workers can count the number of jobs they have processed **per minute** and store this data in a list inside Redis so that it can be queried later.

You enable it on the worker settings by specifying how many data points you want to keep, which basically are counters of the number of jobs that have been processed either completed or failed during 1 minute intervals.

As the metrics are aggregated in 1 minute intervals, using the recommended duration of 2 weeks of data should take a very small amount of total space, just around 120Kb of RAM per queue. The metrics will dispose older data points automatically so this RAM consumption will never increase after it reaches the maximum number of data points.

Check in this example how to enable metrics on a worker:

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

In order to query the metrics, use the `getMetrics` method on the `Queue` class. You can choose to gather the metrics for the _completed_ or _failed_ jobs:

```typescript
import { Queue } from 'bullmq';
const myQueue = new Queue('Paint', {
  connection,
});

const metrics = await queue.getMetrics('completed', 0, MetricsTime.ONE_WEEK * 2);

/* Returns a Metrics object:
{
    data: number[];
    count: number;
    meta: {
      count: number;
      prevTS: number;
      prevCount: number;
    };
  }
*/
```

Let's analyze what data we are getting back. First we have the `meta` field. The `prevTS` and `prevCount` subfields are used internally by the metrics system and should not be used, however you can use the`count` subfield to get a total number for all completed or failed jobs, this counter is not just the number of completed jobs in the given interval, but since the queue started processing jobs.&#x20;

The query also returns a `data` field which is an array where every position in the array represents 1 minute of time and has the total number of jobs that completed (or failed)  in that minute.

Note that the `getMetrics` method also accepts a `start` and `end` argument (`0` and `-1` by default), that you can use if you want to implement pagination.

## Read more:

* 💡 [Get Metrics API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#getMetrics)
