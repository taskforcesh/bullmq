# Global Concurrency

The global concurrency factor is a queue option that determines how many jobs are allowed to be processed in parallel across all your worker instances.

```typescript
import { Queue } from 'bullmq';

await queue.setGlobalConcurrency(4);
```

And in order to get this value:

```typescript
const globalConcurrency = await queue.getGlobalConcurrency();
```

{% hint style="info" %}
Note that if you choose a concurrency level in your workers, it will not override the global one, it will just be the maximum jobs a given worker can process in parallel but never more than the global one.
{% endhint %}

### Remove Global Concurrency

It can be done using the following method:

```typescript
await queue.removeGlobalConcurrency();
```

## Read more:

- 💡 [Set Global Concurrency API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#setglobalconcurrency)
- 💡 [Get Global Concurrency API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#getglobalconcurrency)
- 💡 [Remove Global Concurrency API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#removeglobalconcurrency)
