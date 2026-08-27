## [2.2.1](https://github.com/taskforcesh/bullmq/compare/vex2.2.0...vex2.2.1) (2026-08-27)


### Bug Fixes

* **postgres:** resolve priv SQL dir at runtime for Mix release [elixir] ([#4629](https://github.com/taskforcesh/bullmq/issues/4629)) ([66c29c8](https://github.com/taskforcesh/bullmq/commit/66c29c8d8c562662790a350d0d1ae1753f62592c))

# [2.2.0](https://github.com/taskforcesh/bullmq/compare/vex2.1.3...vex2.2.0) (2026-08-26)


### Features

* **postgres:** forward :ssl option to Postgrex connection ([#4631](https://github.com/taskforcesh/bullmq/issues/4631)) (elixir) ([bb569b8](https://github.com/taskforcesh/bullmq/commit/bb569b824154028c4d76aba86c0cfb0986928f3d))

## [2.1.3](https://github.com/taskforcesh/bullmq/compare/vex2.1.2...vex2.1.3) (2026-08-25)


### Performance Improvements

* **queue:** do not affect rate limit when processing deferred failures (python) (elixir) (rust) (dotnet) ([#4607](https://github.com/taskforcesh/bullmq/issues/4607)) ([ec4be04](https://github.com/taskforcesh/bullmq/commit/ec4be04c04725f5e341920ddef98adf7874a41d5))

## [2.1.2](https://github.com/taskforcesh/bullmq/compare/vex2.1.1...vex2.1.2) (2026-08-15)


### Bug Fixes

* **queue-events:** ignore late queue event task replies during close ([#4572](https://github.com/taskforcesh/bullmq/issues/4572)) [elixir] ([d464a51](https://github.com/taskforcesh/bullmq/commit/d464a51781177cc7ec23b011355f1df54385dab0))

## [2.1.1](https://github.com/taskforcesh/bullmq/compare/vex2.1.0...vex2.1.1) (2026-08-15)


### Performance Improvements

* check script existence before loading [rust] [elixir] ([#4563](https://github.com/taskforcesh/bullmq/issues/4563)) ([6df4589](https://github.com/taskforcesh/bullmq/commit/6df4589805aca2144eed9a9f24d4a9f52dcbbb7b))

# [2.1.0](https://github.com/taskforcesh/bullmq/compare/vex2.0.3...vex2.1.0) (2026-08-12)


### Features

* **queue:** support getCountsPerPriority method [elixir] [dotnet] ([#4535](https://github.com/taskforcesh/bullmq/issues/4535)) ([2f5ea2c](https://github.com/taskforcesh/bullmq/commit/2f5ea2c1648e526b1a689b581a7952fb5ee13610))

## [2.0.3](https://github.com/taskforcesh/bullmq/compare/vex2.0.2...vex2.0.3) (2026-08-02)


### Bug Fixes

* **worker:** fail jobs with deferred failure in task-based worker path [elixir] ([#4458](https://github.com/taskforcesh/bullmq/issues/4458)) ([740985a](https://github.com/taskforcesh/bullmq/commit/740985ae2f67a9144e7787f89955bf8c7f9500e0))

## [2.0.2](https://github.com/taskforcesh/bullmq/compare/vex2.0.1...vex2.0.2) (2026-07-31)


### Bug Fixes

* **postgres:** drop redundant bullmq_ prefix from schema objects ([#4436](https://github.com/taskforcesh/bullmq/issues/4436)) (elixir) (python) (node) ([067a73f](https://github.com/taskforcesh/bullmq/commit/067a73f3666a493c36c03ec2cca8228ae149f043))

## [2.0.1](https://github.com/taskforcesh/bullmq/compare/vex2.0.0...vex2.0.1) (2026-07-31)


### Bug Fixes

* add missing sql files to release packages (elixir) (python) ([#4413](https://github.com/taskforcesh/bullmq/issues/4413)) ([a138230](https://github.com/taskforcesh/bullmq/commit/a1382307c1d0b8b185e16443daad6f221067f55d))

# [2.0.0](https://github.com/taskforcesh/bullmq/compare/vex1.3.7...vex2.0.0) (2026-07-30)


### Features

* release BullMQ v2 with pluggable queue backends (php) (python) (elixir) ([e1f86ef](https://github.com/taskforcesh/bullmq/commit/e1f86effc5bddda5b70d890866d9a490555e41ff))
* Introduce the IQueueBackend abstraction, Redis and PostgreSQL backends, and the accompanying v2 updates across the supported language clients.

### BREAKING CHANGES

* High-level classes no longer expose Redis internals. The optional Connection constructor parameter is replaced by an optional BackendFactory. Queue#client, Queue#redisVersion, Queue#databaseType, Worker#blockingClient, and FlowProducer#client are removed. Access the raw Redis client through the RedisQueueBackend returned by getBackend(). Worker#waitUntilReady() now resolves to void instead of the Redis client.
* The deprecated debounce option and Job#debounceId property are removed. Use deduplication and Job#deduplicationId instead.
* The deprecated debounced event is removed. Listen for the deduplicated event instead.
* Job#discard() is removed from the API. Use UnrecoverableError instead.
* The legacy nextSchedulerJobId property is removed from Job and JobJson.
* The paused job state is removed from JobType and from the default Queue#getJobCounts() result. Jobs in a paused queue are represented as waiting.
* The public Redis implementation exports Scripts, createScripts, JobJsonRaw, and RedisJobOptions are removed. Use the backend APIs instead.
