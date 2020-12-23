---
description: 'First-In, First-Out'
---

# FIFO

The first type of jobs we are going to describe is the FIFO \(First-In, First-Out\) type. This is the standard type when adding jobs to a queue. The jobs are processed in the order they are inserted into the queue. This order is preserved independently on the amount of processors you have, however if you have more than one worker or concurrency larger than 1, even though the workers will start the jobs in order, they may be completed in a slightly different order, since some jobs may take more time to complete than others.

```typescript
import { Queue } from 'bullmq'

const myQueue = new Queue('Paint');

// Add a job that will be processed before all others
await myQueue.add('wall', { color: 'pink' });
```

When you add jobs to the queue there are several options that you can use. For example you can specify how many jobs you want to keep when the jobs are completed or failed:

```typescript

await myQueue.add(
  'wall',
  { color: 'pink' },
  { removeOnComplete: true, removeOnFailed: 1000 },
);

```

In the example above all completed jobs will be removed automatically and the last 1000 failed will be kept in the queue.

### Default job options

Quite often you will want to provide the same job options to all the jobs that you add to the Queue. In this case you can use the "defaultJobOptions" option when instantiating the Queue class:

```typescript
const queue = new Queue('Paint', { defaultJobOptions: {
  removeOnComplete: true, removeOnFail: 1000
});
```



