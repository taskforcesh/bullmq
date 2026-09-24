# Workers

Workers are the actual instances that perform some job based on the jobs that are added in the queue. A worker is equivalent to a "message" receiver in a traditional message queue. The worker duty is to complete the job, if it succeeds the job will be moved to the "completed" status. If the worker throws an exception during its processing, the job will automatically be moved to the "failed" status.

{% hint style="info" %}
Failed jobs can be automatically retried, see [Retrying failing jobs](retrying-failing-jobs.md)
{% endhint %}

A worker is instantiated with the Worker class, and the work itself will be performed in the process function. Process functions are meant to be asynchronous so either use the "async" keyword or return a promise.

```typescript
import { Worker, Job } from 'bullmq';

const worker = new Worker(queueName, async (job: Job) => {
  // Do something with job
  return 'some value';
});
```

Note that a processor can optionally return a value. This value can be retrieved either by getting the job and accessing the "returnvalue" property or by listening to the "completed" event:

```typescript
worker.on('completed', (job: Job, returnvalue: any) => {
  // Do something with the return value.
});
```

Inside the worker process function it is also possible to emit progress events. Calling "job.progress" you can specify a number or an object if you have more complex needs. The "progress" event can be listened in the same way as the "completed" event:

```typescript
worker.on('progress', (job: Job, progress: number | object) => {
  // Do something with the return value.
});
```

Finally, when the process fails with an exception it is possible to listen for the "failed" event too:

```typescript
worker.on('failed', (job: Job, error: Error) => {
  // Do something with the return value.
});
```

It is also possible to listen to global events in order to get notifications of job completions, progress and failures:

```typescript
import { QueueEvents } from 'bullmq';

const queueEvents = new QueueEvents('Paint');

queueEvents.on('completed', ({ jobId, returnvalue }) => {
  // Called every time a job is completed in any worker.
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  // jobId received a progress event
});

queueEvents.on('progress', ({ jobId, data }) => {
  // jobId received a progress event
});
```

## Stalled jobs

Due to the nature of NodeJS, which is \(in general\) single threaded and consists of an event loop to handle the asynchronous operations, the process function needs to be written carefully so that the CPU is not occupied for a long time.

When a job reaches a worker and starts to be processed, BullMQ will place a lock on this job to protect the job from being modified by any other client or worker. At the same time, the worker needs to periodically notify BullMQ that it is still working on the job.

{% hint style="info" %}
This period is configured with the `stalledInterval` setting, which normally you should not need to modify.
{% endhint %}

However if the CPU is very busy due to the process being very CPU intensive, the worker may not have time to renew the lock and tell the queue that it is still working on the job, then the job will likely be marked as Stalled.

A stalled job is moved back to the waiting status and will be processed again by another worker, or if it has reached its maximum number of stalls moved to the failed set.

Therefore it is very important to make sure the workers return the control to NodeJS event loop often enough to avoid this kind of problems.

## Cancelling active jobs from a Queue

A queue can request cooperative cancellation of an active job through `Queue.cancelJob`. This is useful when the producer and worker run in separate processes:

```typescript
const result = await queue.cancelJob(jobId, 'cancelled by user');
```

The result is one of `accepted`, `unknown`, `waiting`, `prioritized`, `delayed`, `waiting-children`, `completed`, or `failed`. The request is published only when the job is active. It does not remove waiting or delayed jobs and does not move a job to a terminal state. A repeated request is safe.

Cancellation remains cooperative. The worker passes an `AbortSignal` to processors that declare the third processor argument, and the processor must observe it and stop its work:

```typescript
const worker = new Worker('my-queue', async (job, token, signal) => {
  const response = await fetch(url, { signal });
  return response.json();
});
```

`accepted` means the request was published, not that the processor stopped; completion can win a race. If the processor ignores the signal, it continues normally. A processor can throw a normal error to follow the configured retry policy, or an `UnrecoverableError` to fail without retrying.

Queue-side cancellation is currently supported by the JavaScript Redis backend with both ioredis and node-redis connections. It is not supported by the Bun Redis client or Valkey Glide adapter. Workers using Bun or Valkey Glide continue to process jobs normally, but they do not receive queue-side cancellation requests. PostgreSQL and the Python, Rust, PHP, .NET, and Elixir ports do not automatically provide this JavaScript API; they must implement equivalent cancellation transport and lifecycle behavior before claiming parity.

## Sandboxed processors

It is also possible to define workers to run on a separate process, we call this processors for sandboxed, because they run isolated from the rest of the code.

Since these workers run the processor in a different process, they will not result in stalled jobs as easily as standard workers, although it is not completely impossible if the CPUs in the system are so overload that there is no practical time for the worker to perform its bookkeeping to avoid stalling.

In order to use a sandboxed processor just define the processor in a separate file:

```typescript
import { Job } from 'bullmq';

module.exports = async (job: Job) {
    // Do something with job
};
```

and refer to it in the worker constructor:

```typescript
const processorFile = path.join(__dirname, 'my_procesor.js');
worker = new Worker(queueName, processorFile);
```
