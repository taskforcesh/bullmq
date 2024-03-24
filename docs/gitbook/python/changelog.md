# Changelog

<!--next-version-placeholder-->

## v2.3.3 (2024-03-24)
### Fix
* **connection:** Accept all parameters for redis connection [python] ([#2486](https://github.com/taskforcesh/bullmq/issues/2486)) ([`ce30192`](https://github.com/taskforcesh/bullmq/commit/ce30192ad30f66fb0f39c8c9ed669ddd133346c8))

## v2.3.2 (2024-03-23)
### Fix
* **scripts:** Use command name in error message when moving to finished ([#2483](https://github.com/taskforcesh/bullmq/issues/2483)) ([`3c335d4`](https://github.com/taskforcesh/bullmq/commit/3c335d49ba637145648c1ef0864d8e0d297dd890))
* **queue:** Use QueueOptions type in opts attribute ([#2481](https://github.com/taskforcesh/bullmq/issues/2481)) ([`51a589f`](https://github.com/taskforcesh/bullmq/commit/51a589f7e07b5336eb35ed00a1b795501b24f254))

### Documentation
* Update README.md ([`43f26c4`](https://github.com/taskforcesh/bullmq/commit/43f26c41332da10f054d43560dd580e9ec3c3904))
* **block-timeout:** Document decision ([#2479](https://github.com/taskforcesh/bullmq/issues/2479)) ([`bcafabc`](https://github.com/taskforcesh/bullmq/commit/bcafabc418bf559df2041350dd23d1d7b26c4fdf))

## v2.3.1 (2024-03-19)
### Fix
* **worker:** Set blockTimeout as 0.001 when reach the time to get delayed jobs [python] ([#2478](https://github.com/taskforcesh/bullmq/issues/2478)) ([`b385034`](https://github.com/taskforcesh/bullmq/commit/b385034006ac183a26093f593269349eb78f8b54))
* **worker:** Validate drainDelay must be greater than 0 ([#2477](https://github.com/taskforcesh/bullmq/issues/2477)) ([`ab43693`](https://github.com/taskforcesh/bullmq/commit/ab436938d895125635aef0393ae2fb5c77c16c1f))

## v2.3.0 (2024-03-16)
### Feature
* **job:** Add log method [python] (#2476) ref #2472 ([`34946c4`](https://github.com/taskforcesh/bullmq/commit/34946c4b29cc9e7d5ae81f8fd170a2e539ac6279))

## v2.2.4 (2024-02-13)
### Fix
* **flow:** Parent job cannot be replaced (python) ([#2417](https://github.com/taskforcesh/bullmq/issues/2417)) ([`2696ef8`](https://github.com/taskforcesh/bullmq/commit/2696ef8200058b7f616938c2166a3b0454663b39))

## v2.2.3 (2024-02-10)
### Performance
* **marker:** Differentiate standard and delayed markers (python) ([#2389](https://github.com/taskforcesh/bullmq/issues/2389)) ([`18ebee8`](https://github.com/taskforcesh/bullmq/commit/18ebee8c242f66f1b5b733d68e48c574b1f1fdef))
* **change-delay:** Add delay marker when needed ([#2411](https://github.com/taskforcesh/bullmq/issues/2411)) ([`8b62d28`](https://github.com/taskforcesh/bullmq/commit/8b62d28a06347e9dd04757807fce1b511ace79bc))

## v2.2.2 (2024-02-03)
### Fix
* **reprocess-job:** Add marker if needed ([#2406](https://github.com/taskforcesh/bullmq/issues/2406)) ([`5923ed8`](https://github.com/taskforcesh/bullmq/commit/5923ed885f5451eee2f14258767d7d5f8d80ae13))
* **rate-limit:** Move job to wait even if ttl is 0 ([#2403](https://github.com/taskforcesh/bullmq/issues/2403)) ([`c1c2ccc`](https://github.com/taskforcesh/bullmq/commit/c1c2cccc7c8c05591f0303e011d46f6efa0942a0))
* **stalled:** Consider adding marker when moving job back to wait ([#2384](https://github.com/taskforcesh/bullmq/issues/2384)) ([`4914df8`](https://github.com/taskforcesh/bullmq/commit/4914df87e416711835291e81da93b279bd758254))

### Performance
* **flow:** Add marker when moving parent to wait (python) ([#2408](https://github.com/taskforcesh/bullmq/issues/2408)) ([`6fb6896`](https://github.com/taskforcesh/bullmq/commit/6fb6896701ae7595e1cb5e2cdbef44625c48d673))
* **move-to-active:** Check rate limited once ([#2391](https://github.com/taskforcesh/bullmq/issues/2391)) ([`ca6c17a`](https://github.com/taskforcesh/bullmq/commit/ca6c17a43e38d5339e62471ea9f59c62a169b797))

## v2.2.1 (2024-01-16)
### Fix
* **retry-jobs:** Add marker when needed ([#2374](https://github.com/taskforcesh/bullmq/issues/2374)) ([`1813d5f`](https://github.com/taskforcesh/bullmq/commit/1813d5fa12b7db69ee6c8c09273729cda8e3e3b5))

## v2.2.0 (2024-01-14)
### Feature
* **queue:** Add promoteJobs method [python] ([#2377](https://github.com/taskforcesh/bullmq/issues/2377)) ([`3b9de96`](https://github.com/taskforcesh/bullmq/commit/3b9de967efa34ea22cdab1fbc7ff65d49927d787))

## v2.1.0 (2024-01-12)
### Feature
* **repeatable:** Allow saving custom key ([#1824](https://github.com/taskforcesh/bullmq/issues/1824)) ([`8ea0e1f`](https://github.com/taskforcesh/bullmq/commit/8ea0e1f76baf36dab94a66657c0f432492cb9999))

### Fix
* **redis:** Upgrade to v5 [python] ([#2364](https://github.com/taskforcesh/bullmq/issues/2364)) ([`d5113c8`](https://github.com/taskforcesh/bullmq/commit/d5113c88ad108b281b292e2890e0eef3be41c8fb))
* **worker:** Worker can be closed if Redis is down ([#2350](https://github.com/taskforcesh/bullmq/issues/2350)) ([`888dcc2`](https://github.com/taskforcesh/bullmq/commit/888dcc2dd40571e05fe1f4a5c81161ed062f4542))

## v2.0.0 (2023-12-23)
### Feature
* **job:** Add isActive method [python] ([#2352](https://github.com/taskforcesh/bullmq/issues/2352)) ([`afb5e31`](https://github.com/taskforcesh/bullmq/commit/afb5e31484ed2e5a1c381c732321225c0a8b78ff))
* **job:** separate attemptsMade from attemptsStarted when manually moving a job ([#2203](https://github.com/taskforcesh/bullmq/issues/2203)) ([`0e88e4f`](https://github.com/taskforcesh/bullmq/commit/0e88e4fe4ed940487dfc79d1345d0686de22d0c6))
* **scripts:** Use new queue markers ([`4276eb7`](https://github.com/taskforcesh/bullmq/commit/4276eb725ca294ddbfc00c4edc627bb2cb5d403a))
* **worker:** Improved markers handling ([`73cf5fc`](https://github.com/taskforcesh/bullmq/commit/73cf5fc1e6e13d8329e1e4e700a8db92173e0624)) ([`0bac0fb`](https://github.com/taskforcesh/bullmq/commit/0bac0fbb97afa968aa7644f1438b86d7bc18bbc5))

### Fix
* **connection:** Unify redis connection args for Queue and Worker ([#2282](https://github.com/taskforcesh/bullmq/issues/2282)) ([`8eee20f`](https://github.com/taskforcesh/bullmq/commit/8eee20f1210a49024eeee6647817f0659b8c3893))

### Breaking
* Markers use now a dedicated key in redis instead of using a special Job ID. ([`73cf5fc`](https://github.com/taskforcesh/bullmq/commit/73cf5fc1e6e13d8329e1e4e700a8db92173e0624)) ([`0bac0fb`](https://github.com/taskforcesh/bullmq/commit/0bac0fbb97afa968aa7644f1438b86d7bc18bbc5))
* Connection must be provided as part of options ([#2282](https://github.com/taskforcesh/bullmq/issues/2282)) ([`8eee20f`](https://github.com/taskforcesh/bullmq/commit/8eee20f1210a49024eeee6647817f0659b8c3893))

## v1.24.0 (2023-12-21)
### Feature
* **job:** Add isWaitingChildren method [python] ([#2345](https://github.com/taskforcesh/bullmq/issues/2345)) ([`e9c1fa1`](https://github.com/taskforcesh/bullmq/commit/e9c1fa10b258ebe171a0396c29b6ccb05aef2608))

## v1.23.0 (2023-12-18)
### Feature
* **queue:** Add getRateLimitTtl method [python] ([#2340](https://github.com/taskforcesh/bullmq/issues/2340)) ([`f0a1f70`](https://github.com/taskforcesh/bullmq/commit/f0a1f7084478f7899233021fbb4d4307c94dfead))

## v1.22.0 (2023-12-14)
### Feature
* **job:** Add isFailed method [python] ([#2333](https://github.com/taskforcesh/bullmq/issues/2333)) ([`19bfccc`](https://github.com/taskforcesh/bullmq/commit/19bfccc2d7734b150a5fbb6ea720fcd9887c9dd3))

## v1.21.0 (2023-12-14)
### Feature
* **job:** Add isCompleted method [python] ([#2331](https://github.com/taskforcesh/bullmq/issues/2331)) ([`364f0c1`](https://github.com/taskforcesh/bullmq/commit/364f0c1f2d4247d2b24041ab9ece0e429110d454))

## v1.20.0 (2023-12-13)
### Feature
* **job:** Add isWaiting method [python] ([#2328](https://github.com/taskforcesh/bullmq/issues/2328)) ([`5db9f95`](https://github.com/taskforcesh/bullmq/commit/5db9f957939cd873eea0224d34569189e5520e84))

## v1.19.0 (2023-12-12)
### Feature
* **job:** Add promote method [python] ([#2323](https://github.com/taskforcesh/bullmq/issues/2323)) ([`61f4ba3`](https://github.com/taskforcesh/bullmq/commit/61f4ba3e99486aa36e5cc3d9b448b8080c567eb1))

## v1.18.0 (2023-12-10)
### Fix
* **retry:** Pass right redis command name into retryJob script (#2321) [python] ([`6bb21a0`](https://github.com/taskforcesh/bullmq/commit/6bb21a07c9754659fa5aa1734df1046a6da5d16a))
* **flows:** Add meta key to queues created with flows ([`272ec69`](https://github.com/taskforcesh/bullmq/commit/272ec69557f601a138e1aaba739f7e7878d5344b))
* **update-progress:** Remove old updateProgress script to prevent conflict (#2298) (python) ([`e65b819`](https://github.com/taskforcesh/bullmq/commit/e65b819101f8e0e8fdef8c51cfdf9a52f5e73f13))
* **worker:** Should cap update progress events ([`2cab9e9`](https://github.com/taskforcesh/bullmq/commit/2cab9e94f65c7bdd053e3fb5944bcda6e3ebaa39))

## v1.17.0 (2023-11-24)
### Feature
* **worker:** Better handling of concurrency when fetching jobs ([#2242](https://github.com/taskforcesh/bullmq/issues/2242)) ([`d2e2035`](https://github.com/taskforcesh/bullmq/commit/d2e203588878ee64cb21e67141f73b32867dfb40))

### Fix
* **worker:** Do not wait for slow jobs fixes #2290 ([`568d758`](https://github.com/taskforcesh/bullmq/commit/568d7585edb1f2ef15991d4ae4a2425e6834046a))

## v1.16.1 (2023-11-09)
### Fix
* **job:** Set delay value on current job instance when it is retried (#2266) (python) ([`76e075f`](https://github.com/taskforcesh/bullmq/commit/76e075f54d5745b6cec3cb11305bf3110d963eae))

## v1.16.0 (2023-11-08)
### Fix
* **backoff:** Fix builtin backoff type (#2265) [python] ([`76959eb`](https://github.com/taskforcesh/bullmq/commit/76959eb9d9495eb1b6d2d31fab93c8951b5d3b93))

## v1.15.4 (2023-11-05)
### Fix
* Update delay job property when moving to delayed set ([#2261](https://github.com/taskforcesh/bullmq/issues/2261)) ([`69ece08`](https://github.com/taskforcesh/bullmq/commit/69ece08babd7716c14c38c3dd50630b44c7c1897))

## v1.15.3 (2023-11-05)
### Fix
* **add-job:** Trim events when waiting-children event is published (#2262) (python) ([`198bf05`](https://github.com/taskforcesh/bullmq/commit/198bf05fa5a4e1ce50081296033a2e0f26ece498))

## v1.15.2 (2023-10-18)
### Fix
* **events:** Do not publish removed event on non-existent jobs ([#2227](https://github.com/taskforcesh/bullmq/issues/2227)) ([`c134606`](https://github.com/taskforcesh/bullmq/commit/c1346064c6cd9f93c59b184f150eac11d51c91b4))
* **events:** Trim events when retrying a job ([#2224](https://github.com/taskforcesh/bullmq/issues/2224)) ([`1986b05`](https://github.com/taskforcesh/bullmq/commit/1986b05ac03fe4ee48861aa60caadcc9df8170a6))

### Performance
* **events:** Trim events when removing jobs (#2235) (python) ([`889815c`](https://github.com/taskforcesh/bullmq/commit/889815c412666e5fad8f32d2e3a2d41cf650f001))

## v1.15.1 (2023-10-04)
### Fix
* **delayed:** Trim events when moving jobs to delayed (python) ([#2211](https://github.com/taskforcesh/bullmq/issues/2211)) ([`eca8c2d`](https://github.com/taskforcesh/bullmq/commit/eca8c2d4dfeafbd8ac36a49764dbd4897303628c))

## v1.15.0 (2023-09-30)
### Feature
* Nothing change

## v1.14.0 (2023-09-26)
### Feature
* **queue:** Add clean method [python] ([#2194](https://github.com/taskforcesh/bullmq/issues/2194)) ([`3b67193`](https://github.com/taskforcesh/bullmq/commit/3b6719379cbec5beb1b7dfb5f06d46cbbf74010f))

### Fix
* **move-to-finished:** Stringify any return value [python] (#2198) fixes #2196 ([`07f1335`](https://github.com/taskforcesh/bullmq/commit/07f13356eb1c0136f03dfdf946d163f0ef3c4d62))
* **queue:** Batched unpack now uses range ([#2188](https://github.com/taskforcesh/bullmq/issues/2188)) ([`b5e97f4`](https://github.com/taskforcesh/bullmq/commit/b5e97f420bc0c4bc82772f3e87883ee522be43d9))
* **queue:** Differentiate score purpose per state in clean method (#2133) fixes #2124 ([`862f10b`](https://github.com/taskforcesh/bullmq/commit/862f10b586276314d9bffff2a5e6caf939399f7e))

## v1.13.2 (2023-09-12)
### Fix
* **remove:** Change error message when job is locked (python) ([#2175](https://github.com/taskforcesh/bullmq/issues/2175)) ([`2f5628f`](https://github.com/taskforcesh/bullmq/commit/2f5628feffab66cdcc78abf4d7bb608bdcaa65bb))

## v1.13.1 (2023-09-11)
### Fix
* **move-to-finished:** Consider addition of prioritized jobs when processing last active job (#2176) (python) ([`4b01f35`](https://github.com/taskforcesh/bullmq/commit/4b01f359c290cfc62ea74ff3ab0b43ccc6956a02))

## v1.13.0 (2023-09-07)
### Feature
* **flow-producer:** Add addBulk method (python) ([#2174](https://github.com/taskforcesh/bullmq/issues/2174)) ([`c67dfb4`](https://github.com/taskforcesh/bullmq/commit/c67dfb49931ee4cb96573af660e9f2316942687c))

## v1.12.0 (2023-08-31)
### Feature
* **queue:** Add addBulk method ([#2161](https://github.com/taskforcesh/bullmq/issues/2161)) ([`555dd44`](https://github.com/taskforcesh/bullmq/commit/555dd44a0190f4957e43f083e2f59d7f58b90ac9))

## v1.11.0 (2023-08-26)
### Feature
* Add flow producer class ([#2115](https://github.com/taskforcesh/bullmq/issues/2115)) ([`14a769b`](https://github.com/taskforcesh/bullmq/commit/14a769b193d97576ff9b3f2a65de47463ba04ffd))

## v1.10.1 (2023-08-19)
### Fix
* **job:** Job getReturnValue not returning returnvalue ([#2143](https://github.com/taskforcesh/bullmq/issues/2143)) ([`dcb8e6a`](https://github.com/taskforcesh/bullmq/commit/dcb8e6a8e62346fac8574bd9aac56c5a25589a2c))

### Performance
* **rate-limit:** Get pttl only if needed ([#2129](https://github.com/taskforcesh/bullmq/issues/2129)) ([`12ce2f3`](https://github.com/taskforcesh/bullmq/commit/12ce2f3746626a81ea961961bb1a629077eed68a))

## v1.10.0 (2023-08-03)
### Feature
* **redis-connection:** Add username option into redisOpts ([#2108](https://github.com/taskforcesh/bullmq/issues/2108)) ([`d27f33e`](https://github.com/taskforcesh/bullmq/commit/d27f33e997d30e6c0c7d4484bea338347c3fe67e))

### Performance
* **retry:** Compare prev state instead of regex expression ([#2099](https://github.com/taskforcesh/bullmq/issues/2099)) ([`c141283`](https://github.com/taskforcesh/bullmq/commit/c1412831903d1fae0955af097e0be049024839fe))

## v1.9.0 (2023-07-18)
### Feature
* **job:** Add option for removing children in remove method (python) ([#2064](https://github.com/taskforcesh/bullmq/issues/2064)) ([`841dc87`](https://github.com/taskforcesh/bullmq/commit/841dc87a689897df81438ad1f43e45a4da77c388))

## v1.8.0 (2023-07-17)
### Fix
* **worker:** Respect concurrency (#2062) fixes #2063 ([`1b95185`](https://github.com/taskforcesh/bullmq/commit/1b95185e8f4a4349037b59e61455bdec79792644))

## v1.7.0 (2023-07-14)
### Feature
* **queue:** Add remove method ([#2066](https://github.com/taskforcesh/bullmq/issues/2066)) ([`808ee72`](https://github.com/taskforcesh/bullmq/commit/808ee7231c75d4d826881f25e346f01b2fd2dc23))
* **worker:** Add id as part of token ([#2061](https://github.com/taskforcesh/bullmq/issues/2061)) ([`e255356`](https://github.com/taskforcesh/bullmq/commit/e2553562271e1e4143a8fef616349bb30de4899d))

## v1.6.1 (2023-07-10)
### Fix
* **pyproject:** Add requires-python config (#2056) fixes #1979 ([`a557970`](https://github.com/taskforcesh/bullmq/commit/a557970c755d370ed23850e2f32af35774002bc9))

## v1.6.0 (2023-07-06)
### Feature
* **job:** Add moveToWaitingChildren method ([#2049](https://github.com/taskforcesh/bullmq/issues/2049)) ([`6d0e224`](https://github.com/taskforcesh/bullmq/commit/6d0e224cd985069055786f447b0ba7c394a76b8a))

## v1.5.0 (2023-07-04)
### Fix
* **queue:** Fix isPaused method when custom prefix is present ([#2047](https://github.com/taskforcesh/bullmq/issues/2047)) ([`7ec1c5b`](https://github.com/taskforcesh/bullmq/commit/7ec1c5b2ccbd575ecd50d339f5377e204ca7aa16))

## v1.4.0 (2023-06-30)
### Feature
* **queue:** Add getJobState method ([#2040](https://github.com/taskforcesh/bullmq/issues/2040)) ([`8ec9ed6`](https://github.com/taskforcesh/bullmq/commit/8ec9ed67d2803224a3b866c51f67239a5c4b7042))

## v1.3.1 (2023-06-29)
### Fix
* **pyproject:** Build egg-info at the root location ([`3c2d06e`](https://github.com/taskforcesh/bullmq/commit/3c2d06e7e6e0944135fe6bd8045d08dd43fe7d9c))

## v1.3.0 (2023-06-29)
### Feature
* **queue:** Add getFailedCount method ([#2036](https://github.com/taskforcesh/bullmq/issues/2036)) ([`92d7227`](https://github.com/taskforcesh/bullmq/commit/92d7227bf5ec63a75b7af3fc7c312d9b4a81d69f))
* **queue:** Add getCompletedCount method ([#2033](https://github.com/taskforcesh/bullmq/issues/2033)) ([`3e9db5e`](https://github.com/taskforcesh/bullmq/commit/3e9db5ef4d868f8b420e368a711c20c2568a5910))

### Fix
* **release:** Add recommended pyproject.toml configuration ([#2029](https://github.com/taskforcesh/bullmq/issues/2029)) ([`d03ffc9`](https://github.com/taskforcesh/bullmq/commit/d03ffc9c98425a96d6e9dd47a6625382556a4cbf))

## v1.2.0 (2023-06-24)
### Feature
* **queue:** Add get job methods by state ([#2012](https://github.com/taskforcesh/bullmq/issues/2012)) ([`57b2b72`](https://github.com/taskforcesh/bullmq/commit/57b2b72f79afb683067d49170df5d2eed46e3712))

## v1.1.0 (2023-06-23)
### Feature
* **queue:** Add getJobs method ([#2011](https://github.com/taskforcesh/bullmq/issues/2011)) ([`8d5d6c1`](https://github.com/taskforcesh/bullmq/commit/8d5d6c14442b7b967c42cb6ec3907a4d1a5bd575))

## v1.0.0 (2023-06-21)
### Breaking
* priority is separeted in its own zset, no duplication needed ([`42a890a`](https://github.com/taskforcesh/bullmq/commit/42a890a2bfe45b29348030f886766400f5d41aa3))

### Performance
* **priority:** Add prioritized as a new state (#1984) (python) ([`42a890a`](https://github.com/taskforcesh/bullmq/commit/42a890a2bfe45b29348030f886766400f5d41aa3))

## v0.5.6 (2023-06-21)
### Fix
* **queue:** Pass right params to trimEvents method ([#2004](https://github.com/taskforcesh/bullmq/issues/2004)) ([`a55fd77`](https://github.com/taskforcesh/bullmq/commit/a55fd777655f7d4bb7af9e4fa2f7b4f48f559189))

### Documentation
* **update:** Add job data section ([#1999](https://github.com/taskforcesh/bullmq/issues/1999)) ([`854b1ca`](https://github.com/taskforcesh/bullmq/commit/854b1cabd082c1df4d55e7973f0e0b0cd4aefb79))

## v0.5.5 (2023-06-16)
### Fix
* **rate-limit:** Keep priority fifo order (#1991) fixes #1929 (python) ([`56bd7ad`](https://github.com/taskforcesh/bullmq/commit/56bd7ad8c4daffcfb1f9f199abfc5d6495eb291e))
* **worker:** Set redis version always in initialization (#1989) fixes #1988 ([`a1544a8`](https://github.com/taskforcesh/bullmq/commit/a1544a8c0f29522cd33772b14f559969db852d1d))

## v0.5.4 (2023-06-14)
### Fix
* **connection:** Add retry strategy in connection ([#1975](https://github.com/taskforcesh/bullmq/issues/1975)) ([`7c5ee20`](https://github.com/taskforcesh/bullmq/commit/7c5ee20471b989d297c8c5e87a6ea497a2077ae6))

## v0.5.3 (2023-06-13)
### Fix
* **worker:** Use timeout as integer for redis lower than v6.0.0 (python) ([#1981](https://github.com/taskforcesh/bullmq/issues/1981)) ([`0df6afa`](https://github.com/taskforcesh/bullmq/commit/0df6afad5e71a693b721ba52ffa6be733ee45ccb))

### Documentation
* **changelog:** Add missing version sections ([#1974](https://github.com/taskforcesh/bullmq/issues/1974)) ([`77b4de7`](https://github.com/taskforcesh/bullmq/commit/77b4de7c3b41ae63e311a2c373e0d2fc787f2f53))

## v0.5.2 (2023-06-11)
### Fix
* **retry-job:** Consider priority when moving job to wait (python) ([#1969](https://github.com/taskforcesh/bullmq/issues/1969)) ([`e753855`](https://github.com/taskforcesh/bullmq/commit/e753855eef248da73a5e9f6b18f4b79319dc2f86))

## v0.5.1 (2023-06-09)
### Fix
* **python:** Include lua scripts when releasing ([`bb4f3b2`](https://github.com/taskforcesh/bullmq/commit/bb4f3b2be8e3d5a54a87f0f5d6ba8dfa09900e53))

## v0.5.0 (2023-06-09)
### Feature
* **python:** Add remove job method ([#1965](https://github.com/taskforcesh/bullmq/issues/1965)) ([`6a172e9`](https://github.com/taskforcesh/bullmq/commit/6a172e97e65684f65ee570c2ae9bcc108720d5df))

## v0.4.4 (2023-06-08)
### Fix
* **deps:** Downgrade python-semantic-release to avoid version issue

## v0.4.3 (2023-06-07)
### Feature
* Add changePriority method ([#1943](https://github.com/taskforcesh/bullmq/issues/1943)) ([`945bcd3`](https://github.com/taskforcesh/bullmq/commit/945bcd39db0f76ef6e9a513304714c120317c7f3))

### Fix
* **rate-limit:** Consider paused queue ([#1931](https://github.com/taskforcesh/bullmq/issues/1931)) ([`d97864a`](https://github.com/taskforcesh/bullmq/commit/d97864a550992aeb8673557c7d8f186ab4ccb5bf))

## v0.4.2 (2023-06-01)
### Fix
* **deps:** Fix 'install_requires' to include semver ([#1927](https://github.com/taskforcesh/bullmq/issues/1927)) ([`ce86ece`](https://github.com/taskforcesh/bullmq/commit/ce86eceed40283b5d3276968b65ceae31ce425bb))

## v0.4.1 (2023-05-29)
### Feature
* **job:** Add getState method ([#1906](https://github.com/taskforcesh/bullmq/issues/1906)) ([`f0867a6`](https://github.com/taskforcesh/bullmq/commit/f0867a679c75555fa764078481252110c1e7377f))

## [v0.4.0](https://github.com/taskforcesh/bullmq/compare/46d6f94...01b621f) (2023-05-18)
### Feature
* **connection:** accept redis options as string ([`01f549e`](https://github.com/taskforcesh/bullmq/commit/01f549e62a33619a7816758910a2d2b5ac75b589))
* **job:** add moveToDelayed job method ([#1849](https://github.com/taskforcesh/bullmq/issues/1849)) ([`5bebf8d`](https://github.com/taskforcesh/bullmq/commit/5bebf8d6560de78448b0413baaabd26f7227575c))
* **job:** Add retry method into job ([#1877](https://github.com/taskforcesh/bullmq/issues/1877)) ([`870da45`](https://github.com/taskforcesh/bullmq/commit/870da459f419076f03885a12a4ce5a2930c500f3))
* **job:** Add updateData method ([#1871](https://github.com/taskforcesh/bullmq/issues/1871)) ([`800b8c4`](https://github.com/taskforcesh/bullmq/commit/800b8c46e709a8cbc4674d84bd59d5c62251d271))
* **job:** Add updateProgress method in job class([#1830](https://github.com/taskforcesh/bullmq/issues/1830)) ([`e1e1aa2`](https://github.com/taskforcesh/bullmq/commit/e1e1aa2e7a41e5418a5a50af4cea347a38bbc7d1))
* **job:** Save stacktrace when job fails ([#1859](https://github.com/taskforcesh/bullmq/issues/1859)) ([`0b538ce`](https://github.com/taskforcesh/bullmq/commit/0b538cedf63c3f006838ee3d016e463ee3492f81))
* Support retryJob logic ([#1869](https://github.com/taskforcesh/bullmq/issues/1869)) ([`b044a03`](https://github.com/taskforcesh/bullmq/commit/b044a03159bc3a8d8823c71019f64825f318a6c2))

### Fix
* **retry:** Consider when queue is paused ([#1880](https://github.com/taskforcesh/bullmq/issues/1880)) ([`01b621f`](https://github.com/taskforcesh/bullmq/commit/01b621fea0cbdae602482ff61361c05646823223))
* **worker:** Stop processes when force stop ([#1837](https://github.com/taskforcesh/bullmq/issues/1837)) ([`514699c`](https://github.com/taskforcesh/bullmq/commit/514699cd8be96db2320bf0f85d4b6593809a09f1))

## [v0.3.0](https://github.com/taskforcesh/bullmq/compare/ca48163...46d6f94) (2023-04-18)
### Feature
* **queue:** Add getJobCounts method ([#1807](https://github.com/taskforcesh/bullmq/issues/1807)) ([`46d6f94`](https://github.com/taskforcesh/bullmq/commit/46d6f94575454fe2a32be0c5247f16d18739fe27))
* Improve worker concurrency ([#1809](https://github.com/taskforcesh/bullmq/issues/1809)) ([`ec7c49e`](https://github.com/taskforcesh/bullmq/commit/ec7c49e284fd1ecdd52b96197281247f5222ea34))

### Fix
* Correct condition so that the worker keeps processing jobs indefinitely ([#1800](https://github.com/taskforcesh/bullmq/issues/1800)) ([`ef0c5d6`](https://github.com/taskforcesh/bullmq/commit/ef0c5d6cae1dcbae607fa02da32d5236069f2339))
* Fix scripts typing on array2obj function ([#1786](https://github.com/taskforcesh/bullmq/issues/1786)) ([`134f6ab`](https://github.com/taskforcesh/bullmq/commit/134f6ab5f3219ddd7a421e61ace6bac72bb51e6d))
* Pass maxMetricsSize as empty string when it is not provided fixes ([#1754](https://github.com/taskforcesh/bullmq/issues/1754)) ([`6bda2b2`](https://github.com/taskforcesh/bullmq/commit/6bda2b24be38a78e5fcfc71ed2913f0150a41dfc))

## [v0.2.0](https://github.com/taskforcesh/bullmq/compare/a97b22f...ca48163) (2023-03-29)
### Feature
* Add trimEvents method ([#1695](https://github.com/taskforcesh/bullmq/issues/1695)) ([`ca48163`](https://github.com/taskforcesh/bullmq/commit/ca48163263b12a85533563485176c684e548df0b))
* **queue:** Add retryJobs method ([#1688](https://github.com/taskforcesh/bullmq/issues/1688)) ([`2745327`](https://github.com/taskforcesh/bullmq/commit/2745327c7a7080f72e8c265bae77429e597cb6d3))

## v0.1.0 (2023-02-15)
### Feature
* Initial python package ([`a97b22f`](https://github.com/taskforcesh/bullmq/commit/a97b22f518a9f6c5d9c30a77bfd03cafdcbc57ff))
