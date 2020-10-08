# Prioritized

Jobs can also include a priority option. Using priorities, job's processing order will be affected by the specified priority instead of following a FIFO or LIFO pattern.

{% hint style="warning" %}
Adding prioritised jobs is a slower operation than the other types of jobs, with a complexity O\(n\) relative to the number of jobs waiting in the Queue.
{% endhint %}

Priorities goes from 1 to MAX\_INT, whereas lower number is always higher priority than higher numbers.

```typescript
import { Queue } from 'bullmq'

const myQueue = new Queue('Paint');

await myQueue.add('wall', { color: 'pink' }, { priority: 10 });
await myQueue.add('wall', { color: 'brown' }, { priority: 5 });
await myQueue.add('wall', { color: 'blue' }, { priority: 7 });

// The wall will be painted first brown, then blue and
// finally pink.


```

