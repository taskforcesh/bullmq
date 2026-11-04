# Adding jobs in bulk

Adding jobs in bulk can be faster because it reduces roundtrips to the backend:

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

Bulk-add atomicity depends on the SDK and backend. On PostgreSQL, the TypeScript, Python, and .NET SDKs add a batch in a single database transaction, so a failed batch is rolled back. Elixir does this for standard jobs when `pipeline: true` (the default), but adds delayed or prioritized jobs individually. Setting `pipeline: false` also adds all jobs individually. If a later Elixir addition fails in these cases, earlier jobs may remain committed; check the queue before retrying.

On Redis, do not assume that a failed bulk call added no jobs. TypeScript, Rust, and .NET pipeline individual job additions; Elixir may split standard jobs across transactions and adds delayed or prioritized jobs sequentially. Python and PHP group additions in a Redis transaction, but Redis does not roll back commands that fail during execution. A failure can therefore leave some jobs added; check the queue before retrying.

## Read more:

- 💡 [Add Bulk API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#addbulk)
