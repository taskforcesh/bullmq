# Pausing queues

BullMQ supports pausing queues _globally_ or _locally_. When a queue is paused _globally_ no workers will pick up any jobs from the queue. When you pause a queue, the workers that are currently busy processing a job will continue working on that job until it completes (or fails), and then will keep idling until the queue is unpaused.

Pausing a queue is performed by calling the _**`pause`**_ method on a [queue](https://api.docs.bullmq.io/classes/v4.Queue.html) instance:

```typescript
await myQueue.pause();
```

It is also possible to _locally_ pause a given worker instance. This pause works in a similar way as the global pause in the sense that the worker will conclude processing the jobs it has already started but will not process any new ones:

```typescript
await myWorker.pause();
```

The call above will wait for all the jobs currently being processed by this worker to complete (or fail). If you do not want to wait for current jobs to complete before the call completes you can pass `true` to pause the worker **ignoring any running jobs**:

```typescript
await myWorker.pause(true);
```

## Read more:

- 💡 [Pause Queue API Reference](https://api.docs.bullmq.io/classes/v4.Queue.html#pause)
- 💡 [Pause Worker API Reference](https://api.docs.bullmq.io/classes/v4.Worker.html#pause)
