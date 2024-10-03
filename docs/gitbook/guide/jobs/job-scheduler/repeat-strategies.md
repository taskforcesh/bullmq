# Repeat Strategies

By default, we are using [cron-parser](https://www.npmjs.com/package/cron-parser) as the default repeat strategy for cron expressions.

It is possible to define a different strategy to schedule repeatable jobs. The idea is that the repeat strategy, based on a pattern and the latest job's milliseconds, return the next desired timestamp. Although not used in the following example,  you could have different behaviours on your repeat strategies based on the current job's name if you want to. However not that **only** **one** repeatStrategy can be defined for a given queue.

For example we can create a custom one for [RRULE](https://jkbrzt.github.io/rrule/) like this:

```typescript
import { Queue, QueueScheduler, Worker } from 'bullmq';
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
    data: { color: 'gray' }
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
