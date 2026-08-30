# Working with batches

BullMQ already ships batch APIs. Use them when you need to enqueue many jobs at once, or when parent/child work should be added as one unit.

## Add many jobs atomically

`Queue.addBulk` places every job in one Redis round-trip. Either all jobs are added, or none are.

See [Adding jobs in bulk](queues/adding-bulks.md).

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

await queue.addBulk([
  { name: 'paint', data: { surface: 'car' } },
  { name: 'paint', data: { surface: 'house' } },
  { name: 'paint', data: { surface: 'boat' } },
]);
```

## Add related jobs as a flow

When jobs depend on each other, use a flow. Parent and children are stored together.

See [Flows](flows/README.md) and [Adding flows in bulk](flows/adding-bulks.md).

```typescript
import { FlowProducer } from 'bullmq';

const flow = new FlowProducer();

await flow.add({
  name: 'assemble',
  queueName: 'paint',
  children: [
    { name: 'prep', data: { part: 'door' }, queueName: 'paint' },
    { name: 'prep', data: { part: 'hood' }, queueName: 'paint' },
  ],
});
```

## Real-time updates

Listen to every worker with `QueueEvents` instead of attaching listeners to a single worker.

See [Events](events/README.md).

```typescript
import { QueueEvents } from 'bullmq';

const events = new QueueEvents('paint');

events.on('completed', ({ jobId }) => {
  console.log('completed', jobId);
});

events.on('failed', ({ jobId, failedReason }) => {
  console.log('failed', jobId, failedReason);
});
```

These APIs are part of the current BullMQ release. You do not need a separate “batches” package.
