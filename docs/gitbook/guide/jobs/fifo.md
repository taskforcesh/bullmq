---
description: First-In, First-Out
---

# FIFO

The first type of job we are going to describe is the FIFO (_First-In, First-Out_) type. This is the standard type when adding jobs to a queue. The jobs are processed in the same order as they are inserted into the queue.

This order is preserved independently on the number of processors you have; however, if you have more than one worker or a concurrency factor larger than 1, even though the workers will start the jobs in order, they may be completed in a slightly different order, since some jobs may take more time to complete than others.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('Paint');

// Add a job that will be processed after all others
await myQueue.add('wall', { color: 'pink' });
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Queue

queue = Queue('Paint')

# Add a job that will be processed after all others
await queue.add('wall', {'color': 'pink'})
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
# Add a job that will be processed after all others
{:ok, _job} = BullMQ.Queue.add("Paint", "wall", %{color: "pink"}, connection: :my_redis)
```

{% endtab %}

{% tab title=".NET" %}

```csharp
using BullMQ;

await using var queue = new Queue("Paint", new QueueOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
});

// Add a job that will be processed after all others
await queue.AddAsync("wall", new { color = "pink" });
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::Queue;

let queue = Queue::new("Paint").await?;

// Add a job that will be processed after all others
queue.add("wall", serde_json::json!({ "color": "pink" })).await?;
```

{% endtab %}

{% tab title="PHP" %}

```php
<?php

use BullMQ\Queue;

$queue = new Queue('Paint');

// Add a job that will be processed after all others
$queue->add('wall', ['color' => 'pink']);
```

{% endtab %}
{% endtabs %}

When you add jobs to the queue there are several options that you can use. For example, you can specify how many jobs you want to keep when the jobs are completed or failed:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
await myQueue.add(
  'wall',
  { color: 'pink' },
  { removeOnComplete: true, removeOnFail: 1000 },
);
```

{% endtab %}

{% tab title="Python" %}

```python
await queue.add(
    'wall',
    {'color': 'pink'},
    {'removeOnComplete': True, 'removeOnFail': 1000},
)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
BullMQ.Queue.add("Paint", "wall", %{color: "pink"},
  connection: :my_redis,
  remove_on_complete: true,
  remove_on_fail: 1000
)
```

{% endtab %}

{% tab title=".NET" %}

```csharp
await queue.AddAsync("wall", new { color = "pink" }, new JobsOptions
{
    RemoveOnComplete = true,
    RemoveOnFail = 1000,
});
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::types::RemoveOnFinish;

queue
    .add("wall", serde_json::json!({ "color": "pink" }))
    .remove_on_complete(RemoveOnFinish::Bool(true))
    .remove_on_fail(RemoveOnFinish::Count(1000))
    .await?;
```

{% endtab %}

{% tab title="PHP" %}

```php
$queue->add('wall', ['color' => 'pink'], [
    'removeOnComplete' => true,
    'removeOnFail' => 1000,
]);
```

{% endtab %}
{% endtabs %}

In the example above all completed jobs will be removed automatically and the last 1000 failed will be kept in the queue.

## Default job options

Quite often, you will want to provide the same job options to all the jobs that you add to the queue. In this case, you can use the `defaultJobOptions` option when instantiating the `Queue` class:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const queue = new Queue('Paint', { defaultJobOptions: {
  removeOnComplete: true, removeOnFail: 1000
});
```

{% endtab %}

{% tab title="Python" %}

```python
queue = Queue('Paint', {'defaultJobOptions': {
    'removeOnComplete': True, 'removeOnFail': 1000
}})
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, _pid} =
  BullMQ.Queue.start_link(
    name: :paint_queue,
    queue: "Paint",
    connection: :my_redis,
    default_job_opts: %{remove_on_complete: true, remove_on_fail: 1000}
  )
```

{% endtab %}

{% tab title=".NET" %}

```csharp
var queue = new Queue("Paint", new QueueOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
    DefaultJobOptions = new JobsOptions
    {
        RemoveOnComplete = true,
        RemoveOnFail = 1000,
    },
});
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::types::RemoveOnFinish;
use bullmq::{JobOptions, Queue, QueueOptions};

let queue = Queue::with_options(
    "Paint",
    QueueOptions::new().default_job_options(
        JobOptions::new()
            .remove_on_complete(RemoveOnFinish::Bool(true))
            .remove_on_fail(RemoveOnFinish::Count(1000)),
    ),
)
.await?;
```

{% endtab %}
{% endtabs %}

## Read more:

- 💡 [Add Job API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#add)
