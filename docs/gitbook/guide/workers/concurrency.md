# Concurrency

There are basically two ways to achieve concurrency with BullMQ. You can run a worker with a concurrency factor larger than 1 \(which is the default value\), or you can run several workers in different node processes.

#### Concurrency factor

The concurrency factor is a worker option that determines how many jobs are allowed to be processed in parallel. This means that the same worker is able to process several jobs in parallel, however the queue guarantees such as "at-least-once" and order of processing are still preserved.

```typescript
import { Worker, Job } from 'bullmq'

const worker = new Worker(queueName, async (job: Job) => {
    // Do something with job
    return 'some value';
}, { concurrency: 50 });
```

Note that the concurrency is only possible when workers perform asynchronous operations such as a call to a database or a external HTTP service, as this is how node supports concurrency natively. If your workers are very CPU intensive it is better to use [Sandboxed processors](sandboxed-processors.md).

#### Multiple workers

The other way to achieve concurrency is to provide multiple workers. This is the recommended way to setup bull anyway since besides providing concurrency it also provides higher availability for your workers. You can easily launch a fleet of workers running in many different machines in order to execute the jobs in parallel in a predictable and robust way.

{% hint style="info" %}
It is not possible to achieve a global concurrency of 1 job at once if you use more than one worker.
{% endhint %}

You still can \(and it is a perfectly good practice\), choose a high concurrency factor for every worker, so that the resources of every machine where the worker is running are used more efficiently.



