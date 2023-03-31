# Adding flows in bulk

Sometimes it is necessary to add a complete bulk of flows atomically. For example, there could be a requirement that all the flows must be created or none of them. Also, adding a bulk of flows can be faster since it reduces the number of roundtrips to Redis:

```typescript
import { FlowProducer } from 'bullmq';

const flow = new FlowProducer({ connection });

const trees = await flow.addBulk([
  {
    name: 'root-job-1',
    queueName: rootQueueName,
    data: {},
    children: [
      {
        name,
        data: { idx: 0, foo: 'bar' },
        queueName,
      },
    ],
  },
  {
    name: 'root-job-2',
    queueName: rootQueueName,
    data: {},
    children: [
      {
        name,
        data: { idx: 1, foo: 'baz' },
        queueName,
      },
    ],
  },
]);
```

This call can only succeed or fail, and all or none of the jobs will be added.

## Read more:

- 💡 [Add Bulk API Reference](https://api.docs.bullmq.io/classes/FlowProducer.html#addBulk)
