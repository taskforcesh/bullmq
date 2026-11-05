# Remove Dependency

In some situations, you may have a parent job and need to remove the relationship when one of its children fail.

The pattern to solve this requirement consists on using the **removeDependencyOnFailure** option. This option will make sure that when a job fails, the dependency is removed from the parent, so the parent will complete without waiting for the failed children.

{% tabs %}
{% tab title="TypeScript" %}

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

{% endtab %}

{% tab title="Python" %}

```python
flow = FlowProducer({"connection": connection})

originalTree = await flow.add({
    "name": "root-job",
    "queueName": "topQueueName",
    "data": {},
    "children": [
        {
            "name": name,
            "data": {"idx": 0, "foo": "bar"},
            "queueName": "childrenQueueName",
            "opts": {"removeDependencyOnFailure": True},
            "children": [
                {
                    "name": name,
                    "data": {"idx": 1, "foo": "bah"},
                    "queueName": "grandChildrenQueueName",
                },
                {
                    "name": name,
                    "data": {"idx": 2, "foo": "baz"},
                    "queueName": "grandChildrenQueueName",
                },
            ],
        },
        {
            "name": name,
            "data": {"idx": 3, "foo": "foo"},
            "queueName": "childrenQueueName",
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
          name: name,
          data: %{idx: 0, foo: "bar"},
          queue_name: "childrenQueueName",
          opts: %{remove_dependency_on_failure: true},
          children: [
            %{
              name: name,
              data: %{idx: 1, foo: "bah"},
              queue_name: "grandChildrenQueueName"
            },
            %{
              name: name,
              data: %{idx: 2, foo: "baz"},
              queue_name: "grandChildrenQueueName"
            }
          ]
        },
        %{
          name: name,
          data: %{idx: 3, foo: "foo"},
          queue_name: "childrenQueueName"
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
                FlowJob::new(name, "childrenQueueName", json!({ "idx": 0, "foo": "bar" }))?
                    .options(JobOptions::new().remove_dependency_on_failure())
                    .add_child(FlowJob::new(
                        name,
                        "grandChildrenQueueName",
                        json!({ "idx": 1, "foo": "bah" }),
                    )?)
                    .add_child(FlowJob::new(
                        name,
                        "grandChildrenQueueName",
                        json!({ "idx": 2, "foo": "baz" }),
                    )?),
            )
            .add_child(FlowJob::new(name, "childrenQueueName", json!({ "idx": 3, "foo": "foo" }))?),
    )
    .await?;
```

{% endtab %}
{% endtabs %}

{% hint style="info" %}
As soon as a **child** with this option fails, the parent job will be moved to a waiting state only if there are no more pending children.
{% endhint %}

## Read more:

- 💡 [Add Flow API Reference](https://docs.bullmq.io/api/classes/v6.FlowProducer.html#add)
