# Meta

The meta data of any queue can be retrieved in the following way:

```typescript
import { Queue } from 'bullmq';

const { concurrency, max, duration, maxLenEvents, paused, version } =
  await queue.getMeta();
```

## Read more:

- 💡 [Get Meta API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#getmeta)
- 💡 [Global Concurrency](./global-concurrency.md)
- 💡 [Global Rate Limit](./global-rate-limit.md)
