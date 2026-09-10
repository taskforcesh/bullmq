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

| Feature                             | Notes                                                                |
| ----------------------------------- | -------------------------------------------------------------------- |
| Concurrency                         | Bounded by `WorkerOptions.Concurrency`                               |
| Blocking fetch                      | Dedicated connection using `BZPOPMIN` on the marker key              |
| Lock renewal                        | Disable with `SkipLockRenewal`                                       |
| Stalled job recovery                | Disable with `SkipStalledCheck`                                      |
| Retries and backoff                 | Fixed, exponential and custom `BackoffStrategy`                      |
| `UnrecoverableError`                | Skips the remaining attempts                                         |
| Panic recovery                      | A panicking processor fails the job instead of the process           |
| Rate limiting                       | `WorkerOptions.Limiter`                                              |
| `RemoveOnComplete` / `RemoveOnFail` | Count and age based                                                  |
| Metrics                             | `WorkerOptions.Metrics`                                              |
| `Pause`, `Resume`, `Close`          | Graceful shutdown drains in-flight jobs                              |
| Events                              | Active, completed, failed, progress, stalled, drained, error, closed |

### Job

`UpdateProgress`, `UpdateData`, `Log`, `Logs`, `State`, `Remove`, `Promote`,
`Retry`, `ChangeDelay`, `ChangePriority`, `ExtendLock`, `MoveToDelayed`,
`MoveToWaitingChildren`, `IsCompleted`, `IsFailed`.

### QueueEvents

Streams every event published by any worker on the queue, in any language.

## Not implemented

| Feature                                | Notes                                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FlowProducer`                         | Parent/child job trees cannot be created from Go. Jobs that already have a parent are still processed correctly, and `Job.MoveToWaitingChildren` works, so a Go worker can participate in a flow created by another port. |
| `JobScheduler` / repeatable jobs       | Use a scheduler from another port; the Lua commands are cron and timezone aware and the Go worker will process the jobs it produces.                                                                                      |
| Sandboxed processors                   | Not applicable; use goroutines.                                                                                                                                                                                           |
| Telemetry / OpenTelemetry              | No tracing hooks yet.                                                                                                                                                                                                     |
| Redis Cluster and Sentinel             | Only standalone Redis is exercised by the test suite. You can pass your own `redis.UniversalClient`, but this configuration is untested.                                                                                  |
| PostgreSQL backend                     | Redis only.                                                                                                                                                                                                               |
| Global concurrency groups (BullMQ Pro) | Pro-only feature.                                                                                                                                                                                                         |

## Compatibility

The port embeds the shared Lua scripts unchanged, encodes script arguments with
the same MessagePack layout, and uses the same Redis key names and job hash
field abbreviations. A queue can therefore be produced by one language and
consumed by another.
