---
description: 'Last-in, First Out'
---

# LIFO

In some cases it is useful to process the jobs in a LIFO \(Last-in, First-Out\) fashion. This means that the newest jobs added to the queue will be processed before the older ones.

```typescript
import { Queue } from 'bullmq'

const myQueue = new Queue('Paint');

// Add a job that will be processed before all others
await myQueue.add('wall', { color: 'pink' }, { lifo: true });
```

 

