---
description: This is a basic guide to get your first queue working.
---

# Quick Start

## Install

Install using npm:

```
$ npm install bullmq
```

Install using yarn:

```
$ yarn add bullmq
```

{% hint style="info" %}
BullMQ is written in TypeScript, and although it can be used in vanilla JavaScript, all examples in this guide will be written in TypeScript.
{% endhint %}

Import into your project and add some jobs:

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('foo');

async function addJobs() {
  await myQueue.add('myJobName', { foo: 'bar' });
  await myQueue.add('myJobName', { qux: 'baz' });
}

await addJobs();
```

{% hint style="danger" %}
You need to have a Redis service running in your local computer to run these examples successfully. You can read more about Redis connections [here](guide/connections.md).
{% endhint %}

Jobs are added to the queue and can be processed at any time, with at least one Node.js process running a worker:

```typescript
import { Worker } from 'bullmq';
import IORedis from '@sinianluoye/ioredis';

const connection = new IORedis({ maxRetriesPerRequest: null });

const worker = new Worker(
  'foo',
  async job => {
    // Will print { foo: 'bar'} for the first job
    // and { qux: 'baz' } for the second.
    console.log(job.data);
  },
  { connection },
);
```

{% hint style="info" %}
You can have as many worker processes as you want, BullMQ will distribute the jobs across your workers in a round robin fashion.
{% endhint %}

You can listen to completed (or failed) jobs by attaching listeners to the workers:

```typescript
worker.on('completed', job => {
  console.log(`${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
  console.log(`${job.id} has failed with ${err.message}`);
});
```

{% hint style="info" %}
There are many other events available, check the [Guide](guide/events.md) or the [API reference](https://api.docs.bullmq.io/) for more information.
{% endhint %}

Sometimes you need to listen to all the workers events in a given place, for this you need to use a special class [`QueueEvents`](https://api.docs.bullmq.io/classes/v5.QueueEvents.html):

```typescript
import { QueueEvents } from 'bullmq';

const queueEvents = new QueueEvents('my-queue-name');

queueEvents.on('waiting', ({ jobId }) => {
  console.log(`A job with ID ${jobId} is waiting`);
});

queueEvents.on('active', ({ jobId, prev }) => {
  console.log(`Job ${jobId} is now active; previous status was ${prev}`);
});

queueEvents.on('completed', ({ jobId, returnvalue }) => {
  console.log(`${jobId} has completed and returned ${returnvalue}`);
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  console.log(`${jobId} has failed with reason ${failedReason}`);
});
```

You may also access the timestamp of the event, which looks like "1580456039332-0".

```typescript
import { QueueEvents } from 'bullmq';

const queueEvents = new QueueEvents('my-queue-name');

queueEvents.on('progress', ({ jobId, data }, timestamp) => {
  console.log(`${jobId} reported progress ${data} at ${timestamp}`);
});
```

{% hint style="danger" %}
For performance reasons, the events emitted by a `QueueEvents` instance do not contain the `Job` instance, only the `jobId`. Use the [`Job.fromId`](https://api.docs.bullmq.io/classes/v5.Job.html#fromid) method if you need the `Job` instance.
{% endhint %}
