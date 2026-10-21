## [2.0.4](https://github.com/taskforcesh/bullmq/compare/vphp2.0.3...vphp2.0.4) (2026-10-20)


### Bug Fixes

* **queue:** move children retried by retryJobs back to their parent's dependencies ([#4879](https://github.com/taskforcesh/bullmq/issues/4879)) (python)(elixir)(php)(rust)(dotnet) ([3d82850](https://github.com/taskforcesh/bullmq/commit/3d828501874eede00b997902068d301803b64c0f)), closes [#4236](https://github.com/taskforcesh/bullmq/issues/4236)


### Performance Improvements

* **deduplication:** use LPOS for keepLastIfActive membership check (python)(elixir)(php)(rust) ([#4956](https://github.com/taskforcesh/bullmq/issues/4956)) ([8796b66](https://github.com/taskforcesh/bullmq/commit/8796b66653baa58b8ecf261d7d7595cc8b72e020)), closes [#4613](https://github.com/taskforcesh/bullmq/issues/4613)

## [2.0.3](https://github.com/taskforcesh/bullmq/compare/vphp2.0.2...vphp2.0.3) (2026-10-12)


### Bug Fixes

* **deps:** update dependency rybakit/msgpack to ^0.9 || ^0.11 [php] ([#4917](https://github.com/taskforcesh/bullmq/issues/4917)) ([d6b7452](https://github.com/taskforcesh/bullmq/commit/d6b74523c387ee5886263dc68ce734dc3fd855a6))

## [2.0.2](https://github.com/taskforcesh/bullmq/compare/vphp2.0.1...vphp2.0.2) (2026-09-18)


### Bug Fixes

* **deduplication:** remove deduplication key if job key does not longer exist (python) (elixir) (php) (rust) (dotnet) ([#4768](https://github.com/taskforcesh/bullmq/issues/4768)) ([75bb3a0](https://github.com/taskforcesh/bullmq/commit/75bb3a059ff214b419553822d41d3e8eaff7e888))

## [2.0.1](https://github.com/taskforcesh/bullmq/compare/vphp2.0.0...vphp2.0.1) (2026-08-05)


### Bug Fixes

* **deps:** upgrade predis to v3 (major) [php] (major) ([#4489](https://github.com/taskforcesh/bullmq/issues/4489)) ([6a166ea](https://github.com/taskforcesh/bullmq/commit/6a166ea3f747f5dece935d206057d43c2febcde7))

# [2.0.0](https://github.com/taskforcesh/bullmq/compare/vphp1.0.3...vphp2.0.0) (2026-07-30)


### Features

* release BullMQ v2 with pluggable queue backends (php) (python) (elixir) ([e1f86ef](https://github.com/taskforcesh/bullmq/commit/e1f86effc5bddda5b70d890866d9a490555e41ff))

### BREAKING CHANGES

* The deprecated debounce option and Job#debounceId property are removed. Use deduplication and Job#deduplicationId instead.
* The deprecated debounced event is removed. Listen for the deduplicated event instead.
* The paused job state is removed from JobType and from the default Queue#getJobCounts() result. Jobs in a paused queue are represented as waiting.
