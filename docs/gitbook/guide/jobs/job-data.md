# Job Data

Every job can have its own custom data. The data is stored in the **data** attribute of the job:

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

If you want to change the data after inserting a job, just use the **updateData** method. For example:

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

## Read more:

- 💡 [Update API Reference](https://api.docs.bullmq.io/classes/Job.html#updateData)
