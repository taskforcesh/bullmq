# BullMQ Rust — Feature Parity Tracker

Compared against Node.js BullMQ (master branch). Updated: 2026-06-10.

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
| QueueEvents         | ❌     | Global stream event listener (planned, separate PR)   |
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
| get_workers / get_workers_count                                                                                                                        | ❌     |
| get_meta / get_version                                                                                                                                 | ❌     |
| export_prometheus_metrics                                                                                                                              | ❌     |
| get_repeatable_jobs / remove_repeatable (legacy)                                                                                                       | ❌     |

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
| max_started_attempts / skip_stalled_check / skip_lock_renewal | ❌       |
| Telemetry / OpenTelemetry                                     | ❌       |

---

## Job Features

| Feature                                                                                          | Status                 |
| ------------------------------------------------------------------------------------------------ | ---------------------- |
| update_progress                                                                                  | ✅                     |
| update_data                                                                                      | ✅                     |
| log / clear_logs                                                                                 | ✅                     |
| retry                                                                                            | ✅                     |
| discard                                                                                          | ✅                     |
| get_state / is_completed / is_failed / is_active / is_waiting / is_delayed / is_waiting_children | ✅                     |
| move_to_completed / move_to_failed / move_to_delayed                                             | ✅                     |
| move_to_waiting_children                                                                         | ✅                     |
| extend_lock                                                                                      | ✅                     |
| promote                                                                                          | ✅                     |
| change_delay / change_priority                                                                   | ✅                     |
| get_children_values                                                                              | ✅                     |
| get_dependencies / get_dependencies_count                                                        | ✅                     |
| get_ignored_children_failures / get_failed_children_values                                       | ✅                     |
| remove_child_dependency                                                                          | ✅                     |
| wait_until_finished                                                                              | ❌ (needs QueueEvents) |

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
| sizeLimit                                        | ❌     |
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

## QueueEvents (planned in a separate PR)

The global stream-based event listener is not yet implemented. The following
events are therefore unavailable cross-process (the Worker still exposes them
via a local in-process channel through `WorkerEvent`):
`active`, `added`, `cleaned`, `completed`, `deduplicated`, `delayed`,
`drained`, `duplicated`, `error`, `failed`, `paused`, `progress`,
`removed`, `resumed`, `retries-exhausted`, `stalled`, `waiting`,
`waiting-children`

This also blocks `Job.wait_until_finished()`.

---

## Advanced Features

| Feature                           | Status           |
| --------------------------------- | ---------------- |
| Global rate limiting              | ✅               |
| Global concurrency                | ✅               |
| Job schedulers (cron/repeat)      | ✅               |
| FlowProducer / parent-child flows | ✅               |
| Metrics collection (time-series)  | ✅               |
| TLS connections                   | ✅               |
| Sandboxed processors              | ❌ (N/A in Rust) |
| Redis Cluster                     | ❌               |
| Telemetry / OpenTelemetry         | ❌               |
| QueueEvents (cross-process)       | ❌ (separate PR) |

---

# Next PR — Implementation Plan

Everything below is currently missing and should be implemented in the next PR.
Items are ordered roughly by value/effort. Each item lists the Node.js
reference, the Rust approach (including which Lua scripts already exist), and the
tests to port.

## 1. QueueEvents (cross-process event listener) — **largest item**

The global, Redis-stream-based event listener. Today the `Worker` only exposes
events via a local in-process `WorkerEvent` channel; there is no way to observe
events from another process/instance.

- **Node reference:** `src/classes/queue-events.ts`
- **Rust approach:**
  - New module `src/queue_events.rs` with a `QueueEvents` struct
    (`new`, `run`, `next_event`, `close`).
  - Use a **dedicated blocking connection** and loop on
    `XREAD BLOCK <timeout> COUNT <n> STREAMS {prefix}:{name}:events <last-id>`.
    Track the last stream id across iterations (start from `$` or a provided id).
  - Parse each stream entry's fields into a `QueueEvent` enum. The `event` field
    selects the variant; common fields are `jobId`, plus per-event extras.
  - Variants to support (match Node event names):
    `active {job_id, prev}`, `added {job_id, name}`, `cleaned {count}`,
    `completed {job_id, return_value, prev}`, `deduplicated {job_id, deduplication_id, deduplicated_job_id}`,
    `delayed {job_id, delay}`, `drained`, `duplicated {job_id}`, `error {message}`,
    `failed {job_id, failed_reason, prev}`, `paused`, `progress {job_id, data}`,
    `removed {job_id}`, `resumed`, `retries-exhausted {job_id, attempts_made}`,
    `stalled {job_id}`, `waiting {job_id, prev?}`, `waiting-children {job_id}`.
  - Expose events via `tokio::sync::mpsc`/`broadcast` plus an async `next_event()`
    mirroring the `Worker` API. Add a `QueueEventsOptions` (connection, prefix,
    blocking timeout, last event id).
  - Re-export `QueueEvents`, `QueueEvent`, `QueueEventsOptions` from `lib.rs`.
- **Scripts:** none required (raw `XREAD`).
- **Tests to port:** `tests/queue-events.test.ts` (added/completed/failed/
  progress/delayed/drained/removed, plus blocking-timeout behaviour).

## 2. Job.wait_until_finished (depends on QueueEvents)

- **Node reference:** `Job.waitUntilFinished` in `src/classes/job.ts`.
- **Rust approach:** `Job::wait_until_finished(&self, events: &QueueEvents, ttl_ms: Option<u64>)`.
  First check the current state (already completed/failed → return immediately by
  reading `returnvalue`/`failedReason`); otherwise subscribe to the `QueueEvents`
  stream and resolve on the `completed`/`failed` event for this `job_id`.
