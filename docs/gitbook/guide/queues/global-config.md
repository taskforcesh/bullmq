# Global Configuration

The global configuration of any queue can be retrieved in the following way:

```typescript
import { Queue } from 'bullmq';

const {
    concurrency,
    max,
    duration,
    maxLenEvents,
    paused,
    version
} = await queue.getGlobalConfig();
```

## Read more:

- 💡 [Get Global Config API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#getglobalconfig)
- 💡 [Global Concurrency](./global-concurrency.md)
- 💡 [Global Rate Limit](./global-rate-limit.md)
