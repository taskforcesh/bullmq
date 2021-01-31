# Debounces

Sometimes, you want to update data in reactions to a sequence of events instead at each event. 
You can enforce `jobId` to be unique with `JobsOptions.jobId?: string`. 
That overrides the job ID - by default, the job ID is a unique
integer, but you can use this setting to override it.
If you use this option, it is up to you to ensure the
jobId is unique. If you attempt to add a job with an id that
already exists, it will not be added.

Hint: Be careful if using removeOnComplete/removeOnFailed options, 
since a removed job will not count as existing and a new job with 
the same job ID would indeed be added to the queue.

example: 
```typescript
import { Job, Queue, QueueScheduler, Worker } from "bullmq"

const myQueueScheduler = new QueueScheduler('Paint');
const myQueue = new Queue('Paint');

const worker = new Worker('Paint', async (job: Job) => {
  console.log('Do something with job');
  return 'some value';
});

worker.on('completed', (job: Job, returnvalue: any) => {
  console.log('worker done painting', new Date());
});

worker.on('failed', (job: Job, failedReason: string) => {
  console.error('worker fail painting',job, failedReason, new Date());
});

// Add only one job that will be delayed at least 5 seconds.
myQueue.add('house', { color: 'white' }, { delay: 1000, jobId: "house" });
myQueue.add('house', { color: 'white' }, { delay: 1000, jobId: "house" });
myQueue.add('house', { color: 'white' }, { delay: 1000, jobId: "house" });
myQueue.add('house', { color: 'white' }, { delay: 1000, jobId: "house" });
myQueue.add('house', { color: 'white' }, { delay: 1000, jobId: "house" });
myQueue.add('house', { color: 'white' }, { delay: 1000, jobId: "house" });
myQueue.add('house', { color: 'white' }, { delay: 1000, jobId: "house" });

```