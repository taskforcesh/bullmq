---
description: Adding jobs with BullMQ for Go - job options, delayed and prioritized jobs, deduplication and queue operations.
---

# Queues and Jobs

A `bullmq.Queue` adds jobs and inspects the queue. It is safe for concurrent
use, so one `Queue` per queue name is enough for a whole program.

```go
queue, err := bullmq.NewQueue("emails", &bullmq.QueueOptions{
	Backend: backend,
	// Merged into the options of every job added through this Queue.
	DefaultJobOptions: &bullmq.JobOptions{Attempts: bullmq.Int64(3)},
})
if err != nil {
	log.Fatal(err)
}
defer queue.Close()
```

## Adding jobs

```go
job, err := queue.Add(ctx, "welcome", Email{To: "ada@example.com"}, &bullmq.JobOptions{
	Backoff:          &bullmq.Backoff{Type: bullmq.BackoffExponential, Delay: 1000},
	RemoveOnComplete: bullmq.KeepCount(1000),
	RemoveOnFail:     bullmq.KeepAge(7 * 24 * 60 * 60),
})
if err != nil {
	log.Fatal(err)
}
log.Printf("added job %s", job.ID)
```

The data is encoded with `encoding/json` (nil is stored as `{}`, as Node.js
stores a job without data), and a processor decodes it with
`job.DecodeData(&v)`. Several options are pointers, so that an explicit zero
can override a queue default; `bullmq.Int64` and `bullmq.Bool` build them.

