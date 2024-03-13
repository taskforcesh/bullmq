# Job Ids

All jobs in BullMQ need to have a unique job id. This id is used to construct a key to store the data in Redis, and as a pointer to the job as it is moved between the different states it can be in during its lifetime.

By default, job ids are generated automatically as an increasing counter, however it is also possible to specify a _custom id_.

The main reason to be able to specify a custom id is in cases when you want to avoid duplicated jobs. Since ids must be unique, if you add a job with an existing id then that job will just be ignored and not added to the queue at all.

{% hint style="danger" %}
Jobs that are removed from the queue (either manually, or when using settings such as `removeOnComplete`/`removeOnFailed`) will **not** be considered as duplicates, meaning that you can add the same job id many times over as long as the previous job has already been removed from the queue.
{% endhint %}

In order to specify a custom job id, use the `jobId` option when adding jobs to the queue:

```typescript
await myQueue.add(
  'wall',
  { color: 'pink' },
  {
    jobId: customJobId,
  },
);
```

{% hint style="danger" %}
Custom job ids must not contains **:** separator as it will be translated in 2 different values, we are also following Redis naming convention. So if you need to add a separator, use a different value, for example **-**, **\_**.
{% endhint %}

## Read more:

- 💡 [Duplicated Event Reference](https://api.docs.bullmq.io/interfaces/v5.QueueEventsListener.html#duplicated)
