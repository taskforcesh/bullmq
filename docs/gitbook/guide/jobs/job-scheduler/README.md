---
description: >-
  Job Schedulers replace "repeatable jobs", and are available in v5.5.5 and
  above.
---

# Job Scheduler

A Job Scheduler acts as a factory , producing jobs based on specified "repeat" settings. The Job Scheduler is highly flexible, accommodating various scenarios, including jobs produced at fixed intervals, according to cron expressions, or based on custom requirements. For historical reasons, jobs produced by the Job Scheduler are often referred to as ‘Repeatable Jobs’.

To create a scheduler, simply use the "upsertJobScheduler" method as demonstrated in the following example:

```typescript
// Creates a new Job Scheduler that generates a job every 1000 milliseconds (1 second)
const firstJob = await queue.upsertJobScheduler("my-scheduler-id", { every: 1000 });
```

This example will create a new Job Scheduler that will produce a new job every second. It will also return the first job created for this Job Scheduler, which will be in "delayed" status waiting to be processed after 1 second.

Now there are also a few important considerations that need to be explained here.:

* **Upsert vs. Add:** 'upsert' is used instead of 'add' to simplify management of recurring jobs, especially in production deployments. It ensures the scheduler is updated or created without duplications.
* **Job Production Rate:** The scheduler will only generate new jobs when the last job begins processing. Therefore, if your queue is very busy, or if you do not have enough workers or concurrency, it is possible that you will get the jobs less frequently than the specified  repetition interval.
* **Job Status:**  As long as a Job Scheduler is producing jobs, there will be always one job associated to the scheduler in the "Delayed" status.

### Using Job Templates

You can also define a template with standard names, data, and options for jobs added to a queue. This ensures that all jobs produced by the Job Scheduler inherit these settings:

```typescript
// Create jobs every day at 3:15 (am)
const firstJob = await queue.upsertJobScheduler(
  "my-scheduler-id",
  { pattern: '0 15 3 * * *' },
  {
    name: "my-job-name",
    data: { foo: "bar" },
    opts: {
      backoff: 3,
      attempts: 5,
      removeOnFail: 1000
    },
  });
 
```

All jobs produced by this scheduler will use the given settings. Note that in the future you could call "upsertJobScheduler" again  with the given "my-scheduler-id" in order to update any settings, both the repeat options or/and the job's template settings.

{% hint style="info" %}
Since jobs produced by the Job Scheduler will get a special job ID in order to guarantee that jobs will never be created more often than the given repeat settings, you cannot choose a custom job id. However you can use the job's name if you need to discriminate these jobs from other jobs.
{% endhint %}
