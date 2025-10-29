# Global Meta

The global meta data of any queue can be retrieved in the following way:

```typescript
import { Queue } from 'bullmq';

const { concurrency, max, duration, maxLenEvents, paused, version } =
  await queue.getGlobalMeta();
```

## Read more:

- 💡 [Get Global Meta API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#getglobalmeta)
- 💡 [Global Concurrency](./global-concurrency.md)
- 💡 [Global Rate Limit](./global-rate-limit.md)
