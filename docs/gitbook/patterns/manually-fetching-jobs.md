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
  await job.moveToCompleted('some return value', token, false);
} else {
  await job.moveToFailed(new Error('my error message'), token, false);
}

await worker.close();
```

There is an important consideration regarding job "locks" when processing manually. Locks prevent workers from fetching a job that is already being processed by  another worker. The ownership of the lock is determined by the "token" that is sent when getting the job.

{% hint style="info" %}
the lock duration setting is called "visibility window" in other queue systems.
{% endhint %}

Normally a job gets locked as soon as it is fetched from the queue with a max duration of the specified `lockDuration` worker option. The default is 30 seconds but can be changed to any value easily. For example, to change it to 60 seconds:

```typescript
const worker = new Worker('my-queue', null, { lockDuration: 60000 });
```

When using standard worker processors, the lock is renewed automatically after half the lock duration time has passed. However, this mechanism does not exist when processing jobs manually, so to avoid the job being moved back to the waiting list of the queue,
you need to make sure to process the job faster than the `lockDuration`, or manually extend the lock:

```typescript
const job = (await worker.getNextJob(token)) as Job;

// Extend the lock 30 more seconds
await job.extendLock(token, 30000);
```

### Choosing a token

A token represents ownership by given worker currently working on a given job. If the worker dies unexpectedly, the job could be picked up by another worker when the lock expires. A good approach for generating tokens for jobs is simply to generate a UUID for every new job, but it all depends on your specific use case.

## Checking for stalled jobs

When processing jobs manually you may also want to start the stalled jobs checker. This checker is needed to move stalled jobs (whose lock has expired) back to the _wait_ status (or _failed_ if they have exhausted the maximum number of [stalled attempts](https://api.docs.bullmq.io/interfaces/v5.WorkerOptions.html#maxStalledCount), which is 1 by default).

```typescript
await worker.startStalledCheckTimer()
```

The checker will run periodically (based on the [`stalledInterval`](https://api.docs.bullmq.io/interfaces/v5.WorkerOptions.html#stalledInterval) option) until the worker is closed.

## Looping through jobs

In many cases, you will have an "infinite" loop that processes jobs one by one like the following example. Note that the third parameter in `job.moveToCompleted`/`job.moveToFailed` is not used, signalling that the next job should be returned automatically.

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

## Rate Limiting

If you want to move a job back to wait because your queue is rate limited.

```typescript
const worker = new Worker('my-queue', null, { connection, prefix });
const token = 'my-token';
await Job.create(queue, 'test', { foo: 'bar' });
const job = (await worker.getNextJob(token)) as Job;

await queue.rateLimit(60000);
await job.moveToWait(token);
```

## Read more:

- 💡 [Get Next Job API Reference](https://api.docs.bullmq.io/classes/v5.Worker.html#getNextJob)
- 💡 [Move To Completed API Reference](https://api.docs.bullmq.io/classes/v5.Job.html#moveToCompleted)
- 💡 [Move To Failed API Reference](https://api.docs.bullmq.io/classes/v5.Job.html#moveToFailed)
- 💡 [Move To Wait API Reference](https://api.docs.bullmq.io/classes/v5.Job.html#moveToWait)