- **Tests to port:** the `waitUntilFinished` cases in `tests/job.test.ts`.

## 3. Worker registration + `get_workers` / `get_workers_count`

- **Node reference:** `QueueGetters.getWorkers`/`getWorkersCount` (uses
  `CLIENT LIST` + name matching); workers set their client name via
  `CLIENT SETNAME` (`{prefix}:{queueName}` and `:w:{name}` suffix when named).
- **Rust approach:**
  - On `Worker::new`, run `CLIENT SETNAME {prefix}:{queueName}[:w:{name}]` on the
    worker's (blocking) connection.
  - `Queue::get_workers` → `CLIENT LIST`, parse the `name=` field, match the
    queue's client-name prefix, return the parsed client info maps.
  - `Queue::get_workers_count` → length of `get_workers`.
- **Scripts:** none (raw `CLIENT LIST` / `CLIENT SETNAME`).
- **Tests to port:** `getWorkers` / `getWorkersCount` cases in `tests/getters.test.ts`.

## 4. Queue meta/version getters

- **Node reference:** `QueueGetters.getMeta`, `Queue.getVersion`.
- **Rust approach:**
  - `Queue::get_meta` → `HGETALL meta`, parse typed fields
    (`concurrency`, `max`, `duration`, `paused` → bool, `maxLenEvents`) and return
    a `QueueMeta` struct keeping the remaining string fields.
  - `Queue::get_version` → `HGET meta library` (currently we write
    `bullmq-rust:0.1.0` in `update_meta`; expose it).
  - `Queue::is_maxed` → compare active count against global concurrency.
- **Tests:** add unit tests (set concurrency / rate limit → assert `get_meta`).

## 5. `export_prometheus_metrics`

- **Node reference:** `QueueGetters.exportPrometheusMetrics`.
- **Rust approach:** `Queue::export_prometheus_metrics(&self, global_labels: Option<HashMap<String,String>>)`
  builds the Prometheus text-exposition string from `get_job_counts` with
  `# HELP`/`# TYPE bullmq_job_count gauge` and one line per state. Escape label
  values (`\\`, `"`, `\n`).
- **Tests to port:** the Prometheus export cases in `tests/getters.test.ts`.

## 6. Worker options (behavioural flags)

- **Node reference:** `src/interfaces/worker-options.ts`.
- Add to `WorkerOptions` and wire into the loops:
  - `max_started_attempts` — fail with `Unrecoverable` once a job's
    `attemptsStarted` exceeds this (guards against poison/stalling jobs).
  - `skip_stalled_check: bool` — do not start the stalled-check timer.
  - `skip_lock_renewal: bool` — do not start the lock-renewal timer.
- **Tests to port:** the corresponding cases in `tests/worker.test.ts` and
  `tests/stalled_jobs.test.ts`.

## 7. Job options

- `size_limit` — reject jobs whose serialized data exceeds the limit. Node packs
  `sizeLimit` into the `addJob` opts; replicate in `pack_add_args`/`pack_job_opts`
  and surface the script error.
- `KeepJobs.limit` — add the `limit` field to `types::KeepJobs` and include it in
  `write_keep_jobs` (worker.rs) so age/count/limit policies match Node.
- **Tests:** add `sizeLimit` rejection test; extend keep-jobs tests with `limit`.

## 8. Legacy / maintenance Queue methods

Lua scripts already vendored: `removeOrphanedJobs-1`, `removeRepeatable-3`,
`paginate-1`.

- `remove_orphaned_jobs(count, limit)` → `removeOrphanedJobs` script (loopable).
- `remove_deprecated_priority_key()` → small Lua/`DEL`.
- `get_repeatable_jobs` / `remove_repeatable` / `remove_repeatable_by_key` —
  legacy repeat API (superseded by job schedulers); port if needed for
  compatibility, using `removeRepeatable`.
- `get_debounce_job_id` / `remove_debounce_key` — deprecated aliases of the
  deduplication API; thin wrappers.
- `get_dependencies` (paginated, queue-level) → `paginate` script (the Node
  `QueueGetters.getDependencies`). Note: `Job::get_dependencies` already exists
  via HSCAN/SSCAN; this is the queue-level paginated variant returning
  `{items, jobs, total}`.
- **Tests:** port the relevant cases from `tests/getters.test.ts` and
  `tests/repeat.test.ts`.

## 9. Connection: Redis Cluster & Sentinel

- **Rust approach:** refactor `redis_connection.rs` so `RedisConnection` wraps an
  enum over single / cluster / sentinel clients. Enable the redis crate
  `cluster-async` and `sentinel` features. Add typed options
  (`cluster_nodes: Vec<String>`, `sentinel: { master_name, nodes }`).
  - **Caveat:** BullMQ requires hash-tag key co-location on cluster
    (`{prefix}:{queue}`), which our `QueueKeys` already nests — verify all
    multi-key scripts stay within one slot.
- **Tests:** require a Redis Cluster / Sentinel in CI (new docker-compose
  services). Gate behind an env flag (e.g. `REDIS_CLUSTER_URL`).

## 10. Telemetry / OpenTelemetry (lowest priority)

- **Rust approach:** optional `tracing` spans around add/process/finish plus a
  pluggable hook trait; integrate with `opentelemetry` behind a cargo feature.
- **Tests:** span/attribute assertions using a test exporter.

---

### Out of scope (intentionally not planned)

- **Sandboxed processors / worker threads** — not applicable in Rust; users run
  native `tokio` tasks or OS threads.
