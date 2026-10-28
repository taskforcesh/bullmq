# Working with batches

"Batches" in BullMQ can mean three different things. Pick the API that matches
the problem you are solving:

| Goal                                                   | Where       | API                                                |
| ------------------------------------------------------ | ----------- | -------------------------------------------------- |
| Enqueue many independent jobs efficiently / atomically | Open source | [`Queue.addBulk`](adding-bulks.md)                 |
| Enqueue many parent/child trees at once                | Open source | [`FlowProducer.addBulk`](../flows/adding-bulks.md) |
| Process many waiting jobs in **one** worker callback   | BullMQ Pro  | [Pro batches](../../bullmq-pro/batches.md)         |

{% hint style="info" %}
Worker `concurrency` runs several jobs in parallel, but each processor call still
receives **one** job. That is not the same as Pro batch processing, where
`job.getBatch()` returns up to `batch.size` jobs together.
{% endhint %}

## Add many jobs (`Queue.addBulk`)

Use this when you already have a list of work items and each item should remain
its own job (own retries, own events, own completion):

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('invoices', { connection });

const jobs = await queue.addBulk([
  { name: 'send', data: { invoiceId: 'A-100' } },
  { name: 'send', data: { invoiceId: 'A-101' } },
  { name: 'send', data: { invoiceId: 'A-102' } },
]);
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Queue

queue = Queue("invoices", {"connection": connection})

jobs = await queue.addBulk([
    {"name": "send", "data": {"invoiceId": "A-100"}},
    {"name": "send", "data": {"invoiceId": "A-101"}},
    {"name": "send", "data": {"invoiceId": "A-102"}},
])
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, jobs} =
  BullMQ.Queue.add_bulk(
    "invoices",
    [
      {"send", %{invoiceId: "A-100"}, []},
      {"send", %{invoiceId: "A-101"}, []},
      {"send", %{invoiceId: "A-102"}, []}
    ],
    connection: :my_redis
  )
```

{% endtab %}

{% tab title=".NET" %}

```csharp
using BullMQ;

var queue = new Queue("invoices", new QueueOptions { Connection = connection });

var jobs = await queue.AddBulkAsync(new (string, object?, JobsOptions?)[]
{
    ("send", new { invoiceId = "A-100" }, null),
    ("send", new { invoiceId = "A-101" }, null),
    ("send", new { invoiceId = "A-102" }, null),
});
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::{BulkJob, Queue, QueueOptions};
use serde_json::json;

let queue = Queue::with_options("invoices", QueueOptions::new().connection(connection)).await?;

let jobs = queue
    .add_bulk(vec![
        BulkJob::new("send", json!({"invoiceId": "A-100"})),
        BulkJob::new("send", json!({"invoiceId": "A-101"})),
        BulkJob::new("send", json!({"invoiceId": "A-102"})),
    ])
    .await?;
```

{% endtab %}

{% tab title="PHP" %}

```php
<?php
use BullMQ\Queue;

$queue = new Queue('invoices', ['connection' => $connection]);

