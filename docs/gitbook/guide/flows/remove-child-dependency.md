# Remove Child Dependency

In some situations, you may have a parent job and need to remove the dependency of one of its children.

The pattern to solve this requirement consists on using the **removeChildDependency** method. It will make sure that if the job is the last pending child, to move its parent to _waiting_ and it won't be listed in unprocessed list of the parent.

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
      opts: {},
    },
  ],
});

await originalTree.children[0].job.removeChildDependency();
```

{% hint style="waring" %}
As soon as a **child** calls this method, it will verify if it has an existing parent, if not, it'll throw an error.
{% endhint %}

Failed or completed children using this option won't generate any removal as they won't be part of unprocessed list:
