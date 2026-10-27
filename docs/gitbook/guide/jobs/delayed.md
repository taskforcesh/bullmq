# Delayed

Delayed jobs are a special type of job that is placed into a special "delayed set", instead of being processed as fast as possible. After the delay time has passed, the job is processed as a regular job.

In order to add delayed jobs to the queue, use the `delay` option with the amount of time (in milliseconds) that you want to delay the job with.

Note that it is not guaranteed that the job will be processed at the _exact_ delayed time specified, as it depends on how busy the workers are when the time has passed, and how many other delayed jobs are scheduled at that exact time. In practice, however, the delay time is quite accurate in most cases.

This is an example of how to add delayed jobs to a queue:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('Paint');

// Add a job that will be delayed by at least 5 seconds.
await myQueue.add('house', { color: 'white' }, { delay: 5000 });
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Queue

queue = Queue('Paint')

# Add a job that will be delayed by at least 5 seconds.
await queue.add('house', {'color': 'white'}, {'delay': 5000})
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
# Add a job that will be delayed by at least 5 seconds.
{:ok, _job} =
  BullMQ.Queue.add("Paint", "house", %{color: "white"}, connection: :my_redis, delay: 5000)
```

{% endtab %}

{% tab title=".NET" %}

```csharp
using BullMQ;

await using var queue = new Queue("Paint", new QueueOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
});

// Add a job that will be delayed by at least 5 seconds.
await queue.AddAsync("house", new { color = "white" }, new JobsOptions { Delay = 5000 });
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::Queue;
use std::time::Duration;

let queue = Queue::new("Paint").await?;

// Add a job that will be delayed by at least 5 seconds.
queue
    .add("house", serde_json::json!({ "color": "white" }))
    .delay(Duration::from_millis(5000))
    .await?;
```

{% endtab %}

{% tab title="PHP" %}

```php
<?php

use BullMQ\Queue;

$queue = new Queue('Paint');

// Add a job that will be delayed by at least 5 seconds.
$queue->add('house', ['color' => 'white'], ['delay' => 5000]);
```

{% endtab %}
{% endtabs %}

If you want to process the job after a specific point in time, just add the time remaining to that point in time. For example, let's say you want to process the job on the third of July 2035 at 10:30:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const targetTime = new Date('03-07-2035 10:30');
const delay = Number(targetTime) - Number(new Date());

await myQueue.add('house', { color: 'white' }, { delay });
```

{% endtab %}

{% tab title="Python" %}

```python
from datetime import datetime

target_time = datetime(2035, 7, 3, 10, 30)
delay = int((target_time - datetime.now()).total_seconds() * 1000)

await queue.add('house', {'color': 'white'}, {'delay': delay})
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
target_time = ~U[2035-07-03 10:30:00Z]
delay = DateTime.diff(target_time, DateTime.utc_now(), :millisecond)

BullMQ.Queue.add("Paint", "house", %{color: "white"}, connection: :my_redis, delay: delay)
```

{% endtab %}

{% tab title=".NET" %}

```csharp
var targetTime = new DateTime(2035, 7, 3, 10, 30, 0);
var delay = (long)(targetTime - DateTime.Now).TotalMilliseconds;

await queue.AddAsync("house", new { color = "white" }, new JobsOptions { Delay = delay });
```

{% endtab %}

{% tab title="Rust" %}

```rust
use chrono::{Local, TimeZone};

let target_time = Local.with_ymd_and_hms(2035, 7, 3, 10, 30, 0).unwrap();
let delay = (target_time - Local::now()).to_std().unwrap_or_default();

queue
    .add("house", serde_json::json!({ "color": "white" }))
    .delay(delay)
    .await?;
```

{% endtab %}

{% tab title="PHP" %}

```php
$targetTime = new DateTime('2035-07-03 10:30');
$delay = ($targetTime->getTimestamp() - time()) * 1000;

$queue->add('house', ['color' => 'white'], ['delay' => $delay]);
```

{% endtab %}
{% endtabs %}

## Change delay

If you want to reschedule a delayed job _after_ inserting it, use the **`changeDelay`** method. This method reschedules the job to execute after the specified number of milliseconds from the current time, regardless of the original delay. For example:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const job = await Job.create(queue, 'test', { foo: 'bar' }, { delay: 2000 });

// Reschedule the job to execute 4000ms (4 seconds) from now
await job.changeDelay(4000);
```

{% endtab %}

{% tab title="Rust" %}

```rust
use std::time::Duration;

let job = queue
    .add("test", serde_json::json!({ "foo": "bar" }))
    .delay(Duration::from_millis(2000))
    .await?;

// Reschedule the job to execute 4000ms (4 seconds) from now
job.change_delay(4000).await?;
```

{% endtab %}
{% endtabs %}

{% hint style="warning" %}
Only jobs currently in the **delayed** state can have their delay changed.
{% endhint %}

## Read more:

- 💡 [Change Delay API Reference](https://docs.bullmq.io/api/classes/v6.Job.html#changedelay)
