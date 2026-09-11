## [3.2.1](https://github.com/taskforcesh/bullmq/compare/vpy3.2.0...vpy3.2.1) (2026-09-01)


### Bug Fixes

* **deps:** update dependency psycopg to v3.3.5 [python] ([#4668](https://github.com/taskforcesh/bullmq/issues/4668)) ([63cee3f](https://github.com/taskforcesh/bullmq/commit/63cee3f977a13304a4e6b07262db15bfad3eb436))

# [3.2.0](https://github.com/taskforcesh/bullmq/compare/vpy3.1.1...vpy3.2.0) (2026-08-31)


### Features

* **queue:** support getDeduplicationJobId method [python] ([#4655](https://github.com/taskforcesh/bullmq/issues/4655)) ref [#4647](https://github.com/taskforcesh/bullmq/issues/4647) ([903f017](https://github.com/taskforcesh/bullmq/commit/903f0171a2da4983ec3d23a978dc3e9ab19e85e6))

## [3.1.1](https://github.com/taskforcesh/bullmq/compare/vpy3.1.0...vpy3.1.1) (2026-08-29)


### Bug Fixes

* **deps:** update python dependencies [python] ([#4650](https://github.com/taskforcesh/bullmq/issues/4650)) ([a0467eb](https://github.com/taskforcesh/bullmq/commit/a0467eb8fd6b5a53489231b62d5a44a2c5a5c705))
* **worker:** delegate maximumBlockTimeout to the backend (python) ([#4644](https://github.com/taskforcesh/bullmq/issues/4644)) ([ea4543c](https://github.com/taskforcesh/bullmq/commit/ea4543cc78aa11935ed5e9af7d4b47fd3e23aea0))

# [3.1.0](https://github.com/taskforcesh/bullmq/compare/vpy3.0.6...vpy3.1.0) (2026-08-28)


### Features

* **job:** add DelayedError and Job.moveToDelayed for processor-controlled delays [python] ([#4635](https://github.com/taskforcesh/bullmq/issues/4635)) ([5251710](https://github.com/taskforcesh/bullmq/commit/5251710a161a676f1509b751c92a10128d057cdc))

## [3.0.6](https://github.com/taskforcesh/bullmq/compare/vpy3.0.5...vpy3.0.6) (2026-08-25)


### Performance Improvements

* **queue:** do not affect rate limit when processing deferred failures (python) (elixir) (rust) (dotnet) ([#4607](https://github.com/taskforcesh/bullmq/issues/4607)) ([ec4be04](https://github.com/taskforcesh/bullmq/commit/ec4be04c04725f5e341920ddef98adf7874a41d5))

## [3.0.5](https://github.com/taskforcesh/bullmq/compare/vpy3.0.4...vpy3.0.5) (2026-08-25)


### Bug Fixes

* **worker:** store failed reason without extra JSON encoding [python] ([#4615](https://github.com/taskforcesh/bullmq/issues/4615)) fixes [#4596](https://github.com/taskforcesh/bullmq/issues/4596) ([57b6b43](https://github.com/taskforcesh/bullmq/commit/57b6b4362d5f967813f713f6651f414ffa1416d4))

## [3.0.4](https://github.com/taskforcesh/bullmq/compare/vpy3.0.3...vpy3.0.4) (2026-08-05)


### Bug Fixes

* **scheduler:** make job schedulers advance and support the postgres backend [python] fixes [#4483](https://github.com/taskforcesh/bullmq/issues/4483) ([#4498](https://github.com/taskforcesh/bullmq/issues/4498)) ([5eb9dca](https://github.com/taskforcesh/bullmq/commit/5eb9dca3050b472cc0f72a1fc0cb491b32b705d3))

## [3.0.3](https://github.com/taskforcesh/bullmq/compare/vpy3.0.2...vpy3.0.3) (2026-08-01)


### Bug Fixes

* **deps:** update python dependencies [python] ([#4453](https://github.com/taskforcesh/bullmq/issues/4453)) ([e58f9e1](https://github.com/taskforcesh/bullmq/commit/e58f9e1892463da4ca411506d66ee01413e5daeb))

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
