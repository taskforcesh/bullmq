# Create Custom Events

In BullMQ, creating a generic distributed realtime event emitter is possible by using our **QueueEventsProducer** class.

Consumers must use **QueueEvents** class to subscribe to those events that they are interested in.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const queueName = 'customQueue';
const queueEventsProducer = new QueueEventsProducer(queueName, {
  connection,
});
const queueEvents = new QueueEvents(queueName, {
  connection,
});

interface CustomListener extends QueueEventsListener {
  example: (args: { custom: string }, id: string) => void;
}
queueEvents.on<CustomListener>('example', async ({ custom }) => {
  // custom logic
});

interface CustomEventPayload {
  eventName: string;
  custom: string;
}

await queueEventsProducer.publishEvent<CustomEventPayload>({
  eventName: 'example',
  custom: 'value',
});
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import QueueEvents, QueueEventsProducer

queueName = "customQueue"
queueEventsProducer = QueueEventsProducer(queueName, {
    "connection": connection,
})
queueEvents = QueueEvents(queueName, {
    "connection": connection,
})

def on_example(args, id):
    custom = args["custom"]
    # custom logic

queueEvents.on("example", on_example)

await queueEventsProducer.publishEvent({
    "eventName": "example",
    "custom": "value",
})
```

{% endtab %}
{% endtabs %}

Only eventName attribute is required.

{% hint style="warning" %}
Some event names are reserved from [Queue Listener API Reference](https://docs.bullmq.io/api/interfaces/v6.QueueListener.html).
{% endhint %}

## Read more:

- 💡 [Queue Events API Reference](https://docs.bullmq.io/api/classes/v6.QueueEvents.html)
- 💡 [Queue Events Listener API Reference](https://docs.bullmq.io/api/interfaces/v6.QueueEventsListener.html)
- 💡 [Queue Events Producer API Reference](https://docs.bullmq.io/api/classes/v6.QueueEventsProducer.html)
