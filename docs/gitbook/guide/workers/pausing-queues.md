# Pausing queues

BullMQ supports pausing queues globally or locally. A queue is paused globally when no workers will pick up any jobs from the queue. When you pause a queue, the workers that are currently busy processing a job, will continue working on that job until it completes \(or failed\), and then will just keep idling until the queue has been unpaused.

Pausing a queue is performed by calling the _**pause**_ method on a [queue](https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/api/bullmq.queue.md) instance:

```typescript
await myQueue.pause();
```

It is also possible to pause a given worker instance, this is what we call pause locally. This pause works in a similar way as the global pause in the sense that the worker will conclude processing the jobs it has already started but will not process any new ones:

```typescript
await myWorker.pause();
```

The call above will be executed almost immediately, but note it is an async method, this is because it can also be called with an extra parameter so that the call waits for all the jobs in that given worker to complete:

```typescript
await myWorker.pause(true);
```

The call is useful if for some reason you want to know exactly when the jobs in the worker have all finalized.



