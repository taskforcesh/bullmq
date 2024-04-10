## [5.7.1](https://github.com/taskforcesh/bullmq/compare/v5.7.0...v5.7.1) (2024-04-10)


### Bug Fixes

* **worker:** use 0.002 as minimum timeout for redis version lower than 7.0.8 ([#2515](https://github.com/taskforcesh/bullmq/issues/2515)) fixes [#2466](https://github.com/taskforcesh/bullmq/issues/2466) ([44f7d21](https://github.com/taskforcesh/bullmq/commit/44f7d21850747d9c636c78e08b9e577d684fb885))

# [5.7.0](https://github.com/taskforcesh/bullmq/compare/v5.6.0...v5.7.0) (2024-04-09)


### Features

* allow arbitrary large drainDelay ([9693321](https://github.com/taskforcesh/bullmq/commit/96933217bf79658e5bb23fd7afe47e0b1150a40d))

# [5.6.0](https://github.com/taskforcesh/bullmq/compare/v5.5.4...v5.6.0) (2024-04-08)


### Features

* **python:** support reusable redis connections ([29ad8c8](https://github.com/taskforcesh/bullmq/commit/29ad8c83596b14a312ad1cd375e0e34d4fdecc52))

## [5.5.4](https://github.com/taskforcesh/bullmq/compare/v5.5.3...v5.5.4) (2024-04-07)


### Performance Improvements

* **stalled:** remove jobId from stalled after removing lock when moved from active ([#2512](https://github.com/taskforcesh/bullmq/issues/2512)) (python) ([64feec9](https://github.com/taskforcesh/bullmq/commit/64feec91b0b034fe640a846166bd95b546ff6d71))

## [5.5.3](https://github.com/taskforcesh/bullmq/compare/v5.5.2...v5.5.3) (2024-04-07)


### Bug Fixes

* **deps:** remove script loader from dist as it is used only when building package ([#2503](https://github.com/taskforcesh/bullmq/issues/2503)) ([6f9ca23](https://github.com/taskforcesh/bullmq/commit/6f9ca23a400e573c3ecb97246c1dda36ce1549ec))

## [5.5.2](https://github.com/taskforcesh/bullmq/compare/v5.5.1...v5.5.2) (2024-04-06)


### Bug Fixes

* **client:** try catch list command as it's not supported in GCP ([#2506](https://github.com/taskforcesh/bullmq/issues/2506)) ([ca68a9e](https://github.com/taskforcesh/bullmq/commit/ca68a9eff070e8dc09c484b1fb298c7afaa18f6f))

## [5.5.1](https://github.com/taskforcesh/bullmq/compare/v5.5.0...v5.5.1) (2024-04-03)


### Bug Fixes

* **connection:** ignore error when setting custom end status ([#2473](https://github.com/taskforcesh/bullmq/issues/2473)) ([3e17e45](https://github.com/taskforcesh/bullmq/commit/3e17e459a89a6ca9bccda64c5f06f91e70b372e4))

# [5.5.0](https://github.com/taskforcesh/bullmq/compare/v5.4.6...v5.5.0) (2024-03-31)


### Features

* **getters:** add getWorkersCount ([743c7aa](https://github.com/taskforcesh/bullmq/commit/743c7aa8f979760bc04f7b8f55844020559038e1))

## [5.4.6](https://github.com/taskforcesh/bullmq/compare/v5.4.5...v5.4.6) (2024-03-26)


### Bug Fixes

* **connection:** accept all parameters for redis connection [python] ([#2486](https://github.com/taskforcesh/bullmq/issues/2486)) ([ce30192](https://github.com/taskforcesh/bullmq/commit/ce30192ad30f66fb0f39c8c9ed669ddd133346c8))
* **job:** stack trace limit ([#2487](https://github.com/taskforcesh/bullmq/issues/2487)) ([cce3bc3](https://github.com/taskforcesh/bullmq/commit/cce3bc3092eb7cf56c2a6c68e9fd8980f5f1f26a))

## [5.4.5](https://github.com/taskforcesh/bullmq/compare/v5.4.4...v5.4.5) (2024-03-22)


### Bug Fixes

* **scripts:** use command name in error message when moving to finished ([#2483](https://github.com/taskforcesh/bullmq/issues/2483)) ([3c335d4](https://github.com/taskforcesh/bullmq/commit/3c335d49ba637145648c1ef0864d8e0d297dd890))

## [5.4.4](https://github.com/taskforcesh/bullmq/compare/v5.4.3...v5.4.4) (2024-03-21)


### Bug Fixes

* **queue:** use QueueOptions type in opts attribute ([#2481](https://github.com/taskforcesh/bullmq/issues/2481)) ([51a589f](https://github.com/taskforcesh/bullmq/commit/51a589f7e07b5336eb35ed00a1b795501b24f254))
* **worker:** set blockTimeout as 0.001 when reach the time to get delayed jobs [python] ([#2478](https://github.com/taskforcesh/bullmq/issues/2478)) ([b385034](https://github.com/taskforcesh/bullmq/commit/b385034006ac183a26093f593269349eb78f8b54))

## [5.4.3](https://github.com/taskforcesh/bullmq/compare/v5.4.2...v5.4.3) (2024-03-17)


### Bug Fixes

* **worker:** validate drainDelay must be greater than 0 ([#2477](https://github.com/taskforcesh/bullmq/issues/2477)) ([ab43693](https://github.com/taskforcesh/bullmq/commit/ab436938d895125635aef0393ae2fb5c77c16c1f))


### Features

* **job:** add log method [python] ([#2476](https://github.com/taskforcesh/bullmq/issues/2476)) ref [#2472](https://github.com/taskforcesh/bullmq/issues/2472) ([34946c4](https://github.com/taskforcesh/bullmq/commit/34946c4b29cc9e7d5ae81f8fd170a2e539ac6279))

## [5.4.2](https://github.com/taskforcesh/bullmq/compare/v5.4.1...v5.4.2) (2024-03-06)


### Bug Fixes

* move fast-glob and minimatch as dev-dependencies ([#2452](https://github.com/taskforcesh/bullmq/issues/2452)) ([cf13b31](https://github.com/taskforcesh/bullmq/commit/cf13b31ca552bcad53f40fe5668a907cf02e0a2e))

## [5.4.1](https://github.com/taskforcesh/bullmq/compare/v5.4.0...v5.4.1) (2024-03-01)


### Bug Fixes

* **worker:** set blockTimeout as 0.001 when reach the time to get delayed jobs ([#2455](https://github.com/taskforcesh/bullmq/issues/2455)) fixes [#2450](https://github.com/taskforcesh/bullmq/issues/2450) ([2de15ca](https://github.com/taskforcesh/bullmq/commit/2de15ca1019517f7ce11f3734fff316a3e4ab894))

# [5.4.0](https://github.com/taskforcesh/bullmq/compare/v5.3.3...v5.4.0) (2024-02-27)


### Features

* **job:** add removeChildDependency method ([#2435](https://github.com/taskforcesh/bullmq/issues/2435)) ([1151022](https://github.com/taskforcesh/bullmq/commit/1151022e4825fbb20cf1ef6ce1ff3e7fe929de5c))

## [5.3.3](https://github.com/taskforcesh/bullmq/compare/v5.3.2...v5.3.3) (2024-02-25)


### Bug Fixes

* **deps:** replaced glob by fast-glob due to security advisory ([91cf9a9](https://github.com/taskforcesh/bullmq/commit/91cf9a9253370ea76df48c27a7e0fcf8d7504c81))

## [5.3.2](https://github.com/taskforcesh/bullmq/compare/v5.3.1...v5.3.2) (2024-02-24)


### Bug Fixes

* **sandbox:** extend SandboxedJob from JobJsonSandbox ([#2446](https://github.com/taskforcesh/bullmq/issues/2446)) fixes [#2439](https://github.com/taskforcesh/bullmq/issues/2439) ([7606e36](https://github.com/taskforcesh/bullmq/commit/7606e3611f1cc18b1585c08b0f7fd9cb90749c9c))

## [5.3.1](https://github.com/taskforcesh/bullmq/compare/v5.3.0...v5.3.1) (2024-02-22)


### Bug Fixes

* **add-job:** fix parent job cannot be replaced error message ([#2441](https://github.com/taskforcesh/bullmq/issues/2441)) ([1e9a13f](https://github.com/taskforcesh/bullmq/commit/1e9a13fc0dc9de810ef75a042fbfeeae5b571ffe))

# [5.3.0](https://github.com/taskforcesh/bullmq/compare/v5.2.1...v5.3.0) (2024-02-20)


### Features

* **worker:** add support for naming workers ([7ba2729](https://github.com/taskforcesh/bullmq/commit/7ba27293615e443903cfdf7d0ff8be0052d061c4))

## [5.2.1](https://github.com/taskforcesh/bullmq/compare/v5.2.0...v5.2.1) (2024-02-17)


### Bug Fixes

* **flow:** remove failed children references on auto removal ([#2432](https://github.com/taskforcesh/bullmq/issues/2432)) ([8a85207](https://github.com/taskforcesh/bullmq/commit/8a85207cf3c552ebab37baca3c395821b9804b37))

# [5.2.0](https://github.com/taskforcesh/bullmq/compare/v5.1.12...v5.2.0) (2024-02-17)


### Features

* **flow:** add ignoreDependencyOnFailure option ([#2426](https://github.com/taskforcesh/bullmq/issues/2426)) ([c7559f4](https://github.com/taskforcesh/bullmq/commit/c7559f4f0a7fa51764ad43b4f46bb9d55ac42d0d))

## [5.1.12](https://github.com/taskforcesh/bullmq/compare/v5.1.11...v5.1.12) (2024-02-16)


### Bug Fixes

* **redis-connection:** close redis connection even when initializing ([#2425](https://github.com/taskforcesh/bullmq/issues/2425)) fixes [#2385](https://github.com/taskforcesh/bullmq/issues/2385) ([1bc26a6](https://github.com/taskforcesh/bullmq/commit/1bc26a64871b85a2d1f6799a9b73b60f8bf9fa90))

## [5.1.11](https://github.com/taskforcesh/bullmq/compare/v5.1.10...v5.1.11) (2024-02-13)


### Bug Fixes

* **flow:** parent job cannot be replaced (python) ([#2417](https://github.com/taskforcesh/bullmq/issues/2417)) ([2696ef8](https://github.com/taskforcesh/bullmq/commit/2696ef8200058b7f616938c2166a3b0454663b39))

## [5.1.10](https://github.com/taskforcesh/bullmq/compare/v5.1.9...v5.1.10) (2024-02-10)


### Performance Improvements

* **marker:** differentiate standard and delayed markers (python) ([#2389](https://github.com/taskforcesh/bullmq/issues/2389)) ([18ebee8](https://github.com/taskforcesh/bullmq/commit/18ebee8c242f66f1b5b733d68e48c574b1f1fdef))

## [5.1.9](https://github.com/taskforcesh/bullmq/compare/v5.1.8...v5.1.9) (2024-02-05)


### Performance Improvements

* **change-delay:** add delay marker when needed ([#2411](https://github.com/taskforcesh/bullmq/issues/2411)) ([8b62d28](https://github.com/taskforcesh/bullmq/commit/8b62d28a06347e9dd04757807fce1b511ace79bc))

## [5.1.8](https://github.com/taskforcesh/bullmq/compare/v5.1.7...v5.1.8) (2024-02-03)


### Performance Improvements

* **flow:** add marker when moving parent to wait (python) ([#2408](https://github.com/taskforcesh/bullmq/issues/2408)) ([6fb6896](https://github.com/taskforcesh/bullmq/commit/6fb6896701ae7595e1cb5e2cdbef44625c48d673))

## [5.1.7](https://github.com/taskforcesh/bullmq/compare/v5.1.6...v5.1.7) (2024-02-02)


### Bug Fixes

* **reprocess-job:** add marker if needed ([#2406](https://github.com/taskforcesh/bullmq/issues/2406)) ([5923ed8](https://github.com/taskforcesh/bullmq/commit/5923ed885f5451eee2f14258767d7d5f8d80ae13))

## [5.1.6](https://github.com/taskforcesh/bullmq/compare/v5.1.5...v5.1.6) (2024-01-31)


### Bug Fixes

* **rate-limit:** move job to wait even if ttl is 0 ([#2403](https://github.com/taskforcesh/bullmq/issues/2403)) ([c1c2ccc](https://github.com/taskforcesh/bullmq/commit/c1c2cccc7c8c05591f0303e011d46f6efa0942a0))

## [5.1.5](https://github.com/taskforcesh/bullmq/compare/v5.1.4...v5.1.5) (2024-01-23)


### Performance Improvements

* **move-to-active:** check rate limited once ([#2391](https://github.com/taskforcesh/bullmq/issues/2391)) ([ca6c17a](https://github.com/taskforcesh/bullmq/commit/ca6c17a43e38d5339e62471ea9f59c62a169b797))

## [5.1.4](https://github.com/taskforcesh/bullmq/compare/v5.1.3...v5.1.4) (2024-01-20)


### Bug Fixes

* **stalled:** consider adding marker when moving job back to wait ([#2384](https://github.com/taskforcesh/bullmq/issues/2384)) ([4914df8](https://github.com/taskforcesh/bullmq/commit/4914df87e416711835291e81da93b279bd758254))

## [5.1.3](https://github.com/taskforcesh/bullmq/compare/v5.1.2...v5.1.3) (2024-01-16)


### Bug Fixes

* **retry-jobs:** add marker when needed ([#2374](https://github.com/taskforcesh/bullmq/issues/2374)) ([1813d5f](https://github.com/taskforcesh/bullmq/commit/1813d5fa12b7db69ee6c8c09273729cda8e3e3b5))

## [5.1.2](https://github.com/taskforcesh/bullmq/compare/v5.1.1...v5.1.2) (2024-01-15)


### Bug Fixes

* **security:** upgrade msgpackr https://github.com/advisories/GHSA-7hpj-7hhx-2fgx ([7ae0953](https://github.com/taskforcesh/bullmq/commit/7ae095357fddbdaacc286cbe5782946b95160d55))

## [5.1.1](https://github.com/taskforcesh/bullmq/compare/v5.1.0...v5.1.1) (2024-01-02)


### Bug Fixes

* **worker:** worker can be closed if Redis is down ([#2350](https://github.com/taskforcesh/bullmq/issues/2350)) ([888dcc2](https://github.com/taskforcesh/bullmq/commit/888dcc2dd40571e05fe1f4a5c81161ed062f4542))

# [5.1.0](https://github.com/taskforcesh/bullmq/compare/v5.0.0...v5.1.0) (2023-12-27)


### Features

* **repeatable:** allow saving custom key ([#1824](https://github.com/taskforcesh/bullmq/issues/1824)) ([8ea0e1f](https://github.com/taskforcesh/bullmq/commit/8ea0e1f76baf36dab94a66657c0f432492cb9999))

# [5.0.0](https://github.com/taskforcesh/bullmq/compare/v4.17.0...v5.0.0) (2023-12-21)


### Bug Fixes

* **worker:** throw error if connection is missing ([6491a18](https://github.com/taskforcesh/bullmq/commit/6491a185268ae546baa9b95a20b95d63c0e27915))


### Features

* **job:** provide skipAttempt option when manually moving a job ([#2203](https://github.com/taskforcesh/bullmq/issues/2203)) ([0e88e4f](https://github.com/taskforcesh/bullmq/commit/0e88e4fe4ed940487dfc79d1345d0686de22d0c6))
* **worker:** improved markers handling ([73cf5fc](https://github.com/taskforcesh/bullmq/commit/73cf5fc1e6e13d8329e1e4e700a8db92173e0624)) ([0bac0fb](https://github.com/taskforcesh/bullmq/commit/0bac0fbb97afa968aa7644f1438b86d7bc18bbc5))


### BREAKING CHANGES

* **connection:** require connection to be passed ([#2335](https://github.com/taskforcesh/bullmq/issues/2335)) ([1867dd1](https://github.com/taskforcesh/bullmq/commit/1867dd107d7edbd417bf6918354ae4656480a544))
* **job:** revert console warn custom job ids when they represent integers ([#2312](https://github.com/taskforcesh/bullmq/issues/2312)) ([84015ff](https://github.com/taskforcesh/bullmq/commit/84015ffa04216c45d8f3181a7f859b8c0792c80d))
* **worker:** Markers use now a dedicated key in redis instead of using a special Job ID.

ref [better queue markers](https://bullmq.io/news/231204/better-queue-markers/)
