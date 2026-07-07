# PostgreSQL backend

BullMQ ships with an optional **PostgreSQL backend** that runs the exact same
`Queue` / `Worker` / `QueueEvents` / `FlowProducer` API on PostgreSQL instead of
Redis. It is built on the datastore-agnostic [backend abstraction](connections.md#the-queue-backend):
you select it by passing the `createPostgresBackend` factory.

{% hint style="info" %}
The Redis backend remains the default and the most battle-tested option. Choose
PostgreSQL when you would rather not operate a separate Redis instance, or when
you want your jobs to live alongside (and in the same database as) your
relational data.
{% endhint %}

## Requirements

- **PostgreSQL 13 or newer** (14+ recommended). The backend checks the server
  version on first connect and throws `UnsupportedPostgresVersionError` when the
  server is older than the minimum. You can bypass the check with
  `skipVersionCheck: true` (at your own risk).
- The **`pg`** ([node-postgres](https://node-postgres.com)) package installed in
  your project. It is an _optional peer dependency_ — Redis-only users never
  need it. It is loaded lazily, only when you actually use the PostgreSQL
  backend:

```bash
npm install pg
```

## Getting started

Pass `createPostgresBackend` as the **last constructor argument**, with a
`connection` that node-postgres understands (a connection string, a pool config,
or a `pg.Pool`):

```typescript
import { Queue, Worker, createPostgresBackend } from 'bullmq';

const opts = {
  connection: 'postgres://user:password@localhost:5432/mydb',
};

const queue = new Queue('my-queue', opts, createPostgresBackend);

const worker = new Worker(
  'my-queue',
  async job => {
    // ... process the job exactly as you would with the Redis backend
  },
  opts,
  createPostgresBackend,
);
```

The argument positions mirror the Redis usage:

| Class          | Constructor                                                |
| -------------- | ---------------------------------------------------------- |
| `Queue`        | `new Queue(name, opts, createPostgresBackend)`             |
| `Worker`       | `new Worker(name, processor, opts, createPostgresBackend)` |
| `QueueEvents`  | `new QueueEvents(name, opts, createPostgresBackend)`       |
| `FlowProducer` | `new FlowProducer(opts, createPostgresBackend)`            |

### Using it everywhere by default

If your whole application uses PostgreSQL, register it once as the process-wide
default backend and drop the per-instance argument:

```typescript
import { setDefaultBackendFactory, createPostgresBackend, Queue } from 'bullmq';

setDefaultBackendFactory(createPostgresBackend);

// Every class now defaults to the PostgreSQL backend:
const queue = new Queue('my-queue', {
  connection: 'postgres://user:password@localhost:5432/mydb',
});
```

## Connection options

The `connection` option is forwarded to node-postgres and may be any of:

```typescript
// 1) A connection string
{ connection: 'postgres://user:pass@localhost:5432/mydb' }

// 2) A node-postgres pool config (any pg.PoolConfig field), optionally carrying
//    the BullMQ-specific `schema` / `skipVersionCheck`
{
  connection: {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    database: 'mydb',
    max: 10,           // pool size
    schema: 'bullmq',  // see "Schema" below
  },
}

// 3) An already-constructed pg.Pool. BullMQ uses it as-is and does NOT close it
//    on close() — you own its lifecycle.
import { Pool } from 'pg';
{ connection: new Pool({ connectionString: 'postgres://…' }) }
```

When BullMQ builds the pool for you (from a string or config), it owns and
closes that pool on `close()`. When you pass your own `pg.Pool`, its lifecycle
is yours.

## Schema

All BullMQ objects live in a single PostgreSQL **schema** (namespace), which
defaults to `bullmq`. This keeps BullMQ's tables cleanly separated from the rest
of your database. Set a custom schema via the config-object form:

```typescript
const opts = {
  connection: {
    connectionString: 'postgres://user:pass@localhost:5432/mydb',
    schema: 'jobs',
  },
};
```

{% hint style="warning" %}
The `schema` option is only honored when BullMQ builds the pool for you (a config
object, or a connection string wrapped as `{ connectionString, schema }`). When
you pass an already-constructed `pg.Pool`, BullMQ cannot change the `search_path`
of connections it did not create. Configure your pool's `search_path` yourself so
it includes BullMQ's schema (`bullmq` by default, or your custom schema),
otherwise unqualified BullMQ queries will not resolve to BullMQ's tables.
{% endhint %}

## Migrations

On the first `waitUntilReady()` of a connection, BullMQ automatically creates its
schema and applies any pending migrations. This is:

- **Idempotent** — running it again is a no-op.
- **Concurrency-safe** — a transaction-scoped advisory lock (namespaced per
  schema) serializes concurrent starters, so many workers or instances booting
  at once still migrate exactly once.

No manual migration step is required. If a database was migrated by a _newer_
BullMQ release and an _older_ instance then connects, it refuses to operate
(`SchemaVersionMismatchError`) rather than risk corruption — upgrade BullMQ to
match. Schema downgrades are not supported.

## How it works

The PostgreSQL backend maps BullMQ's primitives onto PostgreSQL features:

- Jobs and their state live in regular tables inside the schema. State
  transitions run as SQL functions within transactions, giving the same
  atomicity guarantees the Lua scripts provide on Redis.
- The blocking _wait-for-job_ primitive (the Redis `BZPOPMIN`) is implemented
  with `LISTEN`/`NOTIFY`: producers `NOTIFY` a channel and each worker blocks on
  a dedicated `LISTEN` connection until it is woken (or a timeout elapses).
- Each backend uses a `pg.Pool` for regular, short-lived queries plus one
  dedicated, long-lived `LISTEN` connection.

{% hint style="info" %}
The `pg.Pool` size (`max`) bounds how many concurrent queries a single backend
can run; the dedicated `LISTEN` connection is separate and does not consume a
pool slot. Size your server's `max_connections` for the number of concurrent
workers, queues and queue-events you run.
{% endhint %}

## Performance

What to expect relative to the Redis backend:

- **Per-operation latency is comparable** when the database is on a low-latency
  network (same host / same datacenter). Individual operations such as adding a
  job or reading counts take on the order of a millisecond, dominated by the
  network round-trip rather than by the database itself.
- **Job-processing throughput is lower than Redis** — typically in the ballpark
  of **~1.5–2× fewer jobs per second** on comparable hardware. This is inherent,
  not a missing optimization: every job transition is a durable, transactional
  write (WAL + MVCC with `fsync`), whereas Redis processes jobs in memory. You
  are trading some raw throughput for ACID durability and for keeping jobs in
  the same database as your relational data.
- **Bulk enqueues** (`addBulk`, flows) come much closer to Redis, because many
  jobs are inserted per transaction.

The actual numbers depend heavily on your hardware, your PostgreSQL
configuration and where the database lives relative to your workers, so
benchmark with your own workload before committing to capacity figures.

### Indicative numbers

The figures below are a rough illustration measured on an **Apple Silicon laptop
(M-series, ~12 cores)** with PostgreSQL running locally, trivial no-op jobs and
default (durable) settings. They exist only to give an order of magnitude — real
workloads with meaningful payloads and processors will differ, and the Redis
column is the _same machine_ for context, not a formal benchmark.

| Operation                             | PostgreSQL     | Redis (same machine) |
| ------------------------------------- | -------------- | -------------------- |
| `add()`, one at a time                | ~7,000 jobs/s  | ~7,500 jobs/s        |
| `add()`, concurrently (`Promise.all`) | ~15,000 jobs/s | ~38,000 jobs/s       |
| `addBulk()`, batched + concurrent     | ~45,000 jobs/s | ~52,000 jobs/s       |
| Processing, 1 worker (concurrency 1)  | ~2,300 jobs/s  | ~6,000 jobs/s        |
| Processing, concurrency 8–32          | ~11,000 jobs/s | ~18,000 jobs/s       |

A few takeaways:

- Sequential `add()` and batched `addBulk()` are close to Redis — the durable
  write is amortized (per round-trip, or across the batch).
- Concurrent throughput — many parallel adds, or high-concurrency processing —
  is where Redis's in-memory model pulls ahead, leaving PostgreSQL in the
  ~1.5–2× range for processing.

### Tuning tips

- **Keep the database close.** The round-trip latency between your workers and
  PostgreSQL is often the biggest factor — co-locate them (same host / AZ) where
  possible.
- **Size the pool and `max_connections`.** Give each backend enough pool
  connections (`max`) for its concurrency, and make sure the server's
  `max_connections` covers all your workers, queues and queue-events plus their
  dedicated `LISTEN` connections.
- **Consider `synchronous_commit`.** If your durability requirements allow it,
  running PostgreSQL with `synchronous_commit = off` (or `local`) removes the
  per-commit `fsync` wait and can improve processing throughput substantially,
  at the cost of possibly losing the most recent commits on a crash. This is a
  database-level policy decision — weigh it against your durability needs.
- **Let retention do its work.** Use `removeOnComplete` / `removeOnFail` so
  finished jobs don't accumulate; large tables mean more index maintenance and
  vacuum work.

## Feature parity and limitations

The PostgreSQL backend implements the full datastore-agnostic API — queues,
workers, flows, job schedulers, rate limiting, prioritization, delayed jobs,
deduplication, metrics and events — so your application code is identical across
backends.

A few things are inherently Redis-specific and therefore do not apply to
PostgreSQL:

- The Redis-only escape hatches reached through
  [`getBackend()`](connections.md#accessing-the-underlying-redis-client) (the raw
  Redis `client`, `redisVersion`, and similar) exist only on the Redis backend.
- Redis deployment concerns (Redis Cluster, `maxmemory-policy`, etc.) don't
  apply; the relevant knob on PostgreSQL is `max_connections`.
