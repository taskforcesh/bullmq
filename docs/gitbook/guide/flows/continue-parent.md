---
description: Make parent process if any children fails
---

# Continue Parent

The `continueParentOnFailure` option allows a parent job to start processing as soon as a child job fails, while the `removeUnprocessedChildren` method enables dynamic cleanup of unprocessed child jobs. Additionally, you can use the `getFailedChildrenValues`() method to determine whether the parent is processing due to a child failure or because all children completed successfully, allowing you to define distinct logic paths.

### continueParentOnFailure

When set to `true` on a child job, the `continueParentOnFailure` option causes the parent job to begin processing immediately if that child fails. This contrasts with the default behavior, where the parent waits for all children to finish.

* **Key Behavior**: The parent moves to the active state as soon as a child with this option fails, even if other children are still running or unprocessed.
* **Use Case**: Ideal for scenarios where a child’s failure requires immediate parent intervention, such as aborting the workflow or performing cleanup.

### removeUnprocessedChildren

This method, available on a job instance, removes all unprocessed child jobs (those in waiting or delayed states) from the queue. It’s particularly useful when paired with `continueParentOnFailure` to get rid of remaining children after a failure.

* **Key Behavior**: Only affects children that haven’t started processing; **active, completed or failed** children remain intact.
* **Usage**: Call within the parent’s processor to clean up dynamically.

### getFailedChildrenValues

The `getFailedChildrenValues()` method returns an object mapping the IDs of failed child jobs to their failure error messages. This allows the parent job to determine why it’s processing—whether due to a child failure (triggered by `continueParentOnFailure`) or because all children completed successfully.

* **Return Value**: An object where keys are job IDs and values are error messages (e.g., { "job-id-1": "Upload failed" }). If no children failed, the object is empty.
* **Usage**: Use this in the parent’s processor to branch logic based on the presence of failed children.

### Example

The following example shows how to combine these features, with the parent job reacting differently based on whether a child failed or all children succeeded:

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
const processor = async (job) => {
  // Check if any children failed
  const failedChildren = await job.getFailedChildrenValues();
  const hasFailedChildren = Object.keys(failedChildren).length > 0;

  if (hasFailedChildren) {
    // Path 1: A child failed, triggering continueParentOnFailure
    console.log(`Parent job ${job.name} triggered by child failure(s):`, failedChildren);
    
    // Remove unprocessed children
    await job.removeUnprocessedChildren();
    console.log('Unprocessed child jobs have been removed.');
    
    // Additional cleanup or error handling can go here
  } else {
    // Path 2: All children completed successfully
    console.log(`Parent job ${job.name} processing after all children completed successfully.`);
    
    // Proceed with normal parent logic (e.g., aggregating results)
  }
};

```

### Practical use case

Consider a workflow where child jobs upload files to different servers. If one upload fails (e.g., `child-job-1`), the parent can use continueParentOnFailure to react immediately, check `getFailedChildrenValues()` to confirm the failure, and call `removeUnprocessedChildren()` to cancel remaining uploads. If all uploads succeed, the parent might aggregate the results instead.
