## [1.2.2](https://github.com/taskforcesh/bullmq/compare/vrs1.2.1...vrs1.2.2) (2026-08-01)


* feat!: release BullMQ v6 with pluggable queue backends (php) (python) (elixir) ([e1f86ef](https://github.com/taskforcesh/bullmq/commit/e1f86effc5bddda5b70d890866d9a490555e41ff)), closes [Hi#level](https://github.com/Hi/issues/level) [Queue#client](https://github.com/Queue/issues/client) [Queue#redisVersion](https://github.com/Queue/issues/redisVersion) [Queue#databaseType](https://github.com/Queue/issues/databaseType) [Worker#blockingClient](https://github.com/Worker/issues/blockingClient) [FlowProducer#client](https://github.com/FlowProducer/issues/client) [Queue#add](https://github.com/Queue/issues/add) [Queue#addBulk](https://github.com/Queue/issues/addBulk) [Job#debounceId](https://github.com/Job/issues/debounceId) [Job#deduplicationId](https://github.com/Job/issues/deduplicationId)


### Bug Fixes

* **deps:** update dependency redis to v7.4.1 ([#4426](https://github.com/taskforcesh/bullmq/issues/4426)) ([2ac754f](https://github.com/taskforcesh/bullmq/commit/2ac754fd718927e2c0043d6d7787de32d0d196f7))
* **deps:** update security patches [security] [rust] ([#4404](https://github.com/taskforcesh/bullmq/issues/4404)) ([956e2d4](https://github.com/taskforcesh/bullmq/commit/956e2d4b1cefd5b1e4da98d69013a2fa866e8d75))


### BREAKING CHANGES

*

# [1.2.1](https://github.com/taskforcesh/bullmq/compare/vrs1.2.0...vrs1.2.1) (2026-07-30)


### Bug Fixes

* **deps:** pin dependencies [rust] ([#4402](https://github.com/taskforcesh/bullmq/issues/4402)) ([eb956b0](https://github.com/taskforcesh/bullmq/commit/eb956b07fde2ab3d43b41325a06a6b103610e3e3))
* **deps:** update dependency redis [security] ([#4369](https://github.com/taskforcesh/bullmq/issues/4369)) ([2a120df](https://github.com/taskforcesh/bullmq/commit/2a120dfea7324d7af67ad505c78f48571c74402b))

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
