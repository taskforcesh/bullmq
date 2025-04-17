# Auto-removal of jobs

By default, when your queue jobs are completed (or failed), they are stored in two special sets, the "completed" and the "failed" set. This is useful so that you can examine the results of your jobs, particularly in the early stages of development. However, as the solution reaches a production-grade level, we usually need to restrict the number of finished jobs to be kept, so that we do not fill Redis with data that is not particularly useful.

BullMQ supports different strategies for auto-removing finalized jobs. These strategies are configured on the Worker's options [`removeOnComplete`](https://api.docs.bullmq.io/interfaces/v5.WorkerOptions.html#removeOnComplete) and [`removeOnFail`](https://api.docs.bullmq.io/interfaces/v5.WorkerOptions.html#removeOnFail).

### Remove all finalized jobs

The simplest option is to set `removeOnComplete`/`removeOnFail` to `{count: 0}`, in this case, all jobs will be removed automatically as soon as they are finalized:

```typescript
const myWorker = new Worker(
  'myQueueName',
  async job => {
    // do some work
  },
  {
    connection,
    removeOnFail: { count: 0 }
  },
);
```

{% hint style="warning" %}
Jobs will be deleted regardless of their names.
{% endhint %}

### Keep a certain number of jobs

It is also possible to specify a maximum number of jobs to keep. A good practice is to keep a handful of completed jobs and a much larger value of failed jobs:

```typescript
const myWorker = new Worker(
  'myQueueName',
  async job => {
    // do some work
  },
  {
    connection,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 }
  },
);
```

### Keep jobs based on their age

Another possibility is to keep jobs up to a certain age. The `removeOn` option accepts a [`KeepJobs`](https://api.docs.bullmq.io/interfaces/v5.KeepJobs.html) object, that includes an `age` and a `count` fields. The `age` is used to specify how old jobs to keep (in seconds), and the `count` can be used to limit the total amount to keep. The `count` option is useful in cases we get an unexpected amount of jobs in a very short time, in this case we may just want to limit to a certain amount to avoid running out of memory.

```typescript
const myWorker = new Worker(
  'myQueueName',
  async job => {
    // do some work
  },
  {
    connection,
    removeOnComplete: {
      age: 3600, // keep up to 1 hour
      count: 1000, // keep up to 1000 jobs
    },
    removeOnFail: {
      age: 24 * 3600, // keep up to 24 hours
    }
  },
);
```

{% hint style="info" %}
The auto removal of jobs works lazily. This means that jobs are not removed unless a new job completes or fails, since that is when the auto-removal takes place.
{% endhint %}
