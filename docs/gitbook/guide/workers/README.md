# Workers

Workers are the actual instances that perform some job based on the jobs that are added in the queue. A worker is equivalent to a "message" receiver in a traditional message queue. The worker duty is to complete the job, if it succeeds the job will be moved to the "completed" status. If the worker throws an exception during its processing, the job will automatically be moved to the "failed" status.

{% hint style="info" %}
Failed jobs can be automatically retried, see [Retrying failing jobs](../retrying-failing-jobs.md)
{% endhint %}

A worker is instantiated with the Worker class, and the work itself will be performed in the process function. Process functions are meant to be asynchronous so either use the "async" keyword or return a promise.

```typescript
import { Worker, Job } from 'bullmq'

const worker = new Worker(queueName, async (job: Job) => {
    // Do something with job
    return 'some value';
});
```

Note that a processor can optionally return a value. This value can be retrieved either by getting the job and accessing the "returnvalue" property or by listening to the "completed" event:

```typescript
worker.on("completed", (job: Job, returnvalue: any) => {
  // Do something with the return value.
});
```

Inside the worker process function it is also possible to emit progress events. Calling "job.progress" you can specify a number or an object if you have more complex needs. The "progress" event can be listened in the same way as the "completed" event:

```typescript
worker.on("progress", (job: Job, progress: number | object) => {
  // Do something with the return value.
});
```

Finally, when the process fails with an exception it is possible to listen for the "failed" event too:

```typescript
worker.on("failed", (job: Job, failedReason: string) => {
  // Do something with the return value.
});
```

It is also possible to listen to global events in order to get notifications of job completions, progress and failures:

```typescript
import { QueueEvents } from 'bullmq'

const queueEvents = new QueueEvents('Paint')

queueEvents.on('completed', (jobId: string, returnvalue: any) => {
    // Called every time a job is completed in any worker.
});

queueEvents.on('failed', (jobId: string, failedReason: string) => {
    // jobId received a progress event
});

queueEvents.on('progress', (jobId: string, progress: number | object) => {
    // jobId received a progress event
});
```

