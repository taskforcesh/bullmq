---
description: BullMQ is available as a native Go package, running on Redis™ or PostgreSQL.
---

# Introduction

BullMQ for Go is the official Go port of BullMQ. It runs the exact same Lua
scripts (Redis™) and SQL (PostgreSQL) as every other BullMQ SDK, so a queue
produced by the Node.js library can be consumed by a Go worker and the other
way round.

The module has three packages:

- `bullmq`: `Queue`, `Worker`, `Job`, `QueueEvents`, `FlowProducer` and job
  schedulers. It only depends on a `Backend` interface and imports no
  datastore driver.
- `redisbackend`: the Redis backend, built on
  [go-redis](https://github.com/redis/go-redis) v9.
- `postgresbackend`: the PostgreSQL backend, built on
  [pgx](https://github.com/jackc/pgx) v5.

## Installation

```bash
go get github.com/taskforcesh/bullmq-go
```

BullMQ for Go requires:

- Go 1.24 or newer
- Redis 6.2 or newer, **or** PostgreSQL 13 or newer

Both backends ship in the module, but a program only links the driver of the
backend package it imports.

## Get started

BullMQ for Go uses `context.Context` for cancellation and goroutines for
concurrency: a worker processes each job on its own goroutine, and a `Queue`
can be shared by any number of goroutines.

### Adding jobs to a queue

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

	job, err := queue.Add(ctx, "welcome", map[string]string{"to": "ada@example.com"}, &bullmq.JobOptions{
		Attempts: bullmq.Int64(3),
		Backoff:  &bullmq.Backoff{Type: bullmq.BackoffExponential, Delay: 1000},
	})
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("added job %s", job.ID)
}
```

The `Backend` option is required: it is a factory such as the one
`redisbackend.New` or `postgresbackend.New` returns. Job data is encoded with
`encoding/json`.

### Processing jobs

A worker hands each job to a processor, a
`func(ctx context.Context, job *bullmq.Job) (any, error)`. The value it
returns is stored as the job's return value, and an error fails the attempt
(the job is retried while attempts remain):

```go
package main

import (
	"context"
	"errors"
	"log"
	"os"
	"os/signal"
	"syscall"

	bullmq "github.com/taskforcesh/bullmq-go"
	"github.com/taskforcesh/bullmq-go/redisbackend"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	backend := redisbackend.New(redisbackend.Options{Addr: "127.0.0.1:6379"})
	worker, err := bullmq.NewWorker("emails", func(ctx context.Context, job *bullmq.Job) (any, error) {
		var payload struct {
			To string `json:"to"`
		}
		if err := job.DecodeData(&payload); err != nil {
			return nil, bullmq.NewUnrecoverableError("invalid payload: %v", err)
		}
		log.Printf("sending a welcome email to %s", payload.To)
		return map[string]bool{"sent": true}, nil
	}, &bullmq.WorkerOptions{Backend: backend, Concurrency: 10})
	if err != nil {
		log.Fatal(err)
	}
	defer worker.Close()

	// Run blocks until ctx is cancelled or Close is called.
	if err := worker.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatal(err)
	}
}
```

Cancelling the context of `Run`, as Ctrl+C does here, stops the worker
immediately: the jobs in flight see their context cancelled and are recovered
later by the stalled check. `worker.Close()` stops it gracefully, waiting for
them. See [Workers](workers.md#shutting-down).

### Listening to events

A worker publishes the lifecycle of its jobs on `worker.Events()`, and
`QueueEvents` reads the events of every worker of the queue, in any language:

```go
go func() {
	for ev := range worker.Events() {
		switch ev.Type {
		case bullmq.EventCompleted:
			log.Printf("job %s completed with %v", ev.Job.ID, ev.Result)
		case bullmq.EventFailed:
			log.Printf("job %s failed: %v", ev.Job.ID, ev.Err)
		}
	}
}()
```

See [Workers](workers.md#events) and [Queue Events](queue-events.md).

### Using PostgreSQL

Only the backend changes:

```go
backend := postgresbackend.New(postgresbackend.Options{
	ConnString: os.Getenv("DATABASE_URL"), // e.g. postgres://localhost:5432/app
})
queue, err := bullmq.NewQueue("emails", &bullmq.QueueOptions{Backend: backend})
if err != nil {
	log.Fatal(err)
}
defer queue.Close()
```

The `bullmq` schema is created and migrated by the first operation. See
[PostgreSQL](postgresql.md).

## Connection configuration

`redisbackend.Options` holds the Redis settings: `Addr` (`127.0.0.1:6379` by
default), `Username`, `Password`, `DB`, `PoolSize`, and the key `Prefix`
(`bull` by default, as in every other SDK):

```go
backend := redisbackend.New(redisbackend.Options{
	Addr:     "redis.example.com:6379",
	Username: "app",
	Password: os.Getenv("REDIS_PASSWORD"),
	Prefix:   "myapp",
})
```

Each queue, worker and `QueueEvents` built from such a backend opens its own
connections. To share a connection pool, or to set what `Options` doesn't
expose such as TLS, pass an existing go-redis client. BullMQ never closes a
client it didn't create:

```go
rdb := redis.NewClient(&redis.Options{
	Addr:      "redis.example.com:6380",
	Password:  os.Getenv("REDIS_PASSWORD"),
	TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12},
})
defer rdb.Close()

