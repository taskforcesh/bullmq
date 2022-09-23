# Fail Parent

In some situations, you need to fail a job when one of its children fail.

The pattern to solve this requirement consists on using **failParentOnFailure** option.

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
      opts: { failParentOnFailure: true },
      children: [
        {
          name,
          data: { idx: 1, foo: 'bah' },
          queueName: 'grandChildrenQueueName',
          opts: { failParentOnFailure: true },
        },
        {
          name,
          data: { idx: 2, foo: 'baz' },
          queueName: 'grandChildrenQueueName',
        },
      ],
    },
    {
      name,
      data: { idx: 3, foo: 'foo' },
      queueName: 'childrenQueueName',
    },
  ],
});
```

{% hint style="info" %}
As soon as a _child_ with this option fails, the parent job will be moved to failed state. This option will be validated recursively, so a grandparent could be failed and so on.
{% endhint %}

## Read more:

- 💡 [Get Flow API Reference](https://api.docs.bullmq.io/classes/FlowProducer.html#getFlow)
