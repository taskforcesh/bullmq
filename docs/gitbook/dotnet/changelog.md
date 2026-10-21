## [1.2.2](https://github.com/taskforcesh/bullmq/compare/vnet1.2.1...vnet1.2.2) (2026-10-14)


### Bug Fixes

* **job:** respect priority when retrying a finished job (python) (elixir) (rust) (dotnet) ([#4926](https://github.com/taskforcesh/bullmq/issues/4926)) ([afc9711](https://github.com/taskforcesh/bullmq/commit/afc9711a89fe9e38547f09a79bce4566049266c0))
* **queue:** move children retried by retryJobs back to their parent's dependencies ([#4879](https://github.com/taskforcesh/bullmq/issues/4879)) (python)(elixir)(php)(rust)(dotnet) ([3d82850](https://github.com/taskforcesh/bullmq/commit/3d828501874eede00b997902068d301803b64c0f)), closes [#4236](https://github.com/taskforcesh/bullmq/issues/4236)

## [1.2.1](https://github.com/taskforcesh/bullmq/compare/vnet1.2.0...vnet1.2.1) (2026-09-18)


### Bug Fixes

* **deduplication:** remove deduplication key if job key does not longer exist (python) (elixir) (php) (rust) (dotnet) ([#4768](https://github.com/taskforcesh/bullmq/issues/4768)) ([75bb3a0](https://github.com/taskforcesh/bullmq/commit/75bb3a059ff214b419553822d41d3e8eaff7e888))

# [1.2.0](https://github.com/taskforcesh/bullmq/compare/vnet1.1.1...vnet1.2.0) (2026-09-12)


### Features

* **delayed:** support DelayedException [dotnet] ([#4718](https://github.com/taskforcesh/bullmq/issues/4718)) ([e97e813](https://github.com/taskforcesh/bullmq/commit/e97e8135781402357acb77cbf8349ae4845e7516))

## [1.1.1](https://github.com/taskforcesh/bullmq/compare/vnet1.1.0...vnet1.1.1) (2026-08-25)


### Performance Improvements

* **queue:** do not affect rate limit when processing deferred failures (python) (elixir) (rust) (dotnet) ([#4607](https://github.com/taskforcesh/bullmq/issues/4607)) ([ec4be04](https://github.com/taskforcesh/bullmq/commit/ec4be04c04725f5e341920ddef98adf7874a41d5))

# [1.1.0](https://github.com/taskforcesh/bullmq/compare/vnet1.0.0...vnet1.1.0) (2026-08-12)


### Features

* **queue:** support getCountsPerPriority method [elixir] [dotnet] ([#4535](https://github.com/taskforcesh/bullmq/issues/4535)) ([2f5ea2c](https://github.com/taskforcesh/bullmq/commit/2f5ea2c1648e526b1a689b581a7952fb5ee13610))

# 1.0.0 (2026-08-05)


### Features

* initial implementation of the dotnet port [dotnet] ([#4457](https://github.com/taskforcesh/bullmq/issues/4457)) ([9aab10d](https://github.com/taskforcesh/bullmq/commit/9aab10daa3ce0242055c0e334fac44b12c803243))
