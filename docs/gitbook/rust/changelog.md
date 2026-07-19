# [1.1.0](https://github.com/taskforcesh/bullmq/compare/vrs1.0.1...vrs1.1.0) (2026-07-15)


### Features

* idiomatic builder-based ergonomics across the public API [rust] ([#4288](https://github.com/taskforcesh/bullmq/issues/4288)) ([bbf0844](https://github.com/taskforcesh/bullmq/commit/bbf0844a250d08d6bfafacb43360f26a57cb9c87))

## [1.0.1](https://github.com/taskforcesh/bullmq/compare/vrs1.0.0...vrs1.0.1) (2026-07-14)


### Performance Improvements

* **worker:** do fetch next job in same finished roundtrip [rust] ([#4277](https://github.com/taskforcesh/bullmq/issues/4277)) ([677e259](https://github.com/taskforcesh/bullmq/commit/677e2590a04040ea21a0107d6bdcf5a33cf6b5e9))

# 1.0.0 (2026-07-12)


### Features

* add job schedulers and release Lua script sync [rust] ([#4207](https://github.com/taskforcesh/bullmq/issues/4207)) ([cb6b801](https://github.com/taskforcesh/bullmq/commit/cb6b801515daac083150bd4d9cb497479997fecd))
* add QueueEvents, queue/worker getters, and missing options [rust] ([#4229](https://github.com/taskforcesh/bullmq/issues/4229)) ([60ae049](https://github.com/taskforcesh/bullmq/commit/60ae0492a3200f8496976a3b51609e7e54eafd1b))
* expand Queue/Job/Worker API parity with Node.js BullMQ [rust] ([#4219](https://github.com/taskforcesh/bullmq/issues/4219)) ([eb9ae1d](https://github.com/taskforcesh/bullmq/commit/eb9ae1de0ea7468be66cb2c77921b8bb76e86abb))
* initial implementation of rust support ([#4200](https://github.com/taskforcesh/bullmq/issues/4200)) ([38798cc](https://github.com/taskforcesh/bullmq/commit/38798cc212e450f6369da3714c20eeced5a523a9))
* **queue:** add, addBulk, pause, resume, drain, obliterate, clean, retryJobs, promoteJobs
* **worker:** concurrent processing, stalled job detection, lock renewal, pause/resume
* **job:** progress tracking, logging, retry, state queries, manual move operations
* **backoff strategies:** fixed, exponential, custom (async callback)
* dynamic concurrency control
* cancellationToken for cooperative job cancellation
* full compatibility with Node.js/Python BullMQ queues (same Lua scripts)
* **queue:** rate_limit, set_global_rate_limit, remove_global_rate_limit
* **queue:** set_global_concurrency, remove_global_concurrency
* **queue:** upsert_job_scheduler, get_job_scheduler(s), remove_job_scheduler
* job deduplication support and remove_deduplication_key
* worker handling for RateLimited/NextTimestamp fetch results
* **scheduler:** cron scheduler support via croner and chrono-tz
* **flow producer:** add, add_bulk, add_with_opts (per-queue default job options), get_flow
* **flows:** failParentOnFailure, removeDependencyOnFailure, ignoreDependencyOnFailure, continueParentOnFailure
* **queue getters:** get_jobs, get_ranges, get_waiting/active/delayed/completed/failed/prioritized/waiting_children
* **queue counts:** count, get_job_counts_by_types, get_job_count_by_types, get_counts_per_priority, per-state count getters
* **Queue:** get_rate_limit_ttl, get_global_concurrency, get_global_rate_limit, get_deduplication_job_id
* **queue:** get_metrics (time-series), get_dependencies_count, get_children_values
* **job:** clear_logs, discard, is_waiting_children, get_ignored_children_failures, get_dependencies, move_to_waiting_children
* **worker:** metrics option (time-series collection), rate limiting
* **connections:** typed options (host/port/username/password/db) and TLS (`rediss://`) support
