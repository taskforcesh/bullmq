# Adding bulks

Sometimes it is necessary to add a complete bulk of jobs atomically. For example there could be a requirement that all the jobs must be placed in the queue or none of them. Also, adding a bulk of jobs can be faster since it reduces the roundtrips to Redis:

```typescript
import { Queue } from 'bullmq'

const queue = new Queue('paint')

const jobs = await queue.addBulk(
  [
    { name, data: { paint: 'car' } },
    { name, data: { paint: 'house' } },
    { name, data: { paint: 'boat' } },
  ],
);
```

This call can only succeed or fail, and all the or none of the jobs will be added.



