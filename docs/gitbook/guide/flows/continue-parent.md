---
description: Process parent if any children fails.
---

# Continue Parent

{% hint style="info" %}
Available since v5.58.0
{% endhint %}

The `continueParentOnFailure` option allows a parent job to start processing as soon as a child job fails, while the `removeUnprocessedChildren` method enables dynamic cleanup of unprocessed child jobs. Additionally, you can use the `getIgnoredChildrenFailures()` method to determine whether the parent is processing due to a child failure or because all children completed successfully, allowing you to define distinct logic paths.

### continueParentOnFailure

When set to `true` on a child job, the `continueParentOnFailure` option causes the parent job to begin processing immediately if that child fails. This contrasts with the default behavior, where the parent waits for all children to finish.

- **Key Behavior**: The parent moves to the wait list, to be processed, as soon as a child with this option fails, even if other children are still running or unprocessed.
- **Use Case**: Ideal for scenarios where a child’s failure requires immediate parent intervention, such as aborting the workflow or performing cleanup.

### removeUnprocessedChildren

This method, available on a job instance, removes all unprocessed child jobs (those in waiting or delayed states) from the queue. It’s particularly useful when paired with `continueParentOnFailure` to get rid of remaining children after a failure.

- **Key Behavior**: Only affects children that haven’t started processing; **active, completed or failed** children remain intact.
- **Usage**: Call within the parent’s processor to clean up dynamically.

### getIgnoredChildrenFailures

The `getIgnoredChildrenFailures()` method (which replaces the deprecated `getFailedChildrenValues()`) returns an object mapping the keys of the failed child jobs to their failure error messages. This allows the parent job to determine why it’s processing—whether due to a child failure (triggered by `continueParentOnFailure`) or because all children completed successfully.

- **Return Value**: An object where keys are job keys (`<prefix>:<queueName>:<jobId>` on Redis) and values are error messages (e.g., { "bull:childrenQueueName:job-id-1": "Upload failed" }). If no children failed, the object is empty.
- **Usage**: Use this in the parent’s processor to branch logic based on the presence of failed children.

### Example

The following example shows how to combine these features, with the parent job reacting differently based on whether a child failed or all children succeeded:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const { FlowProducer } = require('bullmq');
const flow = new FlowProducer({ connection });

// Define the flow
const originalTree = await flow.add({
  name: 'root-job',
  queueName: 'topQueueName',
  data: {},
  children: [
    {
      name: 'child-job-1',
      data: { idx: 0, foo: 'bar' },
      queueName: 'childrenQueueName',
      opts: { continueParentOnFailure: true }, // Parent processes if this child fails
    },
    {
      name: 'child-job-2',
      data: { idx: 1, foo: 'baz' },
      queueName: 'childrenQueueName',
    },
    {
      name: 'child-job-3',
      data: { idx: 2, foo: 'qux' },
      queueName: 'childrenQueueName',
    },
  ],
});

// Processor for the parent job
const processor = async job => {
  // Check if any children failed
  const failedChildren = await job.getIgnoredChildrenFailures();
  const hasFailedChildren = Object.keys(failedChildren).length > 0;

  if (hasFailedChildren) {
    // Path 1: A child failed, triggering continueParentOnFailure
    console.log(
      `Parent job ${job.name} triggered by child failure(s):`,
      failedChildren,
    );

    // Remove unprocessed children
    await job.removeUnprocessedChildren();
    console.log('Unprocessed child jobs have been removed.');

    // Additional cleanup or error handling can go here
  } else {
    // Path 2: All children completed successfully
    console.log(
      `Parent job ${job.name} processing after all children completed successfully.`,
    );

    // Proceed with normal parent logic (e.g., aggregating results)
  }
};
```

{% endtab %}

{% tab title=".NET" %}

```csharp
using BullMQ;

var flow = new FlowProducer(new QueueBaseOptions { Connection = connection });

// Define the flow
var originalTree = await flow.AddAsync(new FlowJob
{
    Name = "root-job",
    QueueName = "topQueueName",
    Data = new { },
    Children = new[]
    {
        new FlowJob
        {
            Name = "child-job-1",
            Data = new { idx = 0, foo = "bar" },
            QueueName = "childrenQueueName",
            // Parent processes if this child fails
            Opts = new JobsOptions { ContinueParentOnFailure = true },
        },
        new FlowJob { Name = "child-job-2", Data = new { idx = 1, foo = "baz" }, QueueName = "childrenQueueName" },
        new FlowJob { Name = "child-job-3", Data = new { idx = 2, foo = "qux" }, QueueName = "childrenQueueName" },
    },
});

