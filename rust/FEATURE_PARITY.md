# BullMQ Rust — Feature Parity Tracker

Compared against Node.js BullMQ (master branch). Updated: 2026-06-18.

## Legend

- ✅ Implemented
- 🚧 Partial
- ❌ Not implemented

---

## Classes

| Class               | Status | Notes                                                 |
| ------------------- | ------ | ----------------------------------------------------- |
| Queue               | ✅     | Add, getters, counts, metrics, schedulers, rate limit |
| Worker              | ✅     | Concurrency, stalled detection, lock renewal, metrics |
| Job                 | ✅     | Full lifecycle, flows, logs, discard                  |
| FlowProducer        | ✅     | Parent/child trees, `get_flow`, per-queue options     |
| JobScheduler        | ✅     | Cron/interval scheduling (methods live on `Queue`)    |
| QueueEvents         | ✅     | Cross-process stream event listener (`queue_events`)  |
| Sandbox / ChildPool | ❌     | Not applicable — use native Rust tasks/threads        |

---

## Queue Methods

| Method                                                                                                                                                 | Status |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| add / add_bulk                                                                                                                                         | ✅     |
| pause / resume / is_paused                                                                                                                             | ✅     |
| drain                                                                                                                                                  | ✅     |
| obliterate                                                                                                                                             | ✅     |
| clean                                                                                                                                                  | ✅     |
| retry_jobs                                                                                                                                             | ✅     |
| promote_jobs                                                                                                                                           | ✅     |
| get_job / get_jobs / get_ranges                                                                                                                        | ✅     |
| get_waiting / get_active / get_delayed / get_completed / get_failed / get_prioritized / get_waiting_children                                           | ✅     |
| get_job_counts / get_job_counts_by_types / get_job_count_by_types                                                                                      | ✅     |
| count / get_counts_per_priority                                                                                                                        | ✅     |
| get_completed_count / get_failed_count / get_active_count / get_delayed_count / get_prioritized_count / get_waiting_count / get_waiting_children_count | ✅     |
| get_job_state                                                                                                                                          | ✅     |
| get_job_logs                                                                                                                                           | ✅     |
| remove / remove_without_children / remove_unprocessed_children                                                                                         | ✅     |
| trim_events                                                                                                                                            | ✅     |
| set_global_concurrency / remove_global_concurrency / get_global_concurrency                                                                            | ✅     |
| set_global_rate_limit / remove_global_rate_limit / get_global_rate_limit                                                                               | ✅     |
| rate_limit / remove_rate_limit_key / get_rate_limit_ttl                                                                                                | ✅     |
| upsert_job_scheduler / remove_job_scheduler / get_job_scheduler / get_job_schedulers / get_job_schedulers_count                                        | ✅     |
| remove_deduplication_key / get_deduplication_job_id                                                                                                    | ✅     |
| get_metrics                                                                                                                                            | ✅     |
| get_children_values / get_failed_children_values / get_dependencies_count / get_unprocessed_dependencies / remove_child_dependency                     | ✅     |
| get_workers / get_workers_count                                                                                                                        | ✅     |
| get_meta / get_version                                                                                                                                 | ✅     |
| export_prometheus_metrics                                                                                                                              | ✅     |
| is_maxed                                                                                                                                               | ✅     |
| get_debounce_job_id / remove_debounce_key (deprecated aliases)                                                                                         | ✅     |
| remove_orphaned_jobs / get_repeatable_jobs / remove_repeatable (legacy)                                                                                | ❌     |

---

## Worker Features

