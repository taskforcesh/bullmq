# Throttle jobs

Sometimes, you may want to enqueue a job in reaction to a frequently occurring event, without running that job for _every_ event. For example, you may want to send an email to a user when they update their profile, but you don't want to send an email for every single update if they make many changes in rapid succession. 

You can achieve this by setting an identical `jobId` (using `JobsOptions.jobId?: string` to override the default unique integer) so **"identical" jobs are considered duplicates and not added to the queue**. If you use this option, it is up to you to ensure the `jobId`` is unique.

{% hint style="warning" %}
Hint: Be careful if using `removeOnComplete`/`removeOnFailed` options, since a removed job will not count as existing and a new job with the same job ID could be added to the queue without being detected as a duplicate.
{% endhint %}

example:

```typescript
import { Job, Queue, Worker } from 'bullmq';

const myQueue = new Queue('Paint');

const worker = new Worker('Paint', async (job: Job) => {
  console.log('Do something with job');
  return 'some value';
});

worker.on('completed', (job: Job, returnvalue: any) => {
  console.log('worker done painting', new Date());
});

worker.on('failed', (job: Job, error: Error) => {
  console.error('worker fail painting', job, error, new Date());
});

// Add only one job that will be delayed at least 1 second.
myQueue.add('house', { color: 'white' }, { delay: 1000, jobId: 'house' });
myQueue.add('house', { color: 'white' }, { delay: 1000, jobId: 'house' });
myQueue.add('house', { color: 'white' }, { delay: 1000, jobId: 'house' });
myQueue.add('house', { color: 'white' }, { delay: 1000, jobId: 'house' });
myQueue.add('house', { color: 'white' }, { delay: 1000, jobId: 'house' });
myQueue.add('house', { color: 'white' }, { delay: 1000, jobId: 'house' });
myQueue.add('house', { color: 'white' }, { delay: 1000, jobId: 'house' });
```
