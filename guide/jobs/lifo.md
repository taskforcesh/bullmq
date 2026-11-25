
# LIFO

In some cases, it is useful to process jobs in a LIFO \(_Last-in, First-Out_\) fashion. This means that the newest jobs added to the queue will be processed **before** the older ones.

**TypeScript**

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('Paint');

// Add a job that will be processed before all others
await myQueue.add('wall', { color: 'pink' }, { lifo: true });
```

**Python**

```python
from bullmq import Queue

queue = Queue('Paint')

# Add a job that will be processed before all others
await queue.add('wall', {'color': 'pink'}, {'lifo': True})
```

**Elixir**

```elixir
# Add a job that will be processed before all others
{:ok, _job} =
  BullMQ.Queue.add("Paint", "wall", %{color: "pink"}, connection: :my_redis, lifo: true)
```

**.NET**

```csharp
using BullMQ;

await using var queue = new Queue("Paint", new QueueOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
});

// Add a job that will be processed before all others
await queue.AddAsync("wall", new { color = "pink" }, new JobsOptions { Lifo = true });
```

**Rust**

```rust
use bullmq::Queue;

let queue = Queue::new("Paint").await?;

// Add a job that will be processed before all others
queue
    .add("wall", serde_json::json!({ "color": "pink" }))
    .lifo()
    .await?;
```

**Go**

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
	queue, err := bullmq.NewQueue("Paint", &bullmq.QueueOptions{Backend: backend})
	if err != nil {
		log.Fatal(err)
	}
	defer queue.Close()

	// Add a job that will be processed before all others
	_, err = queue.Add(ctx, "wall", map[string]string{"color": "pink"}, &bullmq.JobOptions{LIFO: bullmq.Bool(true)})
	if err != nil {
		log.Fatal(err)
	}
}
```

**PHP**

```php
<?php

use BullMQ\Queue;

$queue = new Queue('Paint');

// Add a job that will be processed before all others
$queue->add('wall', ['color' => 'pink'], ['lifo' => true]);
```

