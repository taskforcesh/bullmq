---
description: Processing jobs with BullMQ for Go - concurrency, events, pausing, shutdown, cancellation, retries and rate limiting.
---

# Workers

A `bullmq.Worker` fetches jobs from a queue and hands each of them to a
processor. The concepts are the same as in the [Workers guide](../guide/workers/);
this page shows the Go API.

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

if err := worker.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
	log.Fatal(err)
}
```

## Processors

A processor is a `func(ctx context.Context, job *bullmq.Job) (any, error)`:

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
  return value. A value that can't be encoded fails the job.
- A returned error fails the attempt, and the job is retried while attempts
  remain. `bullmq.NewUnrecoverableError`, or calling `job.Discard()` before
  returning, fails it for good.
- A panic is recovered and fails the attempt, with the stack as its trace.
- `ctx` is cancelled when the worker stops immediately, loses the job's lock,
  or cancels the job (see below).

A processor reports progress, and writes logs that every SDK and dashboard
can read:

```go
if err := job.UpdateProgress(ctx, 50); err != nil {
	return err
}
if _, err := job.Log(ctx, "half way there"); err != nil {
	return err
}
```

`UpdateProgress` also takes any value encoded as JSON, such as a struct or a
map, instead of a number; NaN and infinite numbers are rejected.

A processor can also move its own job and return a sentinel error, so that
the worker doesn't finish it: `job.MoveToDelayed` with `bullmq.ErrDelayed`
(the attempt isn't counted), `job.MoveToWaitingChildren` with
`bullmq.ErrWaitingChildren` (see [Flows](flows.md)), and `worker.RateLimit`
with `bullmq.ErrRateLimited` (see [Rate limiting](#rate-limiting)).

## Concurrency

`Concurrency` (1 by default) is the number of jobs a worker processes at the
same time, each on its own goroutine. Every processing slot finishes its job
and fetches the next one in the same backend call, as the Node.js worker
does, so a busy worker needs about one round trip per job. The worker only
blocks on the datastore once the queue looks drained, for at most
`DrainDelay` (5 s by default).

Run as many workers as you need, in one process or many. To cap the number of
jobs processed at once across all of them, use
[global concurrency](../guide/queues/global-concurrency.md):

```go
if err := queue.SetGlobalConcurrency(ctx, 20); err != nil {
	log.Fatal(err)
}
```

`queue.GlobalConcurrency` returns the limit, or nil when there is none. Unlike
Node.js, where `setGlobalConcurrency(0)` stores 0 and stops every worker,
`SetGlobalConcurrency(ctx, 0)` removes the limit, as
`RemoveGlobalConcurrency` does.

## Events

`worker.Events()` delivers lifecycle events on a buffered channel, which
`Close` closes:

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
| `EventDrained`           | A fetch found no job, once until a job is fetched again             |                                |
| `EventError`             | A background error, such as a lost connection                       | `Err`                          |
| `EventClosed`            | `Run` is returning                                                  |                                |

The channel never blocks the worker: when its buffer (256 events) is full,
events are dropped, and `worker.DroppedEvents()` counts them. To see every
event, for example to keep metrics, set `WorkerOptions.OnEvent`. It is called
synchronously on the worker's goroutines, so it must be quick and safe for
concurrent use, and it must not call `Close`. `WorkerOptions.OnError`
receives the same errors as `EventError`, each on its own goroutine.

## Pausing

```go
// Stop fetching and wait for the jobs in flight, like Node's pause().
if err := worker.Pause(ctx, false); err != nil {
	log.Fatal(err)
}
// ...
worker.Resume()
```

With `doNotWaitActive` set to `true`, `Pause` returns at once; a processor
pausing its own worker must do so. `Pause` can also be called from `OnEvent`,
for example to pause once the queue is drained:

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

`worker.Pause` affects one worker; `queue.Pause` pauses the queue for every
worker, in every language. See [Pausing queues](../guide/workers/pausing-queues.md).

## Shutting down

`worker.Run` blocks until the worker is stopped, and the two ways of stopping
it treat the jobs in flight differently:

- **`worker.Close()` is graceful.** The worker stops fetching, waits for the
  jobs in flight to finish (their contexts aren't cancelled), and releases its
  connections. It can be called from any goroutine, more than once.
- **Cancelling the context of `Run` is immediate.** That context is the parent
  of every job's context, so processors see the cancellation and should
  return. Whatever they return is then ignored: the jobs stay active, without
  using up an attempt, until their lock expires (`LockDuration`, 30 s by
  default) and the stalled check of a running worker, which runs every
  `StalledInterval` (30 s by default), moves them back to wait, as in
  Node.js. Such a job counts as stalled: one that stalls more than
  `MaxStalledCount` times (1 by default) fails. `Close` must still be called
  to release the connections.

Combining both gives in-flight jobs a grace period on SIGTERM. `Run` returns
nil after `Close`, and the context's error when its context is done, even
during a `Close`:

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
		// The grace period ran out: the jobs still running were left
		// active for the stalled check.
		return nil
	}
	return err
}
```

A worker runs once: calling `Run` again, or after `Close`, returns
`bullmq.ErrWorkerClosed`.

See also [Graceful shutdown](../guide/workers/graceful-shutdown.md).

## Cancelling jobs

`worker.CancelJob(jobID, reason)` cancels the context of a job the worker is
processing, and `worker.CancelAllJobs(reason)` the context of all of them. As
with Node's `cancelJob`, the job fails with the reason if its processor then
returns an error (and is retried if attempts remain).

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