| Feature                                                       | Status   |
| ------------------------------------------------------------- | -------- |
| Configurable concurrency                                      | ✅       |
| Dynamic concurrency (set_concurrency)                         | ✅       |
| Stalled job detection + recovery                              | ✅       |
| Lock renewal                                                  | ✅       |
| Retry with backoff (fixed/exponential/custom)                 | ✅       |
| Graceful close with timeout                                   | ✅       |
| Pause / resume                                                | ✅       |
| Events (local channel)                                        | ✅       |
| Progress forwarding                                           | ✅       |
| CancellationToken                                             | ✅       |
| Rate limiting (limiter option)                                | ✅       |
| Metrics option (time-series)                                  | ✅       |
| Manual processing (get_next_job)                              | ✅       |
| Sandboxed processors (worker threads)                         | ❌ (N/A) |
| max_started_attempts / skip_stalled_check / skip_lock_renewal | ✅       |
| Telemetry / OpenTelemetry                                     | ❌       |

---

## Job Features

| Feature                                                                                          | Status                     |
| ------------------------------------------------------------------------------------------------ | -------------------------- |
| update_progress                                                                                  | ✅                         |
| update_data                                                                                      | ✅                         |
| log / clear_logs                                                                                 | ✅                         |
| retry                                                                                            | ✅                         |
| discard                                                                                          | ✅                         |
| get_state / is_completed / is_failed / is_active / is_waiting / is_delayed / is_waiting_children | ✅                         |
| move_to_completed / move_to_failed / move_to_delayed                                             | ✅                         |
| move_to_waiting_children                                                                         | ✅                         |
| extend_lock                                                                                      | ✅                         |
| promote                                                                                          | ✅                         |
| change_delay / change_priority                                                                   | ✅                         |
| get_children_values                                                                              | ✅                         |
| get_dependencies / get_dependencies_count                                                        | ✅                         |
| get_ignored_children_failures / get_failed_children_values                                       | ✅                         |
| remove_child_dependency                                                                          | ✅                         |
| wait_until_finished                                                                              | ❌ (intentionally skipped) |

---

## Job Options

| Option                                           | Status |
| ------------------------------------------------ | ------ |
| delay                                            | ✅     |
| priority                                         | ✅     |
| attempts                                         | ✅     |
| backoff (fixed/exponential/custom)               | ✅     |
| lifo                                             | ✅     |
| jobId (custom ID)                                | ✅     |
| removeOnComplete / removeOnFail (bool/count/age) | ✅     |
| keepLogs                                         | ✅     |
| deduplication                                    | ✅     |
| repeat / cron (JobScheduler)                     | ✅     |
| parent (full flow support)                       | ✅     |
| failParentOnFailure                              | ✅     |
| removeDependencyOnFailure                        | ✅     |
| ignoreDependencyOnFailure                        | ✅     |
| continueParentOnFailure                          | ✅     |
| sizeLimit                                        | ✅     |
| keepLogs / KeepJobs.limit                        | ✅     |
| telemetry                                        | ❌     |

---

## Connection & Infrastructure

| Feature                                        | Status        |
| ---------------------------------------------- | ------------- |
| Single Redis connection (multiplexed)          | ✅            |
| Configurable URL                               | ✅            |
| Typed options (host/port/username/password/db) | ✅            |
| TLS (`rediss://`)                              | ✅            |
| Redis Cluster                                  | ❌            |
| Sentinel support                               | ❌            |
| Dragonfly compatibility                        | 🚧 (untested) |

---

## QueueEvents (implemented)

The global stream-based event listener is implemented in the `queue_events`
module (`QueueEvents`, `QueueEvent`, `QueueEventEntry`, `QueueEventsOptions`).
It opens a dedicated blocking connection and consumes the
`{prefix}:{name}:events` stream via `XREAD BLOCK`, exposing typed events through
`next_event()`. Supported event variants mirror the Node.js names:
`active`, `added`, `cleaned`, `completed`, `deduplicated`, `debounced`,
`delayed`, `drained`, `duplicated`, `error`, `failed`, `paused`, `progress`,
`removed`, `resumed`, `retries-exhausted`, `stalled`, `waiting`,
`waiting-children` (plus an `Other` fallback for forward compatibility).

`Job.wait_until_finished()` remains intentionally unimplemented — it is mainly a
testing convenience in Node.js and is prone to misuse in production.

---

## Advanced Features

