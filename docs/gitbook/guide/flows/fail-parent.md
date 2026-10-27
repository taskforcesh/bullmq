---
description: Make parents fail is any of its children fails
---

# Fail Parent

In certain workflows, you may need a parent job to fail immediately if any of its child jobs fail. The `failParentOnFailure` option allows you to achieve this behaviour. When set to true on a child job, it ensures that if the child fails, its parent job is also marked as failed. This effect can propagate recursively up the job hierarchy, potentially causing grandparents or higher-level ancestors to fail as well, depending on the configuration.

### Key Points

- Selective Application: Only child jobs with failParentOnFailure: true will trigger the failure of their parent job upon failing. Child jobs without this option will not affect the parent's state if they fail.
- Recursive Behavior: If a child with this option fails, and its parent also has failParentOnFailure: true, the failure propagates upward through the job tree, potentially affecting grandparents and beyond.
- Immediate Effect: As soon as a qualifying child job fails, the parent job is moved to the failed state.

### Example

{% tabs %}
{% tab title="TypeScript" %}

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

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import FlowProducer

flow = FlowProducer({"connection": connection})

originalTree = await flow.add({
    "name": "root-job",
    "queueName": "topQueueName",
    "data": {},
    "children": [
        {
            "name": "child-job",
            "data": {"idx": 0, "foo": "bar"},
            "queueName": "childrenQueueName",
            # This child will fail its parent if it fails
            "opts": {"failParentOnFailure": True},
            "children": [
                {
                    "name": name,
                    "data": {"idx": 1, "foo": "bah"},
                    "queueName": "grandChildrenQueueName",
                    # This grandchild will fail its parent if it fails
                    "opts": {"failParentOnFailure": True},
                },
                {
                    "name": name,
                    "data": {"idx": 2, "foo": "baz"},
                    "queueName": "grandChildrenQueueName",
                    # No failParentOnFailure; its failure won't affect the parent
                },
            ],
        },
        {
            "name": name,
            "data": {"idx": 3, "foo": "foo"},
            "queueName": "childrenQueueName",
            # No failParentOnFailure; its failure won't affect the parent
        },
    ],
})
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, original_tree} =
  BullMQ.FlowProducer.add(
    %{
      name: "root-job",
      queue_name: "topQueueName",
      data: %{},
      children: [
        %{
          name: "child-job",
          data: %{idx: 0, foo: "bar"},
          queue_name: "childrenQueueName",
          # This child will fail its parent if it fails
          opts: %{fail_parent_on_failure: true},
          children: [
            %{
              name: name,
              data: %{idx: 1, foo: "bah"},
              queue_name: "grandChildrenQueueName",
              # This grandchild will fail its parent if it fails
              opts: %{fail_parent_on_failure: true}
            },
            %{
              name: name,
              data: %{idx: 2, foo: "baz"},
              queue_name: "grandChildrenQueueName"
              # No fail_parent_on_failure; its failure won't affect the parent
            }
          ]
        },
        %{
          name: name,
          data: %{idx: 3, foo: "foo"},
          queue_name: "childrenQueueName"
          # No fail_parent_on_failure; its failure won't affect the parent
        }
      ]
    },
    connection: :my_redis
  )
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::{FlowJob, FlowProducer, FlowProducerOptions, JobOptions};
use serde_json::json;

let flow = FlowProducer::with_options(FlowProducerOptions::new().connection(connection)).await?;

let original_tree = flow
    .add(
        FlowJob::new("root-job", "topQueueName", json!({}))?
            .add_child(
                FlowJob::new("child-job", "childrenQueueName", json!({ "idx": 0, "foo": "bar" }))?
                    // This child will fail its parent if it fails
                    .options(JobOptions::new().fail_parent_on_failure())
                    .add_child(
                        FlowJob::new(name, "grandChildrenQueueName", json!({ "idx": 1, "foo": "bah" }))?
                            // This grandchild will fail its parent if it fails
                            .options(JobOptions::new().fail_parent_on_failure()),
                    )
                    // No fail_parent_on_failure; its failure won't affect the parent
                    .add_child(FlowJob::new(
                        name,
                        "grandChildrenQueueName",
                        json!({ "idx": 2, "foo": "baz" }),
                    )?),
            )
            // No fail_parent_on_failure; its failure won't affect the parent
            .add_child(FlowJob::new(name, "childrenQueueName", json!({ "idx": 3, "foo": "foo" }))?),
    )
    .await?;
```

{% endtab %}
{% endtabs %}

{% hint style="info" %}
As soon as a _child_ with this option fails, the parent job will be marked as failed lazily. A worker must process the parent job before it transitions to the failed state. The failure will result in an _UnrecoverableError_ with the message **child {childKey} failed**. Additionally, this option will be validated recursively, meaning a grandparent or higher-level ancestor could also fail depending on the configuration.
{% endhint %}

### How it Works

- If grandchild-job-1 fails, its parent (child-job-1) will fail because of failParentOnFailure: true. Since child-job-1 also has failParentOnFailure: true, the root job (root-job) will fail as well.
- If grandchild-job-2 fails, its parent (child-job-1) will not fail because failParentOnFailure is not set on this grandchild.
- Similarly, if child-job-2 fails, the root job will remain unaffected since failParentOnFailure is not enabled for that child.

### Use Case

This option is particularly useful in workflows where the success of a parent job depends critically on specific child jobs, allowing you to enforce strict dependencies and fail fast when necessary.

## Read more:

- 💡 [Add Flow API Reference](https://docs.bullmq.io/api/classes/v6.FlowProducer.html#add)
