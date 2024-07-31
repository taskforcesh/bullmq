# [7.13.0](https://github.com/taskforcesh/bullmq-pro/compare/v7.12.0...v7.13.0) (2024-07-31)


### Bug Fixes

* **repeatable:** remove repeat hash when removing repeatable job ([#2676](https://github.com/taskforcesh/bullmq/issues/2676)) ([97a297d](https://github.com/taskforcesh/bullmq/commit/97a297d90ad8b27bcddb7db6a8a158acfb549389))
* **repeatable:** keep legacy repeatables if it exists instead of creating one with new structure ([#2665](https://github.com/taskforcesh/bullmq/issues/2665)) ([93fad41](https://github.com/taskforcesh/bullmq/commit/93fad41a9520961d0e6814d82454bc916a039501))
* **repeatable:** consider removing legacy repeatable job ([#2658](https://github.com/taskforcesh/bullmq/issues/2658)) fixes [#2661](https://github.com/taskforcesh/bullmq/issues/2661) ([a6764ae](https://github.com/taskforcesh/bullmq/commit/a6764aecb557fb918d061f5e5c2e26e4afa3e8ee))
* **repeatable:** pass custom key as an args in addRepeatableJob to prevent CROSSSLOT issue ([#2662](https://github.com/taskforcesh/bullmq/issues/2662)) fixes [#2660](https://github.com/taskforcesh/bullmq/issues/2660) ([9d8f874](https://github.com/taskforcesh/bullmq/commit/9d8f874b959e09662985f38c4614b95ab4d5e89c))

### Features

* **repeatable:** new repeatables structure ([#2617](https://github.com/taskforcesh/bullmq/issues/2617)) ref [#2612](https://github.com/taskforcesh/bullmq/issues/2612) fixes [#2399](https://github.com/taskforcesh/bullmq/issues/2399) [#2596](https://github.com/taskforcesh/bullmq/issues/2596) ([8376a9a](https://github.com/taskforcesh/bullmq/commit/8376a9a9007f58ac7eab1a3a1c2f9e7ec373bbd6))

### Performance Improvements

* **worker:** fetch next job on failure ([#2342](https://github.com/taskforcesh/bullmq/issues/2342)) ([f917b80](https://github.com/taskforcesh/bullmq/commit/f917b8090f306c0580aac12f6bd4394fd9ef003d))

# [7.12.0](https://github.com/taskforcesh/bullmq-pro/compare/v7.11.0...v7.12.0) (2024-07-26)


### Features

* **queue:** support global concurrency ([#243](https://github.com/taskforcesh/bullmq-pro/issues/243)) ([4baac78](https://github.com/taskforcesh/bullmq-pro/commit/4baac78a1e00e42b58e62778a5b13df62decd792))

# [7.11.0](https://github.com/taskforcesh/bullmq-pro/compare/v7.10.1...v7.11.0) (2024-07-14)


### Features

* **groups:** add getCountsPerPriorityForGroup method ([#241](https://github.com/taskforcesh/bullmq-pro/issues/241)) ref [#238](https://github.com/taskforcesh/bullmq-pro/issues/238) ([2d3c81c](https://github.com/taskforcesh/bullmq-pro/commit/2d3c81c11c5c566913de15d50250ca5ade1eb59a))

## [7.10.1](https://github.com/taskforcesh/bullmq-pro/compare/v7.10.0...v7.10.1) (2024-07-09)


### Bug Fixes

* **get-groups-count:** consider other group states apart of waiting ([#240](https://github.com/taskforcesh/bullmq-pro/issues/240)) ([eccd4e6](https://github.com/taskforcesh/bullmq-pro/commit/eccd4e69ee3bda08136d227c3628be24746a5464))

# [7.10.0](https://github.com/taskforcesh/bullmq-pro/compare/v7.9.2...v7.10.0) (2024-07-06)


### Bug Fixes

* **queue-getters:** consider passing maxJobs when calling getRateLimitTtl ([#2631](https://github.com/taskforcesh/bullmq/issues/2631)) fixes [#2628](https://github.com/taskforcesh/bullmq/issues/2628) ([9f6609a](https://github.com/taskforcesh/bullmq/commit/9f6609ab1856c473b2d5cf0710068ce2751d708e))
* **job:** consider changing priority to 0 ([#2599](https://github.com/taskforcesh/bullmq/issues/2599)) ([4dba122](https://github.com/taskforcesh/bullmq/commit/4dba122174ab5173315fca7fdbb7454761514a53))
* **priority:** consider paused state when calling getCountsPerPriority (python) ([#2609](https://github.com/taskforcesh/bullmq/issues/2609)) ([6e99250](https://github.com/taskforcesh/bullmq/commit/6e992504b2a7a2fa76f1d04ad53d1512e98add7f))
* **priority:** use module instead of bit.band to keep order (python) ([#2597](https://github.com/taskforcesh/bullmq/issues/2597)) ([9ece15b](https://github.com/taskforcesh/bullmq/commit/9ece15b17420fe0bee948a5307e870915e3bce87))

### Features

* **queue:** add getCountsPerPriority method ([#2595](https://github.com/taskforcesh/bullmq/issues/2595)) ([77971f4](https://github.com/taskforcesh/bullmq/commit/77971f42b9fc425ad66e0b581e800ea429fc254e))

### Performance Improvements

* **job:** set processedBy using hmset ([#2592](https://github.com/taskforcesh/bullmq/issues/2592)) (python) ([238680b](https://github.com/taskforcesh/bullmq/commit/238680b84593690a73d542dbe1120611c3508b47))

## [7.9.2](https://github.com/taskforcesh/bullmq-pro/compare/v7.9.1...v7.9.2) (2024-06-28)


### Bug Fixes

* **groups:** promote maxed groups after decreasing active count ([#234](https://github.com/taskforcesh/bullmq-pro/issues/234)) ([545b6c2](https://github.com/taskforcesh/bullmq-pro/commit/545b6c28c9634d1603ff3d237f072736c2f2388b))

## [7.9.1](https://github.com/taskforcesh/bullmq-pro/compare/v7.9.0...v7.9.1) (2024-06-18)


### Bug Fixes

* **maxed:** consider passing max concurrency into repairMaxedGroup ([#232](https://github.com/taskforcesh/bullmq-pro/issues/232)) ([a3885a5](https://github.com/taskforcesh/bullmq-pro/commit/a3885a5456a9ea12abfedb623def516b84c5c289))

# [7.9.0](https://github.com/taskforcesh/bullmq-pro/compare/v7.8.3...v7.9.0) (2024-06-15)


### Features

* **groups:** allow passing limit when calling getGroupsJobsCount ([#230](https://github.com/taskforcesh/bullmq-pro/issues/230)) ([ac0469f](https://github.com/taskforcesh/bullmq-pro/commit/ac0469f2a43e7714a3b614780d3bc9f7f1f20382))

## [7.8.3](https://github.com/taskforcesh/bullmq-pro/compare/v7.8.2...v7.8.3) (2024-06-13)


### Bug Fixes

* **groups:** consider removing job from prioritized group when using remove method ([#229](https://github.com/taskforcesh/bullmq-pro/issues/229)) ([b61b96f](https://github.com/taskforcesh/bullmq-pro/commit/b61b96f06c4e4c03be09babfb43ded7b3ef00616))

## [7.8.2](https://github.com/taskforcesh/bullmq-pro/compare/v7.8.1...v7.8.2) (2024-05-31)


### Bug Fixes

* **worker:** properly cancel blocking command during disconnections ([2cf12b3](https://github.com/taskforcesh/bullmq/commit/2cf12b3622b0517f645971ece8acdcf673bede97))
* extendlock,createbulk use pipeline no multi command ([a053d9b](https://github.com/taskforcesh/bullmq/commit/a053d9b87e9799b151e2563b499dbff309b9d2e5))
* **repeat:** throw error when endDate is pointing to the past ([#2574](https://github.com/taskforcesh/bullmq/issues/2574)) ([5bd7990](https://github.com/taskforcesh/bullmq/commit/5bd79900ea3ace8ec6aa00525aff81a345f8e18e))
* **retry-job:** throw error when job is not in active state ([#2576](https://github.com/taskforcesh/bullmq/issues/2576)) ([ca207f5](https://github.com/taskforcesh/bullmq/commit/ca207f593d0ed455ecc59d9e0ef389a9a50d9634))
* **sandboxed:** ensure DelayedError is checked in Sandboxed processors ([#2567](https://github.com/taskforcesh/bullmq/issues/2567)) fixes [#2566](https://github.com/taskforcesh/bullmq/issues/2566) ([8158fa1](https://github.com/taskforcesh/bullmq/commit/8158fa114f57619b31f101bc8d0688a09c6218bb))
* **job:** validate job existence when adding a log ([#2562](https://github.com/taskforcesh/bullmq/issues/2562)) ([f87e3fe](https://github.com/taskforcesh/bullmq/commit/f87e3fe029e48d8964722da762326e531c2256ee))

## [7.8.1](https://github.com/taskforcesh/bullmq-pro/compare/v7.8.0...v7.8.1) (2024-05-18)


### Bug Fixes

* **groups:** remove concurrency when removing group ([#226](https://github.com/taskforcesh/bullmq-pro/issues/226)) ([332728e](https://github.com/taskforcesh/bullmq-pro/commit/332728e3a5c93a5f07263a77aedb27356259ddc2))

# [7.8.0](https://github.com/taskforcesh/bullmq-pro/compare/v7.7.2...v7.8.0) (2024-05-10)


### Features

* **group:** add getGroupConcurrency method ([#224](https://github.com/taskforcesh/bullmq-pro/issues/224)) ([88e334e](https://github.com/taskforcesh/bullmq-pro/commit/88e334e567688570111f3109bdd0751e859f46dc))

## [7.7.2](https://github.com/taskforcesh/bullmq-pro/compare/v7.7.1...v7.7.2) (2024-05-04)


### Bug Fixes

* **worker:** make sure clearTimeout is always called after bzpopmin ([782382e](https://github.com/taskforcesh/bullmq/commit/782382e599218024bb9912ff0572c4aa9b1f22a3))
* **worker:** force timeout on bzpopmin command ([#2543](https://github.com/taskforcesh/bullmq/issues/2543)) ([ae7cb6c](https://github.com/taskforcesh/bullmq/commit/ae7cb6caefdbfa5ca0d28589cef4b896ffcce2db))

### Performance Improvements

* **worker:** do not call bzpopmin when blockDelay is lower or equal 0 ([#2544](https://github.com/taskforcesh/bullmq/issues/2544)) ref [#2466](https://github.com/taskforcesh/bullmq/issues/2466) ([9760b85](https://github.com/taskforcesh/bullmq/commit/9760b85dfbcc9b3c744f616961ef939e8951321d))

## [7.7.1](https://github.com/taskforcesh/bullmq-pro/compare/v7.7.0...v7.7.1) (2024-04-30)


### Bug Fixes

* **worker-pro:** correct typo in options argument for limiter ([0e999dd](https://github.com/taskforcesh/bullmq-pro/commit/0e999dd677f4852c1145213b9d1bc752e3e3b859))

# [7.7.0](https://github.com/taskforcesh/bullmq-pro/compare/v7.6.2...v7.7.0) (2024-04-30)


### Features

* **groups:** support for local group concurrency using setGroupConcurrency method ([#220](https://github.com/taskforcesh/bullmq-pro/issues/220)) ([159a341](https://github.com/taskforcesh/bullmq-pro/commit/159a341dd209c4cf8b9494205a2e2fcf8638c343))

## [7.6.2](https://github.com/taskforcesh/bullmq-pro/compare/v7.6.1...v7.6.2) (2024-04-25)


### Bug Fixes

* **stalled:** consider ignoreDependencyOnFailure option (python) ([#2540](https://github.com/taskforcesh/bullmq/issues/2540)) fixes [#2531](https://github.com/taskforcesh/bullmq/issues/2531) ([0140959](https://github.com/taskforcesh/bullmq/commit/0140959cabd2613794631e41ebe4c2ddee6f91da))

## [7.6.1](https://github.com/taskforcesh/bullmq-pro/compare/v7.6.0...v7.6.1) (2024-04-23)


### Bug Fixes

* **worker:** return minimumBlockTimeout depending on redis version (python) ([#2532](https://github.com/taskforcesh/bullmq/issues/2532)) ([83dfb63](https://github.com/taskforcesh/bullmq/commit/83dfb63e72a1a36a4dfc40f122efb54fbb796339))
* **stalled:** consider failParentOnFailure when moving child into failed ([#2526](https://github.com/taskforcesh/bullmq/issues/2526)) fixes [#2464](https://github.com/taskforcesh/bullmq/issues/2464) (python) ([5e31eb0](https://github.com/taskforcesh/bullmq/commit/5e31eb096169ea57350db591bcebfc2264a6b6dc))

### Performance Improvements

* **worker:** reset delays after generating blockTimeout value ([#2529](https://github.com/taskforcesh/bullmq/issues/2529)) ([e92cea4](https://github.com/taskforcesh/bullmq/commit/e92cea4a9d7c99f649f6626d1c0a1e1e994179d6))

# [7.6.0](https://github.com/taskforcesh/bullmq-pro/compare/v7.5.0...v7.6.0) (2024-04-17)


### Features

* **queue:** add getGroupActiveCount method ([#217](https://github.com/taskforcesh/bullmq-pro/issues/217)) ([d59d2e5](https://github.com/taskforcesh/bullmq-pro/commit/d59d2e5f82b7a83495dcdc948d4fbbf162dc72c5))

# [7.5.0](https://github.com/taskforcesh/bullmq-pro/compare/v7.4.1...v7.5.0) (2024-04-10)


### Bug Fixes

* **worker:** use 0.002 as minimum timeout for redis version lower than 7.0.8 ([#2515](https://github.com/taskforcesh/bullmq/issues/2515)) fixes [#2466](https://github.com/taskforcesh/bullmq/issues/2466) ([44f7d21](https://github.com/taskforcesh/bullmq/commit/44f7d21850747d9c636c78e08b9e577d684fb885))

### Features

* allow arbitrary large drainDelay ([9693321](https://github.com/taskforcesh/bullmq/commit/96933217bf79658e5bb23fd7afe47e0b1150a40d))

### Performance Improvements

* **stalled:** remove jobId from stalled after removing lock when moved from active ([#2512](https://github.com/taskforcesh/bullmq/issues/2512)) (python) ([64feec9](https://github.com/taskforcesh/bullmq/commit/64feec91b0b034fe640a846166bd95b546ff6d71))
* **add-to-group:** skip reinsertion of group ([#215](https://github.com/taskforcesh/bullmq-pro/issues/215)) ([6823251](https://github.com/taskforcesh/bullmq-pro/commit/682325108658e9b0d9ca9b45ed5bf0b29250066c))

## [7.4.1](https://github.com/taskforcesh/bullmq-pro/compare/v7.4.0...v7.4.1) (2024-04-07)


### Bug Fixes

* **deps:** remove script loader from dist ([#213](https://github.com/taskforcesh/bullmq-pro/issues/213)) ([dd28ec8](https://github.com/taskforcesh/bullmq-pro/commit/dd28ec80549c41d89d62100d5d7d857825347f5e))

# [7.4.0](https://github.com/taskforcesh/bullmq-pro/compare/v7.3.1...v7.4.0) (2024-04-04)


### Bug Fixes

* **connection:** ignore error when setting custom end status ([#2473](https://github.com/taskforcesh/bullmq/issues/2473)) ([3e17e45](https://github.com/taskforcesh/bullmq/commit/3e17e459a89a6ca9bccda64c5f06f91e70b372e4))
* **job:** stack trace limit ([#2487](https://github.com/taskforcesh/bullmq/issues/2487)) ([cce3bc3](https://github.com/taskforcesh/bullmq/commit/cce3bc3092eb7cf56c2a6c68e9fd8980f5f1f26a))
* **scripts:** use command name in error message when moving to finished ([#2483](https://github.com/taskforcesh/bullmq/issues/2483)) ([3c335d4](https://github.com/taskforcesh/bullmq/commit/3c335d49ba637145648c1ef0864d8e0d297dd890))
* **queue:** use QueueOptions type in opts attribute ([#2481](https://github.com/taskforcesh/bullmq/issues/2481)) ([51a589f](https://github.com/taskforcesh/bullmq/commit/51a589f7e07b5336eb35ed00a1b795501b24f254))
* **worker:** validate drainDelay must be greater than 0 ([#2477](https://github.com/taskforcesh/bullmq/issues/2477)) ([ab43693](https://github.com/taskforcesh/bullmq/commit/ab436938d895125635aef0393ae2fb5c77c16c1f))

### Features

* **getters:** add getWorkersCount ([743c7aa](https://github.com/taskforcesh/bullmq/commit/743c7aa8f979760bc04f7b8f55844020559038e1))

## [7.3.1](https://github.com/taskforcesh/bullmq-pro/compare/v7.3.0...v7.3.1) (2024-03-30)


### Bug Fixes

* **group-limit:** set rate limiting even when group is empty ([#212](https://github.com/taskforcesh/bullmq-pro/issues/212)) ([08824cf](https://github.com/taskforcesh/bullmq-pro/commit/08824cf5fea0887653acc8081abe9d25b6ea96a5))

# [7.3.0](https://github.com/taskforcesh/bullmq-pro/compare/v7.2.0...v7.3.0) (2024-03-16)


### Bug Fixes

* **deps:** move fast-glob and minimatch as dev-dependencies ([#2452](https://github.com/taskforcesh/bullmq/issues/2452)) ([cf13b31](https://github.com/taskforcesh/bullmq/commit/cf13b31ca552bcad53f40fe5668a907cf02e0a2e))
* **worker:** set blockTimeout as 0.001 when reach the time to get delayed jobs ([#2455](https://github.com/taskforcesh/bullmq/issues/2455)) fixes [#2450](https://github.com/taskforcesh/bullmq/issues/2450) ([2de15ca](https://github.com/taskforcesh/bullmq/commit/2de15ca1019517f7ce11f3734fff316a3e4ab894))

### Features

* **job:** add removeChildDependency method ([#2435](https://github.com/taskforcesh/bullmq/issues/2435)) ([1151022](https://github.com/taskforcesh/bullmq/commit/1151022e4825fbb20cf1ef6ce1ff3e7fe929de5c))

# [7.2.0](https://github.com/taskforcesh/bullmq-pro/compare/v7.1.0...v7.2.0) (2024-03-15)


### Bug Fixes

* **deps:** replaced glob by fast-glob due to security advisory ([91cf9a9](https://github.com/taskforcesh/bullmq/commit/91cf9a9253370ea76df48c27a7e0fcf8d7504c81))
* **sandbox:** extend SandboxedJob from JobJsonSandbox ([#2446](https://github.com/taskforcesh/bullmq/issues/2446)) fixes [#2439](https://github.com/taskforcesh/bullmq/issues/2439) ([7606e36](https://github.com/taskforcesh/bullmq/commit/7606e3611f1cc18b1585c08b0f7fd9cb90749c9c))
* **add-job:** fix parent job cannot be replaced error message ([#2441](https://github.com/taskforcesh/bullmq/issues/2441)) ([1e9a13f](https://github.com/taskforcesh/bullmq/commit/1e9a13fc0dc9de810ef75a042fbfeeae5b571ffe))

### Features

* **worker:** add support for naming workers ([7ba2729](https://github.com/taskforcesh/bullmq/commit/7ba27293615e443903cfdf7d0ff8be0052d061c4))

# [7.1.0](https://github.com/taskforcesh/bullmq-pro/compare/v7.0.0...v7.1.0) (2024-03-14)


### Bug Fixes

* **flow:** remove failed children references on auto removal ([#2432](https://github.com/taskforcesh/bullmq/issues/2432)) ([8a85207](https://github.com/taskforcesh/bullmq/commit/8a85207cf3c552ebab37baca3c395821b9804b37))
* **redis-connection:** close redis connection even when initializing ([#2425](https://github.com/taskforcesh/bullmq/issues/2425)) fixes [#2385](https://github.com/taskforcesh/bullmq/issues/2385) ([1bc26a6](https://github.com/taskforcesh/bullmq/commit/1bc26a64871b85a2d1f6799a9b73b60f8bf9fa90))

### Features

* **flow:** add ignoreDependencyOnFailure option ([#2426](https://github.com/taskforcesh/bullmq/issues/2426)) ([c7559f4](https://github.com/taskforcesh/bullmq/commit/c7559f4f0a7fa51764ad43b4f46bb9d55ac42d0d))

# [7.0.0](https://github.com/taskforcesh/bullmq-pro/compare/v6.11.0...v7.0.0) (2024-03-12)


### Bug Fixes

* **worker:** update processor types ([#193](https://github.com/taskforcesh/bullmq-pro/issues/193)) ([8ebb72e](https://github.com/taskforcesh/bullmq-pro/commit/8ebb72e1d87ec819bb1efa12d0a931e8e9ead203))
* **flow:** parent job cannot be replaced (python) ([#2417](https://github.com/taskforcesh/bullmq/issues/2417)) ([2696ef8](https://github.com/taskforcesh/bullmq/commit/2696ef8200058b7f616938c2166a3b0454663b39))
* **reprocess-job:** add marker if needed ([#2406](https://github.com/taskforcesh/bullmq/issues/2406)) ([5923ed8](https://github.com/taskforcesh/bullmq/commit/5923ed885f5451eee2f14258767d7d5f8d80ae13))
* **rate-limit:** move job to wait even if ttl is 0 ([#2403](https://github.com/taskforcesh/bullmq/issues/2403)) ([c1c2ccc](https://github.com/taskforcesh/bullmq/commit/c1c2cccc7c8c05591f0303e011d46f6efa0942a0))
* **stalled:** consider adding marker when moving job back to wait ([#2384](https://github.com/taskforcesh/bullmq/issues/2384)) ([4914df8](https://github.com/taskforcesh/bullmq/commit/4914df87e416711835291e81da93b279bd758254))
* **retry-jobs:** add marker when needed ([#2374](https://github.com/taskforcesh/bullmq/issues/2374)) ([1813d5f](https://github.com/taskforcesh/bullmq/commit/1813d5fa12b7db69ee6c8c09273729cda8e3e3b5))
* **security:** upgrade msgpackr https://github.com/advisories/GHSA-7hpj-7hhx-2fgx ([7ae0953](https://github.com/taskforcesh/bullmq/commit/7ae095357fddbdaacc286cbe5782946b95160d55))
* **worker:** worker can be closed if Redis is down ([#2350](https://github.com/taskforcesh/bullmq/issues/2350)) ([888dcc2](https://github.com/taskforcesh/bullmq/commit/888dcc2dd40571e05fe1f4a5c81161ed062f4542))
* **worker:** throw error if connection is missing ([6491a18](https://github.com/taskforcesh/bullmq/commit/6491a185268ae546baa9b95a20b95d63c0e27915))

### Features

* **stalled:** add command to repair stalled key ([#193](https://github.com/taskforcesh/bullmq-pro/issues/193)) ([8ebb72e](https://github.com/taskforcesh/bullmq-pro/commit/8ebb72e1d87ec819bb1efa12d0a931e8e9ead203))
* **repeatable:** allow saving custom key ([#1824](https://github.com/taskforcesh/bullmq/issues/1824)) ([8ea0e1f](https://github.com/taskforcesh/bullmq/commit/8ea0e1f76baf36dab94a66657c0f432492cb9999))
* **job:** provide skipAttempt option when manually moving a job ([#2203](https://github.com/taskforcesh/bullmq/issues/2203)) ([0e88e4f](https://github.com/taskforcesh/bullmq/commit/0e88e4fe4ed940487dfc79d1345d0686de22d0c6))
* **worker:** improved markers handling ([73cf5fc](https://github.com/taskforcesh/bullmq/commit/73cf5fc1e6e13d8329e1e4e700a8db92173e0624)) ([0bac0fb](https://github.com/taskforcesh/bullmq/commit/0bac0fbb97afa968aa7644f1438b86d7bc18bbc5))

### Performance Improvements

* **marker:** differentiate standard and delayed markers (python) ([#2389](https://github.com/taskforcesh/bullmq/issues/2389)) ([18ebee8](https://github.com/taskforcesh/bullmq/commit/18ebee8c242f66f1b5b733d68e48c574b1f1fdef))
* **change-delay:** add delay marker when needed ([#2411](https://github.com/taskforcesh/bullmq/issues/2411)) ([8b62d28](https://github.com/taskforcesh/bullmq/commit/8b62d28a06347e9dd04757807fce1b511ace79bc))
* **flow:** add marker when moving parent to wait (python) ([#2408](https://github.com/taskforcesh/bullmq/issues/2408)) ([6fb6896](https://github.com/taskforcesh/bullmq/commit/6fb6896701ae7595e1cb5e2cdbef44625c48d673))
* **move-to-active:** check rate limited once ([#2391](https://github.com/taskforcesh/bullmq/issues/2391)) ([ca6c17a](https://github.com/taskforcesh/bullmq/commit/ca6c17a43e38d5339e62471ea9f59c62a169b797))


### BREAKING CHANGES

* **connection:** require connection to be passed ([#2335](https://github.com/taskforcesh/bullmq/issues/2335)) ([1867dd1](https://github.com/taskforcesh/bullmq/commit/1867dd107d7edbd417bf6918354ae4656480a544))
* **job:** revert console warn custom job ids when they represent integers ([#2312](https://github.com/taskforcesh/bullmq/issues/2312)) ([84015ff](https://github.com/taskforcesh/bullmq/commit/84015ffa04216c45d8f3181a7f859b8c0792c80d))
* **worker:** markers use now a dedicated key in redis instead of using a special Job ID.
* **stalled:** remove type check in stalled key

* references:
  - [Better Queue Markers](https://bullmq.io/news/231204/better-queue-markers/)
  - [BullMQ v5 Migration Notes](https://bullmq.io/news/231221/bullmqv5-release/)
  - [BullMQ Pro v7 Release](https://bullmq.io/news/240312/bullmq-prov7-release/)


# [6.11.0](https://github.com/taskforcesh/bullmq-pro/compare/v6.10.0...v6.11.0) (2024-02-26)


### Features

* expose sandboxed-job-pro interface ([6652e0a](https://github.com/taskforcesh/bullmq-pro/commit/6652e0afbdd45664c1e9436f9da0161adfea8c0d))

# [6.10.0](https://github.com/taskforcesh/bullmq-pro/compare/v6.9.6...v6.10.0) (2024-02-21)


### Features

* **groups:** add sandbox support for groups ([53be7a0](https://github.com/taskforcesh/bullmq-pro/commit/53be7a095fca70df7bf8e52dfec45dde8dac064a))

## [6.9.6](https://github.com/taskforcesh/bullmq-pro/compare/v6.9.5...v6.9.6) (2024-01-31)


### Bug Fixes

* **groups:** remove group when removing last job ([#199](https://github.com/taskforcesh/bullmq-pro/issues/199)) ([3066686](https://github.com/taskforcesh/bullmq-pro/commit/3066686df4851334efadd7024cc8566407eabd7f))

## [6.9.5](https://github.com/taskforcesh/bullmq-pro/compare/v6.9.4...v6.9.5) (2024-01-27)


### Bug Fixes

* **batches:** differentiate movetoBatchFinished responses ([#198](https://github.com/taskforcesh/bullmq-pro/issues/198)) ([bb74c50](https://github.com/taskforcesh/bullmq-pro/commit/bb74c501f19fabbb61c4cb637598591f508bd59d))

## [6.9.4](https://github.com/taskforcesh/bullmq-pro/compare/v6.9.3...v6.9.4) (2024-01-20)


### Bug Fixes

* **backoff:** set marker after adding delayed job ([#197](https://github.com/taskforcesh/bullmq-pro/issues/197)) ([50a012e](https://github.com/taskforcesh/bullmq-pro/commit/50a012e352b9608a2a7f36db0cd7643078e183ee))

## [6.9.3](https://github.com/taskforcesh/bullmq-pro/compare/v6.9.2...v6.9.3) (2024-01-18)


### Performance Improvements

* **prioritized:** get target list once in addPrioritizedJob ([#195](https://github.com/taskforcesh/bullmq-pro/issues/195)) ([51cf4a3](https://github.com/taskforcesh/bullmq-pro/commit/51cf4a34d645013a49c01b740cf280666ebc4c97))

## [6.9.2](https://github.com/taskforcesh/bullmq-pro/compare/v6.9.1...v6.9.2) (2024-01-17)


### Bug Fixes

* **groups:** consider prioritized groups when maxSize is provided ([#194](https://github.com/taskforcesh/bullmq-pro/issues/194)) ([1c345c5](https://github.com/taskforcesh/bullmq-pro/commit/1c345c550685f5fdb2d2ff95056261af324d2ca5))

## [6.9.1](https://github.com/taskforcesh/bullmq-pro/compare/v6.9.0...v6.9.1) (2024-01-15)


### Bug Fixes

* **events:** emit drained event only when finishing jobs ([#192](https://github.com/taskforcesh/bullmq-pro/issues/192)) ([22a503d](https://github.com/taskforcesh/bullmq-pro/commit/22a503d4f462cea68f03015af93e0701ed27e2d6))

# [6.9.0](https://github.com/taskforcesh/bullmq-pro/compare/v6.8.0...v6.9.0) (2023-12-28)


### Bug Fixes

* **flows:** update constructor and methods to match queue base ([#2324](https://github.com/taskforcesh/bullmq/issues/2324)) ([d6c2064](https://github.com/taskforcesh/bullmq/commit/d6c2064b1fdd88bd4cc61e049ce055ff620b0062))
* **sandboxed:** better compatibility with esbuild ([8eaf955](https://github.com/taskforcesh/bullmq/commit/8eaf9550fe8b322df624893c507c55d2cce34b11))
* **child-processor:** preserve dynamic imports in commonjs ([d97a5e0](https://github.com/taskforcesh/bullmq/commit/d97a5e06816cff04d86facdb8d32b512f29c6fb9))
* **flows:** add meta key to queues created with flows ([272ec69](https://github.com/taskforcesh/bullmq/commit/272ec69557f601a138e1aaba739f7e7878d5344b))
* **repeat-strategy:** add missing Promise return type ([#2301](https://github.com/taskforcesh/bullmq/issues/2301)) ([6f8f534](https://github.com/taskforcesh/bullmq/commit/6f8f5342cc8aa03f596d9ed5b8831f96a1d4c736))
* **update-progress:** remove old updateProgress script to prevent conflict ([#2298](https://github.com/taskforcesh/bullmq/issues/2298)) (python) ([e65b819](https://github.com/taskforcesh/bullmq/commit/e65b819101f8e0e8fdef8c51cfdf9a52f5e73f13))
* **worker:** get dirname by using module.filename ([#2296](https://github.com/taskforcesh/bullmq/issues/2296)) fixes [#2288](https://github.com/taskforcesh/bullmq/issues/2288) ([6e4db5a](https://github.com/taskforcesh/bullmq/commit/6e4db5a3f3648c6a7e10991f2e18f3dab96fb1d7))
* **worker:** should cap update progress events ([2cab9e9](https://github.com/taskforcesh/bullmq/commit/2cab9e94f65c7bdd053e3fb5944bcda6e3ebaa39))

### Features

* **sandbox:** support URL (local files) as processor file ([7eea670](https://github.com/taskforcesh/bullmq/commit/7eea6700b33bfd7f36b030b647b819a4c5fd9606))
* **queue:** add a paginated getDependencies ([#2327](https://github.com/taskforcesh/bullmq/issues/2327)) ([c5b8ba3](https://github.com/taskforcesh/bullmq/commit/c5b8ba318b12a84a3a6a928345377fa0eaa08ee3))
* **sandboxes:** use the more compatible dynamic import instead of require ([6d2fe6e](https://github.com/taskforcesh/bullmq/commit/6d2fe6e7c0473b75aeb9a6d3080b0676f9521065))


# [6.8.0](https://github.com/taskforcesh/bullmq-pro/compare/v6.7.0...v6.8.0) (2023-11-30)


### Bug Fixes

* **worker:** do not wait for slow jobs fixes [#2290](https://github.com/taskforcesh/bullmq/issues/2290) ([568d758](https://github.com/taskforcesh/bullmq/commit/568d7585edb1f2ef15991d4ae4a2425e6834046a))
* **utils:** use EventEmitter as a type instead of a namespace ([#2283](https://github.com/taskforcesh/bullmq/issues/2283)) ([41c9d1d](https://github.com/taskforcesh/bullmq/commit/41c9d1d05eedc7351272708e667e8d65eb6773fc))
* **job:** set delay value on current job instance when it is retried ([#2266](https://github.com/taskforcesh/bullmq/issues/2266)) (python) ([76e075f](https://github.com/taskforcesh/bullmq/commit/76e075f54d5745b6cec3cb11305bf3110d963eae))


### Features

* **worker:** better handling of concurrency when fetching jobs ([#2242](https://github.com/taskforcesh/bullmq/issues/2242)) ([d2e2035](https://github.com/taskforcesh/bullmq/commit/d2e203588878ee64cb21e67141f73b32867dfb40))


### Performance Improvements

* **rate-limit:** continue promoting groups when there are in paused state ([#187](https://github.com/taskforcesh/bullmq-pro/issues/187)) ([17f9e81](https://github.com/taskforcesh/bullmq-pro/commit/17f9e81ad330eb273c3863f448fd3eee546d420f))

# [6.7.0](https://github.com/taskforcesh/bullmq-pro/compare/v6.6.2...v6.7.0) (2023-11-22)


### Features

* **queue:** improve clean to work iteratively ([#2260](https://github.com/taskforcesh/bullmq/issues/2260)) ([0cfa66f](https://github.com/taskforcesh/bullmq/commit/0cfa66fd0fa0dba9b3941f183cf6f06d8a4f281d)) ref ([#186](https://github.com/taskforcesh/bullmq-pro/issues/186))

### Bug Fixes

* **utils:** use EventEmitter as a type instead of a namespace ([#2283](https://github.com/taskforcesh/bullmq/issues/2283)) ([41c9d1d](https://github.com/taskforcesh/bullmq/commit/41c9d1d05eedc7351272708e667e8d65eb6773fc))
* **job:** set delay value on current job instance when it is retried ([#2266](https://github.com/taskforcesh/bullmq/issues/2266)) (python) ([76e075f](https://github.com/taskforcesh/bullmq/commit/76e075f54d5745b6cec3cb11305bf3110d963eae))
* **connection:** better handling of attached listeners ([02474ad](https://github.com/taskforcesh/bullmq/commit/02474ad59a7b340d7bb2a7415ae7a88e14200398))
* **connection:** move redis instance check to queue base ([13a339a](https://github.com/taskforcesh/bullmq/commit/13a339a730f46ff22acdd4a046e0d9c4b7d88679))
* update delay job property when moving to delayed set ([#2261](https://github.com/taskforcesh/bullmq/issues/2261)) ([69ece08](https://github.com/taskforcesh/bullmq/commit/69ece08babd7716c14c38c3dd50630b44c7c1897))
* **add-job:** trim events when waiting-children event is published ([#2262](https://github.com/taskforcesh/bullmq/issues/2262)) (python) ([198bf05](https://github.com/taskforcesh/bullmq/commit/198bf05fa5a4e1ce50081296033a2e0f26ece498))

## [6.6.2](https://github.com/taskforcesh/bullmq-pro/compare/v6.6.1...v6.6.2) (2023-11-03)


### Bug Fixes

* **worker:** keep extending locks while closing workers ([#2259](https://github.com/taskforcesh/bullmq/issues/2259)) ([c4d12ea](https://github.com/taskforcesh/bullmq/commit/c4d12ea3a9837ffd7f58e2134796137c4181c3de))
* **sandbox:** do not return empty object result when it is undefined ([#2247](https://github.com/taskforcesh/bullmq/issues/2247)) ([308db7f](https://github.com/taskforcesh/bullmq/commit/308db7f58758a72b8abb272da8e92509813a2178))
* **events:** do not publish removed event on non-existent jobs ([#2227](https://github.com/taskforcesh/bullmq/issues/2227)) ([c134606](https://github.com/taskforcesh/bullmq/commit/c1346064c6cd9f93c59b184f150eac11d51c91b4))


### Performance Improvements

* **redis-connection:** check redis version greater or equal than v6 only once ([#2252](https://github.com/taskforcesh/bullmq/issues/2252)) ([a09b15a](https://github.com/taskforcesh/bullmq/commit/a09b15af0d5dedfa83bce7130ee9094f3fb69e10))
* **events:** trim events when removing jobs ([#2235](https://github.com/taskforcesh/bullmq/issues/2235)) (python) ([889815c](https://github.com/taskforcesh/bullmq/commit/889815c412666e5fad8f32d2e3a2d41cf650f001))

## [6.6.1](https://github.com/taskforcesh/bullmq-pro/compare/v6.6.0...v6.6.1) (2023-10-11)


### Bug Fixes

* **events:** trim events when retrying a job ([#2224](https://github.com/taskforcesh/bullmq/issues/2224)) ([1986b05](https://github.com/taskforcesh/bullmq/commit/1986b05ac03fe4ee48861aa60caadcc9df8170a6))
* **sandbox:** update progress value on job instance ([#2214](https://github.com/taskforcesh/bullmq/issues/2214)) fixes [#2213](https://github.com/taskforcesh/bullmq/issues/2213) ([3d0f36a](https://github.com/taskforcesh/bullmq/commit/3d0f36a134b7f5c6b6de26967c9d71bcfb346e72))

# [6.6.0](https://github.com/taskforcesh/bullmq-pro/compare/v6.5.0...v6.6.0) (2023-10-06)


### Bug Fixes
* **delayed:** trim events when moving jobs to delayed (python) ([#2211](https://github.com/taskforcesh/bullmq/issues/2211)) ([eca8c2d](https://github.com/taskforcesh/bullmq/commit/eca8c2d4dfeafbd8ac36a49764dbd4897303628c))

### Features

* **queue:** expose addJobLog and updateJobProgress ([#2202](https://github.com/taskforcesh/bullmq/issues/2202)) ([2056939](https://github.com/taskforcesh/bullmq/commit/205693907a4d6c2da9bd0690fb552b1d1e369c08))


# [6.5.0](https://github.com/taskforcesh/bullmq-pro/compare/v6.4.0...v6.5.0) (2023-09-28)


### Features

* **sandbox:** convert wrapJob method as protected for extension ([#2182](https://github.com/taskforcesh/bullmq/issues/2182)) ([1494b55](https://github.com/taskforcesh/bullmq/commit/1494b5566573356e0248b4a5cab48ae21d82f1da))


### Bug Fixes

* **queue:** batched unpack now uses range ([#2188](https://github.com/taskforcesh/bullmq/issues/2188)) ([b5e97f4](https://github.com/taskforcesh/bullmq/commit/b5e97f420bc0c4bc82772f3e87883ee522be43d9))
* **worker:** forward skipVersionCheck to blockingConnection ([#2189](https://github.com/taskforcesh/bullmq/issues/2189)) ref [#2149](https://github.com/taskforcesh/bullmq/issues/2149) ([c8aa9a3](https://github.com/taskforcesh/bullmq/commit/c8aa9a36224cba8ecb19af1bf652f4f1c4c20d40))
* **worker:** throw exception with NaN as concurrency ([#2184](https://github.com/taskforcesh/bullmq/issues/2184)) ([f36ac8b](https://github.com/taskforcesh/bullmq/commit/f36ac8b61dcd4bb3d9e283278310cd50cfc83fae))
* **queue:** differentiate score purpose per state in clean method ([#2133](https://github.com/taskforcesh/bullmq/issues/2133)) fixes [#2124](https://github.com/taskforcesh/bullmq/issues/2124) ([862f10b](https://github.com/taskforcesh/bullmq/commit/862f10b586276314d9bffff2a5e6caf939399f7e))


# [6.4.0](https://github.com/taskforcesh/bullmq-pro/compare/v6.3.4...v6.4.0) (2023-09-16)


### Features

* **connection:** provide skipVersionCheck option for shared connections ([#2149](https://github.com/taskforcesh/bullmq/issues/2149)) ref [#2148](https://github.com/taskforcesh/bullmq/issues/2148) ([914820f](https://github.com/taskforcesh/bullmq/commit/914820f720cbc48b49f4bd1c46d148eb2bb5b79c))
* **sandbox:** emulate moveToDelayed method ([#180](https://github.com/taskforcesh/bullmq-pro/issues/180)) ([d61de09](https://github.com/taskforcesh/bullmq-pro/commit/d61de095115481b688101bfaf0b126a02545cc6f)) ref [#2118](https://github.com/taskforcesh/bullmq/issues/2118)


### Bug Fixes

* **remove:** change error message when job is locked (python) ([#2175](https://github.com/taskforcesh/bullmq/issues/2175)) ([2f5628f](https://github.com/taskforcesh/bullmq/commit/2f5628feffab66cdcc78abf4d7bb608bdcaa65bb))
* **sandbox:** ignore extra params on processor ([#2142](https://github.com/taskforcesh/bullmq/issues/2142)) ([3602c20](https://github.com/taskforcesh/bullmq/commit/3602c20ab80cbe0a0d3de66210a01ad119e1090b))


## [6.3.4](https://github.com/taskforcesh/bullmq-pro/compare/v6.3.3...v6.3.4) (2023-08-18)


### Bug Fixes

* **worker:** abort rate-limit delay when closing worker ([#179](https://github.com/taskforcesh/bullmq-pro/issues/179)) ([4ad650b](https://github.com/taskforcesh/bullmq-pro/commit/4ad650b7bc0c6a950536df252e510cb96e2e0054))

## [6.3.3](https://github.com/taskforcesh/bullmq-pro/compare/v6.3.2...v6.3.3) (2023-08-15)


### Bug Fixes

* **queue:** throw error when name is not provided ([#178](https://github.com/taskforcesh/bullmq-pro/issues/178)) ([9715bf1](https://github.com/taskforcesh/bullmq-pro/commit/9715bf15edef1f54a9ebc618eb7d47c7b45a35ca))

## [6.3.2](https://github.com/taskforcesh/bullmq-pro/compare/v6.3.1...v6.3.2) (2023-08-11)


### Bug Fixes

* correct group rate limit in some edge cases ([#177](https://github.com/taskforcesh/bullmq-pro/issues/177)) ([c3c87a7](https://github.com/taskforcesh/bullmq-pro/commit/c3c87a7f0a6de5c35ac389efbac594d6d987cf49))

## [6.3.1](https://github.com/taskforcesh/bullmq-pro/compare/v6.3.0...v6.3.1) (2023-08-10)


### Performance Improvements

* **rate-limit:** get pttl only if needed ([#175](https://github.com/taskforcesh/bullmq-pro/issues/175)) ([0439823](https://github.com/taskforcesh/bullmq-pro/commit/0439823c32a82e48abcae43c29e50ef912c31d15))

# [6.3.0](https://github.com/taskforcesh/bullmq-pro/compare/v6.2.4...v6.3.0) (2023-08-03)


### Features

* **queue:** add getRateLimitTtl method ([#173](https://github.com/taskforcesh/bullmq-pro/issues/173)) ([3327350](https://github.com/taskforcesh/bullmq-pro/commit/3327350d06526651353974aa7822fdeeec881fb0))

## [6.2.4](https://github.com/taskforcesh/bullmq-pro/compare/v6.2.3...v6.2.4) (2023-07-29)


### Bug Fixes

* **group:** add priority option into group option ([#171](https://github.com/taskforcesh/bullmq-pro/issues/171)) ([2e632f1](https://github.com/taskforcesh/bullmq-pro/commit/2e632f11013a0db520f7a642741df21bbdd38a78)), closes [taskforcesh/bullmq-pro-support#23](https://github.com/taskforcesh/bullmq-pro-support/issues/23) [taskforcesh/bullmq-pro-support#13](https://github.com/taskforcesh/bullmq-pro-support/issues/13)

## [6.2.3](https://github.com/taskforcesh/bullmq-pro/compare/v6.2.2...v6.2.3) (2023-07-27)


### Performance Improvements

* **groups:** do not move job to paused when promoting rate-limited group ([#169](https://github.com/taskforcesh/bullmq-pro/issues/169)) ([fa2bb3c](https://github.com/taskforcesh/bullmq-pro/commit/fa2bb3c98761615822035312dfdb782934d9a774))

## [6.2.2](https://github.com/taskforcesh/bullmq-pro/compare/v6.2.1...v6.2.2) (2023-07-26)


### Features

* **queue:** add promoteJobs to promote all delayed jobs ([6074592](https://github.com/taskforcesh/bullmq/commit/6074592574256ec4b1c340126288e803e56b1a64))
* **job:** add option for removing children in remove method (python) ([#2064](https://github.com/taskforcesh/bullmq/issues/2064)) ([841dc87](https://github.com/taskforcesh/bullmq/commit/841dc87a689897df81438ad1f43e45a4da77c388))
* **job:** add removeDependencyOnFailure option ([#1953](https://github.com/taskforcesh/bullmq/issues/1953)) ([ffd49e2](https://github.com/taskforcesh/bullmq/commit/ffd49e289c57252487200d47b92193228ae7451f))

## [6.2.1](https://github.com/taskforcesh/bullmq-pro/compare/v6.2.0...v6.2.1) (2023-07-25)


### Bug Fixes

* **flow:** emit delayed event when parent is moved to delayed ([#166](https://github.com/taskforcesh/bullmq-pro/issues/166)) ([38afe1c](https://github.com/taskforcesh/bullmq-pro/commit/38afe1cf3187ddee33d33a39438587d921b8743a))

# [6.2.0](https://github.com/taskforcesh/bullmq-pro/compare/v6.1.1...v6.2.0) (2023-07-25)


### Features

* **groups:** support local priorities ([#156](https://github.com/taskforcesh/bullmq-pro/issues/156)) ([260bd24](https://github.com/taskforcesh/bullmq-pro/commit/260bd24a76d703ec87385c05cdd3b4589f142aa8)), closes [taskforcesh/bullmq-pro-support#23](https://github.com/taskforcesh/bullmq-pro-support/issues/23) [taskforcesh/bullmq-pro-support#13](https://github.com/taskforcesh/bullmq-pro-support/issues/13)

## [6.1.1](https://github.com/taskforcesh/bullmq-pro/compare/v6.1.0...v6.1.1) (2023-07-18)


### Bug Fixes

* add missing error export ([2b8c51f](https://github.com/taskforcesh/bullmq-pro/commit/2b8c51fd43c538fd3eed122ab96d55325da97b90))

# [6.1.0](https://github.com/taskforcesh/bullmq-pro/compare/v6.0.5...v6.1.0) (2023-07-18)


### Bug Fixes

* fix the GroupMaxSizeExceededError prototype ([a1b6a96](https://github.com/taskforcesh/bullmq-pro/commit/a1b6a96f1a0b632940177a1057a4995d59957964))


### Features

* add getGroupStatus ([3bac19d](https://github.com/taskforcesh/bullmq-pro/commit/3bac19d32e9a620a393736152844973951e45d47))
* add support max sized groups ([7bc654c](https://github.com/taskforcesh/bullmq-pro/commit/7bc654c2191c9a2e8c80f4e0843c4beda7d61565))

## [6.0.5](https://github.com/taskforcesh/bullmq-pro/compare/v6.0.4...v6.0.5) (2023-07-11)


### Bug Fixes

* **pause-group:** do not move job to wait when queue is paused ([#162](https://github.com/taskforcesh/bullmq-pro/issues/162)) ([458b381](https://github.com/taskforcesh/bullmq-pro/commit/458b3813eef982dc661a019349776d44d6ddb194))

## [6.0.4](https://github.com/taskforcesh/bullmq-pro/compare/v6.0.3...v6.0.4) (2023-07-07)


### Bug Fixes

* **group:** move job into group list when paused and dynamic rate limit ([#161](https://github.com/taskforcesh/bullmq-pro/issues/161)) ([1625f36](https://github.com/taskforcesh/bullmq-pro/commit/1625f36b3014ac191828d8ce070f237c19494c67))

## [6.0.3](https://github.com/taskforcesh/bullmq-pro/compare/v6.0.2...v6.0.3) (2023-07-05)


### Bug Fixes

* **rate-limit:** emit waiting event in rateLimitGroup ([#160](https://github.com/taskforcesh/bullmq-pro/issues/160)) ([eaf3cd7](https://github.com/taskforcesh/bullmq-pro/commit/eaf3cd74e3bcd40e6ba46bb2f540cae9cb945962))

## [6.0.2](https://github.com/taskforcesh/bullmq-pro/compare/v6.0.1...v6.0.2) (2023-07-04)


### Performance Improvements

* **remove-job:** do not remove last group id ([#159](https://github.com/taskforcesh/bullmq-pro/issues/159)) ([f5a3cd5](https://github.com/taskforcesh/bullmq-pro/commit/f5a3cd50d78bcadfd09ca9c5de1054f9620c191b))

## [6.0.1](https://github.com/taskforcesh/bullmq-pro/compare/v6.0.0...v6.0.1) (2023-06-29)


### Bug Fixes

* **job:** save groupId even when the job is a parent ([#157](https://github.com/taskforcesh/bullmq-pro/issues/157)) ([1debbf4](https://github.com/taskforcesh/bullmq-pro/commit/1debbf40ca4aa8f8b5ab45c36e8732f7ffe5442b))

# [6.0.0](https://github.com/taskforcesh/bullmq-pro/compare/v5.3.5...v6.0.0) (2023-06-26)


### Performance Improvements

* **priority:** add prioritized as a new state  ([#155](https://github.com/taskforcesh/bullmq-pro/issues/155)) ([b2391ca](https://github.com/taskforcesh/bullmq-pro/commit/b2391cab4d63e97f807eaed3a6e814be01de0f32))


### BREAKING CHANGES

* **priority:** priority is separated in its own zset, no duplication needed

* change job method name update to updateData

ref [faster priority jobs](https://bullmq.io/news/062123/faster-priority-jobs/)

## [5.3.5](https://github.com/taskforcesh/bullmq-pro/compare/v5.3.4...v5.3.5) (2023-06-16)


### Bug Fixes

* **rate-limit:** keep priority fifo order ([#1991](https://github.com/taskforcesh/bullmq/issues/1991)) fixes [#1929](https://github.com/taskforcesh/bullmq/issues/1929) (python) ([56bd7ad](https://github.com/taskforcesh/bullmq/commit/56bd7ad8c4daffcfb1f9f199abfc5d6495eb291e))
* **worker:** set redis version always in initialization ([#1989](https://github.com/taskforcesh/bullmq/issues/1989)) fixes [#1988](https://github.com/taskforcesh/bullmq/issues/1988) ([a1544a8](https://github.com/taskforcesh/bullmq/commit/a1544a8c0f29522cd33772b14f559969db852d1d))
* **worker:** use timeout as integer for redis lower than v6.0.0 (python) ([#1981](https://github.com/taskforcesh/bullmq/issues/1981)) ([0df6afa](https://github.com/taskforcesh/bullmq/commit/0df6afad5e71a693b721ba52ffa6be733ee45ccb))
* **retry-job:** consider priority when moving job to wait (python) ([#1969](https://github.com/taskforcesh/bullmq/issues/1969)) ([e753855](https://github.com/taskforcesh/bullmq/commit/e753855eef248da73a5e9f6b18f4b79319dc2f86))
* **job:** import right reference of QueueEvents ([#1964](https://github.com/taskforcesh/bullmq/issues/1964)) ([689c845](https://github.com/taskforcesh/bullmq/commit/689c84567f3a9fea51f349ca93b3008d5c187f62))
* **job:** use QueueEvents type for waitUntilFinished ([#1958](https://github.com/taskforcesh/bullmq/issues/1958)) ([881848c](https://github.com/taskforcesh/bullmq/commit/881848c1ee3835dac24daf6807b1f35da967f68b))
* **worker:** better worker client naming ([c5f63af](https://github.com/taskforcesh/bullmq/commit/c5f63affe72f7b6616f4c5f3aafde858dcc0b200))

## [5.3.4](https://github.com/taskforcesh/bullmq-pro/compare/v5.3.3...v5.3.4) (2023-06-06)


### Features

* **job:** add changePriority method ([#1901](https://github.com/taskforcesh/bullmq/issues/1901)) ref [#1899](https://github.com/taskforcesh/bullmq/issues/1899) ([9485ad5](https://github.com/taskforcesh/bullmq/commit/9485ad567e2d8c78d601cc9eb2b7dd37f96d00c9))

### Bug Fixes

* **rate-limit:** consider paused queue ([#1931](https://github.com/taskforcesh/bullmq/issues/1931)) ([d97864a](https://github.com/taskforcesh/bullmq/commit/d97864a550992aeb8673557c7d8f186ab4ccb5bf))
* **rate-limit:** take in count priority ([#1919](https://github.com/taskforcesh/bullmq/issues/1919)) fixes [#1915](https://github.com/taskforcesh/bullmq/issues/1915) ([b8157a3](https://github.com/taskforcesh/bullmq/commit/b8157a3424ceb60e662e80a3b0db918241b87ecc))

## [5.3.3](https://github.com/taskforcesh/bullmq-pro/compare/v5.3.2...v5.3.3) (2023-05-30)


### Bug Fixes

* **rate-limit:** take groups in count in global rate limit counter ([#151](https://github.com/taskforcesh/bullmq-pro/issues/151)) ([3d8b28d](https://github.com/taskforcesh/bullmq-pro/commit/3d8b28de087b6f97570dee74a356e11d92daf7fa))

## [5.3.2](https://github.com/taskforcesh/bullmq-pro/compare/v5.3.1...v5.3.2) (2023-05-24)


### Bug Fixes

* **job-pro:** use saveStacktrace script ([#150](https://github.com/taskforcesh/bullmq-pro/issues/150)) ([146d9a9](https://github.com/taskforcesh/bullmq-pro/commit/146d9a9596387026e842ab63f13212f7ed66c2c9))

## [5.3.1](https://github.com/taskforcesh/bullmq-pro/compare/v5.3.0...v5.3.1) (2023-05-23)


### Bug Fixes

* **remove-job:** consider decreasing group concurrency ([#149](https://github.com/taskforcesh/bullmq-pro/issues/149)) ([25068e2](https://github.com/taskforcesh/bullmq-pro/commit/25068e243f993e6a22531bb8d2c6c60ffba36b9b))

# [5.3.0](https://github.com/taskforcesh/bullmq-pro/compare/v5.2.5...v5.3.0) (2023-05-23)


### Features

* add support for job batches ([1db0c94](https://github.com/taskforcesh/bullmq-pro/commit/1db0c9436461262b3393628d3eff2191cc3247a2))

## [5.2.5](https://github.com/taskforcesh/bullmq-pro/compare/v5.2.4...v5.2.5) (2023-05-20)


### Bug Fixes

* **retry-job:** consider promoting delayed jobs ([#147](https://github.com/taskforcesh/bullmq-pro/issues/147)) ([3efd39e](https://github.com/taskforcesh/bullmq-pro/commit/3efd39eb2552d852b916f974fc16fab6768434c5))

## [5.2.4](https://github.com/taskforcesh/bullmq-pro/compare/v5.2.3...v5.2.4) (2023-05-16)


### Bug Fixes

* **rate-limit:** consider groups when global dynamic rate limit ([#145](https://github.com/taskforcesh/bullmq-pro/issues/145)) ([6f5d1e3](https://github.com/taskforcesh/bullmq-pro/commit/6f5d1e3014824149d1c857b79587bd5fd01f9bba))

## [5.2.3](https://github.com/taskforcesh/bullmq-pro/compare/v5.2.2...v5.2.3) (2023-05-09)


### Features

* **worker:** add worker threads support ([0820985](https://github.com/taskforcesh/bullmq/commit/0820985e073582fdf841affad38ecc7ab64691ec))
* upgrade ioredis to 5.3.2 ([375b1be](https://github.com/taskforcesh/bullmq/commit/375b1be52035e93c5fef6024e0d06aa723f602a9))

### Bug Fixes

* **rate-limit:** consider paused queue when dynamic rate limit ([#1884](https://github.com/taskforcesh/bullmq/issues/1884)) ([a23f37e](https://github.com/taskforcesh/bullmq/commit/a23f37e4079d34c8589efc85e4d726a62244f0d2))
* **retry:** consider when queue is paused ([#1880](https://github.com/taskforcesh/bullmq/issues/1880)) ([01b621f](https://github.com/taskforcesh/bullmq/commit/01b621fea0cbdae602482ff61361c05646823223))
* **worker:** close open handles after closing ([#1861](https://github.com/taskforcesh/bullmq/issues/1861)) fixes [#1312](https://github.com/taskforcesh/bullmq/issues/1312) ([39286e8](https://github.com/taskforcesh/bullmq/commit/39286e87e8ffabf641f229cf2da3db4c280f4637))

## [5.2.2](https://github.com/taskforcesh/bullmq-pro/compare/v5.2.1...v5.2.2) (2023-04-18)


### Features

* **upstash:** don't throw an error when detecting an upstash host ([2e06bca](https://github.com/taskforcesh/bullmq/commit/2e06bca3615aafecd725d093045a510a67053fed)) ref ([#143](https://github.com/taskforcesh/bullmq-pro/issues/143))

## [5.2.1](https://github.com/taskforcesh/bullmq-pro/compare/v5.2.0...v5.2.1) (2023-04-15)


### Bug Fixes

* **flow-producer-pro:** fix opts assignment ([#140](https://github.com/taskforcesh/bullmq-pro/issues/140)) ([9f8896c](https://github.com/taskforcesh/bullmq-pro/commit/9f8896c5f082d807bb6945780b30c2768015b95f))

# [5.2.0](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.15...v5.2.0) (2023-03-23)


### Features

* **groups:** add repair maxed group function ([a1fa1d8](https://github.com/taskforcesh/bullmq-pro/commit/a1fa1d80cf8ad79c7b9844df163765f61231350a))

## [5.1.15](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.14...v5.1.15) (2023-03-23)


### Bug Fixes

* **job:** avoid error when job is moved when processing ([#1354](https://github.com/taskforcesh/bullmq/issues/1354)) fixes [#1343](https://github.com/taskforcesh/bullmq/issues/1343) [#1602](https://github.com/taskforcesh/bullmq/issues/1602) ([78085e4](https://github.com/taskforcesh/bullmq/commit/78085e4304357dd3695df61057f91e706c3a52bf))
* **worker:** throw error with invalid concurrency fixes [#1723](https://github.com/taskforcesh/bullmq/issues/1723) ([2a1cdbe](https://github.com/taskforcesh/bullmq/commit/2a1cdbe3e871309f460aadc14b4d632238c32aa9))
* **worker:** close lock extended timer ([7995f18](https://github.com/taskforcesh/bullmq/commit/7995f18bb7712bd50d0fa3d17c4ab565b16ab379))
* **worker:** correct lock extender logic ([6aa3569](https://github.com/taskforcesh/bullmq/commit/6aa3569db0fe0137790e61a4b5982d2b35ee5646))
* **worker:** start stalled check timer ([4763be0](https://github.com/taskforcesh/bullmq/commit/4763be028b0c7b0460fd0804d4569c446a06ef4a))
* **worker:** run stalled check directly first time ([f71ec03](https://github.com/taskforcesh/bullmq/commit/f71ec03111a22897cbf2fad39073185e4aeac6d6))
* **worker:** restore failed event job parameter typing ([#1707](https://github.com/taskforcesh/bullmq/issues/1707)) ([44c2203](https://github.com/taskforcesh/bullmq/commit/44c2203ab65d406be9a913254600fe07c83e62d5))
* **worker:** failed event receives an optional job parameter ([#1702](https://github.com/taskforcesh/bullmq/issues/1702)) fixes [#1690](https://github.com/taskforcesh/bullmq/issues/1690) ([6009906](https://github.com/taskforcesh/bullmq/commit/6009906355765bf00cba5c1505e9e0c6bf8f14db))


### Features

* **worker:** replace Promise.race with efficient an async fifo ([0d94e35](https://github.com/taskforcesh/bullmq/commit/0d94e35e805b09c3b4c7404b8a2eeb71a1aff5c4)) ref ([#138](https://github.com/taskforcesh/bullmq-pro/issues/138))
* **worker:** simplify lock extension to one call independent of concurrency ([ebf1aeb](https://github.com/taskforcesh/bullmq/commit/ebf1aeb2400383d0ae90ab68aeb4822aea03ba44))
* **worker:** add remove on complete and fail options ([#1703](https://github.com/taskforcesh/bullmq/issues/1703)) ([cf13494](https://github.com/taskforcesh/bullmq/commit/cf1349471dcbf0e43feea9972eaa71d2299d619f))
* **worker:** add a public method to run the stalled checker ([3159266](https://github.com/taskforcesh/bullmq/commit/3159266ccb002d4fc71b7ee7ac63c465c536dbd1))
* **worker:** add support to disable stalled checks ([49e860c](https://github.com/taskforcesh/bullmq/commit/49e860c6675853971e992c2945b445660504e3b2))


### Performance Improvements

* **scripts:** reuse keys array to avoid allocations ([feac7b4](https://github.com/taskforcesh/bullmq/commit/feac7b4070a6a3720597af36c43d095e9ea37173))
* **worker:** improve worker memory consumption ([4846cf1](https://github.com/taskforcesh/bullmq/commit/4846cf1fe3f9ea35f58a679c11706e1a7101c898))
* **move-to-active:** remove deprecated limiter reference ([#1673](https://github.com/taskforcesh/bullmq/issues/1673)) ([a97b22f](https://github.com/taskforcesh/bullmq/commit/a97b22f518a9f6c5d9c30a77bfd03cafdcbc57ff))


## [5.1.14](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.13...v5.1.14) (2023-02-15)


### Bug Fixes

* **job:** check jobKey when saving stacktrace ([#1681](https://github.com/taskforcesh/bullmq/issues/1681)) fixes [#1676](https://github.com/taskforcesh/bullmq/issues/1676) ([1856c76](https://github.com/taskforcesh/bullmq/commit/1856c7684c377ca4fd36294cca8e128404be27b8))
* infinite worker process spawned for invalid JS file ([a445ba8](https://github.com/taskforcesh/bullmq/commit/a445ba8b7a261b370dec7d88091ae5f5af8b2728))
* **worker:** add a maximum block time ([1a2618b](https://github.com/taskforcesh/bullmq/commit/1a2618bc5473288a62dddb85e3cb78d6cdb4f39f))

## [5.1.13](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.12...v5.1.13) (2023-02-07)


### Bug Fixes

* **master:** copy type declaration ([23ade6e](https://github.com/taskforcesh/bullmq/commit/23ade6e3e45df14bd3fbc2c3e7be47307b642872))
* **redis:** increase minimum default retry time ([d521531](https://github.com/taskforcesh/bullmq/commit/d521531e22ba9eda8ad8d6e8eddf450fdc3f50f4))
* **connection:** apply console.warn in noeviction message ([95f171c](https://github.com/taskforcesh/bullmq/commit/95f171cbc8cdd7d04865618b715dd21229f36a4a))
* **error:** remove global prototype toJSON ([#1642](https://github.com/taskforcesh/bullmq/issues/1642)) fixes [#1414](https://github.com/taskforcesh/bullmq/issues/1414) ([d4e7108](https://github.com/taskforcesh/bullmq/commit/d4e7108a37aeabdd3085a26c9daf09cea5976f3e))
* **rate-limit:** update group concurrency after manual rate-limit ([de66ec4](https://github.com/taskforcesh/bullmq-pro/commit/de66ec494b8400e3cbb916f5937dc3834a213389))


### Features

* **job:** allow clearing job's log ([#1600](https://github.com/taskforcesh/bullmq/issues/1600)) ([0ded2d7](https://github.com/taskforcesh/bullmq/commit/0ded2d7709322bf105e0decac44d801ece5615f2))

## [5.1.12](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.11...v5.1.12) (2023-01-26)


### Bug Fixes

* **move-to-finished:** return correct delayUntil ([#1643](https://github.com/taskforcesh/bullmq/issues/1643)) ([c4bf9fa](https://github.com/taskforcesh/bullmq/commit/c4bf9fa6563eda1630d8eb2189b16e9324b01c7f))
* **worker:** fix delayed jobs with concurrency fixes [#1627](https://github.com/taskforcesh/bullmq/issues/1627) ([99a8e6d](https://github.com/taskforcesh/bullmq/commit/99a8e6d3a339be51fb46f69c8afac4ecdebff6d3))
* **move-to-active:** delete marker when it is moved to active ([#1634](https://github.com/taskforcesh/bullmq/issues/1634)) ([ad1fcea](https://github.com/taskforcesh/bullmq/commit/ad1fcea4500d4ceed51d5d5b0a03dbb5e1735a42))
* **move-to-active:** validate next marker and return delayUntil ([#1630](https://github.com/taskforcesh/bullmq/issues/1630)) ([3cd3305](https://github.com/taskforcesh/bullmq/commit/3cd33052fc711a9ba560c9a431630be5cdd02193))
* **worker:** add max concurrency from the beginning ([#1597](https://github.com/taskforcesh/bullmq/issues/1597)) fixes [#1589](https://github.com/taskforcesh/bullmq/issues/1589) ([6f49db3](https://github.com/taskforcesh/bullmq/commit/6f49db3fb15119d13f99cd83d49f2a7bdcb614cd))

## [5.1.11](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.10...v5.1.11) (2023-01-10)


### Bug Fixes

* circular references ([#1622](https://github.com/taskforcesh/bullmq/issues/1622)) ([f607ec7](https://github.com/taskforcesh/bullmq/commit/f607ec7530fb4430e8cab7ed325583bd9d171ccf))
* [#1603](https://github.com/taskforcesh/bullmq/issues/1603) performance issues in `remove()` ([#1607](https://github.com/taskforcesh/bullmq/issues/1607)) ([2541215](https://github.com/taskforcesh/bullmq/commit/2541215bcf81dcd52eaefa02530c3812a5135fbf))
* **delayed:** remove marker after being consumed ([#1620](https://github.com/taskforcesh/bullmq/issues/1620)) fixes [#1615](https://github.com/taskforcesh/bullmq/issues/1615) ([9fce0f0](https://github.com/taskforcesh/bullmq/commit/9fce0f05e5acc1918a276b03e8cb9c16083cb509))


### Performance Improvements

* **get-dependencies:** replace slow object destructuring with single object ([#1612](https://github.com/taskforcesh/bullmq/issues/1612)) ([621748e](https://github.com/taskforcesh/bullmq/commit/621748ec7727b46ce57eb9d2b46ef981874cdf4c))

## [5.1.10](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.9...v5.1.10) (2022-12-29)


### Bug Fixes

* **stalled:** add activeKey local reference ([#131](https://github.com/taskforcesh/bullmq-pro/issues/131)) ([6554ea4](https://github.com/taskforcesh/bullmq-pro/commit/6554ea4d155e905312dd3398189b611bd54942e0)), closes [taskforcesh/bullmq-pro-support#34](https://github.com/taskforcesh/bullmq-pro-support/issues/34)
* **connection:** throw exception if using keyPrefix in ioredis ([eb6a130](https://github.com/taskforcesh/bullmq/commit/eb6a1305541547725e1717eefe2b678bc445f4d0))
* **connection:** use includes to check for upstash more reliably ([12efb5c](https://github.com/taskforcesh/bullmq/commit/12efb5c539cb6f031ea6f3a80e4128d2e556e627))
* **job:** fetch parent before job moves to complete ([#1580](https://github.com/taskforcesh/bullmq/issues/1580)) ([6a6c0dc](https://github.com/taskforcesh/bullmq/commit/6a6c0dca30bb0a2417e0c62d4c80202c750322dd))
* **sandbox:** throw error when no exported function ([#1588](https://github.com/taskforcesh/bullmq/issues/1588)) fixes [#1587](https://github.com/taskforcesh/bullmq/issues/1587) ([c031891](https://github.com/taskforcesh/bullmq/commit/c03189184c8eeeb324f005b86e93d114abbe2154))


### Features

* **queue:** add getJobState method ([#1593](https://github.com/taskforcesh/bullmq/issues/1593)) ref [#1532](https://github.com/taskforcesh/bullmq/issues/1532) ([b741e84](https://github.com/taskforcesh/bullmq/commit/b741e8456f262b51aa7c68f571c76a3c54d02d37))

## [5.1.9](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.8...v5.1.9) (2022-12-23)


### Bug Fixes

* **job-pro:** fix opts type ([#129](https://github.com/taskforcesh/bullmq-pro/issues/129)) ([262de56](https://github.com/taskforcesh/bullmq-pro/commit/262de56bcb33f107d88fc765215bb809adc502a1)), closes [taskforcesh/issues#114](https://github.com/taskforcesh/issues/issues/114)

## [5.1.8](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.7...v5.1.8) (2022-12-22)


### Bug Fixes

* **worker:** avoid calling run on base class ([aba70f3](https://github.com/taskforcesh/bullmq-pro/commit/aba70f3df50f97221b1b998a416eb8e74ee66465))

## [5.1.7](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.6...v5.1.7) (2022-12-16)


### Performance Improvements

* **counts:** delete delayed marker when needed ([#1583](https://github.com/taskforcesh/bullmq/issues/1583)) ([cc26f1c](https://github.com/taskforcesh/bullmq/commit/cc26f1cd550de76c7588d3a98187b80ee78c40c4))
* **get-children-values:** replace slow object destructuring with single object ([#1586](https://github.com/taskforcesh/bullmq/issues/1586)) ([857d403](https://github.com/taskforcesh/bullmq/commit/857d40377a6eb2c0101e6d16d9085ecd4b52b016))

## [5.1.6](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.5...v5.1.6) (2022-12-15)


### Bug Fixes

* **remove-job:** check groupId is different than false on removed children ([#126](https://github.com/taskforcesh/bullmq-pro/issues/126)) ([efb54cb](https://github.com/taskforcesh/bullmq-pro/commit/efb54cbbd9486a608beace7f975247f5c6995470)), closes [taskforcesh/bullmq-pro-support#32](https://github.com/taskforcesh/bullmq-pro-support/issues/32)

## [5.1.5](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.4...v5.1.5) (2022-12-13)


### Bug Fixes

* **exponential:** respect exponential backoff delay ([#1581](https://github.com/taskforcesh/bullmq/issues/1581)) ([145dd32](https://github.com/taskforcesh/bullmq/commit/145dd329bb9f8254b404f4c5fbf7a50359202d37))
* **get-jobs:** filter marker ([#1551](https://github.com/taskforcesh/bullmq/issues/1551)) ([4add0ef](https://github.com/taskforcesh/bullmq/commit/4add0efa7857cc2f7b6d3c0c78a7f82cb7a46933))

### Features

* **worker:** add ready event for blockingConnection ([#1577](https://github.com/taskforcesh/bullmq/issues/1577)) ([992cc9e](https://github.com/taskforcesh/bullmq/commit/992cc9e9b3046185d3b67f2cc956f30337f458e1))

## [5.1.4](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.3...v5.1.4) (2022-12-08)


### Bug Fixes

* **rate-limit-group:** several small fixes related to manual group rate limit. ([5b338d6](https://github.com/taskforcesh/bullmq-pro/commit/5b338d6b68af6762ae1c12367cff010596d8a15e))

## [5.1.3](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.2...v5.1.3) (2022-12-08)


### Bug Fixes

* **worker:** try catch setname call ([#1576](https://github.com/taskforcesh/bullmq/issues/1576)) fixes [#1574](https://github.com/taskforcesh/bullmq/issues/1574) ([0c42fd8](https://github.com/taskforcesh/bullmq/commit/0c42fd8c07dbac7ace81e97e45440af93fc622a5))
* do not allow move from active to wait if not owner of the job ([dc1a307](https://github.com/taskforcesh/bullmq/commit/dc1a3077d1521c5dc99824a7fc05d17da03906bc))
* floor pexpire to integer ([1d5de42](https://github.com/taskforcesh/bullmq/commit/1d5de425a19ebf879a8f9a7e0543d87a4d358be1))
* **get-workers:** set name when ready event in connection ([#1564](https://github.com/taskforcesh/bullmq/issues/1564)) ([de93c17](https://github.com/taskforcesh/bullmq/commit/de93c172901650e1666c48423a39076f2c7b9c7b))
* **job:** console warn custom job ids when they represent integers ([#1569](https://github.com/taskforcesh/bullmq/issues/1569)) ([6e677d2](https://github.com/taskforcesh/bullmq/commit/6e677d2800957b368bef4247b8e4328c5758f262))
* **add-job:** throw error when jobId represents an integer ([#1556](https://github.com/taskforcesh/bullmq/issues/1556)) ([db617d7](https://github.com/taskforcesh/bullmq/commit/db617d79e8f55b5c9e0df4b6bfd4247612016da1))

### Features

* **queue-events:** support duplicated event ([#1549](https://github.com/taskforcesh/bullmq/issues/1549)) ([18bc4eb](https://github.com/taskforcesh/bullmq/commit/18bc4eb50432f8aa27f2395750a7617317b66ca1))

## [5.1.2](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.1...v5.1.2) (2022-12-07)


### Bug Fixes

* **add-job:** do not update job that already exist ([#1550](https://github.com/taskforcesh/bullmq/issues/1550)) ([26f6311](https://github.com/taskforcesh/bullmq/commit/26f6311cd0d2b936e404d0abebca9637f314a209))
* **rate-limit:** delete rateLimiterKey when 0 ([#1553](https://github.com/taskforcesh/bullmq/issues/1553)) ([0b88e5b](https://github.com/taskforcesh/bullmq/commit/0b88e5b94b4a0dc0d4000f7fd4b327f402248ad2))

## [5.1.1](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.0...v5.1.1) (2022-12-05)


### Bug Fixes

* **remove-job:** check for nil as groupId instead of empty string ([#119](https://github.com/taskforcesh/bullmq-pro/issues/119)) ([dd63c23](https://github.com/taskforcesh/bullmq-pro/commit/dd63c238fdda33313cc06cfe3c69f1c0243fd9f3))

# [5.1.0](https://github.com/taskforcesh/bullmq-pro/compare/v5.0.3...v5.1.0) (2022-11-29)


### Features

* add support for manually rate-limit groups ([64006ee](https://github.com/taskforcesh/bullmq-pro/commit/64006ee49f5f3a83816bfcb1e16488ffa9460273))

## [5.0.3](https://github.com/taskforcesh/bullmq-pro/compare/v5.0.2...v5.0.3) (2022-11-26)


### Bug Fixes

* **global-rate-limit:** move job into group list ([#116](https://github.com/taskforcesh/bullmq-pro/issues/116)) ([75384c4](https://github.com/taskforcesh/bullmq-pro/commit/75384c494e78eacb2f183d1a6504c0918561272b))

## [5.0.2](https://github.com/taskforcesh/bullmq-pro/compare/v5.0.1...v5.0.2) (2022-11-25)


### Performance Improvements

* **groups:** check rate-limit when moving job to active ([#117](https://github.com/taskforcesh/bullmq-pro/issues/117)) ([d247983](https://github.com/taskforcesh/bullmq-pro/commit/d247983f1ceba109511669944e5cf3be756815d2))

## [5.0.1](https://github.com/taskforcesh/bullmq-pro/compare/v5.0.0...v5.0.1) (2022-11-23)


### Bug Fixes

* **ttl:** throw error when it's not provided as positive number ([#115](https://github.com/taskforcesh/bullmq-pro/issues/115)) ([2d8ef2a](https://github.com/taskforcesh/bullmq-pro/commit/2d8ef2a9e8116e272cdf423de08a19775667d75a))

# [5.0.0](https://github.com/taskforcesh/bullmq-pro/compare/v4.0.3...v5.0.0) (2022-11-22)


### Bug Fixes

* upgrade bullmq to 3.2.2 ([#111](https://github.com/taskforcesh/bullmq-pro/issues/111)) ([cac9167](https://github.com/taskforcesh/bullmq-pro/commit/cac91672be7962d2fa3234870d811cd3e690b7b5))


### BREAKING CHANGES

* Change global rate limit
Move jobs to wait or groups when global rate limit

## [4.0.3](https://github.com/taskforcesh/bullmq-pro/compare/v4.0.2...v4.0.3) (2022-11-19)


### Bug Fixes

* **stalled:** use type result as table ([#113](https://github.com/taskforcesh/bullmq-pro/issues/113)) ([0507801](https://github.com/taskforcesh/bullmq-pro/commit/05078015f0ed687d8151780bb102a43d7da642ca))

## [4.0.2](https://github.com/taskforcesh/bullmq-pro/compare/v4.0.1...v4.0.2) (2022-11-08)


### Bug Fixes

* **promote:** consider groups ([#109](https://github.com/taskforcesh/bullmq-pro/issues/109)) ([c46c67b](https://github.com/taskforcesh/bullmq-pro/commit/c46c67b785fe521e5742582460c960bc16fd5c60))

## [4.0.1](https://github.com/taskforcesh/bullmq-pro/compare/v4.0.0...v4.0.1) (2022-11-07)


### Features

* **flows:** allow parent on root jobs in addBulk method ([#1488](https://github.com/taskforcesh/bullmq/issues/1488)) ref [#1480](https://github.com/taskforcesh/bullmq/issues/1480) ([92308e5](https://github.com/taskforcesh/bullmq/commit/92308e53acf14e0ce108d94ecd616633ac93e35d))

# [4.0.0](https://github.com/taskforcesh/bullmq-pro/compare/v3.0.0...v4.0.0) (2022-10-27)


### Bug Fixes

* **job:** send failed event when failParentOnFailure ([#1481](https://github.com/taskforcesh/bullmq/issues/1481)) fixes [#1469](https://github.com/taskforcesh/bullmq/issues/1469) ([b20eb6f](https://github.com/taskforcesh/bullmq/commit/b20eb6f65c7e2c4593d5f9f4d4b940f780bf26d2))
* **redis:** replace throw exception by console.error ([fafa2f8](https://github.com/taskforcesh/bullmq/commit/fafa2f89e796796f950e6c4abbdda4d3d71ad1b0))
* **connection:** validate array of strings in Cluster ([#1468](https://github.com/taskforcesh/bullmq/issues/1468)) fixes [#1467](https://github.com/taskforcesh/bullmq/issues/1467) ([8355182](https://github.com/taskforcesh/bullmq/commit/8355182a372b68ec62e9c3953bacbd69e0abfc74))
* **worker:** clear stalled jobs timer when closing worker ([1567a0d](https://github.com/taskforcesh/bullmq/commit/1567a0df0ca3c8d43a18990fe488888f4ff68040))
* **getters:** fix return type of getJobLogs ([d452927](https://github.com/taskforcesh/bullmq/commit/d4529278c59b2c94eee604c7d4455acc490679e9))
* **sandbox:** get open port using built-in module instead of get-port ([#1446](https://github.com/taskforcesh/bullmq/issues/1446)) ([6db6288](https://github.com/taskforcesh/bullmq/commit/6db628868a9d64c5a3e47d1c9201017e6d05c1ae))
* **job:** update delay value when moving to wait ([#1436](https://github.com/taskforcesh/bullmq/issues/1436)) ([9560915](https://github.com/taskforcesh/bullmq/commit/95609158c1800cf661f22ad7995541fb9474826a))
* **connection:** throw error when no noeviction policy ([3468390](https://github.com/taskforcesh/bullmq/commit/3468390dd6331291f4cf71a54c32028a06d1d99e))
* **compat:** remove Queue3 class ([#1421](https://github.com/taskforcesh/bullmq/issues/1421)) ([fc797f7](https://github.com/taskforcesh/bullmq/commit/fc797f7cd334c19a95cb1290ddb6611cd3417179))
* **delayed:** promote delayed jobs instead of picking one by one ([1b938af](https://github.com/taskforcesh/bullmq/commit/1b938af75069d69772ddf2b03f95db7f53eada68))
* **delayed:** remove marker when promoting delayed job ([1aea0dc](https://github.com/taskforcesh/bullmq/commit/1aea0dcc5fb29086cef3d0c432c387d6f8261963))
* **getters:** compensate for "mark" job id ([231b9aa](https://github.com/taskforcesh/bullmq/commit/231b9aa0f4781e4493d3ea272c33b27c0b7dc0ab))
* **sandbox:** remove progress method ([b43267b](https://github.com/taskforcesh/bullmq/commit/b43267be50f9eade8233500d189d46940a01cc29))
* **stalled-jobs:** handle job id 0 ([829e6e0](https://github.com/taskforcesh/bullmq/commit/829e6e0252e78bf2cbc55ab1d3bd153faa0cee4c))
* **worker:** do not allow stalledInterval to be less than zero ([831ffc5](https://github.com/taskforcesh/bullmq/commit/831ffc520ccd3c6ea63af6b04ddddc9f7829c667))
* **worker:** use connection closing to determine closing status ([fe1d173](https://github.com/taskforcesh/bullmq/commit/fe1d17321f1eb49bd872c52965392add22729941))


### Features

* **redis-connection:** allow providing scripts for extension ([#1472](https://github.com/taskforcesh/bullmq/issues/1472)) ([f193cfb](https://github.com/taskforcesh/bullmq/commit/f193cfb1830e127f9fd47a969baad30011a0e3a4))
* **flow-producer:** allow parent opts in root job when adding a flow ([#1110](https://github.com/taskforcesh/bullmq/issues/1110)) ref [#1097](https://github.com/taskforcesh/bullmq/issues/1097) ([3c3ac71](https://github.com/taskforcesh/bullmq/commit/3c3ac718ad84f6bd0cc1575013c948e767b46f38))
* **job-options:** add failParentOnFailure option ([#1339](https://github.com/taskforcesh/bullmq/issues/1339)) ([65e5c36](https://github.com/taskforcesh/bullmq/commit/65e5c3678771f26555c9128bdb908dd62e3584f9))
* improve delayed jobs and remove QueueSchedulerPro ([1f66e5a](https://github.com/taskforcesh/bullmq/commit/1f66e5a6c891d52e0671e58a685dbca511e45e7e))
* move stalled jobs check and handling to WorkerPro class from QueueSchedulerPro ([13769cb](https://github.com/taskforcesh/bullmq/commit/13769cbe38ba22793cbc66e9706a6be28a7f1512))


### Performance Improvements

* **scripts:** pre-build scripts ([#1441](https://github.com/taskforcesh/bullmq/issues/1441)) ([7f72603](https://github.com/taskforcesh/bullmq/commit/7f72603d463f705d0617898cb221f832c49a4aa3))
* **events:** remove data and opts from added event ([e13d4b8](https://github.com/taskforcesh/bullmq/commit/e13d4b8e0c4f99203f4249ccc86e369d124ff483))


### BREAKING CHANGES

* Remove QueueSchedulerPro class.
WorkerPro class should handle QueueSchedulerPro functionalities.
* **compat:** The compatibility class for Bullv3 is no longer available.
* Failed and stalled events are now produced by the WorkerPro class instead of by the QueueSchedulerPro.
* The minimum Redis recommended version is 6.2.0.

# [3.0.0](https://github.com/taskforcesh/bullmq-pro/compare/v2.7.1...v3.0.0) (2022-10-18)


### Bug Fixes

* **groups:** do not parse gid when deserializing jobs fixes [#25](https://github.com/taskforcesh/bullmq-pro/issues/25) ([b03a1e9](https://github.com/taskforcesh/bullmq-pro/commit/b03a1e9c637e62e7c1722a77b61d55e208983852))


### BREAKING CHANGES

* **groups:** Group ids must be strings. Numbers are not allowed anymore.

Fixes https://github.com/taskforcesh/bullmq-pro-support/issues/25

## [2.7.1](https://github.com/taskforcesh/bullmq-pro/compare/v2.7.0...v2.7.1) (2022-10-13)


### Bug Fixes

* **delete-groups:** consider rate-limit, max concurrency and paused ([#104](https://github.com/taskforcesh/bullmq-pro/issues/104)) ([29873f8](https://github.com/taskforcesh/bullmq-pro/commit/29873f8c900025f70cd88f8328fa8c6b3841bc7b))

# [2.7.0](https://github.com/taskforcesh/bullmq-pro/compare/v2.6.0...v2.7.0) (2022-10-11)


### Features

* add getGroupStatus ([a7cd882](https://github.com/taskforcesh/bullmq-pro/commit/a7cd882f80b182612a19924823000cec15d2cf90))

# [2.6.0](https://github.com/taskforcesh/bullmq-pro/compare/v2.5.0...v2.6.0) (2022-10-11)


### Features

* add version support ([b7e1831](https://github.com/taskforcesh/bullmq-pro/commit/b7e183116137d8774a12d09a4d97d29d1cdb2999))

# [2.5.0](https://github.com/taskforcesh/bullmq-pro/compare/v2.4.14...v2.5.0) (2022-10-11)


### Features

* add getGroupsByStatus method to getters ([949e93b](https://github.com/taskforcesh/bullmq-pro/commit/949e93bc3478607f95ee59eab41a1ac7e271e74d))

## [2.4.14](https://github.com/taskforcesh/bullmq-pro/compare/v2.4.13...v2.4.14) (2022-10-07)


### Bug Fixes

* **delete-group:** consider max-concurrency state ([#98](https://github.com/taskforcesh/bullmq-pro/issues/98)) ([d897dd9](https://github.com/taskforcesh/bullmq-pro/commit/d897dd9bef0f6844d9752bfb3c22f0be6368889b))

## [2.4.13](https://github.com/taskforcesh/bullmq-pro/compare/v2.4.12...v2.4.13) (2022-10-05)


### Bug Fixes

* **delete-group:** consider rate-limit state ([#97](https://github.com/taskforcesh/bullmq-pro/issues/97)) ([85f7f32](https://github.com/taskforcesh/bullmq-pro/commit/85f7f32a0c2e893f7921c8eee9bc0655fdff7a39))

## [2.4.12](https://github.com/taskforcesh/bullmq-pro/compare/v2.4.11...v2.4.12) (2022-09-30)


### Bug Fixes

* **global-rate-limit:** consider groups ([#95](https://github.com/taskforcesh/bullmq-pro/issues/95)) ([de95fde](https://github.com/taskforcesh/bullmq-pro/commit/de95fde1f07096f6d2dfff278b1d969a5b2a0c0f))

## [2.4.11](https://github.com/taskforcesh/bullmq-pro/compare/v2.4.10...v2.4.11) (2022-09-29)


### Bug Fixes

* **drain:** consider empty active list ([#1412](https://github.com/taskforcesh/bullmq/issues/1412)) ([f919a50](https://github.com/taskforcesh/bullmq/commit/f919a50b2f4972dcb9ecd5848b0f7fd9a0e137ea))

### Features

* **sandbox:** support update method ([#1416](https://github.com/taskforcesh/bullmq/issues/1416)) ([606b75d](https://github.com/taskforcesh/bullmq/commit/606b75d53e12dfc109f01eda38736c07e829e9b7))

## [2.4.10](https://github.com/taskforcesh/bullmq-pro/compare/v2.4.9...v2.4.10) (2022-09-14)


### Bug Fixes

* **timeout:** delete unused option ([#94](https://github.com/taskforcesh/bullmq-pro/issues/94)) ([4f8dc50](https://github.com/taskforcesh/bullmq-pro/commit/4f8dc5021c311fe10d20568c4dae4055d01ef98f))

## [2.4.9](https://github.com/taskforcesh/bullmq-pro/compare/v2.4.8...v2.4.9) (2022-09-13)


### Performance Improvements

* **script-loader:** use cache to read script once ([#93](https://github.com/taskforcesh/bullmq-pro/issues/93)) ([04bbeec](https://github.com/taskforcesh/bullmq-pro/commit/04bbeece1dfc8e06d8590eb486879593d4dae437))

## [2.4.8](https://github.com/taskforcesh/bullmq-pro/compare/v2.4.7...v2.4.8) (2022-09-09)


### Bug Fixes

* **concurrency:** consider base rate limit ([#90](https://github.com/taskforcesh/bullmq-pro/issues/90)) ([74a4a0b](https://github.com/taskforcesh/bullmq-pro/commit/74a4a0ba01f3a447f9dc24f5bbb898bc6afaeaa6))

## [2.4.7](https://github.com/taskforcesh/bullmq-pro/compare/v2.4.6...v2.4.7) (2022-09-06)


### Bug Fixes

* **flow-producer-pro:** use interim class ([#92](https://github.com/taskforcesh/bullmq-pro/issues/92)) ([2406cc3](https://github.com/taskforcesh/bullmq-pro/commit/2406cc3f1b4c78feed8a4fbd91422e3ca1970b19))

## [2.4.6](https://github.com/taskforcesh/bullmq-pro/compare/v2.4.5...v2.4.6) (2022-09-06)


### Performance Improvements

* **add-job:** handle parent split on js ([#1397](https://github.com/taskforcesh/bullmq/issues/1397)) ([566f074](https://github.com/taskforcesh/bullmq/commit/566f0747110679e5b07e7642fef793744565fffe))

## [2.4.5](https://github.com/taskforcesh/bullmq-pro/compare/v2.4.4...v2.4.5) (2022-08-30)


### Bug Fixes

* **delete-group:** consider children ([#88](https://github.com/taskforcesh/bullmq-pro/issues/88)) ([83de2a9](https://github.com/taskforcesh/bullmq-pro/commit/83de2a9c9b42775996a8c8893caf66d1af6bea15))

## [2.4.4](https://github.com/taskforcesh/bullmq-pro/compare/v2.4.3...v2.4.4) (2022-08-30)


### Bug Fixes

* **deps:** upgrade bullmq to 1.90.0 ([#84](https://github.com/taskforcesh/bullmq-pro/issues/84)) ([69a01c5](https://github.com/taskforcesh/bullmq-pro/commit/69a01c5d91c3e6ad2b1fb7a32ced8a04021d91ec))

## [2.4.3](https://github.com/taskforcesh/bullmq-pro/compare/v2.4.2...v2.4.3) (2022-08-26)


### Bug Fixes

* **waiting-children:** consider decreasing group concurrency ([#86](https://github.com/taskforcesh/bullmq-pro/issues/86)) ([be430a7](https://github.com/taskforcesh/bullmq-pro/commit/be430a72f7bda55e22a0ae5e5623e8a2b835e98e))

## [2.4.2](https://github.com/taskforcesh/bullmq-pro/compare/v2.4.1...v2.4.2) (2022-08-25)


### Bug Fixes

* **deps:** upgrade bullmq to 1.89.1 ([#87](https://github.com/taskforcesh/bullmq-pro/issues/87)) ([228aca3](https://github.com/taskforcesh/bullmq-pro/commit/228aca3e72ef9401fe3c67e5ca72be6b1068b6c6))

## [2.4.1](https://github.com/taskforcesh/bullmq-pro/compare/v2.4.0...v2.4.1) (2022-08-18)


### Bug Fixes

* **job:** remove from group ([#57](https://github.com/taskforcesh/bullmq-pro/issues/57)) ([7c38aa1](https://github.com/taskforcesh/bullmq-pro/commit/7c38aa19ea9aba53689e14208892ab7f6547b699))

# [2.4.0](https://github.com/taskforcesh/bullmq-pro/compare/v2.3.13...v2.4.0) (2022-08-16)


### Features

* **groups:** support flows ([#81](https://github.com/taskforcesh/bullmq-pro/issues/81)) ([3db9478](https://github.com/taskforcesh/bullmq-pro/commit/3db947863093c7c7db83773876dd7593b5a33210))

## [2.3.13](https://github.com/taskforcesh/bullmq-pro/compare/v2.3.12...v2.3.13) (2022-08-13)


### Bug Fixes

* **deps:** upgrade bullmq to 1.87.2 ([#83](https://github.com/taskforcesh/bullmq-pro/issues/83)) ([5b3c866](https://github.com/taskforcesh/bullmq-pro/commit/5b3c866016837bdafa93bc315d31d9eee2465ed5))

## [2.3.12](https://github.com/taskforcesh/bullmq-pro/compare/v2.3.11...v2.3.12) (2022-08-11)


### Bug Fixes

* **observables:** guarantee store result order ([f963557](https://github.com/taskforcesh/bullmq-pro/commit/f9635571ae359cdf6de9cd18463ef879c166a4f4))
* **observables:** store last value as returnvalue ([7306ae2](https://github.com/taskforcesh/bullmq-pro/commit/7306ae233b5a2ecb96d402a30d7db61bb8c74567))

## [2.3.11](https://github.com/taskforcesh/bullmq-pro/compare/v2.3.10...v2.3.11) (2022-08-09)


### Bug Fixes

* **deps:** upgrade bullmq to 1.87.1 ([#79](https://github.com/taskforcesh/bullmq-pro/issues/79)) ([3affc37](https://github.com/taskforcesh/bullmq-pro/commit/3affc37ab682f1d58c0dfa29d3db714c8e7f8c91))

## [2.3.10](https://github.com/taskforcesh/bullmq-pro/compare/v2.3.9...v2.3.10) (2022-08-03)


### Performance Improvements

* **move-to-finished:** pass keepJobs into opts arg ([#78](https://github.com/taskforcesh/bullmq-pro/issues/78)) ([08eb23f](https://github.com/taskforcesh/bullmq-pro/commit/08eb23fa54bfe1e46c1e79bfee9d72fb0dbba52b))

## [2.3.9](https://github.com/taskforcesh/bullmq-pro/compare/v2.3.8...v2.3.9) (2022-08-01)


### Bug Fixes

* **deps:** upgrade bullmq to 1.86.10 ([#76](https://github.com/taskforcesh/bullmq-pro/issues/76)) ([d3df585](https://github.com/taskforcesh/bullmq-pro/commit/d3df5850fd92b6d98e77c6d7e7355f205f7df4c4))

## [2.3.8](https://github.com/taskforcesh/bullmq-pro/compare/v2.3.7...v2.3.8) (2022-08-01)


### Bug Fixes

* **move-to-active:** use local jobId instead of global reference ([#77](https://github.com/taskforcesh/bullmq-pro/issues/77)) ([1f0b8dd](https://github.com/taskforcesh/bullmq-pro/commit/1f0b8dd747ce9ad9fdacdb7774cb1f34e989ceb5))

## [2.3.7](https://github.com/taskforcesh/bullmq-pro/compare/v2.3.6...v2.3.7) (2022-07-28)


### Bug Fixes

* **deps:** upgrade bullmq to 1.86.9 ([#73](https://github.com/taskforcesh/bullmq-pro/issues/73)) ([bbc0784](https://github.com/taskforcesh/bullmq-pro/commit/bbc07845f6cce0cc003681255b892330c729b30e))

## [2.3.6](https://github.com/taskforcesh/bullmq-pro/compare/v2.3.5...v2.3.6) (2022-07-26)


### Performance Improvements

* **retry-jobs:** add jobs in batches when groupId is present ([#72](https://github.com/taskforcesh/bullmq-pro/issues/72)) ([3961da0](https://github.com/taskforcesh/bullmq-pro/commit/3961da022843048597033e8f13034f245198bca3))

## [2.3.5](https://github.com/taskforcesh/bullmq-pro/compare/v2.3.4...v2.3.5) (2022-07-20)


### Bug Fixes

* **retry-jobs:** consider groups ([#70](https://github.com/taskforcesh/bullmq-pro/issues/70)) ([7b03017](https://github.com/taskforcesh/bullmq-pro/commit/7b030179d1a2de23aba2f9c5e71b5d13d6de67d3))

## [2.3.4](https://github.com/taskforcesh/bullmq-pro/compare/v2.3.3...v2.3.4) (2022-07-16)


### Bug Fixes

* **scripts:** use tonumber on timestamp args ([#71](https://github.com/taskforcesh/bullmq-pro/issues/71)) ([5c6a62d](https://github.com/taskforcesh/bullmq-pro/commit/5c6a62de4d7df43343cca58f53ef39201c2aa6d1))

## [2.3.3](https://github.com/taskforcesh/bullmq-pro/compare/v2.3.2...v2.3.3) (2022-07-12)


### Bug Fixes

* **deps:** upgrade bullmq to 1.86.5 ([#69](https://github.com/taskforcesh/bullmq-pro/issues/69)) ([2ed4bf3](https://github.com/taskforcesh/bullmq-pro/commit/2ed4bf36a1a0245e0303a8bc5fe120dbf84d8e1d))

## [2.3.2](https://github.com/taskforcesh/bullmq-pro/compare/v2.3.1...v2.3.2) (2022-07-09)


### Bug Fixes

* **concurrency:** consider retry backoff strategy ([#68](https://github.com/taskforcesh/bullmq-pro/issues/68)) ([99f17bd](https://github.com/taskforcesh/bullmq-pro/commit/99f17bdd085ef1376bb1f35e2c679ab04e3a2d03))

## [2.3.1](https://github.com/taskforcesh/bullmq-pro/compare/v2.3.0...v2.3.1) (2022-07-01)


### Bug Fixes

* **job-pro:** fix gid parse ([#67](https://github.com/taskforcesh/bullmq-pro/issues/67)) ([5532eaf](https://github.com/taskforcesh/bullmq-pro/commit/5532eaf5d61790a9bf63604838c2c3cd5546697e))

# [2.3.0](https://github.com/taskforcesh/bullmq-pro/compare/v2.2.3...v2.3.0) (2022-07-01)


### Features

* **job-pro:** expose gid value ([#65](https://github.com/taskforcesh/bullmq-pro/issues/65)) ([ea7ab29](https://github.com/taskforcesh/bullmq-pro/commit/ea7ab29d7d15c42fba6823de53c243c0eb20d2fa))

## [2.2.3](https://github.com/taskforcesh/bullmq-pro/compare/v2.2.2...v2.2.3) (2022-06-30)


### Bug Fixes

* **queue-pro:** fix addBulk opts typing ([#66](https://github.com/taskforcesh/bullmq-pro/issues/66)) ([8b73ed9](https://github.com/taskforcesh/bullmq-pro/commit/8b73ed9b807375f1a18a62feef26c48c9b324fe8))

## [2.2.2](https://github.com/taskforcesh/bullmq-pro/compare/v2.2.1...v2.2.2) (2022-06-28)


### Bug Fixes

* **pause-group:** return boolean for execution success ([#64](https://github.com/taskforcesh/bullmq-pro/issues/64)) ([b665b82](https://github.com/taskforcesh/bullmq-pro/commit/b665b828ba950411567f3424f0e8a1f80467021b))

## [2.2.1](https://github.com/taskforcesh/bullmq-pro/compare/v2.2.0...v2.2.1) (2022-06-25)


### Bug Fixes

* **groups:** rename paused and resumed events in QueueEventsPro ([#63](https://github.com/taskforcesh/bullmq-pro/issues/63)) ([e2d6abf](https://github.com/taskforcesh/bullmq-pro/commit/e2d6abff3d59a8417896f7405ffcab35f2a780f3))

# [2.2.0](https://github.com/taskforcesh/bullmq-pro/compare/v2.1.6...v2.2.0) (2022-06-24)


### Features

* **pause-group:** allow pausing specific group ([#61](https://github.com/taskforcesh/bullmq-pro/issues/61)) ref [#25](https://github.com/taskforcesh/bullmq-pro/issues/25) ([a5ec201](https://github.com/taskforcesh/bullmq-pro/commit/a5ec2018935241b01be1c38323e6d1e31fffe89f))

## [2.1.6](https://github.com/taskforcesh/bullmq-pro/compare/v2.1.5...v2.1.6) (2022-06-10)


### Bug Fixes

* **deps:** upgrade bullmq to 1.86.0 ([#60](https://github.com/taskforcesh/bullmq-pro/issues/60)) ([ea07b00](https://github.com/taskforcesh/bullmq-pro/commit/ea07b0090e21efabfe25f65d277856eaab0d8fc5))

## [2.1.5](https://github.com/taskforcesh/bullmq-pro/compare/v2.1.4...v2.1.5) (2022-06-09)


### Bug Fixes

* **deps:** upgrade bullmq to 1.85.4 ([#59](https://github.com/taskforcesh/bullmq-pro/issues/59)) ([b45b363](https://github.com/taskforcesh/bullmq-pro/commit/b45b36369909a7db9fa01968065af0ff9ad2cafd))

## [2.1.4](https://github.com/taskforcesh/bullmq-pro/compare/v2.1.3...v2.1.4) (2022-06-08)


### Bug Fixes

* **worker:** use isObservable ([#58](https://github.com/taskforcesh/bullmq-pro/issues/58)) ([8bed7ce](https://github.com/taskforcesh/bullmq-pro/commit/8bed7ce5a933c0126abd441488180fb5036eb3f1))

## [2.1.3](https://github.com/taskforcesh/bullmq-pro/compare/v2.1.2...v2.1.3) (2022-05-25)


### Bug Fixes

* **deps:** upgrade bullmq to 1.83.2 ([#56](https://github.com/taskforcesh/bullmq-pro/issues/56)) ([a98c917](https://github.com/taskforcesh/bullmq-pro/commit/a98c9177bbb526692a22b9407d0f0374db7ee8d2))

## [2.1.2](https://github.com/taskforcesh/bullmq-pro/compare/v2.1.1...v2.1.2) (2022-05-20)


### Bug Fixes

* **deps:** upgrade bullmq to 1.83.0 ([#55](https://github.com/taskforcesh/bullmq-pro/issues/55)) ([dc3b02d](https://github.com/taskforcesh/bullmq-pro/commit/dc3b02d28b583862ea2fab2e6557d5d35ff811e6))

## [2.1.1](https://github.com/taskforcesh/bullmq-pro/compare/v2.1.0...v2.1.1) (2022-05-18)


### Bug Fixes

* **flow-producer:** use JobPro instances ([#54](https://github.com/taskforcesh/bullmq-pro/issues/54)) ([578d3db](https://github.com/taskforcesh/bullmq-pro/commit/578d3db5941752b72d1925a1026e013a590d55d5))

# [2.1.0](https://github.com/taskforcesh/bullmq-pro/compare/v2.0.3...v2.1.0) (2022-05-17)


### Features

* **get-state:** consider checking groups ([#53](https://github.com/taskforcesh/bullmq-pro/issues/53)) ([1dad072](https://github.com/taskforcesh/bullmq-pro/commit/1dad072cad84b3b18219bd8c0caf883c2b5179fc))

## [2.0.3](https://github.com/taskforcesh/bullmq-pro/compare/v2.0.2...v2.0.3) (2022-05-07)


### Bug Fixes

* **deps:** upgrade bullmq to 1.81.4 ([#52](https://github.com/taskforcesh/bullmq-pro/issues/52)) ([8d92b21](https://github.com/taskforcesh/bullmq-pro/commit/8d92b21571a1263a3be097bf7e1c7d7f60c06816))

## [2.0.2](https://github.com/taskforcesh/bullmq-pro/compare/v2.0.1...v2.0.2) (2022-04-27)


### Bug Fixes

* **stalled:** allow easy transition for stalled changes ([#50](https://github.com/taskforcesh/bullmq-pro/issues/50)) ([ce40ead](https://github.com/taskforcesh/bullmq-pro/commit/ce40ead2c26bffbc80d3953ed80a63bceedbb73b))

## [2.0.1](https://github.com/taskforcesh/bullmq-pro/compare/v2.0.0...v2.0.1) (2022-04-22)


### Bug Fixes

* **deps:** upgrade bullmq to 1.80.6 ([#48](https://github.com/taskforcesh/bullmq-pro/issues/48)) ([4aed9b0](https://github.com/taskforcesh/bullmq-pro/commit/4aed9b0c11d77b96f0859ff6b1b32e4b7c95249d))

# [2.0.0](https://github.com/taskforcesh/bullmq-pro/compare/v1.4.1...v2.0.0) (2022-04-20)


### Features

* **groups:** improve addGroups to return all groups statuses ([3f01d66](https://github.com/taskforcesh/bullmq-pro/commit/3f01d66fee33965a68de634e6771ab9da158a0e1))


### BREAKING CHANGES

* **groups:** In order to make the group getter consistent for all statuses we are changing the SET type for groups:active to ZSET. Also we rename the ZSET to groups:max as it represent groups that have maxed the concurrency.

## [1.4.1](https://github.com/taskforcesh/bullmq-pro/compare/v1.4.0...v1.4.1) (2022-04-19)


### Bug Fixes

* **deps:** upgrade bullmq to 1.80.4 ([#46](https://github.com/taskforcesh/bullmq-pro/issues/46)) ([fc2818f](https://github.com/taskforcesh/bullmq-pro/commit/fc2818f09ddd273b7cc16c54fcd9650e1d456d04))

# [1.4.0](https://github.com/taskforcesh/bullmq-pro/compare/v1.3.5...v1.4.0) (2022-04-12)


### Features

* **worker:** allow ttl per job name ([#43](https://github.com/taskforcesh/bullmq-pro/issues/43)) ([93a61ad](https://github.com/taskforcesh/bullmq-pro/commit/93a61ad1b0c788af39ea944fb908ec78398a47a9))

## [1.3.5](https://github.com/taskforcesh/bullmq-pro/compare/v1.3.4...v1.3.5) (2022-04-06)


### Bug Fixes

* **deps:** upgrade bullmq to 1.78.2 ([#42](https://github.com/taskforcesh/bullmq-pro/issues/42)) ([10771c2](https://github.com/taskforcesh/bullmq-pro/commit/10771c29212686584fbd278d689655b8e97de62a))

## [1.3.4](https://github.com/taskforcesh/bullmq-pro/compare/v1.3.3...v1.3.4) (2022-03-26)


### Bug Fixes

* **groups:** consider delay option ([#40](https://github.com/taskforcesh/bullmq-pro/issues/40)) fixes [#39](https://github.com/taskforcesh/bullmq-pro/issues/39) ([c2a2b93](https://github.com/taskforcesh/bullmq-pro/commit/c2a2b9393a0ca3febcc486ea2f1afd515c294473))

## [1.3.3](https://github.com/taskforcesh/bullmq-pro/compare/v1.3.2...v1.3.3) (2022-03-23)


### Bug Fixes

* upgrade bullmq to 1.77.3 ([#38](https://github.com/taskforcesh/bullmq-pro/issues/38)) ([b7af3d2](https://github.com/taskforcesh/bullmq-pro/commit/b7af3d2c01cfc2fbfadd4643fd8915ed1a2c3098))

## [1.3.2](https://github.com/taskforcesh/bullmq-pro/compare/v1.3.1...v1.3.2) (2022-03-16)


### Bug Fixes

* correctly handle stalled jobs when using groups ([#37](https://github.com/taskforcesh/bullmq-pro/issues/37)) ([97ed889](https://github.com/taskforcesh/bullmq-pro/commit/97ed8890061aea2e5833808df4400bf1e86caada))

## [1.3.1](https://github.com/taskforcesh/bullmq-pro/compare/v1.3.0...v1.3.1) (2022-03-16)


### Bug Fixes

* upgrade bullmq to 1.76.6 ([#36](https://github.com/taskforcesh/bullmq-pro/issues/36)) ([6c7f008](https://github.com/taskforcesh/bullmq-pro/commit/6c7f00885cc8833e5b23322116687d1fc4f7d03c))

# [1.3.0](https://github.com/taskforcesh/bullmq-pro/compare/v1.2.5...v1.3.0) (2022-03-10)


### Features

* add support for max concurrency per group ([d4afb21](https://github.com/taskforcesh/bullmq-pro/commit/d4afb21f7162eda0b080c844c3f6dd90c87003e1))

## [1.2.5](https://github.com/taskforcesh/bullmq-pro/compare/v1.2.4...v1.2.5) (2022-03-08)


### Bug Fixes

* upgrade bullmq to 1.76.1 ([#34](https://github.com/taskforcesh/bullmq-pro/issues/34)) ([8eb36d2](https://github.com/taskforcesh/bullmq-pro/commit/8eb36d280bcbc2bdd7c640d9de12022dbbe79581))

## [1.2.4](https://github.com/taskforcesh/bullmq-pro/compare/v1.2.3...v1.2.4) (2022-02-17)


### Bug Fixes

* upgrade bullmq to 1.73.0 ([#33](https://github.com/taskforcesh/bullmq-pro/issues/33)) ([6afa980](https://github.com/taskforcesh/bullmq-pro/commit/6afa980f3241f3ed364bd8195375fa800b7369d8))

## [1.2.3](https://github.com/taskforcesh/bullmq-pro/compare/v1.2.2...v1.2.3) (2022-02-03)


### Bug Fixes

* upgrade bullmq to 1.67.1 ([#31](https://github.com/taskforcesh/bullmq-pro/issues/31)) ([905d805](https://github.com/taskforcesh/bullmq-pro/commit/905d80588f240464ed5b08359cc315edd4016c7c))

## [1.2.2](https://github.com/taskforcesh/bullmq-pro/compare/v1.2.1...v1.2.2) (2022-01-29)


### Bug Fixes

* upgrade bullmq to 1.66.1 ([#32](https://github.com/taskforcesh/bullmq-pro/issues/32)) ([a830bc6](https://github.com/taskforcesh/bullmq-pro/commit/a830bc64a3588f9b4340e1a9d7a609e8cbc73836))

## [1.2.1](https://github.com/taskforcesh/bullmq-pro/compare/v1.2.0...v1.2.1) (2022-01-13)


### Bug Fixes

* upgrade bullmq to 1.64.0 ([#28](https://github.com/taskforcesh/bullmq-pro/issues/28)) ([893cbeb](https://github.com/taskforcesh/bullmq-pro/commit/893cbeb279196e1aa4c0978c57fc3183a4a4615c))

# [1.2.0](https://github.com/taskforcesh/bullmq-pro/compare/v1.1.6...v1.2.0) (2021-12-17)


### Features

* groups rate limit ([#22](https://github.com/taskforcesh/bullmq-pro/issues/22)) ([a9268b0](https://github.com/taskforcesh/bullmq-pro/commit/a9268b01093e64f45afbde5e36a60451fcaca880))

## [1.1.6](https://github.com/taskforcesh/bullmq-pro/compare/v1.1.5...v1.1.6) (2021-12-08)


### Bug Fixes

* **bullmq:** use fixed version for 1.55.1 ([#23](https://github.com/taskforcesh/bullmq-pro/issues/23)) ([81368de](https://github.com/taskforcesh/bullmq-pro/commit/81368de9045c192c74d4c171333c3a1dd359565b))

## [1.1.5](https://github.com/taskforcesh/bullmq-pro/compare/v1.1.4...v1.1.5) (2021-12-04)


### Bug Fixes

* **bullmq:** upgrade to 1.55.1 ([#21](https://github.com/taskforcesh/bullmq-pro/issues/21)) ([5bb682a](https://github.com/taskforcesh/bullmq-pro/commit/5bb682abc1ced6d46fecbfbb8f955c62e0956e01))

## [1.1.4](https://github.com/taskforcesh/bullmq-pro/compare/v1.1.3...v1.1.4) (2021-12-02)


### Bug Fixes

* expose missing classes ([#20](https://github.com/taskforcesh/bullmq-pro/issues/20)) ([1a5d80d](https://github.com/taskforcesh/bullmq-pro/commit/1a5d80d95177d3ad4ebc8923df88065d1e38e08b))

## [1.1.3](https://github.com/taskforcesh/bullmq-pro/compare/v1.1.2...v1.1.3) (2021-12-01)


### Bug Fixes

* point correct main files ([#19](https://github.com/taskforcesh/bullmq-pro/issues/19)) ([86075af](https://github.com/taskforcesh/bullmq-pro/commit/86075af5acb85bb620071623a3ce2d4c2c88ec71))

## [1.1.2](https://github.com/taskforcesh/bullmq-pro/compare/v1.1.1...v1.1.2) (2021-11-26)


### Bug Fixes

* **bullmq:** upgrade to 1.54.5 version ([#17](https://github.com/taskforcesh/bullmq-pro/issues/17)) ([f2c29a4](https://github.com/taskforcesh/bullmq-pro/commit/f2c29a424bb3350f097eb446cb8d81f40cc0adb6))

## [1.1.1](https://github.com/taskforcesh/bullmq-pro/compare/v1.1.0...v1.1.1) (2021-11-25)


### Bug Fixes

* use es6 interpolation ([f7a533a](https://github.com/taskforcesh/bullmq-pro/commit/f7a533a4b06ccfee1fa386e439af266fd502701e))

# [1.1.0](https://github.com/taskforcesh/bullmq-pro/compare/v1.0.4...v1.1.0) (2021-11-24)


### Features

* **rxjs:** support observables ([#11](https://github.com/taskforcesh/bullmq-pro/issues/11)) ([df4cf07](https://github.com/taskforcesh/bullmq-pro/commit/df4cf07311a41992547b4a5d326408952653f6fd))

## [1.0.4](https://github.com/taskforcesh/bullmq-pro/compare/v1.0.3...v1.0.4) (2021-11-22)


### Bug Fixes

* **add:** send missing events in lua script ([#13](https://github.com/taskforcesh/bullmq-pro/issues/13)) ([a6658dd](https://github.com/taskforcesh/bullmq-pro/commit/a6658dda455e864be5cf34784bd8332575c5d3d2))

## [1.0.3](https://github.com/taskforcesh/bullmq-pro/compare/v1.0.2...v1.0.3) (2021-11-18)


### Bug Fixes

* **bullmq:** upgrade to 1.54.0 version ([#10](https://github.com/taskforcesh/bullmq-pro/issues/10)) ([1fc73ad](https://github.com/taskforcesh/bullmq-pro/commit/1fc73ad86f4130f3e3849890162a37bb4ceed7a6))

## [1.0.2](https://github.com/taskforcesh/bullmq-pro/compare/v1.0.1...v1.0.2) (2021-10-18)


### Bug Fixes

* **npm:** replace npm registry ([01518eb](https://github.com/taskforcesh/bullmq-pro/commit/01518eba488d250d1afa675c7fba237a6d442fe3))

## [1.0.1](https://github.com/taskforcesh/bullmq-pro/compare/v1.0.0...v1.0.1) (2021-10-18)


### Bug Fixes

* **bullmq:** upgrade bullmq ([6b93b5f](https://github.com/taskforcesh/bullmq-pro/commit/6b93b5f4c8712fc55ea76ed89a0eba38b7b4df35))

# 1.0.0 (2021-10-18)


### Bug Fixes

* remove nodejs 10 support ([49eaf78](https://github.com/taskforcesh/bullmq-pro/commit/49eaf7893e287983febe05c034733ec958114882))


### Features

* **groups:** initial implementation ([b1da106](https://github.com/taskforcesh/bullmq-pro/commit/b1da106d7870e8e2783a6028b5088e6c4fa82086))
* add queue-pro, worker-pro and redis-connection-pro ([b9de319](https://github.com/taskforcesh/bullmq-pro/commit/b9de3193b7820dc0dcf5ae1a2f673f7ed5a82aed))
* initial commit ([7924260](https://github.com/taskforcesh/bullmq-pro/commit/7924260d621dd98b8acc6aefb53c21f6d3e06186))
