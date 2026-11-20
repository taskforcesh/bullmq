# Feature parity

Status of the Go port relative to the reference Node.js implementation.

## Supported

### Queue

| Feature                                                | Notes                                  |
| ------------------------------------------------------ | -------------------------------------- |
| `Add`, `AddBulk`                                       | Standard, delayed and prioritized jobs |
| Custom job ids                                         | `JobOptions.JobID`                     |
| Default job options                                    | `QueueOptions.DefaultJobOptions`       |
| `Pause`, `Resume`, `IsPaused`                          |                                        |
| `Drain`, `Obliterate`, `Clean`                         |                                        |
| `Count`, `JobCounts`, `JobIDs`, `Jobs`                 |                                        |
| `RetryJobs`, `PromoteJobs`                             |                                        |
| `IsMaxed`, `SetGlobalConcurrency`, `GlobalConcurrency` |                                        |
| `SetGlobalRateLimit`, `RateLimitTTL`                   |                                        |
| `Metrics`                                              | Completed/failed data points           |
| `Workers`                                              | Parsed from `CLIENT LIST`              |
| Job deduplication                                      | `JobOptions.Deduplication`             |

### Worker

| Feature                             | Notes                                                                                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Concurrency                         | Bounded by `WorkerOptions.Concurrency`                                                                                                                    |
| Fetch-next                          | Each slot fetches its next job when it finishes the current one, re-using its lock token, as in Node.js                                                   |
| Blocking fetch                      | Dedicated connection using `BZPOPMIN` on the marker key for the whole `DrainDelay`, interrupted on close; waits until the next delayed job is due         |
| Lock renewal                        | Disable with `SkipLockRenewal`; `EventLocksRenewed` and `EventLockRenewalFailed`. A lost lock also cancels the job's context (`ErrLockLost`), unlike Node |
| Stalled job recovery                | Disable with `SkipStalledCheck`; `EventStalled`                                                                                                           |
| Retries and backoff                 | Fixed, exponential and custom `BackoffStrategy`; delays are clamped so they cannot overflow                                                               |
| `UnrecoverableError`                | Skips the remaining attempts                                                                                                                              |
| `MaxStartedAttempts`                | Checked after a deferred stalled failure, as in Node.js                                                                                                   |
| `StackTraceLimit`                   | Job option; every trace is kept by default, as in Node.js                                                                                                 |
| Panic recovery                      | A panicking processor fails the job instead of the process                                                                                                |
| Rate limiting                       | `WorkerOptions.Limiter`; the limit is slept out, at most `MaximumRateLimitDelay` at a time                                                                |
| Manual rate limiting                | `Worker.RateLimit` and `ErrRateLimited` (Node's `RateLimitError`)                                                                                         |
| `RemoveOnComplete` / `RemoveOnFail` | Boolean, count, age and limit, stored in the same forms as Node.js (`RemoveAll` is `true`)                                                                |
| Metrics                             | `WorkerOptions.Metrics`                                                                                                                                   |
| `Pause`, `Resume`                   | `Pause(ctx, doNotWaitActive)` waits for active jobs, as in Node.js                                                                                        |
| `Close`                             | Graceful shutdown drains in-flight jobs; cancelling the `Run` context leaves them active for stalled recovery                                             |
| `CancelJob`, `CancelAllJobs`        | Cancel the job context; the job fails with the reason                                                                                                     |
| Events                              | Active, completed, failed, progress, stalled, lock renewal, drained, error, closed; synchronous `OnEvent` and `DroppedEvents`                             |

### Job

`UpdateProgress`, `UpdateData`, `Log`, `Logs`, `State`, `Remove`, `Promote`,
`Retry`, `ChangeDelay`, `ChangePriority`, `ExtendLock`, `MoveToDelayed`,
`MoveToWaitingChildren`, `IsCompleted`, `IsFailed`.

### QueueEvents

Streams every event published by any worker on the queue, in any language.

## Not implemented

| Feature                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FlowProducer`                         | Parent/child job trees cannot be created from Go. Jobs that already have a parent are still processed correctly, and `Job.MoveToWaitingChildren` works, so a Go worker can participate in a flow created by another port.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `JobScheduler` / repeatable jobs       | Not supported. Go workers must not consume queues that contain job scheduler jobs. The next iteration of a scheduler is materialized by the worker that claims the current one (via `addJobScheduler`, which needs cron/timezone parsing), so once a Go worker claims an iteration no other worker can advance that scheduler and the schedule stops, even if scheduler-capable workers share the queue. Until Go performs this fetch-time upsert, keep scheduler jobs on queues consumed only by Node/Python/other scheduler-capable workers. If a Go worker does pick up such a job it still processes it and emits an `error` event. |
| Sandboxed processors                   | Not applicable; use goroutines.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Telemetry / OpenTelemetry              | No tracing hooks yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Redis Cluster and Sentinel             | Only standalone Redis is exercised by the test suite. You can pass your own `redis.UniversalClient`, but this configuration is untested.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| PostgreSQL backend                     | Not bundled. The generic `Backend` interface (see `backend.go`) is in place, so a PostgreSQL implementation can be added through `BackendFactory`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Global concurrency groups (BullMQ Pro) | Pro-only feature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Compatibility

The port embeds the shared Lua scripts unchanged, encodes script arguments with
the same MessagePack layout, and uses the same Redis key names and job hash
field abbreviations. A queue can therefore be produced by one language and
consumed by another.
