# Global Concurrency

The global rate limit config is a queue option that determines how many jobs are allowed to be processed in a specific period of time.

```typescript
import { Queue } from 'bullmq';

// 1 job per second
await queue.setGlobalRateLimiter(1, 1000);
```

And in order to get this value:

```typescript
const globalConcurrency = await queue.getRateLimitTtl();
```

{% hint style="info" %}
Note that if you choose a rate limit level in your workers, it won't override the global one.
{% endhint %}

## Read more:

- 💡 [Set Global Rate Limiter API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#setglobalratelimiter)
- 💡 [Get Rate Limit Ttl API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#getratelimitttl)
