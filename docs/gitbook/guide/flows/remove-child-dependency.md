# Remove Child Dependency

In some situations, you may have a parent job and need to remove the dependency of one of its children.

The pattern to solve this requirement consists on using the **removeChildDependency** method. It will make sure that if the job is the last pending child, to move its parent to _waiting_ and it won't be listed in unprocessed list of the parent.

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
      opts: {},
    },
  ],
});

await originalTree.children[0].job.removeChildDependency();
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::{FlowJob, FlowProducer, FlowProducerOptions, JobOptions};
use serde_json::json;

let flow = FlowProducer::with_options(FlowProducerOptions::new().connection(connection)).await?;

let mut original_tree = flow
    .add(
        FlowJob::new("root-job", "topQueueName", json!({}))?.add_child(
            FlowJob::new(name, "childrenQueueName", json!({ "idx": 0, "foo": "bar" }))?
                .options(JobOptions::new()),
        ),
    )
    .await?;

original_tree.children.as_mut().unwrap()[0]
    .job
    .remove_child_dependency()
    .await?;
```

{% endtab %}

{% tab title="Go" %}

```go
flow, err := bullmq.NewFlowProducer(&bullmq.FlowProducerOptions{Backend: backend})
if err != nil {
	log.Fatal(err)
}
defer flow.Close()

originalTree, err := flow.Add(ctx, bullmq.FlowJob{
	Name:      "root-job",
	QueueName: "topQueueName",
	Data:      map[string]any{},
	Children: []bullmq.FlowJob{
		{
			Name:      name,
			Data:      map[string]any{"idx": 0, "foo": "bar"},
			QueueName: "childrenQueueName",
			Opts:      &bullmq.JobOptions{},
		},
	},
}, nil)
if err != nil {
	log.Fatal(err)
}

if _, err := originalTree.Children[0].Job.RemoveChildDependency(ctx); err != nil {
	log.Fatal(err)
}
```

{% endtab %}
{% endtabs %}

{% hint style="warning" %}
As soon as a **child** calls this method, it will verify if it has an existing parent, if not, it'll throw an error.
{% endhint %}

Failed or completed children using this option won't generate any removal as they won't be part of unprocessed list.
