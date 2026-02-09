---
description: Make parents fail is any of its children fails
---

# Fail Parent

In certain workflows, you may need a parent job to fail immediately if any of its child jobs fail. The `failParentOnFailure` option allows you to achieve this behaviour. When set to true on a child job, it ensures that if the child fails, its parent job is also marked as failed. This effect can propagate recursively up the job hierarchy, potentially causing grandparents or higher-level ancestors to fail as well, depending on the configuration.

### Key Points

* Selective Application: Only child jobs with failParentOnFailure: true will trigger the failure of their parent job upon failing. Child jobs without this option will not affect the parent's state if they fail.
* Recursive Behavior: If a child with this option fails, and its parent also has failParentOnFailure: true, the failure propagates upward through the job tree, potentially affecting grandparents and beyond.
* Immediate Effect: As soon as a qualifying child job fails, the parent job is moved to the failed state.

### Example

```typescript
import { FlowProducer } from 'bullmq';

const flow = new FlowProducer({ connection });

const originalTree = await flow.add({
  name: 'root-job',
  queueName: 'topQueueName',
  data: {},
  children: [
    {
      name: 'child-job',
      data: { idx: 0, foo: 'bar' },
      queueName: 'childrenQueueName',
      // This child will fail its parent if it fails
      opts: { failParentOnFailure: true },
      children: [
        {
          name,
          data: { idx: 1, foo: 'bah' },
          queueName: 'grandChildrenQueueName',
          // This grandchild will fail its parent if it fails
          opts: { failParentOnFailure: true },
        },
        {
          name,
          data: { idx: 2, foo: 'baz' },
          queueName: 'grandChildrenQueueName',
          // No failParentOnFailure; its failure won't affect the parent
        },
      ],
    },
    {
      name,
      data: { idx: 3, foo: 'foo' },
      queueName: 'childrenQueueName',
      // No failParentOnFailure; its failure won't affect the parent
    },
  ],
});
```

{% hint style="info" %}
As soon as a _child_ with this option fails, the parent job will be marked as failed lazily. A worker must process the parent job before it transitions to the failed state. The failure will result in an _UnrecoverableError_ with the message **child {childKey} failed**. Additionally, this option will be validated recursively, meaning a grandparent or higher-level ancestor could also fail depending on the configuration.
{% endhint %}

### How it Works

* If grandchild-job-1 fails, its parent (child-job-1) will fail because of failParentOnFailure: true. Since child-job-1 also has failParentOnFailure: true, the root job (root-job) will fail as well.
* If grandchild-job-2 fails, its parent (child-job-1) will not fail because failParentOnFailure is not set on this grandchild.
* Similarly, if child-job-2 fails, the root job will remain unaffected since failParentOnFailure is not enabled for that child.

### Use Case

This option is particularly useful in workflows where the success of a parent job depends critically on specific child jobs, allowing you to enforce strict dependencies and fail fast when necessary.

## Read more:

* 💡 [Add Flow API Reference](https://api.docs.bullmq.io/classes/v5.FlowProducer.html#add)
