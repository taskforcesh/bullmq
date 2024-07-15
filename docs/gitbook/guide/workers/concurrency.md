# Concurrency

There are basically two ways to achieve concurrency with BullMQ. You can run a worker with a concurrency factor larger than 1 \(which is the default value\), or you can run several workers in different node processes.

#### Global Concurrency factor

The global concurrency factor is a queue option that determines how many jobs are allowed to be processed in parallel across all your worker instances.

```typescript
import { Queue } from 'bullmq';

await queue.setGlobalConcurrency(4);
```

And in order to get this value:

```typescript
const globalConcurrency = await queue.getGlobalConcurrency();
```

{% hint style="info" %}
Note that if you choose a concurrency level in your workers, it will not override the global one, it will just be the maximum jobs a given worker can process in parallel but never more than the global one.
{% endhint %}

#### Local Concurrency factor

The local concurrency factor is a worker option that determines how many jobs are allowed to be processed in parallel for that instance. This means that the same worker is able to process several jobs in parallel, however the queue guarantees such as "at-least-once" and order of processing are still preserved.

```typescript
import { Worker, Job } from 'bullmq';

const worker = new Worker(
  queueName,
  async (job: Job) => {
    // Do something with job
    return 'some value';
  },
  { concurrency: 50 },
);
```

{% hint style="info" %}
Note that the concurrency is only possible when workers perform asynchronous operations such as a call to a database or a external HTTP service, as this is how node supports concurrency natively. If your workers are very CPU intensive it is better to use [Sandboxed processors](sandboxed-processors.md).
{% endhint %}

In addition, you can update the concurrency value as you need while your worker is running:

```typescript
worker.concurrency = 5;
```

#### Multiple workers

The other way to achieve concurrency is to provide multiple workers. This is the recommended way to setup bull anyway since besides providing concurrency it also provides higher availability for your workers. You can easily launch a fleet of workers running in many different machines in order to execute the jobs in parallel in a predictable and robust way.

{% hint style="info" %}
It is not possible to achieve a global concurrency of at most 1 job at a time if you use more than one worker.
{% endhint %}

You can still \(and it is a perfectly good practice to\) choose a high concurrency factor for every worker, so that the resources of every machine where the worker is running are used more efficiently.
