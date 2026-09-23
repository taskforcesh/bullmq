---
description: Tips and hints on how to migrate from Bull package to BullMQ.
---

# Migration from Bull to BullMQ

Bull and BullMQ have diverged too much now to actually give any guarantee of backwards compatibility. 

So the safest would be to use new queues for BullMQ and deprecate the old ones.

New queues in this context mean using different queue names or passing a custom prefix option. You can have a period where bull and bullmq workers are running in parallel until all the jobs from the old queues are completed. Take into account that producers should add jobs in bullmq queues in this period. When all queues from bull are drained, you can deprecate them.

You can use a dashboard tool such as https://taskforce.sh for monitoring this process and make sure the old queues are completely empty before removing them.

## Read more:

- 💡 [Worker Prefix Option Reference](https://docs.bullmq.io/api/interfaces/v6.WorkerOptions.html#prefix)
- 💡 [Queue Prefix Option Reference](https://docs.bullmq.io/api/interfaces/v6.QueueOptions.html#prefix)
