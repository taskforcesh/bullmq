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
