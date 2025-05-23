# Ignore Dependency

In some situations, you may have a parent job and need to ignore when one of its children fail.

The pattern to solve this requirement consists on using the **ignoreDependencyOnFailure** option. This option will make sure that when a job fails, the dependency is ignored from the parent, so the parent will complete without waiting for the failed children.

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
      opts: { ignoreDependencyOnFailure: true },
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
As soon as a **child** with this option fails, the parent job will be moved to a waiting state only if there are no more pending children.
{% endhint %}

Failed children using this option can be retrieved by **getIgnoredChildrenFailures** method:

```typescript
const ignoredChildrenFailures =
  await originalTree.job.getIgnoredChildrenFailures();
```

## Read more:

- 💡 [Add Flow API Reference](https://api.docs.bullmq.io/classes/v5.FlowProducer.html#add)
