# Working with batches

There are two different "batch" use-cases in BullMQ:

1. **Add many jobs at once (OSS)** using `queue.addBulk`.
2. **Process many jobs in one worker callback (BullMQ Pro)** using worker `batch` options.

## 1) Add many jobs at once (OSS)

Use `addBulk` when you want to enqueue several jobs in one call.

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

await queue.addBulk([
  { name: 'car', data: { color: 'blue' } },
  { name: 'house', data: { color: 'yellow' } },
]);
```

This is available in open-source BullMQ.

## 2) Process jobs in batches (BullMQ Pro)

If you want a worker to receive and process several jobs together in one callback,
use BullMQ Pro batches:

- [BullMQ Pro: Batches](../bullmq-pro/batches.md)

## Real-time updates

For real-time queue/job lifecycle updates in open-source BullMQ, use `QueueEvents`:

- [Events](../guide/events/README.md)

If you need richer reactive/event-driven primitives, see BullMQ Pro Observables:

- [BullMQ Pro: Observables](../bullmq-pro/observables/README.md)