// Processor for the parent job
Processor processor = async (job, cancellationToken) =>
{
    // Check if any children failed (child key -> failed reason)
    var failedChildren = await job.GetIgnoredChildrenFailuresAsync();

    if (failedChildren.Count > 0)
    {
        // Path 1: A child failed, triggering ContinueParentOnFailure
        Console.WriteLine($"Parent job {job.Name} triggered by child failure(s): " +
            string.Join(", ", failedChildren.Keys));

        // Remove unprocessed children
        await job.RemoveUnprocessedChildrenAsync();
        Console.WriteLine("Unprocessed child jobs have been removed.");

        // Additional cleanup or error handling can go here
    }
    else
    {
        // Path 2: All children completed successfully
        Console.WriteLine($"Parent job {job.Name} processing after all children completed successfully.");

        // Proceed with normal parent logic (e.g., aggregating results)
    }

    return null;
};
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::worker::CancellationToken;
use bullmq::{FlowJob, FlowProducer, FlowProducerOptions, Job, JobOptions, Queue, QueueOptions};
use serde_json::json;

let flow = FlowProducer::with_options(FlowProducerOptions::new().connection(connection.clone())).await?;

// Define the flow
let original_tree = flow
    .add(
        FlowJob::new("root-job", "topQueueName", json!({}))?
            .add_child(
                FlowJob::new("child-job-1", "childrenQueueName", json!({ "idx": 0, "foo": "bar" }))?
                    .options(JobOptions::new().continue_parent_on_failure()), // Parent processes if this child fails
            )
            .add_child(FlowJob::new("child-job-2", "childrenQueueName", json!({ "idx": 1, "foo": "baz" }))?)
            .add_child(FlowJob::new("child-job-3", "childrenQueueName", json!({ "idx": 2, "foo": "qux" }))?),
    )
    .await?;

// Used to remove the unprocessed children of the parent job
let top_queue = Queue::with_options("topQueueName", QueueOptions::new().connection(connection)).await?;

// Processor for the parent job
let processor = move |job: Job, _token: CancellationToken| {
    let top_queue = top_queue.clone();
    async move {
        // Check if any children failed
        let failed_children = job.get_ignored_children_failures().await?;
        let has_failed_children = !failed_children.is_empty();

        if has_failed_children {
            // Path 1: A child failed, triggering continue_parent_on_failure
            println!(
                "Parent job {} triggered by child failure(s): {:?}",
                job.name(),
                failed_children
            );

            // Remove unprocessed children
            top_queue.remove_unprocessed_children(job.id()).await?;
            println!("Unprocessed child jobs have been removed.");

            // Additional cleanup or error handling can go here
        } else {
            // Path 2: All children completed successfully
            println!(
                "Parent job {} processing after all children completed successfully.",
                job.name()
            );

            // Proceed with normal parent logic (e.g., aggregating results)
        }

        Ok::<_, bullmq::Error>(serde_json::Value::Null)
    }
};
```

{% endtab %}

{% tab title="Go" %}

```go
import (
	"context"
	"fmt"
	"log"

	bullmq "github.com/taskforcesh/bullmq-go"
)

flow, err := bullmq.NewFlowProducer(&bullmq.FlowProducerOptions{Backend: backend})
if err != nil {
	log.Fatal(err)
}
defer flow.Close()

// Define the flow
originalTree, err := flow.Add(ctx, bullmq.FlowJob{
	Name:      "root-job",
	QueueName: "topQueueName",
	Data:      map[string]any{},
	Children: []bullmq.FlowJob{
		{
			Name:      "child-job-1",
			Data:      map[string]any{"idx": 0, "foo": "bar"},
			QueueName: "childrenQueueName",
			Opts:      &bullmq.JobOptions{ContinueParentOnFailure: bullmq.Bool(true)}, // Parent processes if this child fails
		},
		{
			Name:      "child-job-2",
			Data:      map[string]any{"idx": 1, "foo": "baz"},
			QueueName: "childrenQueueName",
		},
		{
			Name:      "child-job-3",
			Data:      map[string]any{"idx": 2, "foo": "qux"},
			QueueName: "childrenQueueName",
		},
	},
}, nil)
if err != nil {
	log.Fatal(err)
}

// Processor for the parent job
processor := func(ctx context.Context, job *bullmq.Job) (any, error) {
	// Check if any children failed
	failedChildren, err := job.IgnoredChildrenFailures(ctx)
	if err != nil {
		return nil, err
	}
	hasFailedChildren := len(failedChildren) > 0

	if hasFailedChildren {
		// Path 1: A child failed, triggering ContinueParentOnFailure
		fmt.Printf("Parent job %s triggered by child failure(s): %v\n", job.Name, failedChildren)

		// Remove unprocessed children
		if err := job.RemoveUnprocessedChildren(ctx); err != nil {
			return nil, err
		}
		fmt.Println("Unprocessed child jobs have been removed.")

		// Additional cleanup or error handling can go here
	} else {
		// Path 2: All children completed successfully
		fmt.Printf("Parent job %s processing after all children completed successfully.\n", job.Name)

		// Proceed with normal parent logic (e.g., aggregating results)
	}
	return nil, nil
}
```

{% endtab %}
{% endtabs %}

### Practical use case

Consider a workflow where child jobs upload files to different servers. If one upload fails (e.g., `child-job-1`), the parent can use continueParentOnFailure to react immediately, check `getIgnoredChildrenFailures()` to confirm the failure, and call `removeUnprocessedChildren()` to cancel remaining uploads. If all uploads succeed, the parent might aggregate the results instead.
