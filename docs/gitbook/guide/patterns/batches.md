# Working with Batches

When dealing with high-throughput workloads, batching jobs can significantly improve performance by reducing the number of Redis round-trips. BullMQ provides several mechanisms for working with batches on both the producer and consumer sides.

## Producer-Side: Adding Jobs in Bulk

### Queue.addBulk

The most common batch operation is adding multiple jobs to a queue atomically using `Queue.addBulk()`. All jobs in the bulk are added in a single Redis transaction, meaning either all jobs are added or none of them:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('notifications', { connection });

// Add multiple jobs atomically
const jobs = await queue.addBulk([
  { name: 'email', data: { to: 'user1@example.com', subject: 'Welcome' } },
  { name: 'email', data: { to: 'user2@example.com', subject: 'Welcome' } },
  { name: 'sms', data: { phone: '+1234567890', message: 'Your code: 1234' } },
]);

console.log(`Added ${jobs.length} jobs to the queue`);
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Queue

queue = Queue("notifications")

jobs = await queue.addBulk([
    {"name": "email", "data": {"to": "user1@example.com", "subject": "Welcome"}},
    {"name": "email", "data": {"to": "user2@example.com", "subject": "Welcome"}},
    {"name": "sms", "data": {"phone": "+1234567890", "message": "Your code: 1234"}},
])

print(f"Added {len(jobs)} jobs to the queue")
```

{% endtab %}
{% endtabs %}

You can also specify per-job options such as delays, priorities, and retry settings:

```typescript
const jobs = await queue.addBulk([
  {
    name: 'report',
    data: { type: 'daily' },
    opts: { delay: 60000, priority: 1 },
  },
  {
    name: 'report',
    data: { type: 'weekly' },
    opts: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
  },
]);
```

### FlowProducer.addBulk

For workflows involving parent-child job dependencies, `FlowProducer.addBulk()` lets you create multiple flow trees atomically:

```typescript
import { FlowProducer } from 'bullmq';

const flowProducer = new FlowProducer({ connection });

const trees = await flowProducer.addBulk([
  {
    name: 'process-order',
    queueName: 'orders',
    data: { orderId: 'order-1' },
    children: [
      { name: 'validate', data: { orderId: 'order-1' }, queueName: 'validation' },
      { name: 'charge', data: { orderId: 'order-1' }, queueName: 'payments' },
    ],
  },
  {
    name: 'process-order',
    queueName: 'orders',
    data: { orderId: 'order-2' },
    children: [
      { name: 'validate', data: { orderId: 'order-2' }, queueName: 'validation' },
      { name: 'charge', data: { orderId: 'order-2' }, queueName: 'payments' },
    ],
  },
]);
```

## Consumer-Side: Processing Jobs

### Individual Processing (Open-Source BullMQ)

In open-source BullMQ, workers process one job at a time per processor invocation. You can use the `concurrency` setting to process multiple jobs in parallel, but each processor call handles a single job:

```typescript
import { Worker } from 'bullmq';

const worker = new Worker(
  'notifications',
  async (job) => {
    // Each invocation processes a single job
    if (job.name === 'email') {
      await sendEmail(job.data.to, job.data.subject);
    } else if (job.name === 'sms') {
      await sendSms(job.data.phone, job.data.message);
    }
  },
  {
    connection,
    concurrency: 10, // Process up to 10 jobs in parallel
  },
);
```

{% hint style="info" %}
While `concurrency` allows parallel processing, it does not provide true batch semantics where the worker receives a group of jobs at once. For worker-side batch processing, see BullMQ Pro below.
{% endhint %}

### Batch Processing (BullMQ Pro)

[BullMQ Pro](https://bullmq.io) extends the worker with native batch processing capabilities. The `WorkerPro` class can receive groups of jobs in a single processor call, enabling efficient batch operations like bulk database inserts or batch API calls:

```typescript
import { WorkerPro } from '@taskforcesh/bullmq-pro';

const worker = new WorkerPro(
  'notifications',
  async (job) => {
    const batch = job.getBatch();
    // batch is an array of jobs
    const emails = batch
      .filter((j) => j.name === 'email')
      .map((j) => j.data);

    // Perform a single bulk operation
    await sendBulkEmails(emails);
  },
  {
    connection,
    batch: {
      size: 50, // Max jobs per batch
    },
  },
);
```

## Tracking Batch Progress with Events

Use `QueueEvents` to monitor the progress of jobs that were added in bulk:

```typescript
import { QueueEvents } from 'bullmq';

const queueEvents = new QueueEvents('notifications', { connection });

queueEvents.on('completed', ({ jobId, returnvalue }) => {
  console.log(`Job ${jobId} completed with result: ${returnvalue}`);
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  console.log(`Job ${jobId} failed: ${failedReason}`);
});

// Track progress updates from within processors
queueEvents.on('progress', ({ jobId, data }) => {
  console.log(`Job ${jobId} progress: ${data}%`);
});
```

## Best Practices

- **Batch sizing:** For `addBulk`, batches of 500–1,000 jobs perform well in most environments. Very large batches (10,000+) may cause Redis command timeouts.
- **Error handling:** `addBulk` is atomic—if any job fails validation, none are added. Validate your job data before calling `addBulk`.
- **Memory awareness:** Each job's data is serialized to JSON and stored in Redis. Keep job payloads small and store large data externally (e.g., in S3 or a database), passing only references in the job data.
- **Monitoring:** Use `QueueEvents` to track individual job outcomes even when jobs are added in bulk. Each job in a bulk operation receives its own unique ID and lifecycle events.

## Read more:

- 💡 [Queue.addBulk API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#addbulk)
- 💡 [FlowProducer.addBulk API Reference](https://docs.bullmq.io/api/classes/v6.FlowProducer.html#addbulk)
- 💡 [Adding jobs in bulk](../queues/adding-bulks.md)
- 💡 [Adding flows in bulk](../flows/adding-bulks.md)
