# Removing jobs

Sometimes it is necessary to remove a job. For example, there could be a job that has bad data.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

const job = await queue.add('wall', { color: 1 });

await job.remove();
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Queue

queue = Queue('paint')

job = await queue.add('wall', {'color': 1})

await job.remove()
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, job} = BullMQ.Queue.add("paint", "wall", %{color: 1}, connection: :my_redis)

{:ok, _removed} =
  BullMQ.Queue.remove_job("paint", job.id, connection: :my_redis, remove_children: true)
```

{% endtab %}

{% tab title=".NET" %}

```csharp
using BullMQ;

await using var queue = new Queue("paint", new QueueOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
});

var job = await queue.AddAsync("wall", new { color = 1 });

await job.RemoveAsync();
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::Queue;

let queue = Queue::new("paint").await?;

let job = queue.add("wall", serde_json::json!({"color": 1})).await?;

// Returns `true` if the job was removed, or `false` if it (or one of its
// dependencies) is locked and could not be removed.
let removed = queue.remove(job.id()).await?;
```

{% endtab %}

{% tab title="Go" %}

```go
package main

import (
	"context"
	"log"

	bullmq "github.com/taskforcesh/bullmq-go"
	"github.com/taskforcesh/bullmq-go/redisbackend"
)

func main() {
	ctx := context.Background()

	backend := redisbackend.New(redisbackend.Options{Addr: "localhost:6379"})
	queue, err := bullmq.NewQueue("paint", &bullmq.QueueOptions{Backend: backend})
	if err != nil {
		log.Fatal(err)
	}
	defer queue.Close()

	job, err := queue.Add(ctx, "wall", map[string]int{"color": 1}, nil)
	if err != nil {
		log.Fatal(err)
	}

	if err := job.Remove(ctx, true); err != nil {
		log.Fatal(err)
	}
}
```

{% endtab %}

{% tab title="PHP" %}

```php
<?php

use BullMQ\Queue;

$queue = new Queue('paint');

$job = $queue->add('wall', ['color' => 1]);

$queue->remove($job->id);
```

{% endtab %}
{% endtabs %}

{% hint style="warning" %}
Locked jobs (in active state) cannot be removed. In TypeScript and Python, an
error will be thrown, and in Go `Job.Remove` returns an error matching
`bullmq.ErrJobLocked`, while the other SDKs report it in the return value (for
example, in Rust `Queue::remove` returns `Ok(false)`). Go's `Queue.Remove`,
which removes a job by id, also returns `false`.
{% endhint %}

## Having a parent job

There are 2 possible cases:

1. There are not pending dependencies; in this case the parent is moved to wait status, we may try to process this job.
2. There are pending dependencies; in this case the parent is kept in waiting-children status.

{% hint style="info" %}
Take into consideration that processed values will be kept in processed `hset` from the parent if this child is in **completed** state at the time when it's removed.
{% endhint %}

## Having pending dependencies

We may try to remove all its pending descendants first.

{% hint style="warning" %}
If any of the children are locked, the deletion process will be stopped.
{% endhint %}

### Read more:

- 💡 [Remove API Reference](https://docs.bullmq.io/api/classes/v6.Job.html#remove)
