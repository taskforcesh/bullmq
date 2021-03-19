# Repeatable

There is a special type of _meta_ job called **repeatable**. These jobs are special in the sense that even though you only add one job to the queue, they will keep repeating according to a predefined schedule.

Every time a repeatable job is picked up for processing, the next repeatable job is added to the queue with a proper delay. Repeatable jobs are thus nothing more than delayed jobs that are added to the queue according to some settings.

{% hint style="info" %}
Repeatable jobs are just delayed jobs, therefore you also need a QueueScheduler instance to schedule the jobs accordingly.
{% endhint %}

There are two ways to specify a repeatable's job repetition pattern, either with a cron expression \(using [cron-parser](https://www.npmjs.com/package/cron-parser)'s "unix cron w/ optional seconds" format\), or specifying a fix amount of milliseconds between repetitions.

```typescript
import { Queue, QueueScheduler } from 'bullmq'

const myQueueScheduler = new QueueScheduler('Paint');
const myQueue = new Queue('Paint');

// Repeat job once every day at 3:15 (am)
await myQueue.add('submarine', { color: 'yellow' }, 
  {
    repeat: {
      cron: '* 15 3 * * *'
    }
  });

// Repeat job every 10 seconds but no more than 100 times
await myQueue.add('bird', { color: 'bird' }, 
  {
    repeat: {
      every: 10000,
      limit: 100
    }
  });
```

There are some important considerations regarding repeatable jobs:

* Bull is smart enough not to add the same repeatable job if the repeat options are the same.
* If there are no workers running, repeatable jobs will not accumulate next time a worker is online.
* repeatable jobs can be removed using the [removeRepeatable](https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/api/bullmq.queue.removerepeatable.md) method or [removeRepeatableByKey](https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/api/bullmq.queue.removerepeatablebykey.md).

All repeatable jobs have a repeatable job key that holds some metadata of the repeatable job itself. It is possible to retrieve all the current repeatable jobs in the queue calling [getRepeatableJobs](https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/api/bullmq.queue.getrepeatablejobs.md):

```typescript
import { Queue } from 'bullmq'

const myQueue = new Queue('Paint');

const repeatableJobs = await myQueue.getRepeatableJobs();

```

Since repeatable jobs are delayed jobs, and the repetition is achieved by generating a new delayed job precisely before the current job starts processing. The jobs require unique ids which avoid duplicates, which implies that the standard jobId option does not work the same as with regular jobs. With repeatable jobs the jobId is used to generate the unique ids, for instance if you have 2 repeatable jobs with the same name and options you could use the jobId to have 2 different repeatable jobs:

```typescript
import { Queue, QueueScheduler } from 'bullmq'

const myQueueScheduler = new QueueScheduler('Paint');
const myQueue = new Queue('Paint');

// Repeat job every 10 seconds but no more than 100 times
await myQueue.add('bird', { color: 'bird' }, 
  {
    repeat: {
      every: 10000,
      limit: 100
    },
    jobId: "colibri"
  });

await myQueue.add('bird', { color: 'bird' }, 
  {
    repeat: {
      every: 10000,
      limit: 100
    },
    jobId: "pingeon"
  });
  
  
```

## Slow repeatable jobs

It is worth to mention the case where the repeatable frequency is larger than the time it takes to process a job.

For instance, let's say that you have a job that is repeated every second, but the process of the job itself takes 5 seconds. As explained above, repeatable jobs are just delayed jobs, so this means that the next repeatable job will be added as soon as the next job is starting to be processed.

In this particular example, the worker will pick up the next job and also add the next repeatable job delayed 1 second since that is the repeatable interval. The worker will require 5 seconds to process the job, and if there is only 1 worker available then the next job will need to wait a full 5 seconds before it can be processed.

On the other hand, if there were 5 workers available, then they will most likely be able to process all the repeatable jobs with the desired frequency of one job per second.

