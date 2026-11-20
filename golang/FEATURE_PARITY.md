# Feature parity

Status of the Go port relative to the reference Node.js implementation
(`src/` at the root of this repository). Everything under **Supported** works
on both backends, Redis and PostgreSQL, and the behaviour test suite runs on
both; the [PostgreSQL](#postgresql) section lists the differences.

## Supported

### Queue

| Feature                                                | Notes                                                                                                                                  |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Add`, `AddBulk`                                       | Standard, delayed, prioritized and LIFO jobs. `AddBulk` is one `MULTI`/`EXEC` on Redis, as in Node.js, and one statement on PostgreSQL |
| Custom job ids                                         | `JobOptions.JobID`; integer ids and ids with `:` are rejected, as in Node.js                                                           |
| Default job options                                    | `QueueOptions.DefaultJobOptions`                                                                                                       |
| Deduplication                                          | `JobOptions.Deduplication`: simple, throttle (`TTL`) and debounce (`Extend`, `Replace`) modes                                          |
| `Pause`, `Resume`, `IsPaused`                          |                                                                                                                                        |
| `Drain`, `Obliterate`, `Clean`                         | `Clean` removes at most 10,000 jobs per call to the datastore, like Node.js                                                            |
| `Job`, `JobState`, `Jobs`, `JobIDs`                    | Node's `getJob`, `getJobState`, `getJobs` and `getRanges`                                                                              |
| `Count`, `JobCounts`                                   | Node's `count` and `getJobCounts`                                                                                                      |
| `RetryJobs`, `PromoteJobs`                             |                                                                                                                                        |
| `IsMaxed`, `SetGlobalConcurrency`, `GlobalConcurrency` | `SetGlobalConcurrency(ctx, 0)` removes the limit (Node's `removeGlobalConcurrency`)                                                    |
| `SetGlobalRateLimit`, `RateLimitTTL`                   |                                                                                                                                        |
| `Metrics`                                              | Completed and failed data points, collected by workers with `WorkerOptions.Metrics`                                                    |
| `Workers`                                              | Names of the connected workers: `CLIENT LIST` on Redis, the `application_name` of the workers' connections on PostgreSQL               |
| Job schedulers                                         | See [Job schedulers](#job-schedulers)                                                                                                  |

### Worker

| Feature                             | Notes                                                                                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Concurrency                         | `WorkerOptions.Concurrency`, one goroutine per job                                                                                                                                                             |
| Fetch-next                          | Each slot fetches its next job when it finishes the current one, re-using its lock token, as in Node.js                                                                                                        |
| Blocking fetch                      | Redis: `BZPOPMIN` on the marker key on a dedicated connection, for the whole `DrainDelay`, interrupted on close. PostgreSQL: `LISTEN` on a dedicated connection. Both wake up when the next delayed job is due |
| Lock renewal                        | Disable with `SkipLockRenewal`; `EventLocksRenewed` and `EventLockRenewalFailed`. A lost lock also cancels the job's context (`ErrLockLost`), unlike Node                                                      |
| Stalled job recovery                | Disable with `SkipStalledCheck`; `EventStalled`; `MaxStalledCount`                                                                                                                                             |
| Retries and backoff                 | Fixed, exponential (with `Jitter`) and custom `BackoffStrategy`; delays are clamped so they can't overflow                                                                                                     |
| `UnrecoverableError`, `Job.Discard` | Skip the remaining attempts                                                                                                                                                                                    |
| Deferred failures                   | A job the stalled check marked as failed (`defa`) fails without running, as in Node.js                                                                                                                         |
| `MaxStartedAttempts`                | Checked after a deferred failure, as in Node.js                                                                                                                                                                |
| `StackTraceLimit`                   | Job option; every trace is kept by default, as in Node.js                                                                                                                                                      |
| Panic recovery                      | A panicking processor fails the attempt instead of crashing the process                                                                                                                                        |
| Rate limiting                       | `WorkerOptions.Limiter` and global rate limits; the limit is slept out, at most `MaximumRateLimitDelay` at a time                                                                                              |
| Manual rate limiting                | `Worker.RateLimit` and `ErrRateLimited` (Node's `rateLimit` and `RateLimitError`)                                                                                                                              |
| Global concurrency                  | Honoured by every worker of the queue                                                                                                                                                                          |
| `RemoveOnComplete` / `RemoveOnFail` | Boolean, count, age and limit, per job or as worker defaults, stored in the same forms as Node.js (`RemoveAll` is `true`)                                                                                      |
| Metrics                             | `WorkerOptions.Metrics`                                                                                                                                                                                        |
| `Pause`, `Resume`, `IsPaused`       | `Pause(ctx, doNotWaitActive)` waits for the active jobs, as in Node.js                                                                                                                                         |
| `Close`                             | Graceful: waits for the jobs in flight. Cancelling the `Run` context instead leaves them active, without using up an attempt, for stalled recovery, as Node's `close(true)`                                    |
| `CancelJob`, `CancelAllJobs`        | Cancel the job's context; the job fails with the reason if its processor returns an error, as in Node.js                                                                                                       |
| Moving jobs from the processor      | `Job.MoveToDelayed` + `ErrDelayed`, `Job.MoveToWaitingChildren` + `ErrWaitingChildren`                                                                                                                         |
| Events                              | Active, progress, completed, failed, stalled, lock renewal, drained, error, closed, on a buffered channel; synchronous `OnEvent`; `DroppedEvents`                                                              |
| Transient errors                    | Finishing a job retries connection and availability errors, as Node's `retryIfFailed` does                                                                                                                     |

### Job

`UpdateProgress`, `UpdateData`, `Log`, `Logs`, `State`, `IsCompleted`,
`IsFailed`, `Remove`, `Promote`, `Retry`, `ChangeDelay`, `ChangePriority`,
`ExtendLock`, `MoveToDelayed`, `MoveToWaitingChildren`, `DecodeData`,
`DecodeReturnValue`.

Parent jobs: `ChildrenValues`, `Dependencies` (paginated), `DependenciesCount`,
`IgnoredChildrenFailures` (and the deprecated `FailedChildrenValues`),
`RemoveChildDependency` and `RemoveUnprocessedChildren`: Node's
`getChildrenValues`, `getDependencies`, `getDependenciesCount`,
`getIgnoredChildrenFailures`, `getFailedChildrenValues`,
`removeChildDependency` and `removeUnprocessedChildren`.

### FlowProducer

| Feature                      | Notes                                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Add`, `AddBulk`             | Trees of jobs across queues, inserted in one Redis transaction or one SQL statement; per-queue default options with `FlowOpts.QueuesOptions`                                                                              |
| `GetFlow`                    | `Depth` and `MaxChildren`, as in Node.js                                                                                                                                                                                  |
| Parent failure options       | `FailParentOnFailure`, `ContinueParentOnFailure`, `IgnoreDependencyOnFailure`, `RemoveDependencyOnFailure`, mutually exclusive                                                                                            |
| Children added at runtime    | `JobOptions.Parent`, or a flow whose root has a parent, then `Job.MoveToWaitingChildren`                                                                                                                                  |
| Deduplication                | Only on a root without children nor parent, as in Node.js                                                                                                                                                                 |
| Parents completing too early | A parent that completes with pending children, or with a child that failed it, fails (`Job X has pending dependencies`), as in Node.js                                                                                    |
| Errors                       | `Add`/`AddBulk` return an error when the datastore rejects a job (missing parent, child of another parent); the jobs it accepted are kept, as in Node.js, which only reports the root of `add` and nothing from `addBulk` |

### Job schedulers

| Feature                                               | Notes                                                                                                                                                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UpsertJobScheduler`                                  | Cron `Pattern` or `Every` interval, with `Offset`, `Limit`, `Immediately`, `StartDate`, `EndDate` and `Tz`; template name, data and options                                        |
| `RemoveJobScheduler`                                  |                                                                                                                                                                                    |
| `JobScheduler`, `JobSchedulers`, `JobSchedulersCount` | Paginated by next run; iteration count, schedule and template                                                                                                                      |
| Worker reschedule-on-fetch                            | The worker that fetches an iteration adds the next one before processing it, as in Node.js; Go and the other ports advance each other's schedulers                                 |
| Cron patterns                                         | Evaluated exactly like cron-parser 5.10.6, the version Node.js pins (5 or 6 fields, names, `L`, `#`, Sunday as 0 or 7, DST changes); `W` and hashed (`H`) expressions are rejected |
| Time zones                                            | IANA names, read from the system's time zone database; import `time/tzdata` where there is none. Without `Tz`, the process's local time zone, as in Node.js                        |
| Legacy repeatable jobs                                | Not supported, as in Node.js 6: their jobs are processed and a migration error is reported                                                                                         |

### QueueEvents

Streams every event published on the queue by any worker or producer, in any
language, from the newest event (`$`, the default) or from a given id. Events
are delivered as raw `QueueEvent` values (name, job id and fields), on a
channel that waits for its reader. On PostgreSQL, see
[#5183](https://github.com/taskforcesh/bullmq/issues/5183) below.

## Not implemented

### Not planned

| Feature                              | Notes                                                    |
| ------------------------------------ | -------------------------------------------------------- |
| Sandboxed processors, worker threads | Not applicable; processors run on goroutines             |
| Legacy repeatable jobs (`repeat`)    | Removed in Node.js 6 too; use job schedulers             |
| BullMQ Pro features                  | Groups, batches, observables and the other Pro-only APIs |

### Not implemented yet

| Feature                                                     | Notes                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telemetry / OpenTelemetry                                   | No tracing hooks; worker events and `OnEvent` are the extension point                                                                                                                                                                                           |
| Redis Cluster and Sentinel                                  | A `redis.UniversalClient` can be passed as `redisbackend.Options.Client`, but only standalone Redis is tested. Cluster clients need a hash-tagged prefix such as `{bull}` and can't have their blocking reads interrupted                                       |
| TLS and other connection settings in `redisbackend.Options` | Pass a configured go-redis client as `Client`                                                                                                                                                                                                                   |
| Manual job fetching                                         | Node's `Worker.getNextJob`, `Job.moveToCompleted`, `Job.moveToFailed`, `Job.moveToWait` and `Worker.extendJobLocks`                                                                                                                                             |
| `Job.waitUntilFinished`                                     | Use `QueueEvents`, or poll `Queue.JobState`                                                                                                                                                                                                                     |
| Deduplication key helpers                                   | `Queue.getDeduplicationJobId`, `Queue.removeDeduplicationKey` and `Job.removeDeduplicationKey`                                                                                                                                                                  |
| Global rate limit helpers                                   | `Queue.removeGlobalRateLimit`, `Queue.getGlobalRateLimit`, `Queue.removeRateLimitKey`, and `Queue.rateLimit` (`Worker.RateLimit` exists)                                                                                                                        |
| Other queue helpers                                         | `Queue.remove`, `updateJobProgress` and `addJobLog` by id (use the `Job` methods), `trimEvents`, `removeOrphanedJobs`, `getMeta`, `getVersion`, `getCountsPerPriority`, `getWorkersCount`, `getQueueEvents`, `exportPrometheusMetrics`, `recordJobCountsMetric` |
| Other job helpers                                           | `Job.clearLogs`; `isActive`, `isDelayed`, `isWaiting` and `isWaitingChildren` (use `State`)                                                                                                                                                                     |
| Worker helpers                                              | `Worker.delay`, `isRunning`, `waitUntilReady`; the transition retry delay (Node's `runRetryDelay`) is fixed at 5 s                                                                                                                                              |
| Typed `QueueEvents` and `QueueEventsProducer`               | Events are raw entries; custom events can't be published                                                                                                                                                                                                        |
| Per-node `prefix` in flows                                  | A flow lives in the namespace of the producer's backend. Use another `FlowProducer` for another prefix                                                                                                                                                          |

## PostgreSQL

The [`postgresbackend`](./postgresbackend) package implements the whole
`Backend` contract on PostgreSQL 13 or newer, with the migrations and commands
of `src/postgres` that every port shares.

| Topic            | PostgreSQL behaviour                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Namespace        | `Options.Schema` (default `bullmq`) instead of a key prefix. `Queue.Backend().QualifiedName()` is the bare queue name, as in Node.js, and child keys are `<queue>:<id>`.                                                                                                                                                                                                                        |
| Migrations       | Applied by the first operation of the process (Node.js only migrates when `runMigrations` is called), in one transaction under the shared advisory lock, and recorded in the `migration` ledger every runtime reads. Every new backend checks the ledger: a schema that requires a newer BullMQ major is refused with `SchemaVersionError`. A legacy .NET `bullmq_migration` ledger is adopted. |
| Connections      | Queries run on a pgxpool pool (`PoolSize`, default 20) shared by the backends of the process with the same settings, or on a caller-supplied `*pgxpool.Pool`, whose `search_path` must be the schema. Workers and `QueueEvents` add one dedicated `LISTEN` connection each, outside the pool.                                                                                                   |
| Blocking fetch   | `LISTEN bullmq_jobs` on the dedicated connection. Before blocking, and after each notification for the queue, the worker checks for a claimable job and the next delayed job, whose due time it reports once, like the Redis delayed marker. Nothing is reported while the queue is paused or at its global concurrency limit.                                                                  |
| Events           | Stored in the `event` table and delivered with `LISTEN bullmq_events`. Event ids are numbers; the Redis forms `0-0` and `<id>-<seq>` are accepted.                                                                                                                                                                                                                                              |
| Worker discovery | `Queue.Workers` lists the `application_name` of the workers' dedicated connections: `{queue}` or `{queue}:w:{name}`, as the Node.js PostgreSQL backend names them. Pooled sessions are never named.                                                                                                                                                                                             |
| Pause            | A queue flag: waiting jobs stay waiting and keep being counted as waiting.                                                                                                                                                                                                                                                                                                                      |
| Prioritized jobs | Waiting jobs with a priority, reported as `prioritized`.                                                                                                                                                                                                                                                                                                                                        |
| Job options      | Stored with the long `JobsOptions` names (`deduplication`, `keepLogs`, `failParentOnFailure`, ...) that the shared SQL reads, as the other ports store them on PostgreSQL.                                                                                                                                                                                                                      |
| Job schedulers   | Stored in the `scheduler` table. As in Node.js, `JobSchedulers` with a negative end returns every remaining scheduler, and an `Every` scheduler that missed iterations catches up with the shared SQL's formula.                                                                                                                                                                                |
| Transient errors | Connection errors, serialization failures (`40001`) and deadlocks (`40P01`) are transient: a failed fetch is reported as `EventError` and retried after 5 s, and finishing a job is retried.                                                                                                                                                                                                    |

### Known issues of the shared SQL

These affect every runtime that uses the shared PostgreSQL SQL. They are
tracked upstream and not worked around in this port unless stated.

| Issue                                                      | Effect on Go                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#5160](https://github.com/taskforcesh/bullmq/issues/5160) | A keep-count of 0 makes the shared SQL delete every finished job of the queue. Go workers avoid it: `RemoveAll()` and a count of 0 remove only the finished job, as on Redis. Jobs finished by the Node.js, Python or .NET workers on the same schema are still affected. |
| [#5183](https://github.com/taskforcesh/bullmq/issues/5183) | `QueueEvents` can miss events when several jobs finish at once: event ids are assigned before their transaction commits, so a listener can read past an event that commits later. Don't count on seeing every `completed` or `failed` event.                              |
| [#5184](https://github.com/taskforcesh/bullmq/issues/5184) | The .NET port names its connections `<schema>:<queue>...`, so `Queue.Workers` doesn't list .NET workers, and .NET doesn't list Go or Node.js workers.                                                                                                                     |
| [#5185](https://github.com/taskforcesh/bullmq/issues/5185) | `move_to_active` can deadlock (`40P01`) while promoting delayed jobs under concurrent workers. A Go worker reports it as an `EventError` and fetches again after 5 s; no job is failed by it.                                                                             |

## Compatibility

On Redis the port embeds the shared Lua scripts unchanged, encodes script
arguments with the same MessagePack layout, and uses the same key names and
job hash fields. On PostgreSQL it embeds the shared SQL unchanged and stores
jobs in the same tables and shape as the other ports. A queue can therefore
be produced by one language and consumed by another, as long as both use the
same Redis prefix or PostgreSQL schema.
