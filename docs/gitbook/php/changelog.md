## [2.0.1](https://github.com/taskforcesh/bullmq/compare/vphp2.0.0...vphp2.0.1) (2026-08-05)


### Bug Fixes

* **deps:** update dependency redis to v7.4.1 ([#4426](https://github.com/taskforcesh/bullmq/issues/4426)) ([2ac754f](https://github.com/taskforcesh/bullmq/commit/2ac754fd718927e2c0043d6d7787de32d0d196f7))
* **deps:** update python dependencies (python) ([#4453](https://github.com/taskforcesh/bullmq/issues/4453)) ([e58f9e1](https://github.com/taskforcesh/bullmq/commit/e58f9e1892463da4ca411506d66ee01413e5daeb))
* **deps:** update security patches [security] ([#4444](https://github.com/taskforcesh/bullmq/issues/4444)) ([c1cf328](https://github.com/taskforcesh/bullmq/commit/c1cf32881474f3f1e9b620e025abde07a359eb06))
* **deps:** upgrade predis to v3 (major) [php] (major) ([#4489](https://github.com/taskforcesh/bullmq/issues/4489)) ([6a166ea](https://github.com/taskforcesh/bullmq/commit/6a166ea3f747f5dece935d206057d43c2febcde7))

# [2.0.0](https://github.com/taskforcesh/bullmq/compare/vphp1.0.3...vphp2.0.0) (2026-07-30)


### Features

* release BullMQ v2 with pluggable queue backends (php) (python) (elixir) ([e1f86ef](https://github.com/taskforcesh/bullmq/commit/e1f86effc5bddda5b70d890866d9a490555e41ff))

### BREAKING CHANGES

* The deprecated debounce option and Job#debounceId property are removed. Use deduplication and Job#deduplicationId instead.
* The deprecated debounced event is removed. Listen for the deduplicated event instead.
* The paused job state is removed from JobType and from the default Queue#getJobCounts() result. Jobs in a paused queue are represented as waiting.
