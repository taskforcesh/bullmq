# Rate limiting

BullMQ has a few options for rate limiting jobs in a queue.

{% hint style="warning" %} Jobs that get rate limited will actually end as delayed jobs, so you need at least one QueueScheduler somewhere in your deployment so that jobs are put back to the wait status. {% endhint %}


## 1. Single rate limit for all jobs

The following will configure the rate limits so that only a maximum of 5 jobs are picked up every 1 second:

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

{% hint style="info" %} The rate limiter is global, so if you have for example 10 workers for one queue with the above settings, still only 10 jobs will be processed by second. {% endhint %}

## 2. Rate limiting jobs in groups, each group with the same defined limit

The following will configure the rate limits so that jobs are grouped by an attribute `customerId`. Each grouping of those jobs will be rate limited seperately, but each group will have the same defined limit of 5 jobs per second:

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
await queue.add('rate limited paint', { customerId: 'my-customer-id' });
```

## 3. Rate limiting in groups, each group with a seperately defined limit

The following will configure the rate limits so that jobs are grouped by an attribute `customerId`. Each grouping of those jobs will be rate limited seperately. If a particular group has rate defined in `groupRates`, then that will be used. Otherwise, the group will use non-group-specific
rate limit (set here to 5 per second).

In this example, jobs with a `customerGroup` attribute value of `walkin` will be limited at 2 jobs/second, where as ones with the value `vip` will be limited to 10/second. Jobs with a `customerGroup` attribute value of anything else, e.g. `regular` or `referral` will use the non-group-specific rate limit of 5 jobs per second per group.

```typescript
import { Queue, Worker, QueueScheduler, RateLimiterOptions } from "bullmq";

const limiterConfig: RateLimiterOptions = {
    max: 5,
    duration: 1000,
    groupKey: 'customerGroup',
    groupRates: {
        walkin: {
            max: 2,
            duration: 1000,
        },
        vip: {
            max: 10,
            duration: 1000,
        },
    },
};

const queue = new Queue('painter', {
    limiter: limiterConfig,
});

const worker = new Worker('painter', async job => {}, {
    limiter: limiterConfig,
});

const scheduler = new QueueScheduler('painter');

// These jobs rate limited at 2/sec:
await queue.add('job', { customerId: 'walkin' });

// These jobs rate limited at 10/sec:
await queue.add('job', { customerId: 'vip' });

// These jobs rate limited at 5/sec:
await queue.add('job', { customerId: 'regular' });

// These jobs also rate limited at 5/sec:
await queue.add('job', { customerId: 'referral' });

```

{% hint style="warning" %}Both the Queue and Worker(s) for the queue need to share the same rate limiter options for this to work.{% endhint %}
