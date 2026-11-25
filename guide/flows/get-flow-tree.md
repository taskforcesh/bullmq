# Get Flow Tree

In some situations, you need to get a job and all of its children, grandchildren, and so on.

The pattern to solve this requirement consists of using the [`getFlow`](https://docs.bullmq.io/api/classes/v6.FlowProducer.html#getflow) method.

**TypeScript**

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

**Rust**

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

**Go**

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
			Children: []bullmq.FlowJob{
				{
					Name:      name,
					Data:      map[string]any{"idx": 4, "foo": "baz"},
					QueueName: "grandchildrenQueueName",
				},
			},
		},
		{
			Name:      name,
			Data:      map[string]any{"idx": 2, "foo": "foo"},
			QueueName: "childrenQueueName",
		},
		{
			Name:      name,
			Data:      map[string]any{"idx": 3, "foo": "bis"},
			QueueName: "childrenQueueName",
		},
	},
}, nil)
if err != nil {
	log.Fatal(err)
}

topJob := originalTree.Job

tree, err := flow.GetFlow(ctx, bullmq.FlowGetOptions{
	ID:        topJob.ID,
	QueueName: "topQueueName",
})
if err != nil {
	log.Fatal(err)
}

children, job := tree.Children, tree.Job
```

> **Note:** Each _child_ may have a `job` property and in the case they have children as well, they would have the `children` property

You may also need a way to limit that information if you have many children for one of the job nodes.

**TypeScript**

```typescript
const limitedTree = await flow.getFlow({
  id: topJob.id,
  queueName: 'topQueueName',
  depth: 2, // the root and its first level of children
  maxChildren: 2, // about 2 children of each status per node
});

const { children, job } = limitedTree;
```

**Rust**

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

**Go**

```go
limitedTree, err := flow.GetFlow(ctx, bullmq.FlowGetOptions{
	ID:          topJob.ID,
	QueueName:   "topQueueName",
	Depth:       2, // the root and its first level of children
	MaxChildren: 2, // about 2 children of each status per node
})
if err != nil {
	log.Fatal(err)
}

children, job := limitedTree.Children, limitedTree.Job
```

> **Note:** `depth` counts the levels of the tree, the root included: `depth: 1` returns only the root job. In Rust, `depth` counts the levels below the root, so `.depth(1)` returns the same tree as `depth: 2` above.
> 
> `maxChildren` limits each group of children (processed, unprocessed, failed and ignored) separately. On Redis it is only a hint, passed as the `COUNT` of `SSCAN`/`HSCAN`: small groups are returned whole, so a node may get more children than `maxChildren`. Rust caps the total number of children per node at `max_children`.

## Read more:

- 💡 [Get Flow API Reference](https://docs.bullmq.io/api/classes/v6.FlowProducer.html#getflow)
