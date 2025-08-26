---
description: Tips and hints on how to migrate from Bull package to BullMQ.
---

# Migration from Bull to BullMQ

Bull and BullMQ have diverged too much now to actually give any guarantee of backwards compatibility. 

So the safest would be to use new queues for BullMQ and deprecate the old ones.

New queues in this context mean using different queue names or passing a custom prefix option. You can have a period where bull and bullmq queues are running at the same time where you should wait for bull queues to be drained. Take in count that producers should add jobs in bullmq queues in this period. When all queues from bull are drained, you can deprecated them.

## Read more:

- 💡 [Worker Prefix Option Reference](https://api.docs.bullmq.io/interfaces/v5.WorkerOptions.html#prefix)
- 💡 [Queue Prefix Option Reference](https://api.docs.bullmq.io/interfaces/v5.QueueOptions.html#prefix)
