# Pausing queues

BullMQ supports pausing queues globally or locally. A queue is paused globally when no workers will pick up any jobs from the queue. When you pause a queue, the workers that are currently busy processing a job, will continue working on that job until it completes (or failed), and then will just keep idling until the queue has been unpaused.

Pausing a queue is performed by calling the _**pause**_ method on a [queue](../../api/bullmq.queue.md) instance:

```typescript
await myQueue.pause();
```

It is also possible to pause a given worker instance, this is what we call pause locally. This pause works in a similar way as the global pause in the sense that the worker will conclude processing the jobs it has already started but will not process any new ones:

```typescript
await myWorker.pause();
```

The call above will wait for all the jobs currently being processed by this worker, if you do not want to wait for current jobs to complete before the call completes you can pass "true" to just pause the worker ignoring any running jobs:

```typescript
await myWorker.pause(true);
```