$jobs = $queue->addBulk([
    ['name' => 'send', 'data' => ['invoiceId' => 'A-100']],
    ['name' => 'send', 'data' => ['invoiceId' => 'A-101']],
    ['name' => 'send', 'data' => ['invoiceId' => 'A-102']],
]);
```

{% endtab %}
{% endtabs %}

`addBulk` reduces Redis round-trips compared with calling `add` in a loop. See
[Adding jobs in bulk](adding-bulks.md) for language examples and atomicity notes.

## Add many flows (`FlowProducer.addBulk`)

Use this when each unit of work is a flow (parent + children) and you want to
create several trees in one call:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { FlowProducer } from 'bullmq';

const flowProducer = new FlowProducer({ connection });

await flowProducer.addBulk([
  {
    name: 'import-file',
    queueName: 'imports',
    data: { fileId: 'first.csv' },
    children: [
      {
        name: 'parse',
        queueName: 'import-steps',
        data: { fileId: 'first.csv' },
      },
      {
        name: 'index',
        queueName: 'import-steps',
        data: { fileId: 'first.csv' },
      },
    ],
  },
  {
    name: 'import-file',
    queueName: 'imports',
    data: { fileId: 'second.csv' },
    children: [
      {
        name: 'parse',
        queueName: 'import-steps',
        data: { fileId: 'second.csv' },
      },
      {
        name: 'index',
        queueName: 'import-steps',
        data: { fileId: 'second.csv' },
      },
    ],
  },
]);
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import FlowProducer

flow_producer = FlowProducer({"connection": connection})

await flow_producer.addBulk([
    {
        "name": "import-file",
        "queueName": "imports",
        "data": {"fileId": "first.csv"},
        "children": [
            {
                "name": "parse",
                "queueName": "import-steps",
                "data": {"fileId": "first.csv"},
            },
            {
                "name": "index",
                "queueName": "import-steps",
                "data": {"fileId": "first.csv"},
            },
        ],
    },
    {
        "name": "import-file",
        "queueName": "imports",
        "data": {"fileId": "second.csv"},
        "children": [
            {
                "name": "parse",
                "queueName": "import-steps",
                "data": {"fileId": "second.csv"},
            },
            {
                "name": "index",
                "queueName": "import-steps",
                "data": {"fileId": "second.csv"},
            },
        ],
    },
])
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, _results} =
  BullMQ.FlowProducer.add_bulk(
    [
      %{
        name: "import-file",
        queue_name: "imports",
        data: %{fileId: "first.csv"},
        children: [
          %{name: "parse", queue_name: "import-steps", data: %{fileId: "first.csv"}},
          %{name: "index", queue_name: "import-steps", data: %{fileId: "first.csv"}}
        ]
      },
      %{
        name: "import-file",
        queue_name: "imports",
        data: %{fileId: "second.csv"},
        children: [
          %{name: "parse", queue_name: "import-steps", data: %{fileId: "second.csv"}},
          %{name: "index", queue_name: "import-steps", data: %{fileId: "second.csv"}}
        ]
      }
    ],
    connection: :my_redis
  )
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::{FlowJob, FlowProducer, FlowProducerOptions};
use serde_json::json;

let flow_producer = FlowProducer::with_options(FlowProducerOptions {
    connection,
    ..Default::default()
})
.await?;

flow_producer
    .add_bulk(vec![
        FlowJob::new("import-file", "imports", json!({"fileId": "first.csv"}))?
            .add_child(FlowJob::new("parse", "import-steps", json!({"fileId": "first.csv"}))?)
            .add_child(FlowJob::new("index", "import-steps", json!({"fileId": "first.csv"}))?),
        FlowJob::new("import-file", "imports", json!({"fileId": "second.csv"}))?
            .add_child(FlowJob::new("parse", "import-steps", json!({"fileId": "second.csv"}))?)
            .add_child(FlowJob::new("index", "import-steps", json!({"fileId": "second.csv"}))?),
    ])
    .await?;
```

{% endtab %}
{% endtabs %}

Details: [Adding flows in bulk](../flows/adding-bulks.md).

## Model a batch as a single job

When the items must share one retry / timeout / completion outcome, put them in
one job payload instead of inventing a custom worker-side batcher:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
await queue.add('send-batch', {
  invoiceIds: ['A-100', 'A-101', 'A-102'],
});
```

{% endtab %}

{% tab title="Python" %}

```python
await queue.add("send-batch", {
    "invoiceIds": ["A-100", "A-101", "A-102"],
})
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, _job} =
  BullMQ.Queue.add(
    "invoices",
    "send-batch",
    %{invoiceIds: ["A-100", "A-101", "A-102"]},
    connection: :my_redis
  )
```

{% endtab %}

{% tab title=".NET" %}

```csharp
await queue.AddAsync("send-batch", new
{
    invoiceIds = new[] { "A-100", "A-101", "A-102" },
});
```

{% endtab %}

{% tab title="Rust" %}

```rust
queue
    .add(
        "send-batch",
        serde_json::json!({
            "invoiceIds": ["A-100", "A-101", "A-102"],
        }),
    )
    .await?;
```

{% endtab %}

{% tab title="PHP" %}

```php
<?php

