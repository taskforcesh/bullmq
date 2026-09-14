# BullMQ for Go

A Go port of [BullMQ](https://github.com/taskforcesh/bullmq), the Redis-backed
job queue.

Jobs produced by this package are fully interoperable with the Node.js, Python,
Rust and .NET implementations: every state transition is executed by the exact
same Lua scripts, which live in `src/commands` at the root of this repository.

> Redis is the only supported backend for now. See
> [FEATURE_PARITY.md](./FEATURE_PARITY.md) for what is and is not implemented.

## Requirements

- Go 1.24 or newer
- Redis 6.2 or newer

## Installation

```sh
go get github.com/taskforcesh/bullmq/golang
```

## Building from this repository

The Lua commands are **not** committed to the `golang` directory. They are
generated from the shared sources so that every port stays byte-for-byte
identical. Before building or testing, run from the repository root:

```sh
yarn install
yarn generate:raw:scripts
yarn copy:lua:golang
```

This resolves the `--- @include` directives in `src/commands/*.lua` into
`rawScripts/` and copies the result into `golang/commands/`, where it is
embedded into the binary with `go:embed`.

## Usage

### Adding jobs

```go
package main

import (
	"context"
	"log"

	bullmq "github.com/taskforcesh/bullmq/golang"
)

func main() {
	ctx := context.Background()

	queue, err := bullmq.NewQueue("emails", &bullmq.QueueOptions{
		Redis: bullmq.RedisOptions{Addr: "127.0.0.1:6379"},
	})
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

		if err := job.UpdateProgress(ctx, bullmq.NumberProgress(50)); err != nil {
			return nil, err
		}

		return map[string]string{"sent": payload.To}, nil
	},
	&bullmq.WorkerOptions{
		Redis:       bullmq.RedisOptions{Addr: "127.0.0.1:6379"},
		Concurrency: 8,
	})
if err != nil {
	log.Fatal(err)
}

// Run blocks until ctx is cancelled or Close is called.
if err := worker.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
	log.Fatal(err)
}
```

`Worker.Run` blocks, so cancel its context (or call `Worker.Close`) to shut it
down gracefully; in-flight jobs are allowed to finish first.

### Job options

```go
queue.Add(ctx, "report", data, &bullmq.JobOptions{
	JobID:            "daily-report",              // idempotency key
	Delay:            60_000,                      // milliseconds
	Priority:         1,                           // lower runs first
	Attempts:         5,
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

`QueueEvents` consumes the shared Redis stream, so it observes every worker
attached to the queue regardless of the language it is written in.

```go
events, err := bullmq.NewQueueEvents("emails", &bullmq.QueueEventsOptions{
	Redis: bullmq.RedisOptions{Addr: "127.0.0.1:6379"},
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

### Sharing a Redis client

Pass an existing `redis.UniversalClient` to reuse a connection pool. Note that a
worker always opens one additional dedicated connection, because it blocks on
`BZPOPMIN` while waiting for jobs.

```go
rdb := redis.NewClient(&redis.Options{Addr: "127.0.0.1:6379"})
queue, err := bullmq.NewQueue("emails", &bullmq.QueueOptions{
	Redis: bullmq.RedisOptions{Client: rdb},
})
```

Clients supplied this way are not closed by `Queue.Close` or `Worker.Close`.

## Testing

The tests need a Redis server. From the repository root:

```sh
docker compose up -d
cd golang
go test ./...
```

Set `REDIS_ADDR` to point at a different server:

```sh
REDIS_ADDR=127.0.0.1:6380 go test ./...
```

Tests that require Redis are skipped automatically when no server is reachable.

## License

MIT
