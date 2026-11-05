# Get Flow Tree

In some situations, you need to get a job and all of its children, grandchildren, and so on.

The pattern to solve this requirement consists of using the [`getFlow`](https://docs.bullmq.io/api/classes/v6.FlowProducer.html#getflow) method.

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

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::{FlowJob, FlowProducer, FlowProducerOptions, GetFlowOptions, JobNode};
use serde_json::json;

let flow = FlowProducer::with_options(FlowProducerOptions::new().connection(connection)).await?;

let original_tree = flow
    .add(
        FlowJob::new("root-job", "topQueueName", json!({}))?
            .add_child(
                FlowJob::new(name, "childrenQueueName", json!({ "idx": 0, "foo": "bar" }))?
                    .add_child(FlowJob::new(
                        name,
                        "grandchildrenQueueName",
                        json!({ "idx": 4, "foo": "baz" }),
                    )?),
            )
            .add_child(FlowJob::new(name, "childrenQueueName", json!({ "idx": 2, "foo": "foo" }))?)
            .add_child(FlowJob::new(name, "childrenQueueName", json!({ "idx": 3, "foo": "bis" }))?),
    )
    .await?;

let top_job = &original_tree.job;

let tree = flow
    .get_flow(GetFlowOptions::new("topQueueName", top_job.id()))
    .await?;

let JobNode { children, job } = tree;
```

{% endtab %}
{% endtabs %}

{% hint style="info" %}
Each _child_ may have a `job` property and in the case they have children as well, they would have the `children` property
{% endhint %}

You may also need a way to limit that information if you have many children for one of the job nodes.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const limitedTree = await flow.getFlow({
  id: topJob.id,
  queueName: 'topQueueName',
  depth: 1, // get only the first level of children
  maxChildren: 2, // get only 2 children per node
});

const { children, job } = limitedTree;
```

{% endtab %}

{% tab title="Rust" %}

```rust
let limited_tree = flow
    .get_flow(
        GetFlowOptions::new("topQueueName", top_job.id())
            .depth(1) // get only the first level of children
            .max_children(2), // get only 2 children per node
    )
    .await?;

let JobNode { children, job } = limited_tree;
```

{% endtab %}
{% endtabs %}

## Read more:

- 💡 [Get Flow API Reference](https://docs.bullmq.io/api/classes/v6.FlowProducer.html#getflow)
