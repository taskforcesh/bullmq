---
description: Processing jobs in batches
---

# Batches

It is possible to configure the workers so that instead of processing one job at a time they can process up to a number of jobs (a so-called batch) in one go.

Workers using batches have slightly different semantics and behavior than normal workers, so read carefully the following examples to avoid pitfalls.

In order to enable batches you must pass the batch option with a size representing the maximum amount of jobs per batch:

```typescript

const worker = new WorkerPro("My Queue", async (job: JobPro) => {
   const batch = job.getBatch();
   
   for(let i=0; i<batch.length; i++) {
      const batchedJob = batch[i];
      await doSomethingWithBatchedJob(batchedJob);
   }
   
}, { connection, batches: { size: 10 } });

```

{% hint style="info" %}
There is no maximum limit for the size of the batches, however, keep in mind that there is an overhead proportional to the size of the batch so really large batches could create performance issues. A typical value would be something between 10 and 50 jobs per batch.
{% endhint %}

### Failing jobs

When using batches, the default is that if the processor throws an exception, **all the jobs in the batch will fail.**

Sometimes it is useful to just fail specific jobs in a batch, we can accomplish this by using the job's method `setAsFailed`. See how the example above can be modified to fail specific jobs:

```typescript
const worker = new WorkerPro("My Queue", async (job: JobPro) => {
   const batch = job.getBatch();
   
   for(let i=0; i<batch.length; i++) {
      const batchedJob = batch[i];
      try {
        await doSomethingWithBatchedJob(batchedJob);
      } catch(err) {
        batchedJob.setAsFailed(err);
      }
   }
}, { connection, batches: { size: 10 } });
```

Only the jobs that are `setAsFailed` will fail, the rest will be moved to complete when the processor for the batch job completes.

### Limitations

Currently, all worker options can be used with the batches, however, there are some unsupported features that may be resolved in the future:

* [Dynamic rate limit](https://docs.bullmq.io/guide/rate-limiting#manual-rate-limit)
* [Manually processing jobs](https://docs.bullmq.io/patterns/manually-fetching-jobs)
* [Dynamically delay jobs](https://docs.bullmq.io/patterns/process-step-jobs#delaying).
