# Preserve Order

BullMQ supports preserving execution order in jobs. When _preserveOrder_ option is provided as *true*, jobs will be processed in the same order, indendently of retry strategies. If the current job fails and has a retry strategy, queue will be in rate limit state until the delay is accomplish.

```typescript
const worker = new Worker('queueName', async (job: Job) => {
    // do some work
}, {
    preserveOrder: true
    });
```

{% hint style="warning" %}
This feature is only allowed when using concurrency 1, any greater value will throw an error:
{% endhint %}
