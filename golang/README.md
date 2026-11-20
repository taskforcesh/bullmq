# BullMQ for Go

A Go port of [BullMQ](https://github.com/taskforcesh/bullmq), the job queue
for Redis and PostgreSQL.

Jobs produced by this package are fully interoperable with the Node.js, Python,
Rust and .NET implementations: on Redis every state transition is executed by
the exact same Lua scripts, which live in `src/commands` at the root of this
repository, and on PostgreSQL by the same SQL, which lives in `src/postgres`.

> `Queue`, `Worker`, `QueueEvents` and `Job` depend only on the `Backend`
> interface (the counterpart of the Node.js `IQueueBackend`), and the root
> package imports no datastore driver. The datastore is chosen with the
> required `Backend` option of `QueueOptions`, `WorkerOptions` and
> `QueueEventsOptions`; the Redis backend lives in the
> [`redisbackend`](./redisbackend) package and the PostgreSQL backend in the
> [`postgresbackend`](./postgresbackend) package. See
> [FEATURE_PARITY.md](./FEATURE_PARITY.md) for what is and is not implemented.

## Requirements

- Go 1.24 or newer
- Redis 6.2 or newer, or PostgreSQL 13 or newer

## Installation

```sh
go get github.com/taskforcesh/bullmq-go
```

## Building from source

The source of truth for this port is the
[`golang/`](https://github.com/taskforcesh/bullmq/tree/master/golang) directory
of the main BullMQ repository. The
[bullmq-go](https://github.com/taskforcesh/bullmq-go) repository is published
automatically on every Go release and already contains the generated Lua
commands and SQL files, so `go get` works out of the box. Contributions should
be made to the main BullMQ repository.

The Lua commands and the SQL files are **not** committed to the `golang`
directory. They are generated from the shared sources so that every port stays
byte-for-byte identical. Before building or testing, run from the repository
root:

```sh
yarn install
yarn generate:raw:scripts
yarn copy:lua:golang
yarn copy:sql:golang
```

This resolves the `--- @include` directives in `src/commands/*.lua` into
`rawScripts/` and copies the result into `golang/redisbackend/commands/`, and
copies the migrations and commands of `src/postgres` into
`golang/postgresbackend/sql/`, where they are embedded into the binary with
`go:embed`.

## Usage

### Adding jobs

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

	backend := redisbackend.New(redisbackend.Options{Addr: "127.0.0.1:6379"})
	queue, err := bullmq.NewQueue("emails", &bullmq.QueueOptions{Backend: backend})
	if err != nil {
		log.Fatal(err)
	}
	defer queue.Close()

	job, err := queue.Add(ctx, "welcome", map[string]string{"to": "me@example.com"}, nil)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("queued job %s", job.ID)
}
```

### Processing jobs

```go
worker, err := bullmq.NewWorker("emails",
	func(ctx context.Context, job *bullmq.Job) (any, error) {
		var payload struct {
			To string `json:"to"`
		}
		if err := job.DecodeData(&payload); err != nil {
			return nil, err
		}

		progress, err := bullmq.NumberProgress(50)
		if err != nil {
			return nil, err
		}
		if err := job.UpdateProgress(ctx, progress); err != nil {
			return nil, err
		}

		return map[string]string{"sent": payload.To}, nil
	},
	&bullmq.WorkerOptions{
		Backend:     backend,
		Concurrency: 8,
	})
if err != nil {
	log.Fatal(err)
}
defer worker.Close()

// Run blocks until ctx is cancelled (processors see the cancellation) or
// Close is called (in-flight jobs are allowed to finish).
if err := worker.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
	log.Fatal(err)
}
```

`Worker.Run` blocks until it is stopped, and the two ways of stopping it treat
in-flight jobs differently:

- **`Worker.Close`** (call it from another goroutine) is the graceful option:
  the worker stops fetching new jobs and waits for in-flight jobs to finish;
  their contexts are not cancelled.
- **Cancelling the context passed to `Run`** is an immediate shutdown: the same
  context is handed to every processor, so in-flight jobs observe the
  cancellation through `ctx.Done()` and should return early.

Cancelling the context only makes `Run` return; it does not release the
worker's connections, so `Close` must still be called afterwards (as
`defer` does above) to avoid leaking connections in a long-lived process. To
shut down gracefully on a signal, call `Close` from the signal handler and run
the worker on a context that is not tied to the signal.

### Job options

```go
queue.Add(ctx, "report", data, &bullmq.JobOptions{
	JobID:            "daily-report",              // idempotency key
	Delay:            bullmq.Int64(60_000),         // milliseconds
	Priority:         bullmq.Int64(1),              // lower runs first
	Attempts:         bullmq.Int64(5),
	Backoff:          &bullmq.Backoff{Type: bullmq.BackoffExponential, Delay: 1000},
	RemoveOnComplete: bullmq.KeepCount(100),
	RemoveOnFail:     bullmq.KeepAge(24 * 60 * 60),
})
```

Return a [`bullmq.UnrecoverableError`](./errors.go) from a processor to fail a
job immediately without consuming the remaining attempts:

```go
return nil, bullmq.NewUnrecoverableError("invalid payload: %v", err)
```

### Worker events

```go
go func() {
	for ev := range worker.Events() {
		switch ev.Type {
		case bullmq.EventCompleted:
			log.Printf("job %s completed", ev.Job.ID)
		case bullmq.EventFailed:
			log.Printf("job %s failed: %v", ev.Job.ID, ev.Err)
		case bullmq.EventError:
			log.Printf("worker error: %v", ev.Err)
		}
	}
}()
```

### Queue-wide events

`QueueEvents` consumes the queue's shared event stream, so it observes every
worker attached to the queue regardless of the language it is written in.

```go
events, err := bullmq.NewQueueEvents("emails", &bullmq.QueueEventsOptions{
	Backend: backend,
})
if err != nil {
	log.Fatal(err)
}
defer events.Close()

go events.Run(ctx)

for ev := range events.Events() {
	log.Printf("%s: job %s", ev.Event, ev.JobID)
}
```

### Rate limiting

```go
&bullmq.WorkerOptions{
	Limiter: &bullmq.RateLimiter{Max: 100, Duration: time.Minute},
}
```

### Redis options

`redisbackend.Options` holds everything Redis-specific: the address,
credentials and pool size, or an existing client, plus the key `Prefix`
(`bull` by default, as in every other port). The backend of a queue built with
`redisbackend.New` is a `*redisbackend.Backend`, which exposes the client and
the key names:

```go
rb := queue.Backend().(*redisbackend.Backend)
waiting, err := rb.Client().LLen(ctx, rb.Keys().Wait()).Result()
```

Pass an existing `redis.UniversalClient` to reuse a connection pool. Blocking reads (`BZPOPMIN` in workers, `XREAD` in `QueueEvents`) never run on the shared pool: when the client is a `*redis.Client`, a dedicated single-connection client is derived from its options with a read timeout suited to blocking calls, and is closed by `Worker.Close`/`QueueEvents.Close`. Other client types (cluster, ring) are used as-is with go-redis's timeout-aware typed blocking commands.

```go
rdb := redis.NewClient(&redis.Options{Addr: "127.0.0.1:6379"})
backend := redisbackend.New(redisbackend.Options{Client: rdb})
queue, err := bullmq.NewQueue("emails", &bullmq.QueueOptions{Backend: backend})
```

Clients supplied this way are not closed by `Queue.Close` or `Worker.Close`.

### PostgreSQL

The [`postgresbackend`](./postgresbackend) package stores queues in
PostgreSQL, with the schema and SQL shared by every BullMQ port, so Go
producers and workers interoperate with Node.js, Python, Elixir and .NET on the
same database:

```go
backend := postgresbackend.New(postgresbackend.Options{
	ConnString: "postgres://user:pass@localhost:5432/app",
})
queue, err := bullmq.NewQueue("emails", &bullmq.QueueOptions{Backend: backend})
```

`postgresbackend.Options` holds the PostgreSQL settings:

- `Schema` namespaces every queue, as the key prefix does on Redis (`bullmq`
  by default). It is created and migrated on first use, with the migration
  ledger every runtime shares; a schema that requires a newer BullMQ major
  version is refused with a `*postgresbackend.SchemaVersionError`.
- `PoolSize` is the size of the query pool (20 by default). Backends built with
  the same `ConnString`, `Schema` and `PoolSize` share one
  [pgxpool](https://pkg.go.dev/github.com/jackc/pgx/v5/pgxpool) pool per
  process; when the last of them closes, the pool closes its idle connections.
- `Pool` is an optional caller-supplied `*pgxpool.Pool`, never closed by
  BullMQ. Its connections must use the schema as their `search_path`
  (`config.ConnConfig.RuntimeParams["search_path"] = "bullmq"`).
- `SkipVersionCheck` skips the PostgreSQL 13 check.

Each worker and `QueueEvents` also holds a dedicated connection, outside the
pool, that `LISTEN`s for notifications, so an idle worker wakes up as soon as a
job is added instead of polling. Its `application_name` is the client name
that `Queue.Workers` looks for. The backend of a queue built with
`postgresbackend.New` is a `*postgresbackend.Backend`, which exposes the pool
and the schema.

## Testing

The tests need a Redis server, and a PostgreSQL database for the PostgreSQL
backend. From the repository root:

```sh
docker compose up -d
cd golang
go test ./...
```

Set `REDIS_ADDR` to point at a different server, and `POSTGRES_URL` to run the
tests against PostgreSQL too (the `postgres` service of `docker-compose.yml`
listens there):

```sh
REDIS_ADDR=127.0.0.1:6380 \
  POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:5432/bullmq_test?sslmode=disable \
  go test ./...
```

Tests that require Redis are skipped automatically when no server is reachable,
and PostgreSQL tests when `POSTGRES_URL` is not set. The PostgreSQL tests
create their own schemas (`bullmq_go_test` and `gotest_pg_*`) in that database
and leave the default `bullmq` schema alone.

The behaviour tests of the root package run once per datastore, as subtests
named after it (for example `TestWorkerProcessesJobs/redis` and
`TestWorkerProcessesJobs/postgres`). The datastores are listed in
`internal/testbackends`: Redis always, and PostgreSQL when `POSTGRES_URL` is
set. Tests specific to a backend live in `redisbackend` and `postgresbackend`.

## License

MIT
