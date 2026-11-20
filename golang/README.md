# BullMQ for Go

The official Go port of [BullMQ](https://bullmq.io), the job queue for Redis
and PostgreSQL.

Go producers and workers share queues with the Node.js, Python, Elixir, PHP,
Rust and .NET ports. On Redis every state transition runs the same Lua scripts
(`src/commands` at the root of this repository), and on PostgreSQL the same
SQL (`src/postgres`), so a job added from Node.js can be processed in Go and
the other way round.

The module has three packages:

- [`bullmq`](https://pkg.go.dev/github.com/taskforcesh/bullmq-go): `Queue`,
  `Worker`, `Job`, `QueueEvents`, `FlowProducer` and job schedulers. It only
  depends on the `Backend` interface and imports no datastore driver.
- [`redisbackend`](./redisbackend): the Redis backend, built on
  [go-redis](https://github.com/redis/go-redis) v9.
- [`postgresbackend`](./postgresbackend): the PostgreSQL backend, built on
  [pgx](https://github.com/jackc/pgx) v5.

[FEATURE_PARITY.md](./FEATURE_PARITY.md) lists what is supported and what
isn't yet. The [BullMQ documentation](https://docs.bullmq.io) explains the
concepts (queues, workers, flows, job schedulers, ...) that this guide refers
to.

## Contents

- [Requirements](#requirements) and [installation](#installation)
- [Quick start](#quick-start): [Redis](#redis) and [PostgreSQL](#postgresql)
- [Connecting to Redis](#connecting-to-redis)
- [Adding jobs](#adding-jobs): [delayed and prioritized jobs](#delayed-and-prioritized-jobs), [deduplication](#deduplication)
- [Workers](#workers): [processors](#processors), [concurrency](#concurrency), [events](#worker-events), [pausing](#pausing-a-worker), [shutting down](#shutting-down), [cancellation](#cancelling-jobs), [retries](#retries-and-backoff), [stalled jobs](#stalled-jobs-and-locks), [rate limiting](#rate-limiting)
- [Queue operations](#queue-operations)
- [QueueEvents](#queueevents)
- [Flows](#flows)
- [Job schedulers](#job-schedulers)
- [The PostgreSQL backend](#the-postgresql-backend)
- [Interoperability](#interoperability)
- [Testing your code](#testing-your-code)
- [Known limitations](#known-limitations)
- [Upgrading from the pre-release API](#upgrading-from-the-pre-release-api)
- [Contributing](#contributing)

## Requirements

- Go 1.24 or newer.
- Redis 6.2 or newer, or PostgreSQL 13 or newer.

## Installation

```sh
go get github.com/taskforcesh/bullmq-go
```

Both backends ship in this module, but a program only links the driver of the
backend package it imports.

## Quick start

### Redis

This program adds a job and processes it. Producers and workers usually run in
different processes; they only need to agree on the queue name and the
backend settings.

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

type Email struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	backend := redisbackend.New(redisbackend.Options{Addr: "127.0.0.1:6379"})

	queue, err := bullmq.NewQueue("emails", &bullmq.QueueOptions{Backend: backend})
	if err != nil {
		log.Fatal(err)
	}
	defer queue.Close()

	job, err := queue.Add(ctx, "welcome", Email{To: "ada@example.com", Subject: "Welcome!"}, nil)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("added job %s", job.ID)

	worker, err := bullmq.NewWorker("emails", func(ctx context.Context, job *bullmq.Job) (any, error) {
		var email Email
		if err := job.DecodeData(&email); err != nil {
			return nil, bullmq.NewUnrecoverableError("invalid payload: %v", err)
		}
		log.Printf("sending %q to %s", email.Subject, email.To)
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

`Backend` is required in `QueueOptions`, `WorkerOptions`,
`QueueEventsOptions` and `FlowProducerOptions`; without it the constructors
return a `*bullmq.ConfigError`. Cancelling the context of `Run`, as Ctrl+C
does here, is an immediate shutdown; see [Shutting down](#shutting-down) for
the graceful one.

### PostgreSQL

Only the backend changes:

```go
package main

import (
	"context"
	"log"
	"os"

	bullmq "github.com/taskforcesh/bullmq-go"
	"github.com/taskforcesh/bullmq-go/postgresbackend"
)

func main() {
	ctx := context.Background()

	backend := postgresbackend.New(postgresbackend.Options{
		ConnString: os.Getenv("DATABASE_URL"), // e.g. postgres://localhost:5432/app
	})

	queue, err := bullmq.NewQueue("emails", &bullmq.QueueOptions{Backend: backend})
	if err != nil {
		log.Fatal(err)
	}
	defer queue.Close()

	if _, err := queue.Add(ctx, "welcome", map[string]string{"to": "ada@example.com"}, nil); err != nil {
		log.Fatal(err)
	}
}
```

The `bullmq` schema is created and migrated by the first operation. See
[The PostgreSQL backend](#the-postgresql-backend) for the options.

## Connecting to Redis

`redisbackend.Options` holds everything Redis-specific:

| Field                                    | Default          | Meaning                                                                                            |
| ---------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| `Addr`                                   | `127.0.0.1:6379` | Server address                                                                                     |
| `Username`, `Password`, `DB`, `PoolSize` |                  | Passed to go-redis                                                                                 |
| `Prefix`                                 | `bull`           | Prefix of every key, as in the other ports. Producers and workers of a queue must use the same one |
| `Client`                                 |                  | An existing `redis.UniversalClient` to use instead of the fields above; BullMQ never closes it     |

Each queue, worker and `QueueEvents` built from `redisbackend.New` with an
`Addr` opens its own client. Pass a `Client` to share one connection pool, or
to configure what `Options` doesn't expose, such as TLS:

```go
rdb := redis.NewClient(&redis.Options{
	Addr:      "redis.example.com:6380",
	Password:  os.Getenv("REDIS_PASSWORD"),
	TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12},
})
defer rdb.Close()

backend := redisbackend.New(redisbackend.Options{Client: rdb})
queue, err := bullmq.NewQueue("emails", &bullmq.QueueOptions{Backend: backend})
if err != nil {
	log.Fatal(err)
}
defer queue.Close()
```

Blocking reads (`BZPOPMIN` in workers, `XREAD` in `QueueEvents`) never run on
the shared pool. When the client is a `*redis.Client`, a worker derives a
dedicated single-connection client from its options (address, credentials,
TLS, dialer...) and closes it on `Close`. An idle worker blocks on it for the
whole `DrainDelay` (5 s by default), and stopping the worker interrupts the
read by closing that connection, as Node's `disconnectBlocking` does. Other
client types (cluster, ring) are used as they are, with blocking calls of at
most a second; see [Known limitations](#known-limitations).

The backend of a queue built with `redisbackend.New` is a
`*redisbackend.Backend`, which exposes the client and the key names:

```go
rb := queue.Backend().(*redisbackend.Backend)
waiting, err := rb.Client().LLen(ctx, rb.Keys().Wait()).Result()
if err != nil {
	log.Fatal(err)
}
log.Printf("%d jobs in the wait list", waiting)
```

## Adding jobs

```go
job, err := queue.Add(ctx, "welcome", Email{To: "ada@example.com"}, &bullmq.JobOptions{
	Attempts:         bullmq.Int64(3),
	Backoff:          &bullmq.Backoff{Type: bullmq.BackoffExponential, Delay: 1000},
	RemoveOnComplete: bullmq.KeepCount(1000),
	RemoveOnFail:     bullmq.KeepAge(7 * 24 * 60 * 60),
})
if err != nil {
	log.Fatal(err)
}
log.Printf("added job %s", job.ID)
```

The data is encoded with `encoding/json`; a processor decodes it with
`job.DecodeData(&v)`. Several options are pointers so that an explicit zero
can override a queue default; `bullmq.Int64` and `bullmq.Bool` build them.

| Option                             | Meaning                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JobID`                            | Custom id. Adding a job whose id already exists does nothing and returns that id. Custom ids can't be integers nor contain `:`                                       |
| `Delay`                            | Milliseconds before the job can be processed                                                                                                                         |
| `Priority`                         | 1 (highest) to 2,097,151; 0 means no priority                                                                                                                        |
| `LIFO`                             | Add the job to the front of the wait list                                                                                                                            |
| `Attempts`, `Backoff`              | See [Retries and backoff](#retries-and-backoff)                                                                                                                      |
| `RemoveOnComplete`, `RemoveOnFail` | `bullmq.RemoveAll()`, `bullmq.KeepCount(n)`, `bullmq.KeepAge(seconds)`, or a `RemoveOnFinish` with `Count`, `Age` and `Limit`. By default every finished job is kept |
| `KeepLogs`                         | How many log rows to keep                                                                                                                                            |
| `SizeLimit`                        | Reject jobs whose encoded data is larger than this many bytes                                                                                                        |
| `StackTraceLimit`                  | How many failure traces to keep; every one by default                                                                                                                |
| `Deduplication`                    | See [Deduplication](#deduplication)                                                                                                                                  |
| `Parent` and the failure options   | See [Flows](#flows)                                                                                                                                                  |

`QueueOptions.DefaultJobOptions` applies to every job of a `Queue`, and
`WorkerOptions.RemoveOnComplete` / `RemoveOnFail` are the defaults of the jobs
a worker finishes. `AddBulk` adds several jobs in one round trip (a single
`MULTI`/`EXEC` on Redis, a single statement on PostgreSQL):

```go
jobs, err := queue.AddBulk(ctx, []bullmq.JobSpec{
	{Name: "welcome", Data: Email{To: "ada@example.com"}},
	{Name: "welcome", Data: Email{To: "grace@example.com"}, Opts: &bullmq.JobOptions{Priority: bullmq.Int64(1)}},
})
if err != nil {
	log.Fatal(err)
}
log.Printf("added %d jobs", len(jobs))
```

### Delayed and prioritized jobs

A delayed job waits in the `delayed` state until it is due. Prioritized jobs
are fetched by increasing `Priority` value, after the jobs without a
priority, as in the [prioritized jobs
guide](https://docs.bullmq.io/guide/jobs/prioritized).

```go
// Processed in about an hour.
_, err := queue.Add(ctx, "reminder", data, &bullmq.JobOptions{Delay: bullmq.Int64(time.Hour.Milliseconds())})
if err != nil {
	log.Fatal(err)
}

// Processed before the jobs with a larger priority value.
urgent, err := queue.Add(ctx, "report", data, &bullmq.JobOptions{Priority: bullmq.Int64(1)})
if err != nil {
	log.Fatal(err)
}

// Change your mind later.
if err := urgent.ChangePriority(ctx, 10, false); err != nil {
	log.Fatal(err)
}
```

`Job.ChangeDelay` reschedules a delayed job, `Job.Promote` and
`Queue.PromoteJobs` make delayed jobs ready right away. A processor can move
its own job back to the delayed set and return `bullmq.ErrDelayed`, which
doesn't use up an attempt:

```go
func poll(ctx context.Context, job *bullmq.Job) (any, error) {
	ready, err := checkStatus(ctx, job)
	if err != nil {
		return nil, err
	}
	if !ready {
		if err := job.MoveToDelayed(ctx, 30*time.Second); err != nil {
			return nil, err
		}
		return nil, bullmq.ErrDelayed
	}
	return "ready", nil
}
```

### Deduplication

While a deduplication id is alive, adding another job with the same id
returns the existing job's id instead of adding a job, and `QueueEvents`
reports a `deduplicated` event. The three modes of the
[deduplication guide](https://docs.bullmq.io/guide/jobs/deduplication) map to
`DeduplicationOptions` like this:

```go
// Simple: until the first job finishes (completes, or fails for good).
_, err := queue.Add(ctx, "sync", data, &bullmq.JobOptions{
	Deduplication: &bullmq.DeduplicationOptions{ID: "sync-account-42"},
})
if err != nil {
	log.Fatal(err)
}

// Throttle: for 10 seconds after the first job was added.
_, err = queue.Add(ctx, "sync", data, &bullmq.JobOptions{
	Deduplication: &bullmq.DeduplicationOptions{ID: "sync-account-42", TTL: 10_000},
})
if err != nil {
	log.Fatal(err)
}

// Debounce: keep only the last job added within 5 seconds of the previous
// one. Replace only swaps a job that is still delayed.
_, err = queue.Add(ctx, "sync", data, &bullmq.JobOptions{
	Delay:         bullmq.Int64(5_000),
	Deduplication: &bullmq.DeduplicationOptions{ID: "sync-account-42", TTL: 5_000, Extend: true, Replace: true},
})
if err != nil {
	log.Fatal(err)
}
```

The `Job` returned for a duplicate carries the existing job's `ID`, but the
data and options of the call; read it back with `Queue.Job` to see what is
stored. Deduplication can't be combined with `Parent`.

## Workers

### Processors

A worker hands every job to a `bullmq.Processor`, a
`func(ctx context.Context, job *bullmq.Job) (any, error)`:

```go
func sendWelcome(ctx context.Context, job *bullmq.Job) (any, error) {
	var email Email
	if err := job.DecodeData(&email); err != nil {
		// A malformed payload never succeeds: don't retry it.
		return nil, bullmq.NewUnrecoverableError("invalid payload: %v", err)
	}
	if err := mailer.Send(ctx, email); err != nil {
		return nil, err // retried while attempts remain
	}
	return map[string]string{"status": "sent"}, nil
}
```

- The returned value is encoded with `encoding/json` and stored as the job's
  return value (`job.ReturnValue`, `job.DecodeReturnValue`). A value that
  can't be encoded fails the job.
- A returned error fails the attempt; the job is retried while attempts
  remain. `bullmq.NewUnrecoverableError`, or calling `job.Discard()` before
  returning, fails it for good.
- A panic is recovered and fails the attempt, with the stack as its trace.
- `bullmq.ErrDelayed`, `bullmq.ErrWaitingChildren` and
  `bullmq.ErrRateLimited` tell the worker that the processor moved the job
  itself; see [delayed jobs](#delayed-and-prioritized-jobs),
  [flows](#flows) and [rate limiting](#rate-limiting).
- `ctx` is cancelled when the worker stops immediately, loses the job's lock
  or cancels the job; see [Shutting down](#shutting-down) and
  [Cancelling jobs](#cancelling-jobs).

A processor reports progress and writes job logs, which every port and
dashboard can read:

```go
progress, err := bullmq.NumberProgress(50)
if err != nil {
	return err
}
if err := job.UpdateProgress(ctx, progress); err != nil {
	return err
}
if _, err := job.Log(ctx, "half way there"); err != nil {
	return err
}
```

`bullmq.JSONProgress(v)` reports a structured value instead of a number.

### Concurrency

```go
worker, err := bullmq.NewWorker("emails", sendWelcome, &bullmq.WorkerOptions{
	Backend:     backend,
	Name:        "mailer-1",
	Concurrency: 50,
})
if err != nil {
	log.Fatal(err)
}
defer worker.Close()
```

`Concurrency` (1 by default) is the number of jobs a worker processes at the
same time, each on its own goroutine. Every processing slot finishes its job
and fetches the next one in the same backend call, as the Node.js worker
does, so a busy worker needs about one round trip per job whatever its
concurrency. The worker only blocks on the datastore once the queue looks
drained. Run as many workers as you like, in one process or many; to cap the
number of jobs processed at once across all of them, use
`Queue.SetGlobalConcurrency`.

`Name` is stored on every job the worker processes and appears in the
connection name that `Queue.Workers` lists.

### Worker events

`Worker.Events` delivers lifecycle events on a buffered channel, which is
closed by `Close`:

```go
go func() {
	for ev := range worker.Events() {
		switch ev.Type {
		case bullmq.EventCompleted:
			log.Printf("job %s completed with %v", ev.Job.ID, ev.Result)
		case bullmq.EventFailed:
			log.Printf("job %s failed: %v", ev.Job.ID, ev.Err)
		case bullmq.EventLockRenewalFailed:
			log.Printf("lost the locks of jobs %v", ev.JobIDs)
		case bullmq.EventError:
			log.Printf("worker error: %v", ev.Err)
		}
	}
}()
```

| Event                    | When                                                                | Fields                         |
| ------------------------ | ------------------------------------------------------------------- | ------------------------------ |
| `EventActive`            | A job starts                                                        | `Job`                          |
| `EventProgress`          | `Job.UpdateProgress` succeeded                                      | `Job`, `Result` (a `Progress`) |
| `EventCompleted`         | A job completed                                                     | `Job`, `Result`                |
| `EventFailed`            | An attempt failed, whether the job is retried or not                | `Job`, `Err`                   |
| `EventStalled`           | This worker's stalled check moved a job back to wait (or failed it) | `Job` (only its `ID` is set)   |
| `EventLocksRenewed`      | Job locks were renewed                                              | `JobIDs`                       |
| `EventLockRenewalFailed` | Job locks could not be renewed; those jobs' contexts are cancelled  | `JobIDs`                       |
| `EventDrained`           | A fetch found no job to process, once until a job is fetched again  | none                           |
| `EventError`             | A background error, such as a lost connection                       | `Err`                          |
| `EventClosed`            | `Run` is returning                                                  | none                           |

The channel never blocks the worker: when its buffer (256 events) is full,
events are dropped and `Worker.DroppedEvents` counts them. To see every event,
for example to keep metrics, set `WorkerOptions.OnEvent`. It is called
synchronously on the worker's goroutines, so it must be quick and safe for
concurrent use, and it must not call `Close` (start a goroutine for that).
`WorkerOptions.OnError` receives the same errors as `EventError`, each on its
own goroutine.

### Pausing a worker

```go
// Stop fetching and wait for the jobs in flight, like Node's pause().
if err := worker.Pause(ctx, false); err != nil {
	log.Fatal(err)
}
// ...
worker.Resume()
```

With `doNotWaitActive` set to `true`, `Pause` returns at once; a processor
pausing its own worker must do so. `Pause` may also be called from `OnEvent`,
for example to pause once the queue is drained: from `EventDrained`,
`EventCompleted` or `EventFailed` it waits for the other jobs only, and a job
fetched in the meantime is put back in the wait list rather than started.
`Close` releases a pending `Pause` with `bullmq.ErrWorkerClosed`.

```go
var worker *bullmq.Worker
worker, err := bullmq.NewWorker("emails", sendWelcome, &bullmq.WorkerOptions{
	Backend: backend,
	OnEvent: func(ev bullmq.Event) {
		if ev.Type == bullmq.EventDrained {
			_ = worker.Pause(context.Background(), false)
		}
	},
})
if err != nil {
	log.Fatal(err)
}
```

`Worker.Pause` only affects one worker. `Queue.Pause` pauses the queue for
every worker, in any language.

### Shutting down

`Worker.Run` blocks until the worker is stopped, and the two ways of stopping
it treat in-flight jobs differently:

- **`Worker.Close` is graceful.** The worker stops fetching, waits for the
  jobs in flight to finish (their contexts aren't cancelled), and releases its
  connections.
- **Cancelling the context of `Run` is immediate.** That context is the parent
  of every job's context, so processors see the cancellation and should
  return. Whatever they return then isn't recorded: the jobs stay active,
  without using up an attempt, until their lock expires (`LockDuration`, 30 s
  by default) and the stalled check of a running worker, which runs every
  `StalledInterval` (30 s by default), moves them back to wait, as in
  Node.js. A job recovered this way counts as stalled, and a job that stalls
  more than `MaxStalledCount` times (1 by default) fails. `Run` returns once
  the processors have returned; `Close` must still be called to release the
  connections.

`Run` returns `context.Canceled` after `Close`, and the context's error when
its context is cancelled. Combining both gives in-flight jobs a grace period
on SIGTERM:

```go
func runUntilSignal(worker *bullmq.Worker) error {
	sigCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Processors run under runCtx, which is only cancelled if they
	// overrun the grace period.
	runCtx, cancelRun := context.WithCancel(context.Background())
	defer cancelRun()

	go func() {
		<-sigCtx.Done()
		timer := time.AfterFunc(30*time.Second, cancelRun)
		defer timer.Stop()
		_ = worker.Close()
	}()

	err := worker.Run(runCtx)
	// Close may be called again: it waits for the call above to finish.
	if cerr := worker.Close(); cerr != nil {
		return cerr
	}
	if errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}
```

A worker runs once: calling `Run` again, or after `Close`, returns
`bullmq.ErrWorkerClosed`.

### Cancelling jobs

`Worker.CancelJob` cancels the context of a job the worker is processing, and
`Worker.CancelAllJobs` the context of all of them. As with Node's
`cancelJob`, the job fails with the reason if its processor then returns an
error (and is retried if attempts remain); a processor that ignores the
cancellation and succeeds completes the job.

```go
if !worker.CancelJob(jobID, "superseded by a newer upload") {
	log.Printf("job %s is not being processed by this worker", jobID)
}
```

`context.Cause` tells a processor why its context was cancelled:

```go
func upload(ctx context.Context, job *bullmq.Job) (any, error) {
	if err := transfer(ctx, job); err != nil {
		switch cause := context.Cause(ctx); {
		case errors.Is(cause, bullmq.ErrJobCancelled):
			// CancelJob: the job fails with the reason (cause.Error()).
			cleanUp(job)
		case errors.Is(cause, bullmq.ErrLockLost):
			// Another worker may own the job now: stop touching it.
		}
		return nil, err
	}
	return nil, nil
}
```

Besides `ErrJobCancelled`, the cause is `bullmq.ErrLockLost` when the worker
couldn't renew the job's lock, or the cause of the `Run` context. In the last
two cases the job isn't failed.

### Retries and backoff

```go
_, err := queue.Add(ctx, "charge", data, &bullmq.JobOptions{
	Attempts: bullmq.Int64(5),
	// 1 s, 2 s, 4 s, 8 s between the attempts, each up to 20% shorter.
	Backoff: &bullmq.Backoff{Type: bullmq.BackoffExponential, Delay: 1000, Jitter: 0.2},
})
if err != nil {
	log.Fatal(err)
}
```

`Attempts` is the total number of tries (1 by default). `BackoffFixed` waits
`Delay` milliseconds before every retry, `BackoffExponential` doubles it each
time, and without a `Backoff` a failed job is retried right away. A custom
backoff type is computed by `WorkerOptions.BackoffStrategy`, which returns the
delay in milliseconds, or a negative value to fail the job for good:

```go
worker, err := bullmq.NewWorker("emails", sendWelcome, &bullmq.WorkerOptions{
	Backend: backend,
	BackoffStrategy: func(attemptsMade int64, backoffType bullmq.BackoffType, err error, job *bullmq.Job) int64 {
		if backoffType == "linear" {
			return attemptsMade * 5_000
		}
		return -1
	},
})
if err != nil {
	log.Fatal(err)
}
```

A job with a custom backoff type fails instead of being retried on a worker
without a `BackoffStrategy`, and an `EventError` says why.
`WorkerOptions.MaxStartedAttempts` fails a job that was started more than that
many times, for example because it keeps stalling. `JobOptions.StackTraceLimit`
bounds the failure traces kept on the job. `Job.Retry` and `Queue.RetryJobs`
move failed (or completed) jobs back to wait.

### Stalled jobs and locks

A worker holds a lock on every job it processes and renews it every
`LockRenewTime` (half of `LockDuration`, which is 30 s by default). Every
`StalledInterval` (30 s), the stalled check looks for active jobs whose lock
expired, because their worker crashed or was stopped immediately, and moves
them back to wait, or fails them once they stalled more than
`MaxStalledCount` times. See the [stalled jobs
guide](https://docs.bullmq.io/guide/workers/stalled-jobs).

When renewing a lock fails, the worker emits `EventLockRenewalFailed` and, as
a Go addition, cancels the job's context with `bullmq.ErrLockLost`: another
worker may already own the job, so the processor should stop. Node.js keeps
running the processor. The job isn't failed either way. `SkipLockRenewal` and
`SkipStalledCheck` turn both mechanisms off, for workers that manage locks
themselves.

### Rate limiting

```go
worker, err := bullmq.NewWorker("emails", sendWelcome, &bullmq.WorkerOptions{
	Backend: backend,
	// At most 100 jobs per minute, across every worker that sets this limiter.
	Limiter: &bullmq.RateLimiter{Max: 100, Duration: time.Minute},
})
if err != nil {
	log.Fatal(err)
}
```

The limit is shared by the queue, like in the other ports.
`Queue.SetGlobalRateLimit` sets one for every worker of the queue, without
configuring each of them. A rate-limited worker sleeps until the limit lifts,
at most `MaximumRateLimitDelay` (30 s by default) at a time.

A processor can also rate limit the queue itself, for example when an
external API asks it to slow down. `Worker.RateLimit` limits the queue for a
while, and returning `bullmq.ErrRateLimited` puts the job back in the wait
list without using up an attempt:

```go
var worker *bullmq.Worker
worker, err := bullmq.NewWorker("emails", func(ctx context.Context, job *bullmq.Job) (any, error) {
	retryAfter, err := callAPI(ctx, job)
	if errors.Is(err, errTooManyRequests) {
		if err := worker.RateLimit(ctx, retryAfter); err != nil {
			return nil, err
		}
		return nil, bullmq.ErrRateLimited
	}
	return nil, err
}, &bullmq.WorkerOptions{
	Backend: backend,
	Limiter: &bullmq.RateLimiter{Max: 100, Duration: time.Minute},
})
if err != nil {
	log.Fatal(err)
}
```

As in Node.js, `RateLimit` only holds back workers that fetch with a limiter
(`Limiter`, or a global rate limit).

### Metrics

```go
worker, err := bullmq.NewWorker("emails", sendWelcome, &bullmq.WorkerOptions{
	Backend: backend,
	Metrics: &bullmq.MetricsOptions{MaxDataPoints: 7 * 24 * 60}, // one week of minutes
})
if err != nil {
	log.Fatal(err)
}

// One count per minute, the most recent first. As in Node.js, a minute's
// count is recorded once a job finishes in a later minute, so Data is empty
// during the first minute.
metrics, err := queue.Metrics(ctx, bullmq.StateCompleted, 0, 59)
if err != nil {
	log.Fatal(err)
}
log.Printf("%d jobs completed in total; last hour: %v", metrics.Count, metrics.Data)
```

## Queue operations

A `Queue` is safe for concurrent use. Its methods mirror Node's `Queue`:

| Methods                                                    | What they do                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `Add`, `AddBulk`                                           | Add jobs                                                                                     |
| `Job`, `JobState`, `Jobs`, `JobIDs`                        | Read jobs, by id or by state                                                                 |
| `Count`, `JobCounts`                                       | Count the waiting, delayed, prioritized and waiting-children jobs, or the jobs in each state |
| `Pause`, `Resume`, `IsPaused`                              | Pause the queue for every worker                                                             |
| `Drain`                                                    | Remove the waiting and prioritized jobs, and optionally the delayed ones                     |
| `Clean`                                                    | Remove the jobs of a state older than a grace period                                         |
| `Obliterate`                                               | Remove the queue and all of its jobs                                                         |
| `RetryJobs`, `PromoteJobs`                                 | Move failed or completed jobs back to wait; make delayed jobs ready                          |
| `SetGlobalConcurrency`, `GlobalConcurrency`, `IsMaxed`     | Cap how many jobs are active across all workers                                              |
| `SetGlobalRateLimit`, `RateLimitTTL`                       | Rate limit every worker of the queue                                                         |
| `Metrics`, `Workers`                                       | Completed and failed metrics; the names of the connected workers                             |
| `UpsertJobScheduler`, `JobScheduler`, `JobSchedulers`, ... | [Job schedulers](#job-schedulers)                                                            |

```go
counts, err := queue.JobCounts(ctx, bullmq.StateWaiting, bullmq.StateActive, bullmq.StateFailed)
if err != nil {
	log.Fatal(err)
}
log.Printf("%d waiting, %d active, %d failed",
	counts[bullmq.StateWaiting], counts[bullmq.StateActive], counts[bullmq.StateFailed])

// The 10 most recent failures.
failed, err := queue.Jobs(ctx, bullmq.StateFailed, 0, 9, false)
if err != nil {
	log.Fatal(err)
}
for _, job := range failed {
	log.Printf("%s failed: %s", job.ID, job.FailedReason)
}

// Remove the completed jobs older than a day, at most 1000 of them.
removed, err := queue.Clean(ctx, 24*time.Hour, 1000, bullmq.StateCompleted)
if err != nil {
	log.Fatal(err)
}
log.Printf("removed %d jobs", len(removed))
```

`Queue.Job` returns `nil` for a job that doesn't exist. The returned `*Job`
can be changed and inspected: `UpdateData`, `UpdateProgress`, `Log` and
`Logs`, `State`, `IsCompleted`, `IsFailed`, `Promote`, `ChangeDelay`,
`ChangePriority`, `Retry`, and `Remove` (which returns `bullmq.ErrJobLocked`
while a worker holds the job).

## QueueEvents

A `QueueEvents` reads the queue's shared event stream, so it sees what every
worker and producer does, in any language:

```go
events, err := bullmq.NewQueueEvents("emails", &bullmq.QueueEventsOptions{Backend: backend})
if err != nil {
	log.Fatal(err)
}
defer events.Close()

go func() {
	if err := events.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Printf("queue events: %v", err)
	}
}()

for ev := range events.Events() {
	switch ev.Event {
	case "completed":
		log.Printf("job %s returned %s", ev.JobID, ev.ReturnValue())
	case "failed":
		log.Printf("job %s failed: %s", ev.JobID, ev.FailedReason())
	}
}
```

Each `QueueEvent` has the event name (`added`, `waiting`, `active`,
`progress`, `completed`, `failed`, `delayed`, `stalled`, `removed`,
`deduplicated`, `drained`...), the job id and every field of the event in
`Data`. The listener starts with the events published after `Run` starts;
set `LastEventID` to read from another point (`"0"` for the oldest event
kept). `Events()` is closed when the listener stops, by `Close` or by
cancelling `Run`'s context. Unlike a worker's events, the channel isn't lossy:
the listener waits for the reader, so keep reading it. Read errors are
retried and reported on `Errors()`.

On PostgreSQL, a listener can miss events when several workers finish jobs at
the same time; see [Known limitations](#known-limitations).

## Flows

A `FlowProducer` adds a tree of jobs, possibly spanning several queues, in
one datastore operation. A parent waits in the `waiting-children` state until
all of its children are processed, then reads their results:

```go
flows, err := bullmq.NewFlowProducer(&bullmq.FlowProducerOptions{Backend: backend})
if err != nil {
	log.Fatal(err)
}
defer flows.Close()

tree, err := flows.Add(ctx, bullmq.FlowJob{
	Name:      "render-report",
	QueueName: "reports",
	Data:      map[string]string{"month": "2026-10"},
	Children: []bullmq.FlowJob{
		{Name: "fetch", QueueName: "sources", Data: "sales"},
		{Name: "fetch", QueueName: "sources", Data: "costs",
			Opts: &bullmq.JobOptions{FailParentOnFailure: bullmq.Bool(true)}},
	},
}, nil)
if err != nil {
	log.Fatal(err)
}
log.Printf("report job %s waits for %d children", tree.Job.ID, len(tree.Children))
```

The processor of the parent reads the children's return values, by child key
(`bull:sources:<id>` on Redis, `sources:<id>` on PostgreSQL):

```go
func renderReport(ctx context.Context, job *bullmq.Job) (any, error) {
	values, err := job.ChildrenValues(ctx)
	if err != nil {
		return nil, err
	}
	total := 0.0
	for _, raw := range values {
		var amount float64
		if err := json.Unmarshal(raw, &amount); err != nil {
			return nil, err
		}
		total += amount
	}
	return total, nil
}
```

- Every queue of a flow is reached through the producer's backend, so they
  share its connections and its namespace (the Redis prefix or the PostgreSQL
  schema). `FlowOpts.QueuesOptions` sets default job options per queue.
- `FailParentOnFailure`, `ContinueParentOnFailure`, `IgnoreDependencyOnFailure`
  and `RemoveDependencyOnFailure` decide what a failing child does to its
  parent, as described in the [flows guide](https://docs.bullmq.io/guide/flows).
  By default the parent keeps waiting.
- `AddBulk` adds several flows at once, and `GetFlow` reads a tree back.
- `Job.Dependencies`, `Job.DependenciesCount`, `Job.IgnoredChildrenFailures`,
  `Job.RemoveChildDependency` and `Job.RemoveUnprocessedChildren` inspect and
  change the children of a parent.

A running job can also add children (with `JobOptions.Parent`, or a flow
whose root has a `Parent`) and then wait for them:

```go
moved, err := job.MoveToWaitingChildren(ctx, nil)
if err != nil {
	return nil, err
}
if moved {
	// Processed again once the children are done.
	return nil, bullmq.ErrWaitingChildren
}
```

## Job schedulers

A job scheduler produces jobs on a cron pattern or at a fixed interval, as
Node's `upsertJobScheduler` does:

```go
// Every day at 09:00, Madrid time.
first, err := queue.UpsertJobScheduler(ctx, "daily-report",
	bullmq.RepeatOptions{Pattern: "0 9 * * *", Tz: "Europe/Madrid"},
	&bullmq.JobTemplate{Name: "report", Data: map[string]string{"kind": "daily"}})
if err != nil {
	log.Fatal(err)
}
if first != nil { // nil when the schedule produces no more jobs
	log.Printf("first report: job %s", first.ID)
}

// Every 10 seconds, 100 times at most.
if _, err := queue.UpsertJobScheduler(ctx, "poll",
	bullmq.RepeatOptions{Every: 10_000, Limit: 100}, nil); err != nil {
	log.Fatal(err)
}

schedulers, err := queue.JobSchedulers(ctx, 0, -1, true)
if err != nil {
	log.Fatal(err)
}
for _, s := range schedulers {
	log.Printf("%s: next run at %s", s.ID, time.UnixMilli(s.Next))
}

if _, err := queue.RemoveJobScheduler(ctx, "poll"); err != nil {
	log.Fatal(err)
}
```

- Upserting again replaces the schedule and template of a scheduler.
  `JobTemplate` sets the name, data and options of the jobs; it can't set
  `JobID`, `Delay`, `Deduplication` or `Repeat`.
- Only the job of the next iteration is stored, with the id
  `repeat:<scheduler id>:<due time in ms>`. The worker that fetches it adds
  the following one before processing it, so Go, Node.js and the other ports
  advance each other's schedulers. While no worker runs, a scheduler doesn't
  pile up jobs.
- `Pattern` takes 5 fields, or 6 with leading seconds, with names, ranges,
  steps, `L` and `#`. It is evaluated exactly as cron-parser evaluates it in
  Node.js, including across DST changes, so every port computes the same due
  times. `W` and `H` aren't supported.
- `Tz` accepts the time zones Node.js accepts: IANA names in any case
  (`america/new_york`), ICU's legacy ids (`PST`) and fixed offsets (`+03:00`,
  `UTC+3`). Without it, patterns use the process's local time zone, as in
  Node.js. Time zones are read from the system's time zone database: on
  systems without one (`scratch` or distroless containers), add
  `import _ "time/tzdata"` to embed it in the binary. A worker that can't
  resolve a scheduler's time zone fails the iteration it fetched with the
  reason and an `EventError`, without processing it or adding the next one, so
  the schedule stops visibly instead of stalling.
- `Every` schedulers accept an `Offset`; every scheduler a `Limit`, a
  `StartDate` and an `EndDate` (Unix milliseconds); `Pattern` schedulers
  `Immediately`, to produce their first job right away.
- Legacy repeatable jobs (Node's `repeat` option, BullMQ 5 and earlier) aren't
  supported: migrate them to job schedulers. A Go worker processes their jobs
  but can't schedule the next ones, and reports it with an `EventError`.

## The PostgreSQL backend

```go
backend := postgresbackend.New(postgresbackend.Options{
	ConnString: os.Getenv("DATABASE_URL"),
	Schema:     "jobs",
	PoolSize:   30,
})
```

`postgresbackend` stores queues with the tables and SQL that the Node.js,
Python, Elixir and .NET ports use, so they all work on the same schema.

| Option             | Default  | Meaning                                                                                                                                                                                                                                                              |
| ------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConnString`       |          | A pgx connection string, URL or keyword/value. Required unless `Pool` is set                                                                                                                                                                                         |
| `Schema`           | `bullmq` | Namespaces every queue, as the key prefix does on Redis                                                                                                                                                                                                              |
| `PoolSize`         | 20       | Size of the query pool (or the connection string's `pool_max_conns`)                                                                                                                                                                                                 |
| `Pool`             |          | A `*pgxpool.Pool` to use instead; BullMQ never closes it. Its connections must use the schema as `search_path` (`config.ConnConfig.RuntimeParams["search_path"] = "bullmq"`). Its `OnNotification`/`OnNotice` callbacks aren't used on BullMQ's `LISTEN` connections |
| `SkipVersionCheck` | `false`  | Skip the PostgreSQL 13 check                                                                                                                                                                                                                                         |

- **Migrations.** The first operation of the process creates or migrates the
  schema, in one transaction under the advisory lock every runtime uses, and
  records it in the shared `migration` ledger. Every new backend checks that
  ledger: a schema that requires a newer BullMQ major version is refused with
  a `*postgresbackend.SchemaVersionError`. (The Node.js backend migrates only
  when asked to, with `runMigrations`; a schema migrated by either is usable
  by both.)
- **Connections.** Backends built with the same `ConnString`, `Schema` and
  `PoolSize` share one pgxpool pool per process. It opens connections on
  demand (`pool_min_conns` and `pool_min_idle_conns` are ignored for these
  shared pools; pass your own `Pool` to keep connections warm) and closes them
  when its last backend closes. Each worker and `QueueEvents` also
  holds one dedicated connection outside the pool, which `LISTEN`s for new
  jobs or events, so idle workers wake up as soon as a job is added rather
  than polling. Size the server's `max_connections` for the pool plus one
  connection per worker and listener.
- **Worker discovery.** The `application_name` of a worker's dedicated
  connection is `<queue>` or `<queue>:w:<name>`, as in Node.js, and is what
  `Queue.Workers` lists.
- The backend of a queue built with `postgresbackend.New` is a
  `*postgresbackend.Backend`, which exposes `Pool()` and `Schema()`.
- Job data, return values and progress are stored as `jsonb`, so a job read
  back holds equal JSON values but not necessarily the same bytes in
  `Job.Data` and `Job.ReturnValue`: decode them rather than compare bytes.

Everything this guide describes works on both backends, with the caveats
listed in [FEATURE_PARITY.md](./FEATURE_PARITY.md#postgresql) and
[Known limitations](#known-limitations).

## Interoperability

Go shares queues with the other BullMQ runtimes on the same backend:

- On Redis, use the same `Prefix` (`bull` by default) as the other side; on
  PostgreSQL, the same database and `Schema`.
- Job data, return values and structured progress are JSON. A Go processor
  decodes data added by Node.js with `job.DecodeData`, and a Node.js parent
  reads a Go child's return value as JSON.
- Job options are stored in the same form as Node.js stores them, so the
  retries, backoff, priorities, removal policies, flows and deduplication of
  a job behave the same whichever runtime processes it. A custom backoff type
  needs a `BackoffStrategy` on Go workers.
- `QueueEvents` in any runtime sees the events of Go workers, and the other
  way round. Job schedulers created in one runtime are advanced by the
  workers of the others.
- On PostgreSQL, `Queue.Workers` doesn't list .NET workers, which name their
  connections differently
  ([#5184](https://github.com/taskforcesh/bullmq/issues/5184)).

## Testing your code

Keep processors as plain functions and unit test them with a `*bullmq.Job`
built in the test. Methods that reach the datastore, such as `UpdateProgress`
or `Log`, return `bullmq.ErrNoContext` on such a job, so keep those calls out
of the logic you test in isolation:

```go
func TestSendWelcomeRejectsBadPayloads(t *testing.T) {
	job := &bullmq.Job{ID: "1", Name: "welcome", Data: json.RawMessage(`"not an object"`)}
	_, err := sendWelcome(context.Background(), job)
	if !bullmq.IsUnrecoverable(err) {
		t.Fatalf("err = %v, want an unrecoverable error", err)
	}
}
```

For integration tests, run a real Redis or PostgreSQL (for example with
`docker compose`, or testcontainers) and give every test its own queue, so
tests can run in parallel and leave nothing behind:

```go
func TestWelcomeEmailIsSent(t *testing.T) {
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

	job, err := queue.Add(ctx, "welcome", Email{To: "ada@example.com"}, nil)
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
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("job is %s, want completed", state)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
```

`t.Cleanup` runs its functions in reverse order, so the worker is closed
before the queue is obliterated. On PostgreSQL, use a dedicated database or
`Schema` for tests; it is migrated on first use. To test stalled-job handling
quickly, lower `LockDuration` and `StalledInterval`.

## Known limitations

- **No telemetry.** There are no OpenTelemetry hooks yet; use worker events
  or `OnEvent` for metrics and tracing.
- **Redis Cluster and Sentinel are untested.** A `redis.UniversalClient` for a
  cluster or a failover setup can be passed as `Client`, but the test suite
  only runs on a standalone server. On a cluster, the prefix needs a hash tag
  (for example `{bull}`) so that the keys of a queue share a slot, as in
  Node.js.
- **QueueEvents on PostgreSQL can miss events under concurrency.** Event ids
  are assigned before their transaction commits, so a listener can skip an
  event that commits after a later one was read. Every runtime is affected
  until [#5183](https://github.com/taskforcesh/bullmq/issues/5183) is fixed.
  Don't rely on `QueueEvents` to see every `completed` or `failed` event on
  PostgreSQL; read the job state instead.
- **Time zones need a database.** Job schedulers with a `Tz` read the
  system's time zone database; import `time/tzdata` in containers that don't
  have one.
- **No legacy repeatable jobs and no sandboxed processors.** Use job
  schedulers and goroutines.

[FEATURE_PARITY.md](./FEATURE_PARITY.md) lists the Node.js features that
aren't implemented yet.

## Upgrading from the pre-release API

The API changed before the first release; code written against the early
drafts of this port needs these changes:

| Before                                                                         | Now                                                                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `Redis: bullmq.RedisOptions{Addr: ...}` in the options; Redis when unset       | `Backend: redisbackend.New(redisbackend.Options{Addr: ...})`, required in every options struct                      |
| `Prefix` in `QueueOptions`, `WorkerOptions` and `QueueEventsOptions`           | `redisbackend.Options.Prefix`                                                                                       |
| `bullmq.RedisBackendFactory`, `bullmq.NewRedisBackend`, `*bullmq.RedisBackend` | `redisbackend.New`, `redisbackend.NewBackend`, `*redisbackend.Backend`                                              |
| `queue.Client()`, `queue.Keys()`, `bullmq.Keys`                                | `queue.Backend().(*redisbackend.Backend).Client()` and `.Keys()`, `redisbackend.Keys`                               |
| `worker.Pause()` returned at once                                              | `worker.Pause(ctx, doNotWaitActive)` waits for the active jobs unless `doNotWaitActive` is true                     |
| `EventStalled` reported lost locks                                             | `EventLockRenewalFailed` and `EventLocksRenewed`, with `Event.JobIDs`; `EventStalled` is only for the stalled check |
| Full event channel dropped events silently                                     | `Worker.DroppedEvents` counts them; `WorkerOptions.OnEvent` sees every event                                        |
| Cancelling `Run`'s context failed in-flight jobs                               | They stay active, without using up an attempt, for the stalled check to recover                                     |
| `RemoveAll()` was stored as `{"count":0}`                                      | Stored as `true`, as in the other ports                                                                             |

Custom `Backend` implementations have more to change: `SignalWork` is gone,
`MoveToCompleted` and `MoveToFailed` return a `*FinishResult` and can fetch
the next job, `FetchResult` reports `RateLimitDelay` and `NextDelayedAt`,
`WaitForJob` returns a `WaitResult`, `BackendOptions.Prefix` moved to the
backends, and there are new methods for flows, job schedulers and manual rate
limiting. The documentation of the `Backend` interface describes the
contract.

## Contributing

The source of truth for this port is the
[`golang/`](https://github.com/taskforcesh/bullmq/tree/master/golang) directory
of the main BullMQ repository. The
[bullmq-go](https://github.com/taskforcesh/bullmq-go) repository is published
automatically on every Go release and already contains the generated Lua
commands and SQL files, so `go get` works out of the box. Contributions go to
the main repository.

The Lua commands and SQL files aren't committed to the `golang` directory:
they are generated from the shared sources, so every port stays byte-for-byte
identical. Before building or testing, run from the repository root:

```sh
yarn install
yarn generate:raw:scripts
yarn copy:lua:golang
yarn copy:sql:golang
```

This resolves the `--- @include` directives of `src/commands/*.lua` into
`rawScripts/` and copies the result into `golang/redisbackend/commands/`, and
copies the migrations and commands of `src/postgres` into
`golang/postgresbackend/sql/`, where `go:embed` picks them up.

The tests need a Redis server, and a PostgreSQL database for the PostgreSQL
backend. From the repository root:

```sh
docker compose up -d
cd golang
go test ./...
```

Set `REDIS_ADDR` to use another Redis server, and `POSTGRES_URL` to run the
tests on PostgreSQL too (the `postgres` service of `docker-compose.yml`
listens on port 5432):

```sh
REDIS_ADDR=127.0.0.1:6380 \
  POSTGRES_URL='postgres://postgres:postgres@127.0.0.1:5432/bullmq_test?sslmode=disable' \
  go test ./...
```

Tests that need Redis are skipped when no server is reachable, and the
PostgreSQL tests when `POSTGRES_URL` isn't set. The PostgreSQL tests create
their own schemas (`bullmq_go_test` and `gotest_pg_*`) and leave the default
`bullmq` schema alone. The behaviour tests of the root package run once per
datastore, as subtests named after it (for example
`TestWorkerProcessesJobs/redis` and `TestWorkerProcessesJobs/postgres`); the
datastores are listed in `internal/testbackends`. Tests specific to a backend
live in `redisbackend` and `postgresbackend`.

## License

MIT
