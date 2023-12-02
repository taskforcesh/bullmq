There is a special type of _meta_ job called **repeatable**. These jobs are special in the sense that even though you only add one job to the queue, they will keep repeating according to a predefined schedule.

Adding a job with the `repeat` option set will actually do two things immediately: create a Repeatable Job configuration, and schedule a regular delayed job for the job's first run. This first run will be scheduled "on the hour", that is if you create a job that repeats every 15 minutes at 4:07, the job will first run at 4:15, then 4:30, and so on.

The Repeatable Job configuration is not a job, so it will not show up in methods like `getJobs()`. To manage Repeatable Job configurations, use [`getRepeatableJobs()`](https://api.docs.bullmq.io/classes/v4.Queue.html#getRepeatableJobs) and similar. This also means repeated jobs do **not** participate in evaluating `jobId` uniqueness - that is, a non-repeatable job can have the same `jobId` as a Repeatable Job configuration, and two Repeatable Job configurations can have the same `jobId` as long as they have different repeat options.

Every time a repeatable job is picked up for processing, the next repeatable job is added to the queue with a proper delay. Repeatable jobs are thus nothing more than delayed jobs that are added to the queue according to some settings.

{% hint style="info" %}
As Repeatable jobs are just delayed jobs, prior to BullMQ 2.0 you also need a `QueueScheduler` instance to schedule the jobs accordingly.

However, from BullMQ 2.0 onwards, the `QueueScheduler` is not needed anymore.
{% endhint %}

There are two ways to specify a repeatable's job repetition pattern, either with a cron expression (using [cron-parser](https://www.npmjs.com/package/cron-parser)'s "unix cron w/ optional seconds" format), or specifying a fixed amount of milliseconds between repetitions.

```typescript
import { Queue, QueueScheduler } from 'bullmq';

const myQueueScheduler = new QueueScheduler('Paint');
const myQueue = new Queue('Paint');

// Repeat job once every day at 3:15 (am)
await myQueue.add(
  'submarine',
  { color: 'yellow' },
  {
    repeat: {
      pattern: '0 15 3 * * *',
    },
  },
);

// Repeat job every 10 seconds but no more than 100 times
await myQueue.add(
  'bird',
  { color: 'bird' },
  {
    repeat: {
      every: 10000,
      limit: 100,
    },
  },
);
```

There are some important considerations regarding repeatable jobs:

- Bull is smart enough not to add the same repeatable job if the repeat options are the same.
- If there are no workers running, repeatable jobs will not accumulate next time a worker is online.
- Repeatable jobs can be removed using the [`removeRepeatable`](https://api.docs.bullmq.io/classes/v4.Queue.html#removeRepeatable) or [`removeRepeatableByKey`](https://api.docs.bullmq.io/classes/v4.Queue.html#removeRepeatableByKey) methods.

```typescript
import { Queue } from 'bullmq';

const repeat = { pattern: '*/1 * * * * *' };

const myQueue = new Queue('Paint');

const job1 = await myQueue.add('red', { foo: 'bar' }, { repeat });
const job2 = await myQueue.add('blue', { foo: 'baz' }, { repeat });
    
const isRemoved1 = await myQueue.removeRepeatableByKey(job1.repeatJobKey);
const isRemoved2 = await queue.removeRepeatable('blue', repeat);
```

All repeatable jobs have a repeatable job key that holds some metadata of the repeatable job itself. It is possible to retrieve all the current repeatable jobs in the queue calling [`getRepeatableJobs`](https://api.docs.bullmq.io/classes/v4.Queue.html#getRepeatableJobs):

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('Paint');

const repeatableJobs = await myQueue.getRepeatableJobs();
```

The standard `jobId` option does not work the same as with regular jobs. Because repeatable jobs are _delayed_ jobs, and the repetition is achieved by generating a new delayed job precisely before the current job starts processing, the jobs require unique ids to avoid being considered duplicates. Therefore, with repeatable jobs, the `jobId` option is used to _generate_ the unique ids (rather than itself being the unique id). For instance, if you have two repeatable jobs with the same name and options, you could use distinct `jobId`s to differentiate them:

```typescript
import { Queue, QueueScheduler } from 'bullmq';

const myQueueScheduler = new QueueScheduler('Paint');
const myQueue = new Queue('Paint');

// Repeat job every 10 seconds but no more than 100 times
await myQueue.add(
  'bird',
  { color: 'bird' },
  {
    repeat: {
      every: 10000,
      limit: 100,
    },
    jobId: 'colibri',
  },
);

await myQueue.add(
  'bird',
  { color: 'bird' },
  {
    repeat: {
      every: 10000,
      limit: 100,
    },
    jobId: 'pigeon',
  },
);
```

## Slow repeatable jobs

It is worth mentioning the case where the repeatable frequency is greater than the time it takes to process a job.

For instance, let's say that you have a job that is repeated every second, but the process of the job itself takes 5 seconds. As explained above, repeatable jobs are just delayed jobs, so this means that the next repeatable job will be added as soon as the next job is starting to be processed.

In this particular example, the worker will pick up the next job and also add the next repeatable job delayed 1 second since that is the repeatable interval. The worker will require 5 seconds to process the job, and if there is only 1 worker available then the next job will need to wait a full 5 seconds before it can be processed.

On the other hand, if there were 5 workers available, then they will most likely be able to process all the repeatable jobs with the desired frequency of one job per second.

## Repeat Strategy

By default, we are using [cron-parser](https://www.npmjs.com/package/cron-parser) in the default repeat strategy for cron expressions.

It is possible to define a different strategy to schedule repeatable jobs. For example we can create a custom one for RRULE:

```typescript
import { Queue, QueueScheduler, Worker } from 'bullmq';
import { rrulestr } from 'rrule';

const settings = {
  repeatStrategy: (millis, opts) => {
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

const myQueueScheduler = new QueueScheduler('Paint');
const myQueue = new Queue('Paint', { settings });

// Repeat job every 10 seconds
await myQueue.add(
  'bird',
  { color: 'bird' },
  {
    repeat: {
      pattern: 'RRULE:FREQ=SECONDLY;INTERVAL=;WKST=MO',
    },
    jobId: 'colibri',
  },
);

await myQueue.add(
  'bird',
  { color: 'bird' },
  {
    repeat: {
      pattern: 'RRULE:FREQ=SECONDLY;INTERVAL=;WKST=MO',
    },
    jobId: 'pigeon',
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

{% hint style="warning" %}
As you may notice, the repeat strategy setting should be provided in `Queue` and `Worker` classes. The reason we need in **both** places is because the first time we add the job to the `Queue` we need to calculate when is the next iteration, but after that the `Worker` takes over and we use the worker settings.
{% endhint %}

{% hint style="info" %}
The repeat strategy function receives an optional `jobName` third parameter.
{% endhint %}

## Read more:

- 💡 [Repeat Strategy API Reference](https://api.docs.bullmq.io/types/v4.RepeatStrategy.html)
