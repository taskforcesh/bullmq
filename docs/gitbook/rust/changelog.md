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
