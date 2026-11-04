# Ignore Dependency

In some situations, you may have a parent job and need to ignore when one of its children fail.

The pattern to solve this requirement consists on using the **ignoreDependencyOnFailure** option. This option will make sure that when a job fails, the dependency is ignored from the parent, so the parent will complete without waiting for the failed children.

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
            "opts": {"ignoreDependencyOnFailure": True},
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
          opts: %{ignore_dependency_on_failure: true},
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
                    .options(JobOptions::new().ignore_dependency_on_failure())
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

Failed children using this option can be retrieved by **getIgnoredChildrenFailures** method:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const ignoredChildrenFailures =
  await originalTree.job.getIgnoredChildrenFailures();
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, ignored_children_failures} =
  BullMQ.Job.get_ignored_children_failures(original_tree.job)
```

{% endtab %}

{% tab title="Rust" %}

```rust
let ignored_children_failures = original_tree.job.get_ignored_children_failures().await?;
```

{% endtab %}
{% endtabs %}

## Read more:

- 💡 [Add Flow API Reference](https://docs.bullmq.io/api/classes/v6.FlowProducer.html#add)