$queue->add('send-batch', [
    'invoiceIds' => ['A-100', 'A-101', 'A-102'],
]);
```

{% endtab %}
{% endtabs %}

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Worker } from 'bullmq';

const worker = new Worker(
  'invoices',
  async job => {
    const invoiceIds: string[] = job.data.invoiceIds;

    for (const [index, invoiceId] of invoiceIds.entries()) {
      await sendInvoice(invoiceId);
      await job.updateProgress({
        completed: index + 1,
        total: invoiceIds.length,
      });
    }

    return { sent: invoiceIds.length };
  },
  { connection },
);
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Worker

async def process(job, token):
    invoice_ids = job.data["invoiceIds"]

    for index, invoice_id in enumerate(invoice_ids):
        await send_invoice(invoice_id)
        await job.updateProgress({
            "completed": index + 1,
            "total": len(invoice_ids),
        })

    return {"sent": len(invoice_ids)}

worker = Worker("invoices", process, {"connection": connection})
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, _worker} =
  BullMQ.Worker.start_link(
    queue: "invoices",
    connection: :my_redis,
    processor: fn job ->
      invoice_ids = job.data["invoiceIds"]
      total = length(invoice_ids)

      invoice_ids
      |> Enum.with_index(1)
      |> Enum.each(fn {invoice_id, completed} ->
        send_invoice(invoice_id)
        BullMQ.Worker.update_progress(job, %{completed: completed, total: total})
      end)

      {:ok, %{sent: total}}
    end
  )
```

{% endtab %}

{% tab title=".NET" %}

```csharp
using System.Text.Json;
using BullMQ;

var worker = new Worker(
    "invoices",
    async (job, cancellationToken) =>
    {
        var invoiceIds = ((JsonElement)job.Data!)
            .GetProperty("invoiceIds")
            .Deserialize<string[]>()!;

        for (var index = 0; index < invoiceIds.Length; index++)
        {
            await SendInvoiceAsync(invoiceIds[index]);
            await job.UpdateProgressAsync(new
            {
                completed = index + 1,
                total = invoiceIds.Length,
            });
        }

        return new { sent = invoiceIds.Length };
    },
    new WorkerOptions { Connection = connection });
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::{Job, JobProgress, Worker, WorkerOptions};
use serde_json::json;

let worker = Worker::with_options(
    "invoices",
    |mut job: Job, _token| async move {
        let invoice_ids: Vec<String> =
            serde_json::from_value(job.data()["invoiceIds"].clone())?;

        for (index, invoice_id) in invoice_ids.iter().enumerate() {
            send_invoice(invoice_id).await?;
            job.update_progress(JobProgress::Object(json!({
                "completed": index + 1,
                "total": invoice_ids.len(),
            })))
            .await?;
        }

        Ok(json!({ "sent": invoice_ids.len() }))
    },
    WorkerOptions::new().connection(connection),
)
.await?;
```

{% endtab %}
{% endtabs %}

Prefer `addBulk` (or flows) when each item needs independent retries or
per-item failure tracking.

## Process several jobs in one worker callback (Pro)

Open-source workers always invoke the processor with a single job. Native
worker-side batches are a [BullMQ Pro](../../bullmq-pro/introduction.md)
feature:

```typescript
import { WorkerPro } from '@taskforcesh/bullmq-pro';

const worker = new WorkerPro(
  'invoices',
  async job => {
    const batch = job.getBatch();

    // Example: one bulk DB/API call for the whole batch
    await sendInvoices(batch.map(batchedJob => batchedJob.data));
  },
  {
    connection,
    batch: { size: 10 },
  },
);
```

Pro batches have different failure and event semantics (a dummy wrapper job,
`setAsFailed`, `QueueEventsPro`, `minSize` / `timeout`, group affinity). Read
[BullMQ Pro: Batches](../../bullmq-pro/batches.md) before enabling them.

## Real-time updates for batched work

Whether you used `addBulk`, a single batch job, or Pro batches, live UIs should
listen with [`QueueEvents`](../events/#real-time-updates) so one
process can observe completions and `progress` from every worker.

## Read more

- [Adding jobs in bulk](adding-bulks.md)
- [Adding flows in bulk](../flows/adding-bulks.md)
- [Events / real-time updates](../events/#real-time-updates)
- [Workers: concurrency](../workers/concurrency.md)
- [BullMQ Pro: Batches](../../bullmq-pro/batches.md)
