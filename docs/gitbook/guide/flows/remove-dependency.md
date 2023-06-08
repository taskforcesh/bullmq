# Remove Dependency

In some situations, you may have a parent job and need to ignore when one of its children fail.

The pattern to solve this requirement consists on using the **removeDependencyOnFailure** option.

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
      opts: { removeDependencyOnFailure: true },
      children: [
        {
          name,
          data: { idx: 1, foo: 'bah' },
          queueName: 'grandChildrenQueueName',
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
As soon as a _child_ with this option fails, the parent job will be moved to waiting state only if there are not more pending children.
{% endhint %}

## Read more:

- 💡 [Add Flow API Reference](https://api.docs.bullmq.io/classes/FlowProducer.html#add)
