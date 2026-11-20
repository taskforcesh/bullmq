# Adding flows in bulk

You can add several flows with a single call. All their jobs are sent to the datastore together, in one transaction on Redis, which makes it faster than adding the flows one by one since it reduces the number of roundtrips:

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

{% tab title="Go" %}

```go
import (
	"log"

	bullmq "github.com/taskforcesh/bullmq-go"
)

flow, err := bullmq.NewFlowProducer(&bullmq.FlowProducerOptions{Backend: backend})
if err != nil {
	log.Fatal(err)
}
defer flow.Close()

trees, err := flow.AddBulk(ctx, []bullmq.FlowJob{
	{
		Name:      "root-job-1",
		QueueName: "rootQueueName-1",
		Data:      map[string]any{},
		Children: []bullmq.FlowJob{
			{
				Name:      name,
				Data:      map[string]any{"idx": 0, "foo": "bar"},
				QueueName: "childrenQueueName-1",
			},
		},
	},
	{
		Name:      "root-job-2",
		QueueName: "rootQueueName-2",
		Data:      map[string]any{},
		Children: []bullmq.FlowJob{
			{
				Name:      name,
				Data:      map[string]any{"idx": 1, "foo": "baz"},
				QueueName: "childrenQueueName-2",
			},
		},
	},
})
if err != nil {
	log.Fatal(err)
}
```

{% endtab %}
{% endtabs %}

Adding flows in bulk is not all-or-nothing, though: a job that the datastore rejects, for example a root job whose `parent` doesn't exist, is not added (nor are its children), while the jobs of the other flows are still added: nothing is rolled back.

{% hint style="warning" %}
The Node.js and Python SDKs don't report such a rejection yet: `addBulk` resolves as if every job had been added ([#5191](https://github.com/taskforcesh/bullmq/issues/5191)).
{% endhint %}

## Read more:

- 💡 [Add Bulk API Reference](https://docs.bullmq.io/api/classes/v6.FlowProducer.html#addbulk)
