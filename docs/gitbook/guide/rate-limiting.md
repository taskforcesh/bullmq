# Rate limiting

BullMQ provides rate limiting for the queues. It is possible to configure the workers so that they obey a given rate limiting option:

```typescript
import { Worker, QueueScheduler } from "bullmq";

const worker = new Worker('painter', async job => paintCar(job), {
  limiter: {
    max: 10,
    duration: 1000
  }
});

const scheduler = new QueueScheduler('painter');

```

{% hint style="warning" %}
Jobs that get rate limited will actually end as delayed jobs, so you need at least one QueueScheduler somewhere in your deployment so that jobs are put back to the wait status.
{% endhint %}

{% hint style="info" %}
The rate limiter is global, so if you have for example 10 workers for one queue with the above settings, still only 10 jobs will be processed by second.
{% endhint %}

It is also possible to define a rate limiter based on group keys, for example you may want to have a rate limiter per _customer_ instead of a global rate limiter for all customers:

```typescript
import { Queue, Worker, QueueScheduler } from "bullmq";

const queue = new Queue('painter', 
{ 
  limiter: {
    groupKey: 'customerId',
  }
});

const worker = new Worker('painter', async job => paintCar(job), {
  limiter: {
    max: 10,
    duration: 1000,
    groupKey: 'customerId'
  }
});

const scheduler = new QueueScheduler('painter');


// jobs will be rate limited by the value of customerId key:
await queue.add('rate limited paint', { customerId: 'my-customer-id' });


```



 



