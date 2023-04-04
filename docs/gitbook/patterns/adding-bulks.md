# Adding jobs in bulk accross different queues

Sometimes it is necessary to add a complete bulk of jobs from different queues atomically. For example, there could be a requirement that all the jobs must be created or none of them. Also, adding a bulk of jobs can be faster since it reduces the number of roundtrips to Redis:

You may be thinking on [queue.addBulk](https://api.docs.bullmq.io/classes/Queue.html#addBulk), but this method only adds jobs from a single queue. Another option is [flowProducer.addBulk](https://api.docs.bullmq.io/classes/FlowProducer.html#addBulk), so let's see an example:

```typescript
import { FlowProducer } from 'bullmq';

const flow = new FlowProducer({ connection });

const trees = await flow.addBulk([
  {
    name: 'job-1',
    queueName: 'queueName-1',
    data: {}
  },
  {
    name: 'job-2',
    queueName: 'queueName-2',
    data: {}
  },
]);
```

It is possible to add individual jobs without children.

This call can only succeed or fail, and all or none of the jobs will be added.

## Read more:

- 💡 [Add Bulk API Reference](https://api.docs.bullmq.io/classes/FlowProducer.html#addBulk)
