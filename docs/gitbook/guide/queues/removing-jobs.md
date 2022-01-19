Currently we have 2 available methods in queue class:

# Drain

Removes all jobs that are waiting or delayed, but not active, completed or failed.

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

await queue.drain();
```

{% hint style="warning" %}
Parent jobs that belong to the same queue would be moved to failed state (when having pending dependencies at that moment) or they will be removed (no more pending dependencies after deleting the last child). On the other hand, if the parent belongs to another queue, it should be kept in waiting-children state (when having pending dependencies at that moment) or it will be moved to wait state (no more pending dependencies after deleting the last child).
{% endhint %}

# Obliterate

Completely obliterates a queue and all of its contents.

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

await queue.obliterate();
```

{% hint style="warning" %}
If the parent belongs to another queue, it should be kept in waiting-children state (when having pending dependencies at that moment) or it will be moved to wait state (no more pending dependencies after deleting the last child).
{% endhint %}
