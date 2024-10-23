# Create Custom Events

In BullMQ, creating a generic distributed realtime event emitter is possible by using our **QueueEventsProducer** class.

Consumers must use **QueueEvents** class to subscribe to those events that they are interested in.

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

Only eventName attribute is required.

{% hint style="warning" %}
Some event names are reserved from [Queue Listener API Reference](https://api.docs.bullmq.io/interfaces/v5.QueueListener.html).
{% endhint %}

## Read more:

- 💡 [Queue Events API Reference](https://api.docs.bullmq.io/classes/v5.QueueEvents.html)
- 💡 [Queue Events Listener API Reference](https://api.docs.bullmq.io/interfaces/v5.QueueEventsListener.html)
- 💡 [Queue Events Producer API Reference](https://api.docs.bullmq.io/interfaces/v5.QueueEventsProducer.html)
