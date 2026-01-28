## [1.2.5](https://github.com/taskforcesh/bullmq/compare/vex1.2.4...vex1.2.5) (2026-01-27)


### Bug Fixes

* **scheduler:** fix job scheduler not creating subsequent iterations [elixir] ([#3729](https://github.com/taskforcesh/bullmq/issues/3729)) ([3bd23d9](https://github.com/taskforcesh/bullmq/commit/3bd23d990c780ff0808d79499edd803084d2efe8))

## [1.2.4](https://github.com/taskforcesh/bullmq/compare/vex1.2.3...vex1.2.4) (2026-01-24)


### Bug Fixes

* fix worker connection name on cluster [#3340](https://github.com/taskforcesh/bullmq/issues/3340) ([#3660](https://github.com/taskforcesh/bullmq/issues/3660)) ([fa22e84](https://github.com/taskforcesh/bullmq/commit/fa22e844d29961db95df58f2ae63b440d71c11f6))

## [1.2.3](https://github.com/taskforcesh/bullmq/compare/vex1.2.2...vex1.2.3) (2026-01-22)


### Performance Improvements

* **job:** apply limit when removing jobs by max age (python) (elixir) ([#3694](https://github.com/taskforcesh/bullmq/issues/3694)) fixes [#3672](https://github.com/taskforcesh/bullmq/issues/3672) ([a8fc316](https://github.com/taskforcesh/bullmq/commit/a8fc316c0989bd3edb54577ceb02bff0c600aa93))

## [1.2.2](https://github.com/taskforcesh/bullmq/compare/vex1.2.1...vex1.2.2) (2026-01-14)


### Bug Fixes

* **scripts:** add missing lua scripts in mix config [elixir] ([#3697](https://github.com/taskforcesh/bullmq/issues/3697)) fixes [#3681](https://github.com/taskforcesh/bullmq/issues/3681) ([c2c6743](https://github.com/taskforcesh/bullmq/commit/c2c6743428a306e39f74c86f63dc9122633040ea))

## [1.2.1](https://github.com/taskforcesh/bullmq/compare/vex1.2.0...vex1.2.1) (2026-01-14)


### Bug Fixes

* **scripts:** copy lua scripts before releasing [elixir] ([#3685](https://github.com/taskforcesh/bullmq/issues/3685)) fixes [#3681](https://github.com/taskforcesh/bullmq/issues/3681) ([5bcd4fb](https://github.com/taskforcesh/bullmq/commit/5bcd4fbe0eb725a95b878f97b95c74106e7dff0f))

# [1.2.0](https://github.com/taskforcesh/bullmq/compare/vex1.1.0...vex1.2.0) (2025-12-31)


### Features

* **queue:** support obliterate method [elixir] ([#3657](https://github.com/taskforcesh/bullmq/issues/3657)) ([ede9fcf](https://github.com/taskforcesh/bullmq/commit/ede9fcf72a713f4de8941270251c7b51427484b4))

# [1.1.0](https://github.com/taskforcesh/bullmq/compare/vex1.0.1...vex1.1.0) (2025-12-14)


### Features

* **job:** support retry method options [elixir] [python] ([#3601](https://github.com/taskforcesh/bullmq/issues/3601)) ([6e406a9](https://github.com/taskforcesh/bullmq/commit/6e406a94a5a2fe1f2c1c6e8a1073c6c9b1f11092))

## [1.0.1](https://github.com/taskforcesh/bullmq/compare/vex1.0.0...vex1.0.1) (2025-12-11)


### Bug Fixes

* **scheduler:** add generated delayed job before processing current job [elixir] ([#3598](https://github.com/taskforcesh/bullmq/issues/3598)) ([84e8745](https://github.com/taskforcesh/bullmq/commit/84e8745e87dea9a7748852ccd281b728e6d0545e))

# 1.0.0 (2025-12-04)


### Features

* Initial release of BullMQ for Elixir ([976734f](https://github.com/taskforcesh/bullmq/commit/976734f2c983714b69f395441f5352999aededb0))
* Core queue functionality (`BullMQ.Queue`)
  * Add jobs with `add/3` and `add_bulk/3`
  * Pause and resume queues
  * Get job by ID
  * Drain and obliterate queues
* Worker implementation (`BullMQ.Worker`)
  * Configurable concurrency
  * Automatic lock renewal
  * Graceful shutdown
  * Rate limiting support
* Job features (`BullMQ.Job`)
  * Priority queues
  * Delayed jobs
  * Automatic retries with backoff
  * Progress tracking
  * Custom job IDs
* Backoff strategies (`BullMQ.Backoff`)
  * Fixed backoff
  * Exponential backoff
  * Custom backoff functions
  * Jitter support
* Rate limiting (`BullMQ.RateLimiter`)
  * Queue-level rate limits
  * Group-based rate limits
  * Manual rate limit triggering
* Job scheduling (`BullMQ.JobScheduler`)
  * Cron-based scheduling
  * Interval-based scheduling
  * Scheduler management (upsert, remove, list)
* Flow producer (`BullMQ.FlowProducer`)
  * Parent-child job dependencies
  * Nested flows
  * Bulk flow creation
* Stalled job detection (`BullMQ.StalledChecker`)
  * Automatic recovery
  * Configurable stall limits
* Event streaming (`BullMQ.QueueEvents`)
  * Real-time job lifecycle events
  * Event filtering
* Telemetry integration (`BullMQ.Telemetry`)
  * Job lifecycle events
  * Worker events
  * Rate limit events
  * Span-based tracing
* Configuration validation (`BullMQ.Config`)
  * NimbleOptions-based schemas
  * Queue, worker, and connection validation
* Redis key management (`BullMQ.Keys`)
  * Consistent key naming
  * Configurable prefix
* Lua script execution (`BullMQ.Scripts`)
  * Atomic operations
  * SHA caching
  * Fallback to EVAL
* Redis connection pooling (`BullMQ.RedisConnection`)
  * NimblePool-based pooling
  * Configurable pool size
* Comprehensive documentation
  * Getting started guide
  * Job options reference
  * Worker configuration
  * Rate limiting guide
  * Flow patterns
  * Telemetry setup
* Test suite
  * Unit tests for all modules
  * Integration tests (requires Redis)

### Compatibility

* Compatible with Node.js BullMQ v5.x
* Requires Elixir 1.15+
* Requires Erlang/OTP 26+
* Requires Redis 6.0+
