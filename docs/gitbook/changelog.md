## [6.0.7](https://github.com/taskforcesh/bullmq/compare/v6.0.6...v6.0.7) (2026-08-04)


### Bug Fixes

* **worker:** recover blocking reads that never settle after a reconnect fixes [#4479](https://github.com/taskforcesh/bullmq/issues/4479) ([#4484](https://github.com/taskforcesh/bullmq/issues/4484)) ([e7e9a64](https://github.com/taskforcesh/bullmq/commit/e7e9a6478d39d43406559b03410b2c5c28639e74))

## [6.0.6](https://github.com/taskforcesh/bullmq/compare/v6.0.5...v6.0.6) (2026-08-03)


### Bug Fixes

* **deps:** update cron-parser to v5.7.0 ([#4462](https://github.com/taskforcesh/bullmq/issues/4462)) ([a514f2d](https://github.com/taskforcesh/bullmq/commit/a514f2d3976848aa631de22bfa458b7e9f60b384))

## [6.0.5](https://github.com/taskforcesh/bullmq/compare/v6.0.4...v6.0.5) (2026-08-01)


### Bug Fixes

* **deps:** update python dependencies (python) ([#4453](https://github.com/taskforcesh/bullmq/issues/4453)) ([e58f9e1](https://github.com/taskforcesh/bullmq/commit/e58f9e1892463da4ca411506d66ee01413e5daeb))

## [6.0.4](https://github.com/taskforcesh/bullmq/compare/v6.0.3...v6.0.4) (2026-08-01)


### Bug Fixes

* **deps:** update security patches [security] ([#4444](https://github.com/taskforcesh/bullmq/issues/4444)) ([c1cf328](https://github.com/taskforcesh/bullmq/commit/c1cf32881474f3f1e9b620e025abde07a359eb06))

## [6.0.3](https://github.com/taskforcesh/bullmq/compare/v6.0.2...v6.0.3) (2026-07-31)


### Bug Fixes

* **postgres:** drop redundant bullmq_ prefix from schema objects ([#4436](https://github.com/taskforcesh/bullmq/issues/4436)) (elixir) (python) ([067a73f](https://github.com/taskforcesh/bullmq/commit/067a73f3666a493c36c03ec2cca8228ae149f043))

## [6.0.2](https://github.com/taskforcesh/bullmq/compare/v6.0.1...v6.0.2) (2026-07-31)


### Bug Fixes

* No Node.js changes.

## [6.0.1](https://github.com/taskforcesh/bullmq/compare/v6.0.0...v6.0.1) (2026-07-31)


### Bug Fixes

* No Node.js changes.

# [6.0.0](https://github.com/taskforcesh/bullmq/compare/v5.81.3...v6.0.0) (2026-07-30)


### Features

* release BullMQ v6 with pluggable queue backends (php) (python) (elixir) ([e1f86ef](https://github.com/taskforcesh/bullmq/commit/e1f86effc5bddda5b70d890866d9a490555e41ff))
* Introduce the IQueueBackend abstraction, Redis and PostgreSQL backends, and the accompanying v6 updates across the supported language clients.

### BREAKING CHANGES

* High-level classes no longer expose Redis internals. The optional Connection constructor parameter is replaced by an optional BackendFactory. Queue#client, Queue#redisVersion, Queue#databaseType, Worker#blockingClient, and FlowProducer#client are removed. Access the raw Redis client through the RedisQueueBackend returned by getBackend(). Worker#waitUntilReady() now resolves to void instead of the Redis client.
* Legacy repeatable jobs and their APIs are removed. This includes the repeat option on Queue#add and Queue#addBulk, the Repeat class, Queue#getRepeatableJobs(), Queue#removeRepeatable(), and Queue#removeRepeatableByKey(). Migrate recurring jobs to Job Schedulers.
* The minimum supported Node.js version is now 14.17.0.
* Worker#resume() is now asynchronous, returns `Promise<void>`, and must be awaited.
* Queue#clean() telemetry now reports the number of cleaned jobs instead of recording the complete array of job IDs.
* The deprecated TelemetryAttributes JobFinishedTimestamp and TelemetryAttributes.JobStatus members are removed. Telemetry uses JobState, and workers no longer set JobFinishedTimestamp on spans.
* Meter#createGauge() is now required for telemetry adapters.
* The deprecated debounce option and Job#debounceId property are removed. Use deduplication and Job#deduplicationId instead.
* The deprecated debounced event is removed. Listen for the deduplicated event instead.
* FlowJob now distinguishes parent and leaf nodes. Deduplication is no longer allowed on parent flow nodes.
* Job#discard() is removed from the Node.js API. Use UnrecoverableError instead.
* The legacy nextSchedulerJobId property is removed from Job and JobJson.
* ioredis is no longer installed as a direct dependency and is now an optional peer dependency. Redis users must install ioredis explicitly.
* The paused job state is removed from JobType and from the default Queue#getJobCounts() result. Jobs in a paused queue are represented as waiting.
* RepeatOptions no longer accepts the cron-parser currentDate, utc, or nthDayOfWeek options. Use tz: 'UTC' instead of utc: true.
* The public Redis implementation exports Scripts, createScripts, JobJsonRaw, and RedisJobOptions are removed. Use the backend APIs instead.
