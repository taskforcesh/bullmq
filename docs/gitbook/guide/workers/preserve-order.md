# Preserve Order

BullMQ supports preserving execution order in jobs. When _preserveOrder_ option is provided as *true*, jobs will be processed in the same order, independently of retry strategies. If the current job fails and has a retry strategy, queue will be in rate limit state until the delay is accomplish.

```typescript
const worker = new Worker('queueName', async (job: Job) => {
    // do some work
}, {
    preserveOrder: true
    });
```

{% hint style="info" %}
when using retries and backoffs, for instance, a failed job will keep the queue idle during the time the job is being backed off until it is picked again.
{% endhint %}

{% hint style="warning" %}
This feature is only allowed when using concurrency 1, any greater value will throw an error. Make sure to also set a [global concurrency](https://docs.bullmq.io/guide/queues/global-concurrency)
{% endhint %}
