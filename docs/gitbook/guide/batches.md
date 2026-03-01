# Batches in BullMQ

The word *batch* is used in two different ways in the BullMQ ecosystem:

## 1) OSS: add jobs in bulk

In open-source BullMQ, batching means adding many jobs in one call.

- For a single queue, use [`Queue#addBulk`](https://api.docs.bullmq.io/classes/v5.Queue.html#addBulk).
- For multiple queues / flow trees, see [Adding flows in bulk](flows/adding-bulks.md).

This is the recommended approach when you want to enqueue many jobs efficiently.

## 2) BullMQ Pro: Batches feature

If you are looking for the **Batches** feature mentioned in some community threads, that feature is part of **BullMQ Pro**:

- [BullMQ Pro → Batches](../bullmq-pro/batches.md)

## Real-time updates

For real-time job lifecycle updates in OSS BullMQ, use [`QueueEvents`](events/README.md) (backed by Redis Streams).

If you need richer observability capabilities, see BullMQ Pro [Observables](../bullmq-pro/observables/README.md).
