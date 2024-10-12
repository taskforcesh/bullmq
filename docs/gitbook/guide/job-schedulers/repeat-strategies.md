# Repeat Strategies

BullMQ comes with two predefined strategies for creating repeatable jobs. The ‘every’ strategy is straightforward, allowing you to schedule jobs to repeat at specific intervals, measured in seconds. The more complex ‘cron’ strategy uses cron expressions, as defined by the [cron-parser](https://www.npmjs.com/package/cron-parser) to schedule jobs in intricate patterns. Additionally, BullMQ lets you create custom strategies, giving you the flexibility to define your own logic for setting job intervals.

### "Every" strategy

The every strategy is used when we simply want to produce repeatable jobs at specific intervals:

```typescript
const { Queue, Worker } = require('bullmq');

const connection = {
  host: 'localhost',
  port: 6379,
};

const myQueue = new Queue('my-repeatable-jobs', { connection });

// Upserting a repeatable job in the queue
await myQueue.upsertJobScheduler(
  'repeat-every-10s',
  {
    every: 10000, // Job will repeat every 10000 milliseconds (10 seconds)
  },
  {
    name: 'every-job',
    data: { jobData: 'data' },
    opts: {}, // Optional additional job options
  },
);

// Worker to process the jobs
const worker = new Worker(
  'my-repeatable-jobs',
  async job => {
    console.log(`Processing job ${job.id} with data: ${job.data.jobData}`);
  },
  { connection },
);
```

### "Cron" strategy

The “cron” strategy in BullMQ leverages the [cron-parser](https://www.npmjs.com/package/cron-parser) library to use cron expressions for scheduling jobs with greater specificity. This approach is ideal for jobs requiring execution at precise times or intervals, such as automated reports or maintenance tasks.

Below is the supported format for cron expressions in cron-parser:

```
*    *    *    *    *    *
┬    ┬    ┬    ┬    ┬    ┬
│    │    │    │    │    │
│    │    │    │    │    └ day of week (0 - 7, 1L - 7L, where 0 or 7 is Sunday)
│    │    │    │    └───── month (1 - 12)
│    │    │    └────────── day of month (1 - 31, L for the last day of the month)
│    │    └─────────────── hour (0 - 23)
│    └──────────────────── minute (0 - 59)
└───────────────────────── second (0 - 59, optional)
```

This format includes the optional second field, which is not typically available in standard cron schedules, allowing for even more precise scheduling.

Cron expressions are quite powerful as in they support seemless handling timezone differences and daylight saving time transitions, crucial for tasks that depend on local times. And also because of the use of special characters to denote specific days or things like the last day of the month, providing flexibility for monthly and weekly tasks.

If you are new to Cron expressions, [Wikipedia](https://en.wikipedia.org/wiki/Cron) is an excelent starting point to learn how to use them.

Here follows an example that sets up a job to execute at 9:00 AM from Monday to Friday:

```typescript
const { Queue, Worker } = require('bullmq');

const connection = {
  host: 'localhost',
  port: 6379,
};

const myQueue = new Queue('my-cron-jobs', { connection });

// Upserting a job with a cron expression
await myQueue.upsertJobScheduler(
  'weekday-morning-job',
  {
    pattern: '0 0 9 * * 1-5', // Runs at 9:00 AM every Monday to Friday
  },
  {
    name: 'cron-job',
    data: { jobData: 'morning data' },
    opts: {}, // Optional additional job options
  },
);

// Worker to process the jobs
const worker = new Worker(
  'my-cron-jobs',
  async job => {
    console.log(
      `Processing job ${job.id} at ${new Date()} with data: ${
        job.data.jobData
      }`,
    );
  },
  { connection },
);
```

### Custom Strategy

It is possible to define a different strategy to schedule repeatable jobs. The idea is that the repeat strategy, based on a pattern and the latest job's milliseconds, return the next desired timestamp. Although not used in the following example, you could have different behaviours on your repeat strategies based on the current job's name if you want to. However not that **only** **one** repeatStrategy can be defined for a given queue.

For example we can create a custom one for [RRULE](https://jkbrzt.github.io/rrule/) like this:

```typescript
import { Queue, Worker } from 'bullmq';
import { rrulestr } from 'rrule';

const settings = {
  repeatStrategy: (millis: number, opts: RepeatOptions, _jobName: string) => {
    const currentDate =
      opts.startDate && new Date(opts.startDate) > new Date(millis)
        ? new Date(opts.startDate)
        : new Date(millis);

    const rrule = rrulestr(opts.pattern);

    if (rrule.origOptions.count && !rrule.origOptions.dtstart) {
      throw new Error('DTSTART must be defined to use COUNT with rrule');
    }

    const next_occurrence = rrule.after(currentDate, false);
    return next_occurrence?.getTime();
  },
};

const myQueue = new Queue('Paint', { settings });

// Repeat job every 10 seconds
await myQueue.upsertJobScheduler(
  'collibris',
  {
    pattern: 'RRULE:FREQ=SECONDLY;INTERVAL=10;WKST=MO',
  },
  {
    data: { color: 'green' },
  },
);

// Repeat job every 20 seconds
await myQueue.upsertJobScheduler(
  'pingeons',
  {
    pattern: 'RRULE:FREQ=SECONDLY;INTERVAL=20;WKST=MO',
  },
  {
    data: { color: 'gray' },
  },
);

const worker = new Worker(
  'Paint',
  async () => {
    doSomething();
  },
  { settings },
);
```

{% hint style="danger" %}
As you may have noticed, the repeat strategy setting should be provided in **both** the Queue and Worker classes. The reason we need it in both places is that when we first add the job to the Queue, we need to calculate when the next iteration will occur. After that, the Worker takes over, and we use the settings configured in the Worker.
{% endhint %}
