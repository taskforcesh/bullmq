# Workers

Workers are the actual instances that perform some job based on the jobs that are added in the queue. A worker is equivalent to a "message" receiver in a traditional message queue. The worker duty is to complete the job, if it succeeds, the job will be moved to the "completed" status. If the worker throws an exception during its processing, the job will automatically be moved to the "failed" status.

{% hint style="info" %}
Failed jobs can be automatically retried, see [Retrying failing jobs](../retrying-failing-jobs.md)
{% endhint %}

A worker is instantiated with the Worker class, and the work itself will be performed in the process function. Process functions are meant to be asynchronous so either use the "async" keyword or return a promise.

```typescript
import { Worker, Job } from 'bullmq';

const worker = new Worker(queueName, async (job: Job) => {
  // Optionally report some progress
  await job.updateProgress(42);

  // Optionally sending an object as progress
  await job.updateProgress({ foo: 'bar' });

  // Do something with job
  return 'some value';
});
```

{% hint style="info" %}
When a worker instance is created, it launches the processor immediately
{% endhint %}

In order to decide when your processor should start its execution, pass autorun as false as part of worker options:

```typescript
import { Worker, Job } from 'bullmq';

const worker = new Worker(
  queueName,
  async (job: Job) => {
    // Optionally report some progress
    await job.updateProgress(42);

    // Optionally sending an object as progress
    await job.updateProgress({ foo: 'bar' });

    // Do something with job
    return 'some value';
  },
  { autorun: false },
);

worker.run();
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

queueEvents.on('completed', ({ jobId: string, returnvalue: any }) => {
  // Called every time a job is completed in any worker.
});

queueEvents.on('failed', ({ jobId: string, failedReason: string }) => {
  // jobId received a progress event
});

queueEvents.on('progress', ({jobId: string, data: number | object}) => {
  // jobId received a progress event
});
```

Finally, you should attach an error listener to your worker to avoid NodeJS raising an unhandled exception when an error occurs, something like this:

```typescript
worker.on('error', err => {
  // log the error
  console.error(err);
});
```

{% hint style="danger" %}
If the error handler is missing, your worker may stop processing jobs when an error is emitted!. More info [here](https://nodejs.org/api/events.html#events_error_events).
{% endhint %}

## Typescript typings

It is also possible to specify the data types for the Job data and return value using generics:

```typescript
const worker = new Worker<MyData, MyReturn>(queueName, async (job: Job) => {});
```

## Read more:

- 💡 [Worker API Reference](https://api.docs.bullmq.io/classes/Worker.html)
- 💡 [Queue Events API Reference](https://api.docs.bullmq.io/classes/QueueEvents.html)
