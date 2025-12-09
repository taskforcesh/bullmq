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
