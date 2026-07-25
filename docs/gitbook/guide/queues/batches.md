# Working with batches

If you need to enqueue many jobs at once, BullMQ provides bulk APIs:

- [Adding jobs in bulk](adding-bulks.md) using `Queue.addBulk`
- [Adding flows in bulk](../../flows/adding-bulks.md) using `FlowProducer.addBulk`

If you want workers to **process jobs in batches**, that capability is provided by
BullMQ Pro. See:

- [BullMQ Pro: Batches](../../bullmq-pro/batches.md)
