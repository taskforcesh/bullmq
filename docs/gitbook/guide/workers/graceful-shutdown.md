# Graceful shutdown

BullMQ supports graceful shutdowns of the workers. This is important so that we can minimize stalled jobs when a worker for some reason must be shutdown. But note that even in the event of an "ungraceful shutdown", the stalled mechanism in BullMQ allows for new workers to pick up stalled jobs and continue working on them.

{% hint style="danger" %}
In order for stalled jobs to be picked up by other workers you need to have a [QueueScheduler](https://docs.bullmq.io/guide/queuescheduler) class running in the system.
{% endhint %}

In order to perform a shutdown just call the _**close**_ method:

```typescript
await worker.close();
```

The above call will mark the worker as _closing_ so it will not pick up new jobs, at the same time it will wait for all the current jobs to be processed \(or failed\). This call will not timeout by itself, so you should make sure that your jobs finalize in a timely manner. If this call fails for some reason or it is not able to complete, the pending jobs will be marked as stalled and processed by other workers \(if correct stalled options are configured on the [QueueScheduler](https://api.docs.bullmq.io/interfaces/QueueSchedulerOptions.html)\).
