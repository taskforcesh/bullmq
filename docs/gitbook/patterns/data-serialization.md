# Data Serialization and Deserialization

It can be convenient to use custom serializers and deserializers when working with complex data types. By default, only JSON-like data can be passed in as job data. If you need to pass data that doesn't conform to JSON standards (like a Map, Set, or Date), you can define custom serializers and deserializers for your queues and workers:

```typescript
import { Queue, Worker } from 'bullmq';
import superjson from 'superjson';

const queue = new Queue('my-queue', {
  serializer: data => superjson.serialize(data),
});

await queue.add('my-job', {
  date: new Date(),
  map: new Map([['my-key', 'my-value']]),
});

const worker = new Worker(
  'my-queue',
  async job => {
    console.log(job.data.date.getSeconds());
    console.log(job.data.map.get('my-key'));
  },
  {
    deserializer: data => superjson.deserialize(data),
  },
);
```

{% hint style="warning" %}
If you are using third-party BullMQ integrations, such as dashboard or other monitoring solutions, passing custom serializers and deserializers to your queues and workers may have an adverse effect on the way these integrations operate. Defining your serializer to return a JSON compatible object is the best way to ensure that these integrations continue to work as expected.
{% endhint %}
