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
