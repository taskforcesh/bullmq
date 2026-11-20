---
description: Running BullMQ for Go on PostgreSQL - options, migrations, connections and known issues.
---

# PostgreSQL

The `postgresbackend` package runs the same `Queue`, `Worker`, `QueueEvents`,
`FlowProducer` and job scheduler API on PostgreSQL 13 or newer. It uses the
schema and SQL that the Node.js, Python, Elixir and .NET SDKs use, so they all
work on the same queues. Read the [PostgreSQL backend guide](../guide/postgresql.md)
for how the backend works and how it performs.

```go
backend := postgresbackend.New(postgresbackend.Options{
	ConnString: os.Getenv("DATABASE_URL"), // e.g. postgres://localhost:5432/app
})

queue, err := bullmq.NewQueue("emails", &bullmq.QueueOptions{Backend: backend})
if err != nil {
	log.Fatal(err)
}
defer queue.Close()

worker, err := bullmq.NewWorker("emails", sendWelcome, &bullmq.WorkerOptions{
	Backend:     backend,
	Concurrency: 10,
})
if err != nil {
	log.Fatal(err)
}
defer worker.Close()
```

## Options

| Option             | Default  | Meaning                                                                                                                                                                        |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ConnString`       |          | A [pgx connection string](https://pkg.go.dev/github.com/jackc/pgx/v5/pgxpool#ParseConfig), URL or keyword/value. Required unless `Pool` is set                                 |
| `Schema`           | `bullmq` | The schema the queues live in, as the key prefix on Redis                                                                                                                      |
| `PoolSize`         | 20       | Size of the query pool, unless the connection string sets `pool_max_conns`. Connections open on demand (`pool_min_conns` / `pool_min_idle_conns` are ignored for shared pools) |
| `Pool`             |          | A `*pgxpool.Pool` to use instead of `ConnString`; BullMQ never closes it. Its `OnNotification`/`OnNotice` callbacks aren't used on BullMQ's `LISTEN` connections               |
| `SkipVersionCheck` | `false`  | Skip the PostgreSQL 13 check                                                                                                                                                   |

## Migrations

The first operation of the process creates or migrates the schema, in one
transaction under the advisory lock every SDK uses, and records the
migrations in the schema's `migration` ledger, which the other SDKs share.
Every new backend checks the ledger, and a schema that requires a newer
BullMQ major version is refused with a `*postgresbackend.SchemaVersionError`:

```go
var versionErr *postgresbackend.SchemaVersionError
if _, err := queue.Add(ctx, "welcome", data, nil); errors.As(err, &versionErr) {
	log.Fatalf("upgrade bullmq-go: schema %s requires major version %d", versionErr.Schema, versionErr.Required)
}
```

{% hint style="info" %}
The Node.js backend only migrates when `runMigrations` is called, while the
Go backend migrates on first use, as the .NET one does. A schema migrated by
any SDK can be used by the others. Schemas migrated by early .NET releases,
which used a `bullmq_migration` ledger, are adopted.
{% endhint %}

## Connections

- Queries run on a [pgxpool](https://pkg.go.dev/github.com/jackc/pgx/v5/pgxpool)
  pool. Backends built with the same `ConnString`, `Schema` and `PoolSize`
  share one pool per process, which closes its idle connections when the last
  of them closes.
- Each worker and `QueueEvents` also holds one dedicated connection, outside
  the pool, that `LISTEN`s for new jobs or events, so an idle worker wakes up
  as soon as a job is added instead of polling. Size the server's
  `max_connections` for the pool plus one connection per worker and listener.
- The `application_name` of a worker's dedicated connection is `<queue>` or
  `<queue>:w:<worker name>`, as in Node.js; `queue.Workers` lists them.

To use your own pool, set its `search_path` to the schema, since BullMQ
doesn't change the session of connections it doesn't own:

```go
config, err := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))
if err != nil {
	log.Fatal(err)
}
config.ConnConfig.RuntimeParams["search_path"] = "bullmq"
pool, err := pgxpool.NewWithConfig(ctx, config)
if err != nil {
	log.Fatal(err)
}
defer pool.Close()

backend := postgresbackend.New(postgresbackend.Options{Pool: pool})
```

The backend of a queue built with `postgresbackend.New` is a
`*postgresbackend.Backend`, which exposes `Pool()` and `Schema()`.

## Differences from Redis

- Pausing a queue sets a flag: the waiting jobs stay waiting and are counted
  as waiting.
- Prioritized jobs are waiting jobs with a priority, reported as
  `prioritized`.
- Children are keyed `<queue>:<id>` instead of `<prefix>:<queue>:<id>`.
- Event ids are numbers instead of Redis stream ids.
- Deadlocks (`40P01`), serialization failures and connection errors are
  transient: a worker reports a failed fetch as an `EventError` and fetches
  again 5 s later, and retries finishing a job.

## Known issues

These issues are in the SQL every SDK shares, and are tracked upstream:

- [#5160](https://github.com/taskforcesh/bullmq/issues/5160): a keep-count of
  0 deletes every finished job of the queue. Go workers avoid it, removing
  only the finished job for `bullmq.RemoveAll()` and `KeepCount(0)`, but jobs
  finished by other SDKs on the same schema are still affected.
- [#5183](https://github.com/taskforcesh/bullmq/issues/5183): `QueueEvents`
  can miss events when several jobs finish at once. See
  [Queue Events](queue-events.md).
- [#5184](https://github.com/taskforcesh/bullmq/issues/5184): .NET workers
  name their connections differently, so `queue.Workers` doesn't list them.
- [#5185](https://github.com/taskforcesh/bullmq/issues/5185): fetching can
  deadlock while promoting delayed jobs under concurrent workers. A Go worker
  reports it and fetches again.
