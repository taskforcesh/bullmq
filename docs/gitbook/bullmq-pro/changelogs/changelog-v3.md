# [3.0.0](https://github.com/taskforcesh/bullmq-pro/compare/v2.7.1...v3.0.0) (2022-10-18)


### Bug Fixes

* **groups:** do not parse gid when deserializing jobs fixes [#25](https://github.com/taskforcesh/bullmq-pro/issues/25) ([b03a1e9](https://github.com/taskforcesh/bullmq-pro/commit/b03a1e9c637e62e7c1722a77b61d55e208983852))


### BREAKING CHANGES

* **groups:** Group ids must be strings. Numbers are not allowed anymore.

Fixes https://github.com/taskforcesh/bullmq-pro-support/issues/25
