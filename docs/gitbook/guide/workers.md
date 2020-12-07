# Workers

Workers are the actual instances that perform some job based on the jobs that are added in the queue. A worker is equivalent to a "message" receiver in a traditional message queue. The worker duty is to complete the job, if it succeeds the job will be moved to the "completed" status. If the worker throws an exception during its processing, the job will automatically be moved to the "failed" status.

{% hint style="info" %}
Failed jobs can be automatically retried, see [Retrying failing jobs](retrying-failing-jobs.md)
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

### Stalled jobs

Due to the nature of NodeJS, which is \(in general\) single threaded and consists of an event loop to handle the asynchronous operations, the process function needs to be written carefully so that the CPU is not occupied for a long time. 

When a job reaches a worker and starts to be processed, BullMQ will place a lock on this job  to protect the job from being modified by any other client or worker. At the same time, the worker needs to periodically notify BullMQ that it is still working on the job.

{% hint style="info" %}
This period is configured with the "stalledInterval" setting, which normally you should not need to modify.
{% endhint %}

However if the CPU is very busy due to the process being very CPU intensive, the worker may not have time to renew the lock and tell the queue that it is still working on the job, then the job will likely be marked as Stalled. 

A stalled job is moved back to the waiting status and will be processed again by another worker, or if it has reached its maximum number of stalls moved to the failed set.

Therefore it is very important to make sure the workers return the control to NodeJS event loop often enough to avoid this kind of problems.

### Sandboxed processors

It is also possible to define workers to run on a separate process, we call this processors for sandboxed, because they run isolated from the rest of the code.

Since these workers run the processor in a different process, they will not result in stalled jobs as easily as standard workers, although it is not completely impossible if the CPUs in the system are so overload that there is no practical time for the worker to perform its bookkeeping to avoid stalling.

In order to use a sandboxed processor just define the processor in a separate file:

```typescript
import { Job } from 'bullmq';

module.exports = async (job: Job) {
    // Do something with job
};
```

and refer to it in the worker constructor:

```typescript
 const processorFile = path.join(__dirname, 'my_procesor.js');
 worker = new Worker(queueName, processorFile);
```



