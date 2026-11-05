# Adding flows in bulk

Sometimes it is necessary to atomically add flows in bulk. For example, there could be a requirement that all the flows must be created or none of them. Also, adding flows in bulk can be faster since it reduces the number of roundtrips to Redis:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { FlowProducer } from 'bullmq';

const flow = new FlowProducer({ connection });

const trees = await flow.addBulk([
  {
    name: 'root-job-1',
    queueName: 'rootQueueName-1',
    data: {},
    children: [
      {
        name,
        data: { idx: 0, foo: 'bar' },
        queueName: 'childrenQueueName-1',
      },
    ],
  },
  {
    name: 'root-job-2',
    queueName: 'rootQueueName-2',
    data: {},
    children: [
      {
        name,
        data: { idx: 1, foo: 'baz' },
        queueName: 'childrenQueueName-2',
      },
    ],
  },
]);
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import FlowProducer

flow = FlowProducer({"connection": connection})

trees = await flow.addBulk([
    {
        "name": "root-job-1",
        "queueName": "rootQueueName-1",
        "data": {},
        "children": [
            {
                "name": name,
                "data": {"idx": 0, "foo": "bar"},
                "queueName": "childrenQueueName-1",
            },
        ],
    },
    {
        "name": "root-job-2",
        "queueName": "rootQueueName-2",
        "data": {},
        "children": [
            {
                "name": name,
                "data": {"idx": 1, "foo": "baz"},
                "queueName": "childrenQueueName-2",
            },
        ],
    },
])
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, trees} =
  BullMQ.FlowProducer.add_bulk(
    [
      %{
        name: "root-job-1",
        queue_name: "rootQueueName-1",
        data: %{},
        children: [
          %{
            name: name,
            data: %{idx: 0, foo: "bar"},
            queue_name: "childrenQueueName-1"
          }
        ]
      },
      %{
        name: "root-job-2",
        queue_name: "rootQueueName-2",
        data: %{},
        children: [
          %{
            name: name,
            data: %{idx: 1, foo: "baz"},
            queue_name: "childrenQueueName-2"
          }
        ]
      }
    ],
    connection: :my_redis
  )
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::{FlowJob, FlowProducer, FlowProducerOptions};
use serde_json::json;

let flow = FlowProducer::with_options(FlowProducerOptions::new().connection(connection)).await?;

let trees = flow
    .add_bulk(vec![
        FlowJob::new("root-job-1", "rootQueueName-1", json!({}))?.add_child(FlowJob::new(
            name,
            "childrenQueueName-1",
            json!({ "idx": 0, "foo": "bar" }),
        )?),
        FlowJob::new("root-job-2", "rootQueueName-2", json!({}))?.add_child(FlowJob::new(
            name,
            "childrenQueueName-2",
            json!({ "idx": 1, "foo": "baz" }),
        )?),
    ])
    .await?;
```

{% endtab %}
{% endtabs %}

This call can only succeed or fail, and all or none of the jobs will be added.

## Read more:

- 💡 [Add Bulk API Reference](https://docs.bullmq.io/api/classes/v6.FlowProducer.html#addbulk)
