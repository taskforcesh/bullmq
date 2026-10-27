---
description: This is a basic guide to get your first queue working.
---

# Quick Start

{% hint style="info" %}
This guide uses the TypeScript package, which runs on [Node.js](https://nodejs.org) and [Bun](https://bun.sh). If you are using another language, check the getting started section of the [Python](python/introduction.md), [Elixir](elixir/introduction.md), [.NET](dotnet/introduction.md), [Rust](rust/introduction.md) or [PHP](php/introduction.md) SDKs. All of them can work on the same queues.
{% endhint %}

## Install

Install using npm:

```
$ npm install bullmq
```

Install using yarn:

```
$ yarn add bullmq
```

Install using pnpm:

```
$ pnpm add bullmq
```

Install using Bun:

```
$ bun add bullmq
```

{% hint style="info" %}
BullMQ is written in TypeScript, and although it can be used in vanilla JavaScript, all examples in this guide will be written in TypeScript.
{% endhint %}

## Start a datastore

BullMQ stores its queues in Redis™ by default, so you need a Redis 6.2+ (or compatible, such as Valkey or Dragonfly) server running. The quickest way to get one locally is with Docker:

```
$ docker run -d --name redis -p 6379:6379 redis:latest
```

If you would rather use PostgreSQL, see [Using PostgreSQL](#using-postgresql) below.

## Add jobs and process them

Import into your project and add some jobs:

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('foo');

async function addJobs() {
  await myQueue.add('myJobName', { foo: 'bar' });
  await myQueue.add('myJobName', { qux: 'baz' });
}

await addJobs();
```

{% hint style="danger" %}
When no connection options are given, BullMQ connects to Redis on `localhost:6379`, so you need a Redis service running in your local computer to run these examples successfully. You can read more about connections, including other Redis clients such as node-redis, Bun's Redis client or Valkey GLIDE, [here](guide/connections.md).
{% endhint %}

Jobs are added to the queue and can be processed at any time, by at least one worker. Workers can run in the same process as the queue or in any other process or machine, and they can even be written in a different language:

```typescript
import { Worker } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis({ maxRetriesPerRequest: null });

const worker = new Worker(
  'foo',
  async job => {
    // Will print { foo: 'bar'} for the first job
    // and { qux: 'baz' } for the second.
    console.log(job.data);
  },
  { connection },
);
```

{% hint style="info" %}
You can have as many worker processes as you want, BullMQ will distribute the jobs across your workers in a round robin fashion.
{% endhint %}

You can listen to completed (or failed) jobs by attaching listeners to the workers:

```typescript
worker.on('completed', job => {
  console.log(`${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
  console.log(`${job.id} has failed with ${err.message}`);
});
```

{% hint style="info" %}
There are many other events available, check the [Guide](guide/events/) or the [API reference](https://docs.bullmq.io/api/) for more information.
{% endhint %}

Sometimes you need to listen to all the workers events in a given place, for this you need to use a special class [`QueueEvents`](https://docs.bullmq.io/api/classes/v6.QueueEvents.html):

```typescript
import { QueueEvents } from 'bullmq';

const queueEvents = new QueueEvents('my-queue-name');

queueEvents.on('waiting', ({ jobId }) => {
  console.log(`A job with ID ${jobId} is waiting`);
});

queueEvents.on('active', ({ jobId, prev }) => {
  console.log(`Job ${jobId} is now active; previous status was ${prev}`);
});

queueEvents.on('completed', ({ jobId, returnvalue }) => {
  console.log(`${jobId} has completed and returned ${returnvalue}`);
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  console.log(`${jobId} has failed with reason ${failedReason}`);
});
```

You may also access the timestamp of the event, which looks like "1580456039332-0".

```typescript
import { QueueEvents } from 'bullmq';

const queueEvents = new QueueEvents('my-queue-name');

queueEvents.on('progress', ({ jobId, data }, timestamp) => {
  console.log(`${jobId} reported progress ${data} at ${timestamp}`);
});
```

{% hint style="danger" %}
For performance reasons, the events emitted by a `QueueEvents` instance do not contain the `Job` instance, only the `jobId`. Use the [`Job.fromId`](https://docs.bullmq.io/api/classes/v6.Job.html#fromid) method if you need the `Job` instance.
{% endhint %}

## Using PostgreSQL

The same API runs on PostgreSQL 13 or newer. In TypeScript, install the [`pg`](https://node-postgres.com) package, apply BullMQ's schema migrations once (for example as a deployment step), and pass the `createPostgresBackend` factory as the last constructor argument. The Python, Elixir and .NET SDKs apply the migrations automatically on first use (see their introduction pages for the PostgreSQL driver they require):

```
$ npm install pg
```

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Pool } from 'pg';
import { Queue, Worker, createPostgresBackend, runMigrations } from 'bullmq';

const connection = 'postgres://postgres:postgres@localhost:5432/mydb';

// Run once, for example in a deployment step.
const pool = new Pool({ connectionString: connection });
const client = await pool.connect();
try {
  await runMigrations(client);
} finally {
  client.release();
  await pool.end();
}

const queue = new Queue('foo', { connection }, createPostgresBackend);

await queue.add('myJobName', { foo: 'bar' });

const worker = new Worker(
  'foo',
  async job => {
    console.log(job.data);
  },
  { connection },
  createPostgresBackend,
);
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Queue, Worker

connection = "postgres://postgres:postgres@localhost:5432/mydb"

# Migrations are applied automatically on first use.
queue = Queue("foo", {"backend": "postgres", "connection": connection})

await queue.add("myJobName", {"foo": "bar"})

async def process(job, token):
    print(job.data)

worker = Worker("foo", process, {"backend": "postgres", "connection": connection})
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
# Migrations are applied automatically when the connection starts.
{:ok, _pid} =
  BullMQ.Backends.Postgres.Connection.start_link(
    name: :my_pg,
    url: "postgres://postgres:postgres@localhost:5432/mydb"
  )

{:ok, _job} =
  BullMQ.Queue.add("foo", "myJobName", %{foo: "bar"},
    connection: :my_pg,
    backend: BullMQ.Backends.Postgres
  )

{:ok, _worker} =
  BullMQ.Worker.start_link(
    queue: "foo",
    connection: :my_pg,
    backend: BullMQ.Backends.Postgres,
    processor: fn job ->
      IO.inspect(job.data)
      :ok
    end
  )
```

{% endtab %}

{% tab title=".NET" %}

```csharp
using BullMQ;
using BullMQ.Postgres;

var postgres = new PostgresOptions
{
    ConnectionString = "Host=localhost;Port=5432;Database=mydb;Username=postgres;Password=postgres",
};

// Migrations are applied automatically on first use.
await using var queue = new Queue("foo", new QueueOptions { Postgres = postgres });

await queue.AddAsync("myJobName", new { foo = "bar" });

await using var worker = new Worker(
    "foo",
    async (job, cancellationToken) =>
    {
        Console.WriteLine(job.Data);
        return null;
    },
    new WorkerOptions { Postgres = postgres });
```

{% endtab %}
{% endtabs %}

Read more in the [PostgreSQL backend](guide/postgresql.md) section.

## Next steps

- Learn the main concepts in the [Guide](guide/introduction.md).
- Prepare your deployment with [Going to production](guide/going-to-production.md).
- Find out how BullMQ works internally in [Architecture](guide/architecture.md).
