Currently we have 3 available methods in queue class:

# Drain

Removes all jobs that are waiting or delayed, but not active, waiting-children, completed or failed.

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

await queue.drain();
```

{% hint style="warning" %}
Parent jobs that belong to the queue being drained will be kept in **waiting-children** status if they have pending children, but if they do not have any pending children they will just be removed.
{% endhint %}

{% hint style="warning" %}
Parent jobs in queues different from the one being drained will either stay in **waiting-children** if they
have pending children in other queues, or just moved to wait.
{% endhint %}

# Clean

Removes jobs in a specific state, but keeps jobs within a certain grace period.

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

const deletedJobIds = await queue.clean(
  60000, // 1 minute
  1000, // max number of jobs to clean
  'paused',
);
```

# Obliterate

Completely obliterates a queue and all of its contents.

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

await queue.obliterate();
```

{% hint style="warning" %}
Parent jobs in queues different from the one being obliterated will either stay in **waiting-children** if they
have pending children in other queues, or just moved to wait.
{% endhint %}

## Read more:

- 💡 [Drain API Reference](https://api.docs.bullmq.io/classes/Queue.html#drain)
- 💡 [Clean API Reference](https://api.docs.bullmq.io/classes/Queue.html#clean)
- 💡 [Obliterate API Reference](https://api.docs.bullmq.io/classes/Queue.html#obliterate)
