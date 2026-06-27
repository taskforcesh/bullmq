# Adding jobs in bulk

Sometimes it is necessary to add many jobs atomically. For example, there could be a requirement that all the jobs must be placed in the queue or none of them. Also, adding jobs in bulk can be faster since it reduces the number of roundtrips to Redis:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

const name = 'jobName';
const jobs = await queue.addBulk([
  { name, data: { paint: 'car' } },
  { name, data: { paint: 'house' } },
  { name, data: { paint: 'boat' } },
]);
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Queue

queue = Queue("paint")

jobs = await queue.addBulk([
  { "name": "jobName", "data": { "paint": "car" } },
  { "name": "jobName", "data": { "paint": "house" } },
  { "name": "jobName", "data": { "paint": "boat" } }
])
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::{Queue, QueueOptions};

let queue = Queue::new("paint", QueueOptions::default()).await?;

let jobs = queue.add_bulk(vec![
    ("jobName".into(), serde_json::json!({"paint": "car"}), None),
    ("jobName".into(), serde_json::json!({"paint": "house"}), None),
    ("jobName".into(), serde_json::json!({"paint": "boat"}), None),
]).await?;
```

{% endtab %}
{% endtabs %}

This call can only succeed or fail, and all or none of the jobs will be added.

## Read more:

- 💡 [Add Bulk API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#addbulk)
