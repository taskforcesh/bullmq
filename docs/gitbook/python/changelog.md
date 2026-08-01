## [3.0.3](https://github.com/taskforcesh/bullmq/compare/vpy3.0.2...vpy3.0.3) (2026-08-01)


### Bug Fixes

* **deps:** update python dependencies (python) ([#4453](https://github.com/taskforcesh/bullmq/issues/4453)) ([e58f9e1](https://github.com/taskforcesh/bullmq/commit/e58f9e1892463da4ca411506d66ee01413e5daeb))
* **deps:** update security patches [security] ([#4444](https://github.com/taskforcesh/bullmq/issues/4444)) ([c1cf328](https://github.com/taskforcesh/bullmq/commit/c1cf32881474f3f1e9b620e025abde07a359eb06))

## [3.0.2](https://github.com/taskforcesh/bullmq/compare/vpy3.0.1...vpy3.0.2) (2026-07-31)


### Bug Fixes

* **deps:** update dependency redis to v7.4.1 ([#4426](https://github.com/taskforcesh/bullmq/issues/4426)) ([2ac754f](https://github.com/taskforcesh/bullmq/commit/2ac754fd718927e2c0043d6d7787de32d0d196f7))
* **postgres:** drop redundant bullmq_ prefix from schema objects ([#4436](https://github.com/taskforcesh/bullmq/issues/4436)) (elixir) (python) (node) ([067a73f](https://github.com/taskforcesh/bullmq/commit/067a73f3666a493c36c03ec2cca8228ae149f043))

## [3.0.1](https://github.com/taskforcesh/bullmq/compare/vpy3.0.0...vpy3.0.1) (2026-07-31)


### Bug Fixes

* add missing sql files to release packages (elixir) (python) ([#4413](https://github.com/taskforcesh/bullmq/issues/4413)) ([a138230](https://github.com/taskforcesh/bullmq/commit/a1382307c1d0b8b185e16443daad6f221067f55d))

# [3.0.0](https://github.com/taskforcesh/bullmq/compare/vpy2.26.0...vpy3.0.0) (2026-07-30)


### Features

* release BullMQ v3 with pluggable queue backends (php) (python) (elixir) ([e1f86ef](https://github.com/taskforcesh/bullmq/commit/e1f86effc5bddda5b70d890866d9a490555e41ff))
* Introduce the IQueueBackend abstraction, Redis and PostgreSQL backends, and the accompanying v3 updates across the supported language clients.

### BREAKING CHANGES

* High-level classes no longer expose Redis internals. The optional Connection constructor parameter is replaced by an optional BackendFactory. Queue#client, Queue#redisVersion, Queue#databaseType, Worker#blockingClient, and FlowProducer#client are removed. Access the raw Redis client through the RedisQueueBackend returned by getBackend(). Worker#waitUntilReady() now resolves to void instead of the Redis client.
* The deprecated debounce option and Job#debounceId property are removed. Use deduplication and Job#deduplicationId instead.
* The deprecated debounced event is removed. Listen for the deduplicated event instead.
* FlowJob now distinguishes parent and leaf nodes. Deduplication is no longer allowed on parent flow nodes.
* The paused job state is removed from JobType and from the default Queue#getJobCounts() result. Jobs in a paused queue are represented as waiting.
* The public Redis implementation exports Scripts, createScripts, JobJsonRaw, and RedisJobOptions are removed. Use the backend APIs instead.
