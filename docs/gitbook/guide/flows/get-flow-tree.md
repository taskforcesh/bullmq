# Get Flow Tree

In some situations you need to get a job and all of its children, grandchildren and so on.

The pattern to solve this requirement consists on using [getFlow](./bullmq.flowproducer.getflow.md) method.

```typescript
const flow = new FlowProducer({ connection });

const originalTree = await flow.add({
  name: 'root-job',
  queueName: 'topQueueName',
  data: {},
  children: [
    {
      name,
      data: { idx: 0, foo: 'bar' },
      queueName: 'childrenQueueName',
      children: [
        {
          name,
          data: { idx: 4, foo: 'baz' },
          queueName: 'grandchildrenQueueName',
        },
      ],
    },
    {
      name,
      data: { idx: 2, foo: 'foo' },
      queueName: 'childrenQueueName',
    },
    {
      name,
      data: { idx: 3, foo: 'bis' },
      queueName: 'childrenQueueName',
    },
  ],
});

const { job: topJob } = originalTree;

const tree = await flow.getFlow({
  id: topJob.id,
  queueName: 'topQueueName',
});

const { children, job } = tree;
```

{% hint style="info" %}
Each _child_ may have a job property and in case they have children as well, they would have children property
{% endhint %}

You would also may need a way to limit that information if you have many children for one of the job nodes.

```typescript
const limitedTree = await flow.getFlow({
  id: topJob.id,
  queueName: 'topQueueName',
  depth: 1, // get only the first level of children
  maxChildren: 2, // get only 2 children per node
});

const { children, job } = limitedTree;
```
