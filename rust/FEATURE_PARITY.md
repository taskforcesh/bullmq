# BullMQ Rust — Feature Parity Tracker

Compared against Node.js BullMQ (master branch). Updated: 2025-05-27.

## Legend

- ✅ Implemented
- 🚧 Partial
- ❌ Not implemented

---

## Classes

| Class               | Status | Notes                                              |
| ------------------- | ------ | -------------------------------------------------- |
| Queue               | ✅     | Core methods implemented                           |
| Worker              | ✅     | Core processing loop with concurrency              |
| Job                 | ✅     | Lifecycle methods, progress, retry                 |
| QueueEvents         | ❌     | Global stream-based event listener                 |
| FlowProducer        | ❌     | Parent/child job dependency trees                  |
| JobScheduler        | ❌     | Cron/interval-based job scheduling                 |
| Sandbox / ChildPool | ❌     | Sandboxed processors in separate processes/threads |

---

## Queue Methods

| Method                                                       | Status |
| ------------------------------------------------------------ | ------ |
| add / addBulk                                                | ✅     |
| pause / resume / isPaused                                    | ✅     |
| drain                                                        | ✅     |
| obliterate                                                   | ✅     |
| clean                                                        | ✅     |
| retryJobs                                                    | ✅     |
| promoteJobs                                                  | ✅     |
| getJob / getJobs                                             | ✅     |
| getJobCounts                                                 | ✅     |
| getJobState                                                  | ✅     |
| getJobLogs                                                   | ✅     |
| remove (single job)                                          | ✅     |
| trimEvents                                                   | ✅     |
| getWaitingCount / getActiveCount / etc.                      | ✅     |
| setGlobalConcurrency / removeGlobalConcurrency               | ❌     |
| setGlobalRateLimit / removeGlobalRateLimit                   | ❌     |
| rateLimit / removeRateLimitKey / getRateLimitTtl             | ❌     |
| upsertJobScheduler / removeJobScheduler / getJobSchedulers   | ❌     |
| getRepeatableJobs / removeRepeatable / removeRepeatableByKey | ❌     |
| removeDebounceKey / removeDeduplicationKey                   | ❌     |
| getCountsPerPriority                                         | ❌     |
| getWorkersCount                                              | ❌     |
| getMetrics                                                   | ❌     |
| getVersion                                                   | ❌     |

---

## Worker Features

| Feature                                           | Status |
| ------------------------------------------------- | ------ |
| Configurable concurrency                          | ✅     |
| Dynamic concurrency (set_concurrency)             | ✅     |
| Stalled job detection + recovery                  | ✅     |
| Lock renewal                                      | ✅     |
| Retry with backoff (fixed/exponential/custom)     | ✅     |
| Graceful close with timeout                       | ✅     |
| Pause / resume                                    | ✅     |
| Events (local channel)                            | ✅     |
| Progress forwarding                               | ✅     |
| CancellationToken                                 | ✅     |
| Rate limiting (limiter option)                    | ❌     |
| Sandboxed processors (file path / worker threads) | ❌     |
| maxStartedAttempts                                | ❌     |
| skipStalledCheck                                  | ❌     |
| skipLockRenewal                                   | ❌     |
| Metrics option (time-series)                      | ❌     |
| Telemetry / OpenTelemetry                         | ❌     |
| Force close (immediate termination)               | ❌     |

---

## Job Features

| Feature                                     | Status |
| ------------------------------------------- | ------ |
| update_progress                             | ✅     |
| log                                         | ✅     |
| retry                                       | ✅     |
| get_state / is_completed / is_failed / etc. | ✅     |
| move_to_completed / move_to_failed          | ✅     |
| move_to_delayed                             | ✅     |
| extend_lock                                 | ✅     |
| promote                                     | ✅     |
| change_delay                                | ✅     |
| change_priority                             | ✅     |
| moveToWaitingChildren                       | ❌     |
| getChildrenValues                           | ❌     |
| getDependencies / getDependenciesCount      | ❌     |
| remove (job-level with children)            | ❌     |
| discard                                     | ❌     |
| removeChildDependency                       | ❌     |
| updateData                                  | ❌     |

---

## Job Options

| Option                             | Status |
| ---------------------------------- | ------ |
| delay                              | ✅     |
| priority                           | ✅     |
| attempts                           | ✅     |
| backoff (fixed/exponential/custom) | ✅     |
| lifo                               | ✅     |
| jobId (custom ID)                  | ✅     |
| removeOnComplete / removeOnFail    | ✅     |
| deduplication                      | ✅     |
| repeat / cron (JobScheduler)       | ❌     |
| parent (full flow support)         | ❌     |
| failParentOnFailure                | ❌     |
| removeDependencyOnFailure          | ❌     |
| sizeLimit                          | ❌     |

---

## Connection & Infrastructure

| Feature                                   | Status |
| ----------------------------------------- | ------ |
| Single Redis connection (multiplexed)     | ✅     |
| Configurable URL                          | ✅     |
| Redis Cluster                             | ❌     |
| Sentinel support                          | ❌     |
| TLS / username+password auth (beyond URL) | ❌     |
| Shared connections across instances       | ❌     |
| Dragonfly compatibility                   | ❌     |

---

## QueueEvents (entire class missing)

All global stream events unavailable:
`active`, `added`, `cleaned`, `completed`, `deduplicated`, `delayed`,
`drained`, `duplicated`, `error`, `failed`, `paused`, `progress`,
`removed`, `resumed`, `retries-exhausted`, `stalled`, `waiting`,
`waiting-children`

---

## Advanced Features

| Feature                           | Status |
| --------------------------------- | ------ |
| Global rate limiting              | ❌     |
| Job schedulers (cron/repeat)      | ❌     |
| FlowProducer / parent-child flows | ❌     |
| Sandboxed processors              | ❌     |
| Redis Cluster                     | ❌     |
| Telemetry / OpenTelemetry         | ❌     |
| Metrics collection (time-series)  | ❌     |
| Global concurrency                | ❌     |
| Custom event publishing           | ❌     |
