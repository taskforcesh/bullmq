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

name = "jobName"
jobs = await queue.addBulk([
    {"name": name, "data": {"paint": "car"}},
    {"name": name, "data": {"paint": "house"}},
    {"name": name, "data": {"paint": "boat"}},
])
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
name = "jobName"

{:ok, jobs} =
  BullMQ.Queue.add_bulk(
    "paint",
    [
      {name, %{paint: "car"}, []},
      {name, %{paint: "house"}, []},
      {name, %{paint: "boat"}, []}
    ],
    connection: :my_redis
  )
```

{% endtab %}

{% tab title=".NET" %}

```csharp
using BullMQ;

var queue = new Queue("paint", new QueueOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
});

const string name = "jobName";
var jobs = await queue.AddBulkAsync(new (string, object?, JobsOptions?)[]
{
    (name, new { paint = "car" }, null),
    (name, new { paint = "house" }, null),
    (name, new { paint = "boat" }, null),
});
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::{BulkJob, Queue};
use serde_json::json;

let queue = Queue::new("paint").await?;

let name = "jobName";
let jobs = queue
    .add_bulk(vec![
        BulkJob::new(name, json!({"paint": "car"})),
        BulkJob::new(name, json!({"paint": "house"})),
        BulkJob::new(name, json!({"paint": "boat"})),
    ])
    .await?;
```

{% endtab %}

{% tab title="PHP" %}

```php
<?php
use BullMQ\Queue;

$queue = new Queue('paint');

$name = 'jobName';
$jobs = $queue->addBulk([
    ['name' => $name, 'data' => ['paint' => 'car']],
    ['name' => $name, 'data' => ['paint' => 'house']],
    ['name' => $name, 'data' => ['paint' => 'boat']],
]);
```

{% endtab %}
{% endtabs %}

This call can only succeed or fail, and all or none of the jobs will be added. The .NET and Rust SDKs send all the jobs at once (pipelined) for speed, but do not add them atomically.

## Read more:

- 💡 [Add Bulk API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#addbulk)
