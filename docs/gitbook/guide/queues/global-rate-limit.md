# Global Rate Limit

The global rate limit config is a queue option that determines how many jobs are allowed to be processed in a specific period of time.

```typescript
import { Queue } from 'bullmq';

// 1 job per second
await queue.setGlobalRateLimit(1, 1000);
```

In order to get these values:

```typescript
const { max, duration } = await queue.getGlobalRateLimit();
```

And in order to get current ttl:

```typescript
const ttl = await queue.getRateLimitTtl();
```

{% hint style="info" %}
Note that if you choose a rate limit level in your workers, it won't override the global one.
{% endhint %}

### Remove Global Rate Limit

It can be done using the following method:

```typescript
await queue.removeGlobalRateLimit();
```

## Read more:

- 💡 [Set Global Rate Limit API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#setglobalratelimit)
- 💡 [Get Global Rate Limit API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#getglobalratelimit)
- 💡 [Get Rate Limit Ttl API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#getratelimitttl)
- 💡 [Remove Global Rate Limit API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#removeglobalratelimit)
