# Changelog

<!--next-version-placeholder-->

## v1.19.0 (2023-12-12)
### Feature
* **job:** Add promote method [python] ([#2323](https://github.com/taskforcesh/bullmq/issues/2323)) ([`61f4ba3`](https://github.com/taskforcesh/bullmq/commit/61f4ba3e99486aa36e5cc3d9b448b8080c567eb1))

## v1.18.0 (2023-12-10)
### Feature
* **sandboxes:** Use the more compatible dynamic import instead of require ([`6d2fe6e`](https://github.com/taskforcesh/bullmq/commit/6d2fe6e7c0473b75aeb9a6d3080b0676f9521065))

### Fix
* **retry:** Pass right redis command name into retryJob script (#2321) [python] ([`6bb21a0`](https://github.com/taskforcesh/bullmq/commit/6bb21a07c9754659fa5aa1734df1046a6da5d16a))
* **child-processor:** Preserve dynamic imports in commonjs ([`d97a5e0`](https://github.com/taskforcesh/bullmq/commit/d97a5e06816cff04d86facdb8d32b512f29c6fb9))
* **flows:** Add meta key to queues created with flows ([`272ec69`](https://github.com/taskforcesh/bullmq/commit/272ec69557f601a138e1aaba739f7e7878d5344b))
* **repeat-strategy:** Add missing Promise return type ([#2301](https://github.com/taskforcesh/bullmq/issues/2301)) ([`6f8f534`](https://github.com/taskforcesh/bullmq/commit/6f8f5342cc8aa03f596d9ed5b8831f96a1d4c736))
* **worker:** Get dirname by using module.filename (#2296) fixes #2288 ([`6e4db5a`](https://github.com/taskforcesh/bullmq/commit/6e4db5a3f3648c6a7e10991f2e18f3dab96fb1d7))
* **update-progress:** Remove old updateProgress script to prevent conflict (#2298) (python) ([`e65b819`](https://github.com/taskforcesh/bullmq/commit/e65b819101f8e0e8fdef8c51cfdf9a52f5e73f13))
* **worker:** Should cap update progress events ([`2cab9e9`](https://github.com/taskforcesh/bullmq/commit/2cab9e94f65c7bdd053e3fb5944bcda6e3ebaa39))

### Documentation
* **guide:** Use v4 api references ([#2314](https://github.com/taskforcesh/bullmq/issues/2314)) ([`fcf98f4`](https://github.com/taskforcesh/bullmq/commit/fcf98f4218c35de5888934fee80ca7832dac2267))
* **bullmq-pro:** Update changelog to v6.8.0 ([#2307](https://github.com/taskforcesh/bullmq/issues/2307)) ([`9896b8a`](https://github.com/taskforcesh/bullmq/commit/9896b8a70d7136932955cb67edd31a4ed03c15f1))

## v1.17.0 (2023-11-24)
### Feature
* **worker:** Better handling of concurrency when fetching jobs ([#2242](https://github.com/taskforcesh/bullmq/issues/2242)) ([`d2e2035`](https://github.com/taskforcesh/bullmq/commit/d2e203588878ee64cb21e67141f73b32867dfb40))

### Fix
* **worker:** Do not wait for slow jobs fixes #2290 ([`568d758`](https://github.com/taskforcesh/bullmq/commit/568d7585edb1f2ef15991d4ae4a2425e6834046a))
* **utils:** Use EventEmitter as a type instead of a namespace ([#2283](https://github.com/taskforcesh/bullmq/issues/2283)) ([`41c9d1d`](https://github.com/taskforcesh/bullmq/commit/41c9d1d05eedc7351272708e667e8d65eb6773fc))

### Documentation
* **bullmq-pro:** Update changelog to v6.7.0 ([#2292](https://github.com/taskforcesh/bullmq/issues/2292)) ([`f3f8491`](https://github.com/taskforcesh/bullmq/commit/f3f84918f4ff91c5d6958ce07180685ae3b02c1e))
* Improve documentation grammar, format, etc. ([#2158](https://github.com/taskforcesh/bullmq/issues/2158)) ([`25090ab`](https://github.com/taskforcesh/bullmq/commit/25090abe188d8dfe407283d52bace1483d80b010))
* **bullmq-pro:** Update changelog with v6.6.2 ([#2284](https://github.com/taskforcesh/bullmq/issues/2284)) ([`edc31a6`](https://github.com/taskforcesh/bullmq/commit/edc31a6146f7e45ef09c75a2006cb49134586b40))
* **python:** Update changelog ([#2280](https://github.com/taskforcesh/bullmq/issues/2280)) ([`517d011`](https://github.com/taskforcesh/bullmq/commit/517d011cdde47be6cc8e64cccd107f52dc1a6e4f))
* Update NoCodeDB logo ([`526f6e8`](https://github.com/taskforcesh/bullmq/commit/526f6e84d5b18ef266391bc85bd7bc3fe63be786))
* Update README.md ([`da3720a`](https://github.com/taskforcesh/bullmq/commit/da3720a5f44a01f5c08cf649acd861113d33f16b))
* **readme:** Add dragonfly sponsorship ([`4e76620`](https://github.com/taskforcesh/bullmq/commit/4e76620dd724153458f2dc45893be9f3ced95553))
* Fix minor typos ([#2270](https://github.com/taskforcesh/bullmq/issues/2270)) ([`9a469da`](https://github.com/taskforcesh/bullmq/commit/9a469daaf7f885df328a61dc5c1f6457b89f78fe))

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
