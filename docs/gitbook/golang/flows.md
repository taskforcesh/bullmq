---
description: Adding flows (trees of parent and child jobs) with BullMQ for Go.
---

# Flows

A `bullmq.FlowProducer` adds a tree of jobs, possibly spanning several
queues, in one datastore operation. A parent waits in the `waiting-children`
state until all of its children are processed, and then reads their results.
The concepts are described in the [Flows guide](../guide/flows/).

```go
flows, err := bullmq.NewFlowProducer(&bullmq.FlowProducerOptions{Backend: backend})
if err != nil {
	log.Fatal(err)
}
defer flows.Close()

tree, err := flows.Add(ctx, bullmq.FlowJob{
	Name:      "render-report",
	QueueName: "reports",
	Data:      map[string]string{"month": "2026-10"},
	Children: []bullmq.FlowJob{
		{Name: "fetch", QueueName: "sources", Data: "sales"},
		{Name: "fetch", QueueName: "sources", Data: "costs",
			Opts: &bullmq.JobOptions{FailParentOnFailure: bullmq.Bool(true)}},
	},
}, nil)
if err != nil {
	log.Fatal(err)
}
log.Printf("report job %s waits for %d children", tree.Job.ID, len(tree.Children))
```

Every queue of a flow is reached through the producer's backend, so they
share its connections and its namespace (the Redis prefix or the PostgreSQL
schema). `FlowOpts.QueuesOptions` sets default job options per queue:

```go
_, err := flows.Add(ctx, flow, &bullmq.FlowOpts{
	QueuesOptions: map[string]bullmq.FlowQueueOptions{
		"sources": {DefaultJobOptions: &bullmq.JobOptions{Attempts: bullmq.Int64(3)}},
	},
})
if err != nil {
	log.Fatal(err)
}
```

`AddBulk` adds several flows in one operation. When the datastore rejects a
job, for example because the parent of the root doesn't exist, `Add` and
`AddBulk` return an error, and, as in Node.js, the jobs already accepted are
kept.

## Reading the results of the children

The processor of a parent reads the return value of each completed child,
keyed by the child's key (`bull:sources:<id>` on Redis, `sources:<id>` on
PostgreSQL):

```go
func renderReport(ctx context.Context, job *bullmq.Job) (any, error) {
	values, err := job.ChildrenValues(ctx)
	if err != nil {
		return nil, err
	}
	total := 0.0
	for _, raw := range values {
		var amount float64
		if err := json.Unmarshal(raw, &amount); err != nil {
			return nil, err
		}
		total += amount
	}
	return total, nil
}
```

`job.Dependencies` lists the children by status (processed, unprocessed,
ignored, failed), in full or a page at a time, and `job.DependenciesCount`
counts them.

## When a child fails

By default, a parent keeps waiting when one of its children fails. The child
options change that, as described in the guide:

| Option                      | Effect on the parent                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `FailParentOnFailure`       | [The parent fails](../guide/flows/fail-parent.md)                                                        |
| `ContinueParentOnFailure`   | [The parent is processed right away](../guide/flows/continue-parent.md)                                  |
| `IgnoreDependencyOnFailure` | [The failure is ignored](../guide/flows/ignore-dependency.md), and kept in `job.IgnoredChildrenFailures` |
| `RemoveDependencyOnFailure` | [The child is removed from the dependencies](../guide/flows/remove-dependency.md)                        |

The options are mutually exclusive. `job.RemoveChildDependency` detaches a
pending child from its parent (it returns an error matching
`bullmq.ErrParentJobNotExist` for a job without a parent, as Node.js throws),
and `job.RemoveUnprocessedChildren` removes the children of a parent that
haven't been processed yet.

## Adding children at runtime

A running job can add children, with `JobOptions.Parent` or a flow whose root
has a `Parent`, and then wait for them. The processor runs again once the
children are done, so it records its progress in the job's data:

```go
func importFiles(ctx context.Context, job *bullmq.Job) (any, error) {
	var state struct {
		Files         []string `json:"files"`
		ChildrenAdded bool     `json:"childrenAdded"`
	}
	if err := job.DecodeData(&state); err != nil {
		return nil, err
	}
	if !state.ChildrenAdded {
		for _, file := range state.Files {
			_, err := filesQueue.Add(ctx, "import-file", file, &bullmq.JobOptions{
				Parent: &bullmq.ParentOptions{ID: job.ID, Queue: job.QueueName},
			})
			if err != nil {
				return nil, err
			}
		}
		state.ChildrenAdded = true
		if err := job.UpdateData(ctx, state); err != nil {
			return nil, err
		}
	}
	moved, err := job.MoveToWaitingChildren(ctx, nil)
	if err != nil {
		return nil, err
	}
	if moved {
		return nil, bullmq.ErrWaitingChildren
	}
	// Every child is done.
	return job.ChildrenValues(ctx)
}
```

## Reading a flow back

```go
node, err := flows.GetFlow(ctx, bullmq.FlowGetOptions{ID: tree.Job.ID, QueueName: "reports"})
if err != nil {
	log.Fatal(err)
}
if node != nil {
	for _, child := range node.Children {
		log.Printf("child %s of queue %s", child.Job.ID, child.Job.QueueName)
	}
}
```

`Depth` and `MaxChildren` limit how much of the tree is read, as in Node.js.

{% hint style="info" %}
Unlike Node.js, a flow node can't set its own `prefix`: use another
`FlowProducer`, with another backend, for queues under another prefix.
{% endhint %}
