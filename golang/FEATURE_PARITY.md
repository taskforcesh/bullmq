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
| Auto-pipelining                     | Opt-in, experimental: `redisbackend.Options.AutoPipeline` (go-redis auto-pipelining, use `FullDuplex`) batches concurrent commands as ioredis does        |
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

Parent jobs: `ChildrenValues`, `Dependencies` (paginated), `DependenciesCount`,
`IgnoredChildrenFailures` (and the deprecated `FailedChildrenValues`),
`RemoveChildDependency`, `RemoveUnprocessedChildren`: Node's
`getChildrenValues`, `getDependencies`, `getDependenciesCount`,
`getIgnoredChildrenFailures`, `getFailedChildrenValues`,
`removeChildDependency` and `removeUnprocessedChildren`.

### FlowProducer

| Feature                      | Notes                                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Add`, `AddBulk`             | Trees of jobs across queues, inserted in one Redis transaction or one SQL statement; per-queue default options with `FlowOpts.QueuesOptions`                                                                              |
| `GetFlow`                    | `Depth` and `MaxChildren`, as in Node.js                                                                                                                                                                                  |
| Parent failure options       | `FailParentOnFailure`, `ContinueParentOnFailure`, `IgnoreDependencyOnFailure`, `RemoveDependencyOnFailure`, mutually exclusive                                                                                            |
| Deduplication                | Only on a root without children nor parent, as in Node.js                                                                                                                                                                 |
| Parents completing too early | A parent that completes with pending children, or with a child that failed it, fails (`Job X has pending dependencies`), as in Node.js                                                                                    |
| Errors                       | `Add`/`AddBulk` return an error when the datastore rejects a job (missing parent, child of another parent); the jobs it accepted are kept, as in Node.js, which only reports the root of `add` and nothing from `addBulk` |
| Per-node `prefix`            | Not supported: a flow lives in the namespace of the producer's backend factory. Use another `FlowProducer` for another prefix                                                                                             |

### Job schedulers

| Feature                                               | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UpsertJobScheduler`                                  | Cron `Pattern` or `Every` interval, with `Offset`, `Limit`, `Immediately`, `StartDate`, `EndDate` and `Tz`; template name, data and options                                                                                                                                                                                                                                                                                                                                 |
| `RemoveJobScheduler`                                  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `JobScheduler`, `JobSchedulers`, `JobSchedulersCount` | Paginated by next run; iteration count, schedule and template                                                                                                                                                                                                                                                                                                                                                                                                               |
| Worker reschedule-on-fetch                            | The worker that fetches an iteration adds the next one before processing it, as in Node.js; Go and other ports advance each other's schedulers                                                                                                                                                                                                                                                                                                                              |
| Cron patterns                                         | Evaluated exactly like cron-parser 5.10.6, the version Node.js pins (5 or 6 fields, names, `L`, `#`, Sunday as 0 or 7, DST changes); `W` and hashed (`H`) expressions are rejected                                                                                                                                                                                                                                                                                          |
| Time zones                                            | Resolved as Node.js resolves them (Luxon and Intl): IANA names in any case, ICU's legacy ids such as `PST`, and fixed offsets (`+03:00`, `+0300`, `UTC+3`); ICU's deprecated `SystemV/*` ids are not supported. A worker that cannot resolve a scheduler's time zone (for example without a tz database: import `time/tzdata`) fails the fetched iteration with the reason and an `EventError`, unprocessed and without adding the next one, instead of leaving it to stall |
| Legacy repeatable jobs                                | Not supported, as in Node.js 6: their jobs are processed and a migration error is reported                                                                                                                                                                                                                                                                                                                                                                                  |

### QueueEvents

Streams every event published by any worker on the queue, in any language.

## Not implemented

| Feature                                | Notes                                                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Sandboxed processors                   | Not applicable; use goroutines.                                                                                                          |
| Telemetry / OpenTelemetry              | No tracing hooks yet.                                                                                                                    |
| Redis Cluster and Sentinel             | Only standalone Redis is exercised by the test suite. You can pass your own `redis.UniversalClient`, but this configuration is untested. |
| Global concurrency groups (BullMQ Pro) | Pro-only feature.                                                                                                                        |

## PostgreSQL

The [`postgresbackend`](./postgresbackend) package implements the whole
`Backend` contract on PostgreSQL 13 or newer, with the migrations and commands
of `src/postgres` that every port shares. Everything listed above works on
both datastores, and the behaviour test suite runs on both.

| Topic            | PostgreSQL behaviour                                                                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Namespace        | `Options.Schema` (default `bullmq`) instead of a key prefix. `Queue.Backend().QualifiedName()` is the bare queue name, as in Node.js.                                                                                                                                                                                          |
| Migrations       | Applied on first use, in one transaction under the shared advisory lock, and recorded in the `migration` ledger every runtime reads. A schema whose ledger requires a newer BullMQ major is refused with `SchemaVersionError`. A legacy .NET `bullmq_migration` ledger is adopted.                                             |
| Connections      | Queries run on a pgxpool pool (`PoolSize`, default 20) shared by the backends of the process with the same settings, or on a caller-supplied `*pgxpool.Pool`. Workers and `QueueEvents` add one dedicated `LISTEN` connection each, outside the pool.                                                                          |
| Blocking fetch   | `LISTEN bullmq_jobs` on the dedicated connection. Before blocking, and after each notification for the queue, the worker checks for a claimable job and the next delayed job, whose due time it reports once, like the Redis delayed marker. Nothing is reported while the queue is paused or at its global concurrency limit. |
| Events           | Stored in the `event` table and delivered with `LISTEN bullmq_events`. Event ids are numbers; the Redis forms `0-0` and `<id>-<seq>` are accepted. As with every runtime on the shared SQL, a listener can miss an event whose transaction commits after a later event was read, which happens with concurrent workers.        |
| Worker discovery | `Queue.Workers` lists the `application_name` of the workers' dedicated connections: `{queue}` or `{queue}:w:{name}`, as the Node.js PostgreSQL backend names them. Pooled sessions are never named.                                                                                                                            |
| Pause            | A queue flag: waiting jobs stay waiting and keep being counted as waiting.                                                                                                                                                                                                                                                     |
| Prioritized jobs | Waiting jobs with a priority, reported as `prioritized`.                                                                                                                                                                                                                                                                       |
| Job options      | Stored with the long `JobsOptions` names (`deduplication`, `keepLogs`, `failParentOnFailure`, ...) that the shared SQL reads, as the other ports store them on PostgreSQL.                                                                                                                                                     |
| Job schedulers   | Stored in the `scheduler` table. As in Node.js, `JobSchedulers` with a negative end returns every remaining scheduler, and an `Every` scheduler that missed iterations catches up with the shared SQL's formula.                                                                                                               |

## Compatibility

The port embeds the shared Lua scripts unchanged, encodes script arguments with
the same MessagePack layout, and uses the same Redis key names and job hash
field abbreviations. On PostgreSQL it embeds the shared SQL unchanged and
stores jobs in the same tables and shape as the other ports. A queue can
therefore be produced by one language and consumed by another.
