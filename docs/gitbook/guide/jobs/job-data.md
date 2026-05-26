# Job Data

Every job can have its own custom data. The data is stored in the **`data`** attribute of the job:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('paint');

const job = await myQueue.add('wall', { color: 'red' });

job.data; // { color: 'red' }
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Queue

queue = Queue('paint')

job = await queue.add('wall', {'color': 'red'})

job.data # { color: 'red' }
```

{% endtab %}
{% endtabs %}

## Update data

If you want to change the data after inserting a job, just use the **`updateData`** method. For example:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const job = await Job.create(queue, 'wall', { color: 'red' });

await job.updateData({
  color: 'blue',
});

job.data; // { color: 'blue' }
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Queue

queue = Queue('paint')

job = await queue.add('wall', {'color': 'red'})

await job.updateData({'color': 'blue'})
job.data # { color: 'blue' }
```

{% endtab %}
{% endtabs %}

## Data is serialized as JSON

Job data is sent through Redis as a string, so before being stored it is
serialized with `JSON.stringify` and on the worker side it is deserialized
with `JSON.parse`. This has a few practical consequences worth being aware
of:

- The payload must be JSON-serializable. Values like `undefined`, functions,
  `BigInt`, `Map`/`Set`, circular references and similar are not preserved.
- If you pass a **class instance** as `data`, the worker will receive a
  plain object with the same enumerable own properties — but the prototype,
  and therefore any methods, getters or setters, will be gone. Calling
  something like `job.data.getTimestamp()` inside your processor will throw
  `TypeError: job.data.getTimestamp is not a function`.
- The `DataType` type parameter on `Queue<DataType, ...>` and
  `Job<DataType, ...>` describes the _shape_ of the JSON payload, not a
  runtime class. TypeScript will happily accept a class instance there even
  though its methods will not survive the round-trip.

If you need behavior on the worker side, store the data as a plain object
and re-instantiate the class in your processor:

```typescript
class Message {
  constructor(
    public token: string,
    public timestamp: number,
  ) {}
  getTimestamp() {
    return this.timestamp;
  }
}

// Producer: pass a plain object, not the class instance.
await myQueue.add('send', { token: 't', timestamp: Date.now() });

// Worker: rebuild the instance from job.data.
const worker = new Worker('paint', async job => {
  const msg = new Message(job.data.token, job.data.timestamp);
  msg.getTimestamp(); // works
});
```

Alternatively, implement a `toJSON()` method on your class — `JSON.stringify`
calls it automatically — to control exactly how the instance is serialized.

## Read more:

- 💡 [Update Data API Reference](https://api.docs.bullmq.io/classes/v5.Job.html#updatedata)
