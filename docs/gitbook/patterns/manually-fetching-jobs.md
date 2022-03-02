# Manually processing jobs

When a Worker is instantiated, the most common usage is to specify a process function so that the worker will automatically process the jobs that arrive to the queue.

Sometimes however it is useful to be able to fetch the jobs manually. Just instantiate the worker without a processor and call getNextJob to fetch the next job:

```typescript
const worker = new Worker('my-queue');

// Specify a unique token
const token = 'my-token';

const job = (await worker.getNextJob(token)) as Job;

// Access job.data and do something with the job
// processJob(job.data)
if (succeeded) {
  await job.moveToCompleted('some return value', token);
} else {
  await job.moveToFailed(new Error('my error message'), token);
}

await worker.close();
```

There is an important consideration regarding job "locks" when processing manually. Locks avoid other workers to fetch the same job that is being processed by a given worker. The ownership of the lock is determined by the "token" that is sent when getting the job.

{% hint style="info" %}
the lock duration setting is called "visibility window" in other queue systems.
{% endhint %}

Normally a job gets locked as soon as it is fetched from the queue with a max duration of "lockDuration" worker option. The default is 30 seconds but can be changed to any value easily, for example, to change it to 60 seconds:

```typescript
const worker = new Worker('my-queue', null, { lockDuration: 60000 });
```

When using standard worker processors the lock is renewed automatically after half lock duration time has passed, however, this mechanism does not exist when processing jobs manually, so you need to make sure to process the job faster than the lockDuration to avoid the "QueueScheduler" to move the job back to the waiting list of the queue or you can extend the lock for the job manually:

```typescript
const job = (await worker.getNextJob(token)) as Job;

// Extend the lock 30 more seconds
await job.extendLock(token, 30000);
```

## Looping through jobs

In many cases, you will have an "infinite" loop that processes jobs one by one like this example:

```typescript
const worker = new Worker('my-queue');

const token = 'my-token';
let job;

while (1) {
  let jobData = null,
    jobId,
    success;

  if (job) {
    // Use job.data to process this particular job.
    // and set success variable if succeeded

    if (success) {
      [jobData, jobId] = await job.moveToCompleted('some return value', token);
    } else {
      await job.moveToFailed(new Error('some error message'), token);
    }

    if (jobData) {
      job = Job.fromJSON(worker, jobData, jobId);
    } else {
      job = null;
    }
  } else {
    if (!job) {
      job = await worker.getNextJob(token);
    }
  }
}
```
