# Changelog

## [Unreleased]

### Added

- Initial release of BullMQ for Rust
- Queue: add, addBulk, pause, resume, drain, obliterate, clean, retryJobs, promoteJobs
- Worker: concurrent processing, stalled job detection, lock renewal, pause/resume
- Job: progress tracking, logging, retry, state queries, manual move operations
- Backoff strategies: fixed, exponential, custom (async callback)
- Dynamic concurrency control
- CancellationToken for cooperative job cancellation
- Full compatibility with Node.js/Python BullMQ queues (same Lua scripts)
- Queue: rate_limit, set_global_rate_limit, remove_global_rate_limit
- Queue: set_global_concurrency, remove_global_concurrency
- Queue: upsert_job_scheduler, get_job_scheduler(s), remove_job_scheduler
- Job deduplication support and remove_deduplication_key
- Worker handling for RateLimited/NextTimestamp fetch results
- Cron scheduler support via croner and chrono-tz
- FlowProducer: add, add_bulk, add_with_opts (per-queue default job options), get_flow
- Flows: failParentOnFailure, removeDependencyOnFailure, ignoreDependencyOnFailure, continueParentOnFailure
- Queue getters: get_jobs, get_ranges, get_waiting/active/delayed/completed/failed/prioritized/waiting_children
- Queue counts: count, get_job_counts_by_types, get_job_count_by_types, get_counts_per_priority, per-state count getters
- Queue: get_rate_limit_ttl, get_global_concurrency, get_global_rate_limit, get_deduplication_job_id
- Queue: get_metrics (time-series), get_dependencies_count, get_children_values
- Job: clear_logs, discard, is_waiting_children, get_ignored_children_failures, get_dependencies, move_to_waiting_children
- Worker: metrics option (time-series collection), rate limiting
- Connections: typed options (host/port/username/password/db) and TLS (`rediss://`) support