The cause is `bullmq.ErrJobCancelled` after `CancelJob`, `bullmq.ErrLockLost`
when the worker couldn't renew the job's lock, or the cause of the `Run`
context. In the last two cases the job isn't failed. See
[Cancelling jobs](../guide/workers/cancelling-jobs.md).

## Retries and backoff

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

`BackoffFixed` waits `Delay` milliseconds before every retry,
`BackoffExponential` doubles the wait each time, and without a `Backoff` a
failed job is retried right away. A custom backoff type is computed by
`WorkerOptions.BackoffStrategy`, which returns the delay in milliseconds, or
a negative value to fail the job for good:

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

`WorkerOptions.MaxStartedAttempts` fails a job that was started more than
that many times, for example because it keeps stalling, and
`JobOptions.StackTraceLimit` bounds the failure traces kept on a job.

`Job.Retry` moves a failed (or completed) job back to wait. It keeps the
attempt counters, so a job that used up its attempts fails for good after one
more failure, unless you reset them:

```go
err := job.Retry(ctx, bullmq.StateFailed, &bullmq.RetryOptions{ResetAttemptsMade: true})
if err != nil {
	log.Fatal(err)
}
```

See [Retrying failing jobs](../guide/retrying-failing-jobs.md).

## Stalled jobs and locks

A worker holds a lock on every job it processes and renews it every
`LockRenewTime` (half of `LockDuration`, which is 30 s by default). Every
`StalledInterval` (30 s), the stalled check moves active jobs whose lock
expired back to wait, or fails them once they stalled more than
`MaxStalledCount` times. See [Stalled jobs](../guide/workers/stalled-jobs.md).

When a lock can't be renewed, the worker emits `EventLockRenewalFailed` and,
unlike Node.js, also cancels the job's context with `bullmq.ErrLockLost`:
another worker may own the job by then, so the processor should stop.

## Rate limiting

```go
worker, err := bullmq.NewWorker("emails", sendWelcome, &bullmq.WorkerOptions{
	Backend: backend,
	// At most 100 jobs per minute, across every worker with this limiter.
	Limiter: &bullmq.RateLimiter{Max: 100, Duration: time.Minute},
})
if err != nil {
	log.Fatal(err)
}
```

`queue.SetGlobalRateLimit(ctx, max, duration)` sets a limit for every worker
of the queue instead; `queue.GlobalRateLimit(ctx)` reads it and
`queue.RemoveGlobalRateLimit(ctx)` removes it. A rate-limited worker sleeps until the limit lifts, at
most `MaximumRateLimitDelay` (30 s by default) at a time.
`queue.RateLimitTTL(ctx, maxJobs)` tells how long the queue stays limited, in
milliseconds: the time left in the current window once `maxJobs` jobs were
counted in it, else 0. With `maxJobs` 0 it uses the global rate limit's max
and, without one, returns the time left whatever the count, or -2 when no
window is open, as Node's `getRateLimitTtl()` does.

A processor can rate limit the queue itself, for example when an external API
asks it to slow down. `worker.RateLimit` limits the queue for a while, and
returning `bullmq.ErrRateLimited` puts the job back in the wait list without
using up an attempt:

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
(`Limiter`, or a global rate limit). See [Rate limiting](../guide/rate-limiting.md).

## Removing finished jobs

Completed and failed jobs are kept unless their job options, or the worker's
defaults, say otherwise:

```go
worker, err := bullmq.NewWorker("emails", sendWelcome, &bullmq.WorkerOptions{
	Backend:          backend,
	RemoveOnComplete: bullmq.KeepCount(1000),           // the last 1000
	RemoveOnFail:     bullmq.KeepAge(7 * 24 * 60 * 60), // one week, in seconds
})
if err != nil {
	log.Fatal(err)
}
```

`bullmq.RemoveAll()` removes each job as soon as it finishes. Options set on
a job take precedence. See [Auto-removal of jobs](../guide/workers/auto-removal-of-jobs.md).

## Worker options

| Option                                | Default      | Meaning                                                              |
| ------------------------------------- | ------------ | -------------------------------------------------------------------- |
| `Backend`                             | required     | The datastore backend factory                                        |
| `Name`                                | generated id | Stored on every job the worker processes, and in its connection name |
| `Concurrency`                         | 1            | Jobs processed at the same time                                      |
| `LockDuration`, `LockRenewTime`       | 30 s, half   | Job lock duration and renewal interval                               |
| `StalledInterval`, `MaxStalledCount`  | 30 s, 1      | Stalled check interval, and stalls allowed before a job fails        |
| `SkipStalledCheck`, `SkipLockRenewal` | `false`      | Turn the stalled check or lock renewal off                           |
| `MaxStartedAttempts`                  | 0 (no limit) | Fail jobs started more than this many times                          |
| `DrainDelay`                          | 5 s          | Longest blocking wait for new jobs                                   |
| `Limiter`, `MaximumRateLimitDelay`    | none, 30 s   | Rate limit, and the longest sleep while rate limited                 |
| `Metrics`                             | none         | Collect completed and failed [metrics](../guide/metrics/)            |
| `RemoveOnComplete`, `RemoveOnFail`    | keep all     | Default removal policies                                             |
| `BackoffStrategy`                     | none         | Custom backoff types                                                 |
| `OnEvent`, `OnError`                  | none         | Event and error callbacks                                            |
