# Repeat options

There are some options that can be used on all Job Schedulers, to control some aspects of the repetitions. Lets review them one by one:

#### Start date

This option sets a future date from which the job will start being scheduled. This can be useful for setting up jobs that should begin repeating on a specific day.

```typescript
const { Queue } = require('bullmq');
const connection = { host: 'localhost', port: 6379 };
const myQueue = new Queue('my-dated-jobs', { connection });

await myQueue.upsertJobScheduler(
  'start-later-job',
  {
    every: 60000, // every minute
    startDate: new Date('2024-10-15T00:00:00Z'), // start on October 15, 2024
  },
  {
    name: 'timed-start-job',
    data: { message: 'Starting later' },
  },
);
```

#### End Date

Use this to specify when the job should stop being scheduled, effectively setting an expiration date for the job repetitions.

```typescript
await myQueue.upsertJobScheduler(
  'end-soon-job',
  {
    every: 60000, // every minute
    endDate: new Date('2024-11-01T00:00:00Z'), // end on November 1, 2024
  },
  {
    name: 'timed-end-job',
    data: { message: 'Ending soon' },
  },
);
```

#### Limit

This setting is used to limit the number of times a job will be repeated. When the count reaches this limit, no more jobs will be produced for the given job scheculer.

```typescript
await myQueue.upsertJobScheduler(
  'limited-job',
  {
    every: 10000, // every 10 seconds
    limit: 10, // limit to 10 executions
  },
  {
    name: 'limited-execution-job',
    data: { message: 'Limited runs' },
  },
);
```

#### immediately

This setting forces the job to execute as soon as it is added, regardless of the schedule. This can help in situations where an immediate action is required before entering a regular cycle.

When you use the every option in BullMQ, it schedules jobs based on fixed time intervals, which might seem a bit counterintuitive initially. For instance, if you set an interval of 2000ms, jobs will be triggered at every even second—such as 0, 2, 4, 6, 8 seconds, and so on. This means the scheduling aligns with the clock, regardless of when you actually added the job.

If you need a job to begin processing immediately after you add a job scheduler, regardless of the interval’s alignment with the clock, you can use the immediately setting. This is especially crucial for long intervals. For example, if you set the job to repeat monthly, normally it would wait to start until the first second of the next month. If you add the job mid-month, it would not start until the beginning of the following month. Using immediately ensures the first instance of the job runs as soon as it’s added, bypassing the wait until the scheduled interval begins.

```typescript
await myQueue.upsertJobScheduler(
  'immediate-job',
  {
    every: 86400000, // once a day
    immediately: true, // execute the first one immediately
  },
  {
    name: 'instant-job',
    data: { message: 'Immediate start' },
  },
);
```

{% hint style="danger" %}
From version 5.19.0 and onwards the "immediately" option has been deprecated. The current behaviour is as if "immediately" was always true, in other words, the first repetition will always be immediately for a new inserted job scheduler, and then repeat according to the "every" setting. Subsequent calls to upsertJobScheduler for **existing** schedulers will not lead to immediate repetitions and will instead follow the "every" interval.
{% endhint %}
