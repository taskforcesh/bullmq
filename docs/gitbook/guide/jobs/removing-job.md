# Removing job

Sometimes it is necessary to remove a job. For example, there could be a job that has bad data.

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

const job = await queue.add('wall', { color: 1 });

await job.remove();
```

{% hint style="info" %}
Locked jobs (in active state) can not be removed. An error will be thrown.
{% endhint %}

# Having a parent job

There are 2 possible cases:

1. There are not pending dependencies; in this case the parent is moved to wait status, we may try to process this job.
2. There are pending dependencies; in this case the parent is kept in waiting-children status.

# Having pending dependencies

We may try to remove all its pending descendents first.

{% hint style="warning" %}
In case one of the children is locked, it will stop the deletion process.
{% endhint %}
