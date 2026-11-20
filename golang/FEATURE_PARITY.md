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

| Feature                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FlowProducer`                         | Parent/child job trees cannot be created from Go. Jobs that already have a parent are still processed correctly, and `Job.MoveToWaitingChildren` works, so a Go worker can participate in a flow created by another port.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `JobScheduler` / repeatable jobs       | Not supported. Go workers must not consume queues that contain job scheduler jobs. The next iteration of a scheduler is materialized by the worker that claims the current one (via `addJobScheduler`, which needs cron/timezone parsing), so once a Go worker claims an iteration no other worker can advance that scheduler and the schedule stops, even if scheduler-capable workers share the queue. Until Go performs this fetch-time upsert, keep scheduler jobs on queues consumed only by Node/Python/other scheduler-capable workers. If a Go worker does pick up such a job it still processes it and emits an `error` event. |
| Sandboxed processors                   | Not applicable; use goroutines.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Telemetry / OpenTelemetry              | No tracing hooks yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Redis Cluster and Sentinel             | Only standalone Redis is exercised by the test suite. You can pass your own `redis.UniversalClient`, but this configuration is untested.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Global concurrency groups (BullMQ Pro) | Pro-only feature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## PostgreSQL

The [`postgresbackend`](./postgresbackend) package implements the whole
`Backend` contract on PostgreSQL 13 or newer, with the migrations and commands
of `src/postgres` that every port shares. Everything listed above works on
both datastores, and the behaviour test suite runs on both.

| Topic            | PostgreSQL behaviour                                                                                                                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Namespace        | `Options.Schema` (default `bullmq`) instead of a key prefix. `Queue.Backend().QualifiedName()` is the bare queue name, as in Node.js.                                                                                                                                                                                   |
| Migrations       | Applied on first use, in one transaction under the shared advisory lock, and recorded in the `migration` ledger every runtime reads. A schema whose ledger requires a newer BullMQ major is refused with `SchemaVersionError`. A legacy .NET `bullmq_migration` ledger is adopted.                                      |
| Connections      | Queries run on a pgxpool pool (`PoolSize`, default 20) shared by the backends of the process with the same settings, or on a caller-supplied `*pgxpool.Pool`. Workers and `QueueEvents` add one dedicated `LISTEN` connection each, outside the pool.                                                                   |
| Blocking fetch   | `LISTEN bullmq_jobs` plus a check for waiting jobs and the next delayed job before blocking; a worker wakes as soon as a job is added to its queue.                                                                                                                                                                     |
| Events           | Stored in the `event` table and delivered with `LISTEN bullmq_events`. Event ids are numbers; the Redis forms `0-0` and `<id>-<seq>` are accepted. As with every runtime on the shared SQL, a listener can miss an event whose transaction commits after a later event was read, which happens with concurrent workers. |
| Worker discovery | `Queue.Workers` lists the `application_name` of the workers' dedicated connections: `{queue}` or `{queue}:w:{name}`, as the Node.js PostgreSQL backend names them. Pooled sessions are never named.                                                                                                                     |
| Pause            | A queue flag: waiting jobs stay waiting and keep being counted as waiting.                                                                                                                                                                                                                                              |
| Prioritized jobs | Waiting jobs with a priority, reported as `prioritized`.                                                                                                                                                                                                                                                                |
| Job options      | Stored with the long `JobsOptions` names (`deduplication`, `keepLogs`, `failParentOnFailure`, ...) that the shared SQL reads, as the other ports store them on PostgreSQL.                                                                                                                                              |

## Compatibility

The port embeds the shared Lua scripts unchanged, encodes script arguments with
the same MessagePack layout, and uses the same Redis key names and job hash
field abbreviations. On PostgreSQL it embeds the shared SQL unchanged and
stores jobs in the same tables and shape as the other ports. A queue can
therefore be produced by one language and consumed by another.
