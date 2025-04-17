---
description: Processing jobs in batches
---

# Batches

It is possible to configure workers so that instead of processing one job at a time they can process up to a number of jobs (a so-called _batch_) in one go. Workers using batches have slightly different semantics and behavior than normal workers, so read carefully the following examples to avoid pitfalls.

To enable batches, pass the `batch` option with a `size` property representing the maximum number of jobs per batch:

```typescript
const worker = new WorkerPro(
  'My Queue',
  async (job: JobPro) => {
    const batch = job.getBatch();

    for (let i = 0; i < batch.length; i++) {
      const batchedJob = batch[i];
      await doSomethingWithBatchedJob(batchedJob);
    }
  },
  { connection, batch: { size: 10 } },
);
```

{% hint style="info" %}
There is no strict maximum limit for the size of batches; however, keep in mind that larger batches introduce overhead proportional to their size, which could lead to performance issues. Typical batch sizes range between 10 and 50 jobs.
{% endhint %}

### New Batch Options: `minSize` and `timeout`

In addition to the size option, two new options—`minSize` and `timeout`—provide greater control over batch processing:

* `minSize`: Specifies the minimum number of jobs required before the worker processes a batch. The worker will wait until at least minSize jobs are available before fetching and processing them, up to the size limit. If fewer than minSize jobs are available, the worker waits indefinitely unless a timeout is also set.&#x20;
* `timeout`: Defines the maximum time (in milliseconds) the worker will wait for minSize jobs to accumulate. If the timeout expires before minSize is reached, the worker processes whatever jobs are available, up to the size limit. If minSize is not set the timeout option is effectively ignored, as the worker batches only avaialble jobs.

{% hint style="info" %}
Important: minSize and timeout are not compatible with groups. When groups are used, the worker ignores minSize and tries to batch avaialble jobs without waiting.
{% endhint %}

Here’s an example configuration using both `minSize` and `timeout`:

```typescript
const worker = new WorkerPro(
  'My Queue',
  async (job: JobPro) => {
    const batch = job.getBatch();
    for (let i = 0; i < batch.length; i++) {
      const batchedJob = batch[i];
      await doSomethingWithBatchedJob(batchedJob);
    }
  },
  {
    connection,
    batch: {
      size: 10,      // Maximum jobs per batch
      minSize: 5,    // Wait for at least 5 jobs
      timeout: 30_000 // Wait up to 30 seconds
    },
  },
);
```

In this example:

* The worker waits for at least 5 jobs to become available, up to a maximum of 10 jobs per batch.
* If 5 or more jobs are available within 30 seconds, it processes the batch (up to 10 jobs).
* If fewer than 5 jobs are available after 30 seconds, it processes whatever jobs are present, even if below `minSize`.

### Failing jobs

When using batches, the default is that if the processor throws an exception, **all jobs in the batch will fail.**

To fail specific jobs instead, use the `setAsFailed` method on individual jobs within the batch:

```typescript
const worker = new WorkerPro(
  'My Queue',
  async (job: JobPro) => {
    const batch = job.getBatch();

    for (let i = 0; i < batch.length; i++) {
      const batchedJob = batch[i];
      try {
        await doSomethingWithBatchedJob(batchedJob);
      } catch (err) {
        batchedJob.setAsFailed(err);
      }
    }
  },
  { connection, batch: { size: 10 } },
);
```

Only jobs explicitly marked with `setAsFailed` will fail; the remaining jobs in the batch will complete succesfully once the processor finishes.

### Handling events

Batches are managed by wrapping all  jobs in a batch into a dummy job that holds the jobs in an internal array. This simplifies batch processing but affects event handling. For example, worker-level event listeners (e.g., `worker.on('completed', ...)`) report events for the dummy batch job, not the individual jobs within it.

To retrieve the jobs in a batch from an event handler, use the `getBatch` method:

```typescript
worker.on('completed', job => {
  const batch = job.getBatch();
  // ...
});
```

Using a global event listener you can listen to individual job events even though they may be processed in a batch:

```typescript
import { QueueEventsPro } from '@taskforcesh/bullmq-pro';

const queueEvents = new QueueEventsPro(queueName, { connection });
queueEvents.on('completed', (jobId, err) => {
  // ...
});
```

### Limitations

Currently, all worker options can be used with batches, however, there are some unsupported features that may be implemented in the future:

* [Dynamic rate limit](https://docs.bullmq.io/guide/rate-limiting#manual-rate-limit)
* [Manually processing jobs](https://docs.bullmq.io/patterns/manually-fetching-jobs)
* [Dynamically delay jobs](https://docs.bullmq.io/patterns/process-step-jobs#delaying).
