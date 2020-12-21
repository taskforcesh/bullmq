# Returning job data

When a worker is done processing, sometimes it is convenient to return some data. This data can then be accessed for example by listening to the "completed" event. This return data is available at the job's "returnvalue" property.

Imagine a simple worker that performs some async processing:

```typescript
import { Queue, Worker } from 'bullmq';

const myWorker = new Worker('AsyncProc', async (job)=>{
    const result = await doSomeAsyncProcessing();
    return result;
});
```

{% hint style="info" %}
Note, in the example above we could just return directly doSomeAsyncProcessing, we just use a temporal variable to make the example more explicit.
{% endhint %}

We can now listen to the completed event in order to get the result value:

```typescript
import { Job, QueueEvents } from 'bullmq'

const queueEvents = new QueueEvents('AsyncProc')

queueEvents.on('completed', async (jobId: string) => {
    const job = await Job.fromId(jobId);
    
    console.log(job.returnvalue);
});

```

If you want to store the result of the processing function it is still much more robust to do it in the process function itself, that will guarantee that if the job is completed the return value would be stored as well. Storing data on the completed event on the other hand could fail and still the job would complete without detecting the error.

### Using a "results" Queue

Another common practice to send jobs results robustly is to have a special "results" queue where the results are sent to. The worker for this "results" queue can reliably do something with the data such as storing it in a database. This approach is useful for designing robust micro-service architectures, where data is sent between services using queues. Even if the service that processes the result is down at the time the results queue receives the data, the result will still be processed as soon as the service come up online again.



