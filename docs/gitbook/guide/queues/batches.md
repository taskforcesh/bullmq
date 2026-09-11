# Working with batches

"Batches" in BullMQ can mean three different things. Pick the API that matches
the problem you are solving:

| Goal                                                   | Where       | API                                                |
| ------------------------------------------------------ | ----------- | -------------------------------------------------- |
| Enqueue many independent jobs efficiently / atomically | Open source | [`Queue.addBulk`](adding-bulks.md)                 |
| Enqueue many parent/child trees at once                | Open source | [`FlowProducer.addBulk`](../flows/adding-bulks.md) |
| Process many waiting jobs in **one** worker callback   | BullMQ Pro  | [Pro batches](../../bullmq-pro/batches.md)         |

{% hint style="info" %}
Worker `concurrency` runs several jobs in parallel, but each processor call still
receives **one** job. That is not the same as Pro batch processing, where
`job.getBatch()` returns up to `batch.size` jobs together.
{% endhint %}

## Add many jobs (`Queue.addBulk`)

Use this when you already have a list of work items and each item should remain
its own job (own retries, own events, own completion):

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('invoices', { connection });

const jobs = await queue.addBulk([
  { name: 'send', data: { invoiceId: 'A-100' } },
  { name: 'send', data: { invoiceId: 'A-101' } },
  { name: 'send', data: { invoiceId: 'A-102' } },
]);
```

`addBulk` reduces Redis round-trips compared with calling `add` in a loop. See
[Adding jobs in bulk](adding-bulks.md) for language examples and atomicity notes.

## Add many flows (`FlowProducer.addBulk`)

Use this when each unit of work is a flow (parent + children) and you want to
create several trees in one call:

```typescript
import { FlowProducer } from 'bullmq';

const flowProducer = new FlowProducer({ connection });

await flowProducer.addBulk([
  {
    name: 'import-file',
    queueName: 'imports',
    data: { fileId: 'first.csv' },
    children: [
      {
        name: 'parse',
        queueName: 'import-steps',
        data: { fileId: 'first.csv' },
      },
      {
        name: 'index',
        queueName: 'import-steps',
        data: { fileId: 'first.csv' },
      },
    ],
  },
  {
    name: 'import-file',
    queueName: 'imports',
    data: { fileId: 'second.csv' },
    children: [
      {
        name: 'parse',
        queueName: 'import-steps',
        data: { fileId: 'second.csv' },
      },
      {
        name: 'index',
        queueName: 'import-steps',
        data: { fileId: 'second.csv' },
      },
    ],
  },
]);
```

Details: [Adding flows in bulk](../flows/adding-bulks.md).

## Model a batch as a single job

When the items must share one retry / timeout / completion outcome, put them in
one job payload instead of inventing a custom worker-side batcher:

```typescript
await queue.add('send-batch', {
  invoiceIds: ['A-100', 'A-101', 'A-102'],
});
```

```typescript
import { Worker } from 'bullmq';

const worker = new Worker(
  'invoices',
  async job => {
    const invoiceIds: string[] = job.data.invoiceIds;

    for (const [index, invoiceId] of invoiceIds.entries()) {
      await sendInvoice(invoiceId);
      await job.updateProgress({
        completed: index + 1,
        total: invoiceIds.length,
      });
    }

    return { sent: invoiceIds.length };
  },
  { connection },
);
```

Prefer `addBulk` (or flows) when each item needs independent retries or
per-item failure tracking.

## Process several jobs in one worker callback (Pro)

Open-source workers always invoke the processor with a single job. Native
worker-side batches are a [BullMQ Pro](../../bullmq-pro/introduction.md)
feature:

```typescript
import { WorkerPro } from '@taskforcesh/bullmq-pro';

const worker = new WorkerPro(
  'invoices',
  async job => {
    const batch = job.getBatch();

    // Example: one bulk DB/API call for the whole batch
    await sendInvoices(batch.map(batchedJob => batchedJob.data));
  },
  {
    connection,
    batch: { size: 10 },
  },
);
```

Pro batches have different failure and event semantics (a dummy wrapper job,
`setAsFailed`, `QueueEventsPro`, `minSize` / `timeout`, group affinity). Read
[BullMQ Pro: Batches](../../bullmq-pro/batches.md) before enabling them.

## Real-time updates for batched work

Whether you used `addBulk`, a single batch job, or Pro batches, live UIs should
listen with [`QueueEvents`](../events/README.md#real-time-updates) so one
process can observe completions and `progress` from every worker.

## Read more

- [Adding jobs in bulk](adding-bulks.md)
- [Adding flows in bulk](../flows/adding-bulks.md)
- [Events / real-time updates](../events/README.md#real-time-updates)
- [Workers: concurrency](../workers/concurrency.md)
- [BullMQ Pro: Batches](../../bullmq-pro/batches.md)
