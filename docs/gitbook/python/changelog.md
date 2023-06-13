# Changelog

<!--next-version-placeholder-->

## v0.5.3 (2023-06-13)
### Fix
* **worker:** Use timeout as integer for redis lower than v6.0.0 (python) ([#1981](https://github.com/taskforcesh/bullmq/issues/1981)) ([`0df6afa`](https://github.com/taskforcesh/bullmq/commit/0df6afad5e71a693b721ba52ffa6be733ee45ccb))

### Documentation
* **python:** Add missing version sections ([#1974](https://github.com/taskforcesh/bullmq/issues/1974)) ([`77b4de7`](https://github.com/taskforcesh/bullmq/commit/77b4de7c3b41ae63e311a2c373e0d2fc787f2f53))

# [0.3.0](https://github.com/taskforcesh/bullmq/compare/ca48163...46d6f94) (2023-03-18)


### Bug Fixes

* correct condition so that the worker keeps processing jobs indefinitely \([ef0c5d6](https://github.com/taskforcesh/bullmq/commit/ef0c5d6cae1dcbae607fa02da32d5236069f2339)\)
* fix scripts typing on array2obj function \([134f6ab](https://github.com/taskforcesh/bullmq/commit/134f6ab5f3219ddd7a421e61ace6bac72bb51e6d)\)
* pass maxMetricsSize as empty string when it is not provided \([6bda2b2](https://github.com/taskforcesh/bullmq/commit/6bda2b24be38a78e5fcfc71ed2913f0150a41dfc)\)


### Features

* add getJobCounts method \([46d6f94](https://github.com/taskforcesh/bullmq/commit/46d6f94575454fe2a32be0c5247f16d18739fe27)\)
* improve worker concurrency \([ec7c49e](https://github.com/taskforcesh/bullmq/commit/ec7c49e284fd1ecdd52b96197281247f5222ea34)\)

# [0.2.0](https://github.com/taskforcesh/bullmq/compare/a97b22f...ca48163) (2023-03-29)


### Features

* add trimEvents method \([ca48163](https://github.com/taskforcesh/bullmq/commit/ca48163263b12a85533563485176c684e548df0b)\)
* add retryJobs method \([2745327](https://github.com/taskforcesh/bullmq/commit/2745327c7a7080f72e8c265bae77429e597cb6d3)\)

# 0.1.0 (2023-02-15)


### Features

* initial python package \([a97b22f](https://github.com/taskforcesh/bullmq/commit/a97b22f518a9f6c5d9c30a77bfd03cafdcbc57ff)\)

