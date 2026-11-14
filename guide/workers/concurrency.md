# Concurrency

There are basically two ways to achieve concurrency with BullMQ using Worker instances. You can run a worker with a concurrency factor larger than 1 (which is the default value), or you can run several workers in different node processes.

#### Local Concurrency factor

The local concurrency factor is a worker option that determines how many jobs are allowed to be processed concurrently (or in parallel if using sandboxed processors) for that instance. This means that the same worker is able to process several jobs at the same time and still provide guarantees such as "at-least-once" and order of processing.

**TypeScript**

```typescript
import { Worker, Job } from 'bullmq';

const worker = new Worker(
  queueName,
  async (job: Job) => {
    // Do something with job
    return 'some value';
  },
  { concurrency: 50 },
);
```

**Python**

```python
from bullmq import Worker

async def process(job, token):
    # Do something with job
    return "some value"

worker = Worker(queue_name, process, {"concurrency": 50})
```

**Elixir**

```elixir
{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: queue_name,
    connection: :my_redis,
    processor: fn job ->
      # Do something with job
      {:ok, "some value"}
    end,
    concurrency: 50
  )
```

**.NET**

```csharp
using BullMQ;

var worker = new Worker(
    queueName,
    async (job, cancellationToken) =>
    {
        // Do something with job
        return "some value";
    },
    new WorkerOptions
    {
        Connection = ConnectionOptions.FromString("localhost:6379"),
        Concurrency = 50,
    });
```

**Rust**

```rust
use bullmq::worker::CancellationToken;
use bullmq::{Job, Worker, WorkerOptions};

let worker = Worker::with_options(
    queue_name,
    |job: Job, _token: CancellationToken| async move {
        // Do something with job
        Ok(serde_json::json!("some value"))
    },
    WorkerOptions::new().concurrency(50),
)
.await?;
```

> **Note:** Note that the concurrency is only possible when workers perform asynchronous operations such as a call to a database or a external HTTP service, as this is how node supports concurrency natively. If your workers are very CPU intensive it is better to use [Sandboxed processors](https://docs.bullmq.io/guide/workers/sandboxed-processors.md).

In addition, you can update the concurrency value as you need while your worker is running:

**TypeScript**

```typescript
worker.concurrency = 5;
```

**Rust**

```rust
worker.set_concurrency(5);
```

#### Multiple workers

The other way to achieve concurrency is to provide multiple workers. This is the recommended way to setup BullMQ as besides providing concurrency it also provides higher availability for your workers. You can easily launch a fleet of workers running in many different machines in order to execute the jobs in parallel in a predictable and robust way.

> **Note:** If you need to achieve a global concurrency of at most 1 job at a time, refer to [Global concurrency](https://docs.bullmq.io/guide/queues/global-concurrency.md).

You can still (and it is a perfectly good practice to) choose a high concurrency factor for every worker, so that the resources of every machine where the worker is running are used more efficiently.