| Feature                           | Status           |
| --------------------------------- | ---------------- |
| Global rate limiting              | ✅               |
| Global concurrency                | ✅               |
| Job schedulers (cron/repeat)      | ✅               |
| FlowProducer / parent-child flows | ✅               |
| Metrics collection (time-series)  | ✅               |
| Prometheus metrics export         | ✅               |
| TLS connections                   | ✅               |
| Sandboxed processors              | ❌ (N/A in Rust) |
| Redis Cluster                     | ❌               |
| Telemetry / OpenTelemetry         | ❌               |
| QueueEvents (cross-process)       | ✅               |

---

# Implementation Status

## Recently completed

These items were implemented with Node-parity integration tests (run with
`cargo test`; tests require a Redis instance at `redis://127.0.0.1:6379`):

1. **QueueEvents** (`src/queue_events.rs`) — cross-process, stream-based event
   listener (`QueueEvents`, `QueueEvent`, `QueueEventEntry`, `QueueEventsOptions`).
   Tests: `tests/queue_events_test.rs`.
2. **`get_workers` / `get_workers_count`** — workers register a client name
   (`CLIENT SETNAME`) on their blocking connection; the queue discovers them via
   `CLIENT LIST`. Tests: `tests/workers_test.rs`.
3. **Queue meta getters** — `get_meta` (typed `QueueMeta`), `get_version`,
   `is_maxed`. Tests: `tests/meta_test.rs`.
4. **`export_prometheus_metrics`** — Prometheus text-exposition output with
   optional global labels. Tests: `tests/prometheus_test.rs`.
5. **Worker behavioural flags** — `max_started_attempts`, `skip_stalled_check`,
   `skip_lock_renewal`. Tests: `tests/worker_options_test.rs`.
6. **Job options** — `size_limit` (client-side byte-length validation) and
   `KeepJobs.limit`. Tests: `tests/job_options_test.rs`.
7. **Deprecated debounce aliases** — `get_debounce_job_id`,
   `remove_debounce_key`. Tests: `tests/deduplication_test.rs`.
8. **Convenience methods** — `Queue::update_job_progress`, `Job::move_to_wait`,
   `Queue::record_job_counts_metric`. Tests: `tests/convenience_methods_test.rs`.

## Still missing

Ordered roughly by value/effort.

### Legacy / maintenance Queue methods

Lua scripts already vendored: `removeOrphanedJobs-1`, `removeRepeatable-3`,
`paginate-1`.

- `remove_orphaned_jobs(count, limit)` → `removeOrphanedJobs` script. **Note:**
  this method deletes job keys based on a precise set of known key suffixes; it
  must be ported carefully (an incorrect suffix set risks deleting live job
  data), which is why it is still pending.
- `get_repeatable_jobs` / `remove_repeatable` / `remove_repeatable_by_key` —
  legacy repeat API (superseded by job schedulers), using `removeRepeatable`.
- `get_dependencies` (paginated, queue-level) → `paginate` script. Note:
  `Job::get_dependencies` already exists via HSCAN/SSCAN; this is the
  queue-level paginated variant returning `{items, jobs, total}`.
- `remove_deprecated_priority_key()` → small `DEL`/Lua cleanup.
- `get_queue_events()` — deprecated `CLIENT LIST` variant for QueueEvents clients.
- `QueueEventsProducer` — class for publishing _custom_ events into the stream
  (the consumer `QueueEvents` is implemented).

### Intentionally skipped (for now)

- **`Job.wait_until_finished`** — mainly a testing convenience in Node.js and
  prone to misuse in production; not needed by the Rust test suite.
- **Redis Cluster & Sentinel** — requires new CI infrastructure (cluster/sentinel
  docker-compose services) and a `RedisConnection` refactor over single/cluster/
  sentinel clients.
- **Telemetry / OpenTelemetry** — optional `tracing`/`opentelemetry` spans behind
  a cargo feature.
- **Sandboxed processors / worker threads** — not applicable in Rust; users run
  native `tokio` tasks or OS threads.
