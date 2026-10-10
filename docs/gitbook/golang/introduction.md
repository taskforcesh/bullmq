---
description: BullMQ is available as a native Go package with full context-aware async support.
---

# Introduction

## Installation

Add BullMQ to your project via `go get`:

```bash
go get github.com/taskforcesh/bullmq/golang
```

It is imported in code under the `bullmq` package name:

```go
import bullmq "github.com/taskforcesh/bullmq/golang"
```

BullMQ for Go requires:

- Go 1.24+
- Redis 6.2+

## Get Started

BullMQ uses Go's standard `context.Context` for cancellation throughout. All
operations are non-blocking with respect to other goroutines and designed for
high-throughput concurrent workloads.

### Adding Jobs to a Queue

```go
package main

import (
	"context"
	"log"

	bullmq "github.com/taskforcesh/bullmq/golang"
)

func main() {
	ctx := context.Background()

	queue, err := bullmq.NewQueue("my-queue", &bullmq.QueueOptions{
		Redis: bullmq.RedisOptions{Addr: "127.0.0.1:6379"},
	})
	if err != nil {
		log.Fatal(err)
	}
	defer queue.Close()

	job, err := queue.Add(ctx, "my-job", map[string]string{"foo": "bar"}, nil)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("queued job %s", job.ID)
}
```

### Processing Jobs with a Worker

```go
package main

import (
	"context"
	"errors"
	"log"

	bullmq "github.com/taskforcesh/bullmq/golang"
)

func main() {
	ctx := context.Background()

	worker, err := bullmq.NewWorker("my-queue",
		func(ctx context.Context, job *bullmq.Job) (any, error) {
			log.Printf("Processing job: %s - %s", job.ID, job.Name)
			return map[string]bool{"processed": true}, nil
		},
		&bullmq.WorkerOptions{Redis: bullmq.RedisOptions{Addr: "127.0.0.1:6379"}},
	)
	if err != nil {
		log.Fatal(err)
	}
	defer worker.Close()

	// Run blocks until ctx is cancelled (processors see the cancellation) or
	// Close is called (in-flight jobs are allowed to finish).
	if err := worker.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatal(err)
	}
}
```

There are two ways to stop a worker, and they differ in how in-flight jobs are
treated:

- **Graceful shutdown: `worker.Close()`.** Call it from another goroutine. The
  worker stops fetching new jobs, waits for the jobs already in flight to
  finish (their contexts are not cancelled), and then `Run` returns.
- **Immediate shutdown: cancelling the context passed to `Run`.** The worker
  stops fetching new jobs, but the same context is handed to your processors,
  so they observe the cancellation through `ctx.Done()` and should return
  early. After `Run` returns, call `worker.Close()` to release the worker's
  Redis connections and close its event channel.

```go
// Graceful: let in-flight jobs finish.
sigCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()

go func() {
	<-sigCtx.Done()
	if err := worker.Close(); err != nil {
		log.Printf("close: %v", err)
	}
}()

// Run on a context that is not tied to the signal, so processors are not cancelled.
if err := worker.Run(context.Background()); err != nil && !errors.Is(err, context.Canceled) {
	log.Fatal(err)
}
```

If you pass the signal-aware context directly to `Run` instead, shutdown
becomes immediate and processors must honour `ctx.Done()`.

### Listening to Worker Events

```go
go func() {
	for ev := range worker.Events() {
		switch ev.Type {
		case bullmq.EventCompleted:
			log.Printf("Job %s completed with: %v", ev.Job.ID, ev.Result)
		case bullmq.EventFailed:
			log.Printf("Job %s failed: %v", ev.Job.ID, ev.Err)
		case bullmq.EventActive:
			log.Printf("Job %s started processing", ev.Job.ID)
		}
	}
}()
```

## Concurrency

Configure how many jobs are processed simultaneously:

```go
worker, err := bullmq.NewWorker("my-queue", processor, &bullmq.WorkerOptions{
	Redis:       bullmq.RedisOptions{Addr: "127.0.0.1:6379"},
	Concurrency: 10,
})
```

## Progress Tracking

Report progress from inside the processor:

```go
func(ctx context.Context, job *bullmq.Job) (any, error) {
	for i := 0; i < 100; i++ {
		// Do work...
		progress, err := bullmq.NumberProgress(float64(i))
		if err != nil {
			return nil, err
		}
		if err := job.UpdateProgress(ctx, progress); err != nil {
			return nil, err
		}
	}
	return nil, nil
}
```

## Job Retries with Backoff

```go
queue.Add(ctx, "flaky-job", map[string]any{}, &bullmq.JobOptions{
	Attempts: bullmq.Int64(5),
	Backoff: &bullmq.Backoff{
		Type:  bullmq.BackoffExponential,
		Delay: 1000, // waits 1s, 2s, 4s, 8s between the 5 attempts
	},
})
```

## Connection Configuration

```go
redisOpts := bullmq.RedisOptions{
	Addr:     "redis.example.com:6380",
	Username: "user",
	Password: "password",
	DB:       0,
}

queue, err := bullmq.NewQueue("my-queue", &bullmq.QueueOptions{Redis: redisOpts})

worker, err := bullmq.NewWorker("my-queue", processor, &bullmq.WorkerOptions{Redis: redisOpts})
```

### Sharing a Redis client

Pass an existing `redis.UniversalClient` (from
[go-redis](https://github.com/redis/go-redis)) to reuse a connection pool.
Clients supplied this way are not closed by `Queue.Close` or `Worker.Close`.

```go
import "github.com/redis/go-redis/v9"

rdb := redis.NewClient(&redis.Options{Addr: "127.0.0.1:6379"})

queue, err := bullmq.NewQueue("my-queue", &bullmq.QueueOptions{
	Redis: bullmq.RedisOptions{Client: rdb},
})
```

## Key Differences from Node.js

| Aspect         | Node.js                            | Go                                                 |
| -------------- | ---------------------------------- | -------------------------------------------------- |
| Runtime        | Event loop (single-threaded)       | Goroutines (multi-threaded, OS-scheduled)          |
| Processor      | `async function` or sandboxed file | `func(ctx context.Context, job *Job) (any, error)` |
| Events         | EventEmitter pattern               | Buffered `chan Event` consumed with `range`        |
| Error handling | Exceptions                         | `error` return values                              |
| Cancellation   | AbortSignal                        | `context.Context`                                  |
| Concurrency    | Cooperative (single core)          | True parallelism across all CPU cores              |

## Compatibility

The Go implementation uses the same Lua scripts and Redis data structures as
the Node.js, Python, Rust and .NET versions. This means:

- Jobs added by Node.js workers can be processed by Go workers (and vice versa)
- Queue state is fully shared across all language implementations
- You can mix languages in a single deployment
