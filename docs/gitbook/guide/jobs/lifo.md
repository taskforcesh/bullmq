---
description: 'Last-in, First Out'
---

# LIFO

In some cases, it is useful to process jobs in a LIFO \(_Last-in, First-Out_\) fashion. This means that the newest jobs added to the queue will be processed **before** the older ones.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('Paint');

// Add a job that will be processed before all others
await myQueue.add('wall', { color: 'pink' }, { lifo: true });
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Queue

queue = Queue('Paint')

# Add a job that will be processed before all others
await queue.add('wall', {'color': 'pink'}, {'lifo': True})
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
# Add a job that will be processed before all others
{:ok, _job} =
  BullMQ.Queue.add("Paint", "wall", %{color: "pink"}, connection: :my_redis, lifo: true)
```

{% endtab %}

{% tab title=".NET" %}

```csharp
using BullMQ;

await using var queue = new Queue("Paint", new QueueOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
});

// Add a job that will be processed before all others
await queue.AddAsync("wall", new { color = "pink" }, new JobsOptions { Lifo = true });
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::Queue;

let queue = Queue::new("Paint").await?;

// Add a job that will be processed before all others
queue
    .add("wall", serde_json::json!({ "color": "pink" }))
    .lifo()
    .await?;
```

{% endtab %}

{% tab title="PHP" %}

```php
<?php

use BullMQ\Queue;

$queue = new Queue('Paint');

// Add a job that will be processed before all others
$queue->add('wall', ['color' => 'pink'], ['lifo' => true]);
```

{% endtab %}
{% endtabs %}