| Option                             | Meaning                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `JobID`                            | Custom id. Adding a job whose id exists does nothing and returns that id. Custom ids can't be integers nor contain `:`        |
| `Delay`                            | Milliseconds before the job can be processed                                                                                  |
| `Priority`                         | 1 (highest) to 2,097,151; 0 means no priority                                                                                 |
| `LIFO`                             | Add the job to the front of the wait list                                                                                     |
| `Attempts`, `Backoff`              | Retries; see [Workers](workers.md#retries-and-backoff)                                                                        |
| `RemoveOnComplete`, `RemoveOnFail` | `bullmq.RemoveAll()`, `bullmq.KeepCount(n)`, `bullmq.KeepAge(seconds)`, or a `RemoveOnFinish` with `Count`, `Age` and `Limit` |
| `KeepLogs`                         | How many log rows to keep                                                                                                     |
| `SizeLimit`                        | Reject jobs whose encoded data is larger than this many bytes                                                                 |
| `StackTraceLimit`                  | How many failure traces to keep; every one by default                                                                         |
| `Deduplication`                    | See [Deduplication](#deduplication)                                                                                           |
| `Parent` and the failure options   | See [Flows](flows.md)                                                                                                         |

Times and delays stored with a job keep the units every port stores:
`JobOptions.Delay`, `Backoff.Delay`, `DeduplicationOptions.TTL` and the
`RepeatOptions` fields are `int64` milliseconds (`time.Minute.Milliseconds()`;
dates with `UnixMilli()`), and `RemoveOnFinish.Age` is in seconds. Method
parameters and worker settings are `time.Duration`s: `job.ChangeDelay`,
`job.MoveToDelayed`, `job.ExtendLock`, `Worker.RateLimit`, the grace period of
`Clean` and the durations of `WorkerOptions`. So `ChangeDelay(ctx, 4000)` is
4 µs; write `4*time.Second`.

`AddBulk` adds several jobs in one round trip (a single `MULTI`/`EXEC` on
Redis, a single transaction on PostgreSQL). On PostgreSQL a failed batch adds
no job. Redis doesn't roll back the jobs already added when another one is
rejected, for example because its parent doesn't exist, so check the queue
before retrying a failed batch there:

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

## Delayed jobs

```go
// Processed in about an hour.
_, err := queue.Add(ctx, "reminder", data, &bullmq.JobOptions{Delay: bullmq.Int64(time.Hour.Milliseconds())})
if err != nil {
	log.Fatal(err)
}
```

`job.ChangeDelay` reschedules a delayed job, and `job.Promote` and
`queue.PromoteJobs` make delayed jobs ready right away. A processor can move
its own job back to the delayed set and return `bullmq.ErrDelayed`; the
attempt isn't counted:

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

See [Delayed jobs](../guide/jobs/delayed.md).

## Prioritized jobs

```go
urgent, err := queue.Add(ctx, "report", data, &bullmq.JobOptions{Priority: bullmq.Int64(1)})
if err != nil {
	log.Fatal(err)
}

// Change it later; the second argument is LIFO.
if err := urgent.ChangePriority(ctx, 10, false); err != nil {
	log.Fatal(err)
}
```

Jobs with a lower `Priority` value are processed first, and jobs without a
priority before all of them. See [Prioritized jobs](../guide/jobs/prioritized.md).

## Deduplication

While a deduplication id is alive, adding another job with the same id
returns the existing job's id instead of adding a job, and `QueueEvents`
reports a `deduplicated` event:

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

// Reschedule: push the delayed job back to 5 seconds from now, keeping its
// id and data. A job that is no longer delayed is left alone.
_, err = queue.Add(ctx, "sync", data, &bullmq.JobOptions{
	Delay:         bullmq.Int64(5_000),
	Deduplication: &bullmq.DeduplicationOptions{ID: "sync-account-42", Reschedule: true},
})
if err != nil {
	log.Fatal(err)
}

// Keep last if active: while the job runs, remember the last job added and
// add it once the running one finishes. At most one job runs and one waits.
_, err = queue.Add(ctx, "deploy", data, &bullmq.JobOptions{
	Deduplication: &bullmq.DeduplicationOptions{ID: "deploy-repo-7", KeepLastIfActive: true},
})
if err != nil {
	log.Fatal(err)
}
```

`KeepLastIfActive` ignores `TTL`: the id is held until the jobs finish. It
can't be used on a flow node with a parent.

The `Job` returned for a duplicate carries the existing job's `ID`, but the
data and options of the call; read it back with `queue.Job` to see what is
stored.

`Add` doesn't say whether it deduplicated the job, as in Node.js: listen to
the `deduplicated` event, or compare the returned `ID` with `JobID` when you
set one. `DeduplicationJobID` tells which job holds a deduplication id, and
the id can be released before the job finishes, so the next job with it is
added:

```go
holder, err := queue.DeduplicationJobID(ctx, "sync-account-42") // "" when none
if err != nil {
	log.Fatal(err)
}
log.Printf("job %q holds sync-account-42", holder)

// Release it, whichever job holds it.
if _, err := queue.RemoveDeduplicationKey(ctx, "sync-account-42"); err != nil {
	log.Fatal(err)
}
```

`Job.RemoveDeduplicationKey` releases the job's id only while the job holds
it, for example to accept the next sync as soon as this one starts:

```go
func syncAccount(ctx context.Context, job *bullmq.Job) (any, error) {
	if _, err := job.RemoveDeduplicationKey(ctx); err != nil {
		return nil, err
	}
	return nil, syncWithCRM(ctx, job)
}
```

See [Deduplication](../guide/jobs/deduplication.md).

## Queue operations

| Methods                                                                           | What they do                                                                                                                                                    |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Add`, `AddBulk`                                                                  | Add jobs                                                                                                                                                        |
| `Job`, `JobState`, `Jobs`, `JobIDs`                                               | Read jobs, by id or by states                                                                                                                                   |
| `Count`, `JobCounts`, `CountsPerPriority`, `DelayedCount`                         | Count the waiting, delayed, prioritized and waiting-children jobs, the jobs in each state, the waiting jobs per priority, or the delayed jobs due before a time |
| `Pause`, `Resume`, `IsPaused`                                                     | Pause the queue for every worker                                                                                                                                |
| `Drain`                                                                           | Remove the waiting and prioritized jobs, and optionally the delayed ones                                                                                        |
| `Remove`                                                                          | Remove a job by id, and optionally its children; false when a worker holds it                                                                                   |
| `Clean`                                                                           | Remove the jobs of a state older than a grace period                                                                                                            |
| `Obliterate`                                                                      | Remove the queue and all of its jobs                                                                                                                            |
| `RetryJobs`, `PromoteJobs`                                                        | Move failed or completed jobs back to wait; make delayed jobs ready                                                                                             |
| `SetGlobalConcurrency`, `GlobalConcurrency`, `RemoveGlobalConcurrency`, `IsMaxed` | Cap how many jobs are active across all workers                                                                                                                 |
| `SetGlobalRateLimit`, `GlobalRateLimit`, `RemoveGlobalRateLimit`, `RateLimitTTL`  | Rate limit every worker of the queue                                                                                                                            |
| `DeduplicationJobID`, `RemoveDeduplicationKey`                                    | Read or release a [deduplication](#deduplication) id                                                                                                            |
| `Metrics`, `Workers`                                                              | Completed and failed metrics; the connected workers (`[]WorkerInfo`)                                                                                            |
| `Meta`, `Version`                                                                 | The queue metadata (limits, paused, events length) and the library that wrote it                                                                                |
| `UpsertJobScheduler`, `JobScheduler`, `JobSchedulers`, ...                        | [Job schedulers](job-schedulers.md)                                                                                                                             |

```go
counts, err := queue.JobCounts(ctx, bullmq.StateWaiting, bullmq.StateActive, bullmq.StateFailed)
if err != nil {
	log.Fatal(err)
}
log.Printf("%d waiting, %d active, %d failed",
	counts[bullmq.StateWaiting], counts[bullmq.StateActive], counts[bullmq.StateFailed])

// The 10 most recent failures.
failed, err := queue.Jobs(ctx, 0, 9, false, bullmq.StateFailed)
if err != nil {
	log.Fatal(err)
}
for _, job := range failed {
	log.Printf("%s failed: %s", job.ID, job.FailedReason)
}

// The next 10 jobs to run of each pending state, as Node's getWaiting,
// getPrioritized and getDelayed list them.
next, err := queue.Jobs(ctx, 0, 9, true, bullmq.StateWaiting, bullmq.StatePrioritized, bullmq.StateDelayed)
if err != nil {
	log.Fatal(err)
}
log.Printf("%d jobs to run", len(next))

// Remove the completed jobs older than a day, at most 1000 of them.
removed, err := queue.Clean(ctx, 24*time.Hour, 1000, bullmq.StateCompleted)
if err != nil {
	log.Fatal(err)
}
log.Printf("removed %d jobs", len(removed))

// Retry the jobs that failed more than an hour ago, 1000 per round trip.
if err := queue.RetryJobs(ctx, &bullmq.RetryJobsOptions{Before: time.Now().Add(-time.Hour)}); err != nil {
	log.Fatal(err)
}
```

`queue.Job` returns `nil` for a job that doesn't exist. A `*bullmq.Job` can be
changed and inspected with `UpdateData`, `UpdateProgress`, `Log` and `Logs`,
`State`, `IsCompleted`, `IsFailed`, `Promote`, `ChangeDelay`,
`ChangePriority`, `Retry` and `Remove`, which returns `bullmq.ErrJobLocked`
while a worker holds the job. `queue.Remove(ctx, id, removeChildren)` removes
a job by id without reading it first, and returns false while a worker holds
it.

`NewQueue` doesn't reach the datastore. Before its first command, a queue
writes its metadata, as Node's `Queue` does: `version` and
`opts.maxLenEvents`, the approximate maximum length of the events stream,
`QueueOptions.EventsMaxLen` (10,000 by default). Set
`QueueOptions.SkipMetasUpdate` for a role that may only read. `queue.Meta`
reads the metadata back.