backend := redisbackend.New(redisbackend.Options{Client: rdb})
```

Workers and `QueueEvents` still run their blocking reads on a dedicated
connection, derived from the client's options, so that a blocked read never
holds a connection of the shared pool.

## Key differences from Node.js

| Aspect         | Node.js                                    | Go                                                                                              |
| -------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Datastore      | `connection` option (or a backend factory) | Required `Backend` option: `redisbackend.New(...)` or `postgresbackend.New(...)`                |
| Processor      | `async` function or sandboxed file         | `func(ctx context.Context, job *bullmq.Job) (any, error)`, run on goroutines                    |
| Errors         | Thrown exceptions                          | Returned `error` values; panics are recovered and fail the attempt                              |
| Events         | `EventEmitter`                             | A buffered `chan bullmq.Event` that drops events when full, or a synchronous `OnEvent` callback |
| Cancellation   | `AbortSignal`                              | The processor's `context.Context`; `context.Cause` tells why                                    |
| Lost job locks | Reported; the processor keeps running      | Reported, and the job's context is cancelled with `bullmq.ErrLockLost`                          |
| Concurrency    | Cooperative, on one thread                 | Parallel, on every CPU core                                                                     |
| Options        | `undefined` means unset                    | Pointer fields (`bullmq.Int64(0)`) tell an explicit zero from unset                             |

## Interoperability

The Go SDK uses the same Lua scripts, SQL, key names and data layout as the
Node.js, Python, Elixir, PHP, Rust and .NET SDKs. As long as both sides use
the same Redis prefix, or the same PostgreSQL database and schema:

- jobs added in any language can be processed by Go workers, and the other way
  round; data and return values are JSON;
- retries, backoff, priorities, removal policies, flows, deduplication and
  rate limits behave the same whichever runtime processes the job (a custom
  backoff type needs a `BackoffStrategy` on Go workers);
- `QueueEvents` in any language sees the events of Go workers;
- job schedulers created in one language are advanced by the workers of the
  others.

## Testing

Run integration tests against a real Redis or PostgreSQL server, with a
unique queue name per test, and remove the queue afterwards:

```go
func TestWelcomeEmail(t *testing.T) {
	ctx := context.Background()
	backend := redisbackend.New(redisbackend.Options{Addr: "127.0.0.1:6379"})
	name := fmt.Sprintf("emails-test-%d", time.Now().UnixNano())

	queue, err := bullmq.NewQueue(name, &bullmq.QueueOptions{Backend: backend})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = queue.Obliterate(context.Background(), true, 0)
		_ = queue.Close()
	})

	worker, err := bullmq.NewWorker(name, sendWelcome, &bullmq.WorkerOptions{Backend: backend})
	if err != nil {
		t.Fatal(err)
	}
	go func() { _ = worker.Run(ctx) }()
	t.Cleanup(func() { _ = worker.Close() })

	job, err := queue.Add(ctx, "welcome", map[string]string{"to": "ada@example.com"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		state, err := queue.JobState(ctx, job.ID)
		if err != nil {
			t.Fatal(err)
		}
		if state == bullmq.StateCompleted {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("job is %s, want completed", state)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
```

To unit test a processor on its own, call it with a `&bullmq.Job{Data: ...}`
built in the test. Methods that reach the datastore, such as `UpdateProgress`,
return `bullmq.ErrNoContext` on such a job.

## Limitations

- No telemetry (OpenTelemetry) integration yet.
- Redis Cluster and Sentinel are untested: a cluster or failover client can be
  passed as `Client`, but the test suite only runs against a standalone
  server.
- On PostgreSQL, `QueueEvents` can miss events when several jobs finish at
  once, in every SDK, until
  [#5183](https://github.com/taskforcesh/bullmq/issues/5183) is fixed.
- Job schedulers with a time zone read the system's time zone database; in
  containers without one, add `import _ "time/tzdata"` to the program.
- Legacy repeatable jobs and sandboxed processors aren't supported.

The [feature parity table](https://github.com/taskforcesh/bullmq/blob/master/golang/FEATURE_PARITY.md)
lists what is and isn't implemented, and the
[Go README](https://github.com/taskforcesh/bullmq/tree/master/golang) is the
complete guide, including the changes from the pre-release API.
