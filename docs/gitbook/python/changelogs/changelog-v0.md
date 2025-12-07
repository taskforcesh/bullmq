## [0.5.6](https://github.com/taskforcesh/bullmq/compare/vpy0.5.5...vpy0.5.6) (2023-06-21)


### Bug Fixes

* **queue:** pass right params to trimEvents method ([#2004](https://github.com/taskforcesh/bullmq/issues/2004)) ([a55fd77](https://github.com/taskforcesh/bullmq/commit/a55fd777655f7d4bb7af9e4fa2f7b4f48f559189))

## [0.5.5](https://github.com/taskforcesh/bullmq/compare/vpy0.5.4...vpy0.5.5) (2023-06-16)


### Bug Fixes

* **rate-limit:** keep priority fifo order ([#1991](https://github.com/taskforcesh/bullmq/issues/1991)) fixes [#1929](https://github.com/taskforcesh/bullmq/issues/1929) (python) ([56bd7ad](https://github.com/taskforcesh/bullmq/commit/56bd7ad8c4daffcfb1f9f199abfc5d6495eb291e))
* **worker:** set redis version always in initialization ([#1989](https://github.com/taskforcesh/bullmq/issues/1989)) fixes [#1988](https://github.com/taskforcesh/bullmq/issues/1988) ([a1544a8](https://github.com/taskforcesh/bullmq/commit/a1544a8c0f29522cd33772b14f559969db852d1d))

## [0.5.4](https://github.com/taskforcesh/bullmq/compare/vpy0.5.3...vpy0.5.4) (2023-06-14)


### Bug Fixes

* **connection:** add retry strategy in connection ([#1975](https://github.com/taskforcesh/bullmq/issues/1975)) ([7c5ee20](https://github.com/taskforcesh/bullmq/commit/7c5ee20471b989d297c8c5e87a6ea497a2077ae6))

## [0.5.3](https://github.com/taskforcesh/bullmq/compare/vpy0.5.2...vpy0.5.3) (2023-06-13)


### Bug Fixes

* **worker:** use timeout as integer for redis lower than v6.0.0 (python) ([#1981](https://github.com/taskforcesh/bullmq/issues/1981)) ([0df6afa](https://github.com/taskforcesh/bullmq/commit/0df6afad5e71a693b721ba52ffa6be733ee45ccb))

## [0.5.2](https://github.com/taskforcesh/bullmq/compare/vpy0.5.1...vpy0.5.2) (2023-06-11)


### Bug Fixes

* **retry-job:** consider priority when moving job to wait (python) ([#1969](https://github.com/taskforcesh/bullmq/issues/1969)) ([e753855](https://github.com/taskforcesh/bullmq/commit/e753855eef248da73a5e9f6b18f4b79319dc2f86))

## [0.5.1](https://github.com/taskforcesh/bullmq/compare/vpy0.5.0...vpy0.5.1) (2023-06-09)


### Bug Fixes

* **python:** include lua scripts when releasing ([bb4f3b2](https://github.com/taskforcesh/bullmq/commit/bb4f3b2be8e3d5a54a87f0f5d6ba8dfa09900e53))

# [0.5.0](https://github.com/taskforcesh/bullmq/compare/vpy0.4.4...vpy0.5.0) (2023-06-09)


### Features

* **python:** add remove job method ([#1965](https://github.com/taskforcesh/bullmq/issues/1965)) ([6a172e9](https://github.com/taskforcesh/bullmq/commit/6a172e97e65684f65ee570c2ae9bcc108720d5df))

## [0.4.4](https://github.com/taskforcesh/bullmq/compare/vpy0.4.3...vpy0.4.4) (2023-06-08)


### Bug Fixes

* **deps:** downgrade python-semantic-release to avoid version issue

## [0.4.3](https://github.com/taskforcesh/bullmq/compare/vpy0.4.2...vpy0.4.3) (2023-06-07)


### Bug Fixes

* **rate-limit:** consider paused queue ([#1931](https://github.com/taskforcesh/bullmq/issues/1931)) ([d97864a](https://github.com/taskforcesh/bullmq/commit/d97864a550992aeb8673557c7d8f186ab4ccb5bf))


### Features

* **job:** add changePriority method ([#1943](https://github.com/taskforcesh/bullmq/issues/1943)) ([945bcd3](https://github.com/taskforcesh/bullmq/commit/945bcd39db0f76ef6e9a513304714c120317c7f3))

## [0.4.2](https://github.com/taskforcesh/bullmq/compare/vpy0.4.1...vpy0.4.2) (2023-06-01)


### Bug Fixes

* **deps:** fix 'install_requires' to include semver ([#1927](https://github.com/taskforcesh/bullmq/issues/1927)) ([ce86ece](https://github.com/taskforcesh/bullmq/commit/ce86eceed40283b5d3276968b65ceae31ce425bb))

## [0.4.1](https://github.com/taskforcesh/bullmq/compare/vpy0.4.0...vpy0.4.1) (2023-05-29)


### Features

* **job:** add getState method ([#1906](https://github.com/taskforcesh/bullmq/issues/1906)) ([f0867a6](https://github.com/taskforcesh/bullmq/commit/f0867a679c75555fa764078481252110c1e7377f))

# [0.4.0](https://github.com/taskforcesh/bullmq/compare/vpy0.3.0...vpy0.4.0) (2023-05-18)


### Bug Fixes

* **retry:** consider when queue is paused ([#1880](https://github.com/taskforcesh/bullmq/issues/1880)) ([01b621f](https://github.com/taskforcesh/bullmq/commit/01b621fea0cbdae602482ff61361c05646823223))
* **worker:** stop processes when force stop ([#1837](https://github.com/taskforcesh/bullmq/issues/1837)) ([514699c](https://github.com/taskforcesh/bullmq/commit/514699cd8be96db2320bf0f85d4b6593809a09f1))


### Features

* **connection:** accept redis options as string ([01f549e](https://github.com/taskforcesh/bullmq/commit/01f549e62a33619a7816758910a2d2b5ac75b589))
* **job:** add moveToDelayed job method ([#1849](https://github.com/taskforcesh/bullmq/issues/1849)) ([5bebf8d](https://github.com/taskforcesh/bullmq/commit/5bebf8d6560de78448b0413baaabd26f7227575c))
* **job:** add retry method into job ([#1877](https://github.com/taskforcesh/bullmq/issues/1877)) ([870da45](https://github.com/taskforcesh/bullmq/commit/870da459f419076f03885a12a4ce5a2930c500f3))
* **job:** add updateData method ([#1871](https://github.com/taskforcesh/bullmq/issues/1871)) ([800b8c4](https://github.com/taskforcesh/bullmq/commit/800b8c46e709a8cbc4674d84bd59d5c62251d271))
* **job:** add updateProgress method in job class([#1830](https://github.com/taskforcesh/bullmq/issues/1830)) ([e1e1aa2](https://github.com/taskforcesh/bullmq/commit/e1e1aa2e7a41e5418a5a50af4cea347a38bbc7d1))
* **job:** save stacktrace when job fails ([#1859](https://github.com/taskforcesh/bullmq/issues/1859)) ([0b538ce](https://github.com/taskforcesh/bullmq/commit/0b538cedf63c3f006838ee3d016e463ee3492f81))
* support retryJob logic ([#1869](https://github.com/taskforcesh/bullmq/issues/1869)) ([b044a03](https://github.com/taskforcesh/bullmq/commit/b044a03159bc3a8d8823c71019f64825f318a6c2))

# [0.3.0](https://github.com/taskforcesh/bullmq/compare/vpy0.2.0...vpy0.3.0) (2023-04-18)


### Bug Fixes

* correct condition so that the worker keeps processing jobs indefinitely ([#1800](https://github.com/taskforcesh/bullmq/issues/1800)) ([ef0c5d6](https://github.com/taskforcesh/bullmq/commit/ef0c5d6cae1dcbae607fa02da32d5236069f2339))
* fix scripts typing on array2obj function ([#1786](https://github.com/taskforcesh/bullmq/issues/1786)) ([134f6ab](https://github.com/taskforcesh/bullmq/commit/134f6ab5f3219ddd7a421e61ace6bac72bb51e6d))
* pass maxMetricsSize as empty string when it is not provided fixes ([#1754](https://github.com/taskforcesh/bullmq/issues/1754)) ([6bda2b2](https://github.com/taskforcesh/bullmq/commit/6bda2b24be38a78e5fcfc71ed2913f0150a41dfc))


### Features

* **queue:** add getJobCounts method ([#1807](https://github.com/taskforcesh/bullmq/issues/1807)) ([46d6f94](https://github.com/taskforcesh/bullmq/commit/46d6f94575454fe2a32be0c5247f16d18739fe27))
* improve worker concurrency ([#1809](https://github.com/taskforcesh/bullmq/issues/1809)) ([ec7c49e](https://github.com/taskforcesh/bullmq/commit/ec7c49e284fd1ecdd52b96197281247f5222ea34))

# [0.2.0](https://github.com/taskforcesh/bullmq/compare/vpy0.1.0...vpy0.2.0) (2023-03-29)


### Features

* add trimEvents method ([#1695](https://github.com/taskforcesh/bullmq/issues/1695)) ([ca48163](https://github.com/taskforcesh/bullmq/commit/ca48163263b12a85533563485176c684e548df0b))
* **queue:** add retryJobs method ([#1688](https://github.com/taskforcesh/bullmq/issues/1688)) ([2745327](https://github.com/taskforcesh/bullmq/commit/2745327c7a7080f72e8c265bae77429e597cb6d3))

# 0.1.0 (2023-02-15)

### Features

* initial python package ([a97b22f](https://github.com/taskforcesh/bullmq/commit/a97b22f518a9f6c5d9c30a77bfd03cafdcbc57ff))
