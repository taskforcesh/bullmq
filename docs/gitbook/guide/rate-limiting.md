# Rate limiting

BullMQ has a few options for rate limiting jobs in a queue.

## 1. Single rate limit for all jobs

The following will configure the rate limits so that only a maximum of 5 jobs are picked up every 1 second:

```typescript
const worker = new Worker(queueName, async job => {}, {
    limiter: {
    max: 5,
    duration: 1000,
    },
});
```

**NOTE**: If there are multiple workers for a single queue, they all need to share the same rate limiter options for this to work.

## 2. Rate limiting jobs in groups, each group with the same defined limit

The following will configure the rate limits so that jobs are grouped by an attribute `shape`. Each grouping of those jobs will be rate limited seperately, but each group will have the same defined limit of 5 jobs per second:

```typescript
const limiterConfig: RateLimiterOptions = {
    max: 5,
    duration: 1000,
    groupKey: 'shape',
};

const rateLimitedQueue = new Queue(queueName, {
    limiter: limiterConfig,
});

const worker = new Worker(queueName, async job => {}, {
    limiter: limiterConfig,
});
```

**NOTE**: Both the Queue and Worker(s) for the queue need to share the same rate limiter options for this to work. 

## 3. Rate limiting in groups, each group with a seperately defined limit

The following will configure the rate limits so that jobs are grouped by an attribute `shape`. Each grouping of those jobs will be rate limited seperately. If a particular group has rate defined in `groupRates`, then that will be used. Otherwise, the group will use non-group-specific
rate limit (set here to 5 per second).

In this example, jobs with a `shape` attribute value of `rectangle` will be limited at 4 jobs/second, where as ones with the value `triangle` will be limited to 3/second. Jobs with a `shape` attribute value of anything else, e.g. `circle` or `square` will use the non-group-specific rate limit of 5 jobs per second per group.

```typescript
const limiterConfig: RateLimiterOptions = {
    max: 5,
    duration: 1000,
    groupKey: 'shape',
    groupRates: {
        rectangle: {
            max: 4,
            duration: 1000,
        },
        triangle: {
            max: 3,
            duration: 1000,
        },
    },
};

const rateLimitedQueue = new Queue(queueName, {
    limiter: limiterConfig,
});

const worker = new Worker(queueName, async job => {}, {
    limiter: limiterConfig,
});
```

**NOTE**: Both the Queue and Worker(s) for the queue need to share the same rate limiter options for this to work. 
