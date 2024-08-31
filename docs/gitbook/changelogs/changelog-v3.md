## [3.15.8](https://github.com/taskforcesh/bullmq/compare/v3.15.7...v3.15.8) (2023-06-16)


### Bug Fixes

* **rate-limit:** keep priority fifo order ([#1991](https://github.com/taskforcesh/bullmq/issues/1991)) fixes [#1929](https://github.com/taskforcesh/bullmq/issues/1929) (python) ([56bd7ad](https://github.com/taskforcesh/bullmq/commit/56bd7ad8c4daffcfb1f9f199abfc5d6495eb291e))

## [3.15.7](https://github.com/taskforcesh/bullmq/compare/v3.15.6...v3.15.7) (2023-06-16)


### Bug Fixes

* **worker:** set redis version always in initialization ([#1989](https://github.com/taskforcesh/bullmq/issues/1989)) fixes [#1988](https://github.com/taskforcesh/bullmq/issues/1988) ([a1544a8](https://github.com/taskforcesh/bullmq/commit/a1544a8c0f29522cd33772b14f559969db852d1d))

## [3.15.6](https://github.com/taskforcesh/bullmq/compare/v3.15.5...v3.15.6) (2023-06-13)


### Bug Fixes

* **worker:** use timeout as integer for redis lower than v6.0.0 (python) ([#1981](https://github.com/taskforcesh/bullmq/issues/1981)) ([0df6afa](https://github.com/taskforcesh/bullmq/commit/0df6afad5e71a693b721ba52ffa6be733ee45ccb))

## [3.15.5](https://github.com/taskforcesh/bullmq/compare/v3.15.4...v3.15.5) (2023-06-11)


### Bug Fixes

* **retry-job:** consider priority when moving job to wait (python) ([#1969](https://github.com/taskforcesh/bullmq/issues/1969)) ([e753855](https://github.com/taskforcesh/bullmq/commit/e753855eef248da73a5e9f6b18f4b79319dc2f86))

## [3.15.4](https://github.com/taskforcesh/bullmq/compare/v3.15.3...v3.15.4) (2023-06-08)


### Bug Fixes

* **job:** import right reference of QueueEvents ([#1964](https://github.com/taskforcesh/bullmq/issues/1964)) ([689c845](https://github.com/taskforcesh/bullmq/commit/689c84567f3a9fea51f349ca93b3008d5c187f62))

## [3.15.3](https://github.com/taskforcesh/bullmq/compare/v3.15.2...v3.15.3) (2023-06-08)


### Bug Fixes

* **job:** use QueueEvents type for waitUntilFinished ([#1958](https://github.com/taskforcesh/bullmq/issues/1958)) ([881848c](https://github.com/taskforcesh/bullmq/commit/881848c1ee3835dac24daf6807b1f35da967f68b))

## [3.15.2](https://github.com/taskforcesh/bullmq/compare/v3.15.1...v3.15.2) (2023-06-06)


### Bug Fixes

* **worker:** better worker client naming ([c5f63af](https://github.com/taskforcesh/bullmq/commit/c5f63affe72f7b6616f4c5f3aafde858dcc0b200))

## [3.15.1](https://github.com/taskforcesh/bullmq/compare/v3.15.0...v3.15.1) (2023-06-05)


### Bug Fixes

* **rate-limit:** consider paused queue ([#1931](https://github.com/taskforcesh/bullmq/issues/1931)) ([d97864a](https://github.com/taskforcesh/bullmq/commit/d97864a550992aeb8673557c7d8f186ab4ccb5bf))

# [3.15.0](https://github.com/taskforcesh/bullmq/compare/v3.14.2...v3.15.0) (2023-05-31)


### Features

* **job:** add changePriority method ([#1901](https://github.com/taskforcesh/bullmq/issues/1901)) ref [#1899](https://github.com/taskforcesh/bullmq/issues/1899) ([9485ad5](https://github.com/taskforcesh/bullmq/commit/9485ad567e2d8c78d601cc9eb2b7dd37f96d00c9))

## [3.14.2](https://github.com/taskforcesh/bullmq/compare/v3.14.1...v3.14.2) (2023-05-30)


### Bug Fixes

* **rate-limit:** take in count priority ([#1919](https://github.com/taskforcesh/bullmq/issues/1919)) fixes [#1915](https://github.com/taskforcesh/bullmq/issues/1915) ([b8157a3](https://github.com/taskforcesh/bullmq/commit/b8157a3424ceb60e662e80a3b0db918241b87ecc))

## [3.14.1](https://github.com/taskforcesh/bullmq/compare/v3.14.0...v3.14.1) (2023-05-27)


### Performance Improvements

* **retry-job:** get target queue list once ([#1921](https://github.com/taskforcesh/bullmq/issues/1921)) ([8a7a9dd](https://github.com/taskforcesh/bullmq/commit/8a7a9ddd793161a8591485ed18a191ece37026a8))

# [3.14.0](https://github.com/taskforcesh/bullmq/compare/v3.13.4...v3.14.0) (2023-05-22)


### Features

* **worker:** make extendLocks overridable ([7b1386b](https://github.com/taskforcesh/bullmq/commit/7b1386bb823562d9666a1ad6e206e1deb63e57ec))

## [3.13.4](https://github.com/taskforcesh/bullmq/compare/v3.13.3...v3.13.4) (2023-05-11)


### Performance Improvements

* **rate-limit:** call pttl in script moveJobFromActiveToWait ([#1889](https://github.com/taskforcesh/bullmq/issues/1889)) ([e0d2992](https://github.com/taskforcesh/bullmq/commit/e0d2992eb757d437dede52054c049470d986ad44))

## [3.13.3](https://github.com/taskforcesh/bullmq/compare/v3.13.2...v3.13.3) (2023-05-10)


### Bug Fixes

* **child:** use named import for EventEmitter ([#1887](https://github.com/taskforcesh/bullmq/issues/1887)) ([1db396d](https://github.com/taskforcesh/bullmq/commit/1db396d1f54154dc94c796ae8b570336fc341f02))

## [3.13.2](https://github.com/taskforcesh/bullmq/compare/v3.13.1...v3.13.2) (2023-05-09)


### Bug Fixes

* **rate-limit:** consider paused queue when dynamic rate limit ([#1884](https://github.com/taskforcesh/bullmq/issues/1884)) ([a23f37e](https://github.com/taskforcesh/bullmq/commit/a23f37e4079d34c8589efc85e4d726a62244f0d2))

## [3.13.1](https://github.com/taskforcesh/bullmq/compare/v3.13.0...v3.13.1) (2023-05-07)


### Bug Fixes

* **retry:** consider when queue is paused ([#1880](https://github.com/taskforcesh/bullmq/issues/1880)) ([01b621f](https://github.com/taskforcesh/bullmq/commit/01b621fea0cbdae602482ff61361c05646823223))

# [3.13.0](https://github.com/taskforcesh/bullmq/compare/v3.12.1...v3.13.0) (2023-05-06)


### Features

* **worker:** add worker threads support ([0820985](https://github.com/taskforcesh/bullmq/commit/0820985e073582fdf841affad38ecc7ab64691ec))

## [3.12.1](https://github.com/taskforcesh/bullmq/compare/v3.12.0...v3.12.1) (2023-05-05)


### Bug Fixes

* **worker:** close open handles after closing ([#1861](https://github.com/taskforcesh/bullmq/issues/1861)) fixes [#1312](https://github.com/taskforcesh/bullmq/issues/1312) ([39286e8](https://github.com/taskforcesh/bullmq/commit/39286e87e8ffabf641f229cf2da3db4c280f4637))

# [3.12.0](https://github.com/taskforcesh/bullmq/compare/v3.11.0...v3.12.0) (2023-04-20)


### Features

* upgrade ioredis to 5.3.2 ([375b1be](https://github.com/taskforcesh/bullmq/commit/375b1be52035e93c5fef6024e0d06aa723f602a9))

# [3.11.0](https://github.com/taskforcesh/bullmq/compare/v3.10.4...v3.11.0) (2023-04-17)


### Features

* **upstash:** don't throw an error when detecting an upstash host ([2e06bca](https://github.com/taskforcesh/bullmq/commit/2e06bca3615aafecd725d093045a510a67053fed))

## [3.10.4](https://github.com/taskforcesh/bullmq/compare/v3.10.3...v3.10.4) (2023-04-05)


### Bug Fixes

* **flow:** do not remove completed children results ([#1788](https://github.com/taskforcesh/bullmq/issues/1788)) fixes [#1778](https://github.com/taskforcesh/bullmq/issues/1778) ([04b547a](https://github.com/taskforcesh/bullmq/commit/04b547ad3df02cb94c499f7f26678e19c6797e7e))

## [3.10.3](https://github.com/taskforcesh/bullmq/compare/v3.10.2...v3.10.3) (2023-03-30)


### Bug Fixes

* **flow:** consider removing dependency on removeOnFail true ([#1753](https://github.com/taskforcesh/bullmq/issues/1753)) ([de5a299](https://github.com/taskforcesh/bullmq/commit/de5a299f109834ab0235ae6fb6286fd94fcef961))

## [3.10.2](https://github.com/taskforcesh/bullmq/compare/v3.10.1...v3.10.2) (2023-03-22)


### Bug Fixes

* **job:** avoid error when job is moved when processing ([#1354](https://github.com/taskforcesh/bullmq/issues/1354)) fixes [#1343](https://github.com/taskforcesh/bullmq/issues/1343) [#1602](https://github.com/taskforcesh/bullmq/issues/1602) ([78085e4](https://github.com/taskforcesh/bullmq/commit/78085e4304357dd3695df61057f91e706c3a52bf))

## [3.10.1](https://github.com/taskforcesh/bullmq/compare/v3.10.0...v3.10.1) (2023-03-06)


### Bug Fixes

* **worker:** throw error with invalid concurrency fixes [#1723](https://github.com/taskforcesh/bullmq/issues/1723) ([2a1cdbe](https://github.com/taskforcesh/bullmq/commit/2a1cdbe3e871309f460aadc14b4d632238c32aa9))

# [3.10.0](https://github.com/taskforcesh/bullmq/compare/v3.9.0...v3.10.0) (2023-03-02)


### Bug Fixes

* **worker:** close lock extended timer ([7995f18](https://github.com/taskforcesh/bullmq/commit/7995f18bb7712bd50d0fa3d17c4ab565b16ab379))
* **worker:** correct lock extender logic ([6aa3569](https://github.com/taskforcesh/bullmq/commit/6aa3569db0fe0137790e61a4b5982d2b35ee5646))
* **worker:** start stalled check timer ([4763be0](https://github.com/taskforcesh/bullmq/commit/4763be028b0c7b0460fd0804d4569c446a06ef4a))


### Features

* **worker:** replace Promise.race with efficient an async fifo ([0d94e35](https://github.com/taskforcesh/bullmq/commit/0d94e35e805b09c3b4c7404b8a2eeb71a1aff5c4))
* **worker:** simplify lock extension to one call independent of concurrency ([ebf1aeb](https://github.com/taskforcesh/bullmq/commit/ebf1aeb2400383d0ae90ab68aeb4822aea03ba44))


### Performance Improvements

* **scripts:** reuse keys array to avoid allocations ([feac7b4](https://github.com/taskforcesh/bullmq/commit/feac7b4070a6a3720597af36c43d095e9ea37173))
* **worker:** improve worker memory consumption ([4846cf1](https://github.com/taskforcesh/bullmq/commit/4846cf1fe3f9ea35f58a679c11706e1a7101c898))

# [3.9.0](https://github.com/taskforcesh/bullmq/compare/v3.8.0...v3.9.0) (2023-02-25)


### Features

* **worker:** add remove on complete and fail options ([#1703](https://github.com/taskforcesh/bullmq/issues/1703)) ([cf13494](https://github.com/taskforcesh/bullmq/commit/cf1349471dcbf0e43feea9972eaa71d2299d619f))

# [3.8.0](https://github.com/taskforcesh/bullmq/compare/v3.7.2...v3.8.0) (2023-02-23)


### Bug Fixes

* **worker:** run stalled check directly first time ([f71ec03](https://github.com/taskforcesh/bullmq/commit/f71ec03111a22897cbf2fad39073185e4aeac6d6))


### Features

* **worker:** add a public method to run the stalled checker ([3159266](https://github.com/taskforcesh/bullmq/commit/3159266ccb002d4fc71b7ee7ac63c465c536dbd1))
* **worker:** add support to disable stalled checks ([49e860c](https://github.com/taskforcesh/bullmq/commit/49e860c6675853971e992c2945b445660504e3b2))

## [3.7.2](https://github.com/taskforcesh/bullmq/compare/v3.7.1...v3.7.2) (2023-02-23)


### Bug Fixes

* **worker:** restore failed event job parameter typing ([#1707](https://github.com/taskforcesh/bullmq/issues/1707)) ([44c2203](https://github.com/taskforcesh/bullmq/commit/44c2203ab65d406be9a913254600fe07c83e62d5))

## [3.7.1](https://github.com/taskforcesh/bullmq/compare/v3.7.0...v3.7.1) (2023-02-22)


### Bug Fixes

* **worker:** failed event receives an optional job parameter ([#1702](https://github.com/taskforcesh/bullmq/issues/1702)) fixes [#1690](https://github.com/taskforcesh/bullmq/issues/1690) ([6009906](https://github.com/taskforcesh/bullmq/commit/6009906355765bf00cba5c1505e9e0c6bf8f14db))

# [3.7.0](https://github.com/taskforcesh/bullmq/compare/v3.6.6...v3.7.0) (2023-02-16)


### Performance Improvements

* **move-to-active:** remove deprecated limiter reference ([#1673](https://github.com/taskforcesh/bullmq/issues/1673)) ([a97b22f](https://github.com/taskforcesh/bullmq/commit/a97b22f518a9f6c5d9c30a77bfd03cafdcbc57ff))

## [3.6.6](https://github.com/taskforcesh/bullmq/compare/v3.6.5...v3.6.6) (2023-02-15)


### Bug Fixes

* **job:** check jobKey when saving stacktrace ([#1681](https://github.com/taskforcesh/bullmq/issues/1681)) fixes [#1676](https://github.com/taskforcesh/bullmq/issues/1676) ([1856c76](https://github.com/taskforcesh/bullmq/commit/1856c7684c377ca4fd36294cca8e128404be27b8))

## [3.6.5](https://github.com/taskforcesh/bullmq/compare/v3.6.4...v3.6.5) (2023-02-11)


### Bug Fixes

* infinite worker process spawned for invalid JS file ([a445ba8](https://github.com/taskforcesh/bullmq/commit/a445ba8b7a261b370dec7d88091ae5f5af8b2728))

## [3.6.4](https://github.com/taskforcesh/bullmq/compare/v3.6.3...v3.6.4) (2023-02-09)


### Bug Fixes

* **worker:** add a maximum block time ([1a2618b](https://github.com/taskforcesh/bullmq/commit/1a2618bc5473288a62dddb85e3cb78d6cdb4f39f))

## [3.6.3](https://github.com/taskforcesh/bullmq/compare/v3.6.2...v3.6.3) (2023-02-07)


### Bug Fixes

* **master:** copy type declaration ([23ade6e](https://github.com/taskforcesh/bullmq/commit/23ade6e3e45df14bd3fbc2c3e7be47307b642872))

## [3.6.2](https://github.com/taskforcesh/bullmq/compare/v3.6.1...v3.6.2) (2023-02-03)


### Bug Fixes

* **redis:** increase minimum default retry time ([d521531](https://github.com/taskforcesh/bullmq/commit/d521531e22ba9eda8ad8d6e8eddf450fdc3f50f4))

## [3.6.1](https://github.com/taskforcesh/bullmq/compare/v3.6.0...v3.6.1) (2023-01-31)


### Bug Fixes

* **connection:** apply console.warn in noeviction message ([95f171c](https://github.com/taskforcesh/bullmq/commit/95f171cbc8cdd7d04865618b715dd21229f36a4a))

# [3.6.0](https://github.com/taskforcesh/bullmq/compare/v3.5.11...v3.6.0) (2023-01-31)


### Features

* **job:** allow clearing job's log ([#1600](https://github.com/taskforcesh/bullmq/issues/1600)) ([0ded2d7](https://github.com/taskforcesh/bullmq/commit/0ded2d7709322bf105e0decac44d801ece5615f2))

## [3.5.11](https://github.com/taskforcesh/bullmq/compare/v3.5.10...v3.5.11) (2023-01-27)


### Bug Fixes

* **error:** remove global prototype toJSON ([#1642](https://github.com/taskforcesh/bullmq/issues/1642)) fixes [#1414](https://github.com/taskforcesh/bullmq/issues/1414) ([d4e7108](https://github.com/taskforcesh/bullmq/commit/d4e7108a37aeabdd3085a26c9daf09cea5976f3e))

## [3.5.10](https://github.com/taskforcesh/bullmq/compare/v3.5.9...v3.5.10) (2023-01-24)


### Bug Fixes

* **move-to-finished:** return correct delayUntil ([#1643](https://github.com/taskforcesh/bullmq/issues/1643)) ([c4bf9fa](https://github.com/taskforcesh/bullmq/commit/c4bf9fa6563eda1630d8eb2189b16e9324b01c7f))

## [3.5.9](https://github.com/taskforcesh/bullmq/compare/v3.5.8...v3.5.9) (2023-01-19)


### Bug Fixes

* **worker:** fix delayed jobs with concurrency fixes [#1627](https://github.com/taskforcesh/bullmq/issues/1627) ([99a8e6d](https://github.com/taskforcesh/bullmq/commit/99a8e6d3a339be51fb46f69c8afac4ecdebff6d3))

## [3.5.8](https://github.com/taskforcesh/bullmq/compare/v3.5.7...v3.5.8) (2023-01-18)


### Bug Fixes

* **move-to-active:** delete marker when it is moved to active ([#1634](https://github.com/taskforcesh/bullmq/issues/1634)) ([ad1fcea](https://github.com/taskforcesh/bullmq/commit/ad1fcea4500d4ceed51d5d5b0a03dbb5e1735a42))

## [3.5.7](https://github.com/taskforcesh/bullmq/compare/v3.5.6...v3.5.7) (2023-01-17)


### Bug Fixes

* **move-to-active:** validate next marker and return delayUntil ([#1630](https://github.com/taskforcesh/bullmq/issues/1630)) ([3cd3305](https://github.com/taskforcesh/bullmq/commit/3cd33052fc711a9ba560c9a431630be5cdd02193))

## [3.5.6](https://github.com/taskforcesh/bullmq/compare/v3.5.5...v3.5.6) (2023-01-13)


### Bug Fixes

* **worker:** add max concurrency from the beginning ([#1597](https://github.com/taskforcesh/bullmq/issues/1597)) fixes [#1589](https://github.com/taskforcesh/bullmq/issues/1589) ([6f49db3](https://github.com/taskforcesh/bullmq/commit/6f49db3fb15119d13f99cd83d49f2a7bdcb614cd))

## [3.5.5](https://github.com/taskforcesh/bullmq/compare/v3.5.4...v3.5.5) (2023-01-10)


### Bug Fixes

* circular references ([#1622](https://github.com/taskforcesh/bullmq/issues/1622)) ([f607ec7](https://github.com/taskforcesh/bullmq/commit/f607ec7530fb4430e8cab7ed325583bd9d171ccf))

## [3.5.4](https://github.com/taskforcesh/bullmq/compare/v3.5.3...v3.5.4) (2023-01-09)


### Bug Fixes

* [#1603](https://github.com/taskforcesh/bullmq/issues/1603) performance issues in `remove()` ([#1607](https://github.com/taskforcesh/bullmq/issues/1607)) ([2541215](https://github.com/taskforcesh/bullmq/commit/2541215bcf81dcd52eaefa02530c3812a5135fbf))

## [3.5.3](https://github.com/taskforcesh/bullmq/compare/v3.5.2...v3.5.3) (2023-01-07)


### Bug Fixes

* **delayed:** remove marker after being consumed ([#1620](https://github.com/taskforcesh/bullmq/issues/1620)) fixes [#1615](https://github.com/taskforcesh/bullmq/issues/1615) ([9fce0f0](https://github.com/taskforcesh/bullmq/commit/9fce0f05e5acc1918a276b03e8cb9c16083cb509))

## [3.5.2](https://github.com/taskforcesh/bullmq/compare/v3.5.1...v3.5.2) (2023-01-04)


### Performance Improvements

* **get-dependencies:** replace slow object destructuring with single object ([#1612](https://github.com/taskforcesh/bullmq/issues/1612)) ([621748e](https://github.com/taskforcesh/bullmq/commit/621748ec7727b46ce57eb9d2b46ef981874cdf4c))

## [3.5.1](https://github.com/taskforcesh/bullmq/compare/v3.5.0...v3.5.1) (2022-12-23)


### Bug Fixes

* **connection:** throw exception if using keyPrefix in ioredis ([eb6a130](https://github.com/taskforcesh/bullmq/commit/eb6a1305541547725e1717eefe2b678bc445f4d0))
* **connection:** use includes to check for upstash more reliably ([12efb5c](https://github.com/taskforcesh/bullmq/commit/12efb5c539cb6f031ea6f3a80e4128d2e556e627))

# [3.5.0](https://github.com/taskforcesh/bullmq/compare/v3.4.2...v3.5.0) (2022-12-20)


### Bug Fixes

* **job:** fetch parent before job moves to complete ([#1580](https://github.com/taskforcesh/bullmq/issues/1580)) ([6a6c0dc](https://github.com/taskforcesh/bullmq/commit/6a6c0dca30bb0a2417e0c62d4c80202c750322dd))
* **sandbox:** throw error when no exported function ([#1588](https://github.com/taskforcesh/bullmq/issues/1588)) fixes [#1587](https://github.com/taskforcesh/bullmq/issues/1587) ([c031891](https://github.com/taskforcesh/bullmq/commit/c03189184c8eeeb324f005b86e93d114abbe2154))


### Features

* **queue:** add getJobState method ([#1593](https://github.com/taskforcesh/bullmq/issues/1593)) ref [#1532](https://github.com/taskforcesh/bullmq/issues/1532) ([b741e84](https://github.com/taskforcesh/bullmq/commit/b741e8456f262b51aa7c68f571c76a3c54d02d37))

## [3.4.2](https://github.com/taskforcesh/bullmq/compare/v3.4.1...v3.4.2) (2022-12-15)


### Performance Improvements

* **counts:** delete delayed marker when needed ([#1583](https://github.com/taskforcesh/bullmq/issues/1583)) ([cc26f1c](https://github.com/taskforcesh/bullmq/commit/cc26f1cd550de76c7588d3a98187b80ee78c40c4))
* **get-children-values:** replace slow object destructuring with single object ([#1586](https://github.com/taskforcesh/bullmq/issues/1586)) ([857d403](https://github.com/taskforcesh/bullmq/commit/857d40377a6eb2c0101e6d16d9085ecd4b52b016))

## [3.4.1](https://github.com/taskforcesh/bullmq/compare/v3.4.0...v3.4.1) (2022-12-10)


### Bug Fixes

* **exponential:** respect exponential backoff delay ([#1581](https://github.com/taskforcesh/bullmq/issues/1581)) ([145dd32](https://github.com/taskforcesh/bullmq/commit/145dd329bb9f8254b404f4c5fbf7a50359202d37))
* **get-jobs:** filter marker ([#1551](https://github.com/taskforcesh/bullmq/issues/1551)) ([4add0ef](https://github.com/taskforcesh/bullmq/commit/4add0efa7857cc2f7b6d3c0c78a7f82cb7a46933))

# [3.4.0](https://github.com/taskforcesh/bullmq/compare/v3.3.5...v3.4.0) (2022-12-09)


### Features

* **worker:** add ready event for blockingConnection ([#1577](https://github.com/taskforcesh/bullmq/issues/1577)) ([992cc9e](https://github.com/taskforcesh/bullmq/commit/992cc9e9b3046185d3b67f2cc956f30337f458e1))

## [3.3.5](https://github.com/taskforcesh/bullmq/compare/v3.3.4...v3.3.5) (2022-12-08)


### Bug Fixes

* **worker:** add token postfix ([#1575](https://github.com/taskforcesh/bullmq/issues/1575)) ([1d3e368](https://github.com/taskforcesh/bullmq/commit/1d3e368021041bb9861761c86fe3e04914b0c52f))

## [3.3.4](https://github.com/taskforcesh/bullmq/compare/v3.3.3...v3.3.4) (2022-12-07)


### Bug Fixes

* **worker:** try catch setname call ([#1576](https://github.com/taskforcesh/bullmq/issues/1576)) fixes [#1574](https://github.com/taskforcesh/bullmq/issues/1574) ([0c42fd8](https://github.com/taskforcesh/bullmq/commit/0c42fd8c07dbac7ace81e97e45440af93fc622a5))

## [3.3.3](https://github.com/taskforcesh/bullmq/compare/v3.3.2...v3.3.3) (2022-12-07)


### Bug Fixes

* do not allow move from active to wait if not owner of the job ([dc1a307](https://github.com/taskforcesh/bullmq/commit/dc1a3077d1521c5dc99824a7fc05d17da03906bc))

## [3.3.2](https://github.com/taskforcesh/bullmq/compare/v3.3.1...v3.3.2) (2022-12-05)


### Bug Fixes

* floor pexpire to integer ([1d5de42](https://github.com/taskforcesh/bullmq/commit/1d5de425a19ebf879a8f9a7e0543d87a4d358be1))

## [3.3.1](https://github.com/taskforcesh/bullmq/compare/v3.3.0...v3.3.1) (2022-12-05)


### Bug Fixes

* **get-workers:** set name when ready event in connection ([#1564](https://github.com/taskforcesh/bullmq/issues/1564)) ([de93c17](https://github.com/taskforcesh/bullmq/commit/de93c172901650e1666c48423a39076f2c7b9c7b))
* **job:** console warn custom job ids when they represent integers ([#1569](https://github.com/taskforcesh/bullmq/issues/1569)) ([6e677d2](https://github.com/taskforcesh/bullmq/commit/6e677d2800957b368bef4247b8e4328c5758f262))

# [3.3.0](https://github.com/taskforcesh/bullmq/compare/v3.2.5...v3.3.0) (2022-12-04)


### Features

* **queue-events:** support duplicated event ([#1549](https://github.com/taskforcesh/bullmq/issues/1549)) ([18bc4eb](https://github.com/taskforcesh/bullmq/commit/18bc4eb50432f8aa27f2395750a7617317b66ca1))

## [3.2.5](https://github.com/taskforcesh/bullmq/compare/v3.2.4...v3.2.5) (2022-12-04)


### Bug Fixes

* **add-job:** throw error when jobId represents an integer ([#1556](https://github.com/taskforcesh/bullmq/issues/1556)) ([db617d7](https://github.com/taskforcesh/bullmq/commit/db617d79e8f55b5c9e0df4b6bfd4247612016da1))

## [3.2.4](https://github.com/taskforcesh/bullmq/compare/v3.2.3...v3.2.4) (2022-11-29)


### Bug Fixes

* **add-job:** do not update job that already exist ([#1550](https://github.com/taskforcesh/bullmq/issues/1550)) ([26f6311](https://github.com/taskforcesh/bullmq/commit/26f6311cd0d2b936e404d0abebca9637f314a209))

## [3.2.3](https://github.com/taskforcesh/bullmq/compare/v3.2.2...v3.2.3) (2022-11-29)


### Bug Fixes

* **rate-limit:** delete rateLimiterKey when 0 ([#1553](https://github.com/taskforcesh/bullmq/issues/1553)) ([0b88e5b](https://github.com/taskforcesh/bullmq/commit/0b88e5b94b4a0dc0d4000f7fd4b327f402248ad2))

## [3.2.2](https://github.com/taskforcesh/bullmq/compare/v3.2.1...v3.2.2) (2022-11-15)


### Bug Fixes

* **rate-limit:** check job is active before moving to wait ([9502167](https://github.com/taskforcesh/bullmq/commit/9502167bb0d9008fc8811ff7980dc8126fbc5ac2))

## [3.2.1](https://github.com/taskforcesh/bullmq/compare/v3.2.0...v3.2.1) (2022-11-15)


### Bug Fixes

* **worker:** consider removed jobs in failed event ([#1500](https://github.com/taskforcesh/bullmq/issues/1500)) ([8704b9a](https://github.com/taskforcesh/bullmq/commit/8704b9a10575fd7df738296f7156057123592b86))

# [3.2.0](https://github.com/taskforcesh/bullmq/compare/v3.1.3...v3.2.0) (2022-11-09)


### Features

* **flow:** move parent to delayed when delay option is provided ([#1501](https://github.com/taskforcesh/bullmq/issues/1501)) ([2f3e5d5](https://github.com/taskforcesh/bullmq/commit/2f3e5d54f0797bf0d1adf14dbb2b51ad9f9183ca))

## [3.1.3](https://github.com/taskforcesh/bullmq/compare/v3.1.2...v3.1.3) (2022-11-04)


### Bug Fixes

* **delayed:** better handling of marker id ([816376e](https://github.com/taskforcesh/bullmq/commit/816376e7880ae0eafe85a1f9a5aef9fdfe3031a9))
* **delayed:** notify workers a delayed job is closer in time fixes [#1505](https://github.com/taskforcesh/bullmq/issues/1505) ([6ced4d0](https://github.com/taskforcesh/bullmq/commit/6ced4d06c5c9c8342c9e4f7920a21826871eac1b))
* **job:** better error message in moveToFailed ([4e9f5bb](https://github.com/taskforcesh/bullmq/commit/4e9f5bb90f87c66eca959ffc9b7a09e05908c2d9))
* **moveToFinish:** always promote delayed jobs ([7610cc3](https://github.com/taskforcesh/bullmq/commit/7610cc37d4695a885043c251990e153d4ce4440f))
* **moveToFinished:** revert move promoteDelayedJobs ([7d780db](https://github.com/taskforcesh/bullmq/commit/7d780dbc1d7728ab7b762a5578871b31f27ff80c))

## [3.1.2](https://github.com/taskforcesh/bullmq/compare/v3.1.1...v3.1.2) (2022-11-04)


### Bug Fixes

* **repeat:** allow easy migration from bullmq <3 to >=3 ([e17b886](https://github.com/taskforcesh/bullmq/commit/e17b886d3e2978e25f23f1a99b88562537a08576))

## [3.1.1](https://github.com/taskforcesh/bullmq/compare/v3.1.0...v3.1.1) (2022-11-03)


### Bug Fixes

* **change-delay:** remove delayed stream ([#1509](https://github.com/taskforcesh/bullmq/issues/1509)) ([6e4809e](https://github.com/taskforcesh/bullmq/commit/6e4809e5d8f7ef35bc0871d21bfcdcb0f1f316c6))
* **worker:** restore dynamic concurrency change ([#1515](https://github.com/taskforcesh/bullmq/issues/1515)) ([fdac5c2](https://github.com/taskforcesh/bullmq/commit/fdac5c27607dfaaaad1c1256c47f2ae448efcd21))

# [3.1.0](https://github.com/taskforcesh/bullmq/compare/v3.0.1...v3.1.0) (2022-11-02)


### Features

* **workers:** better error message for missing lock ([bf1d086](https://github.com/taskforcesh/bullmq/commit/bf1d0860c70bcc2b604d02ca47e5db64f962d71d))

## [3.0.1](https://github.com/taskforcesh/bullmq/compare/v3.0.0...v3.0.1) (2022-11-02)


### Bug Fixes

* **move-to-delayed:** consider promoting delayed jobs ([#1493](https://github.com/taskforcesh/bullmq/issues/1493)) ([909da2b](https://github.com/taskforcesh/bullmq/commit/909da2bc2718a588379b3fdd9791bc8e51ad1dad))
* **retry-job:** consider promoting delayed jobs ([#1508](https://github.com/taskforcesh/bullmq/issues/1508)) ([d0b3412](https://github.com/taskforcesh/bullmq/commit/d0b3412d222449c24ab36068a791d08ea19ed922))

# [3.0.0](https://github.com/taskforcesh/bullmq/compare/v2.4.0...v3.0.0) (2022-10-25)


### Bug Fixes

* **backoff:** handle backoff strategy as function ([#1463](https://github.com/taskforcesh/bullmq/issues/1463)) ([3640269](https://github.com/taskforcesh/bullmq/commit/36402691a3c7fa500f07e2e11a28318099bdb909))
* **repeat:** remove cron in favor of pattern option ([#1456](https://github.com/taskforcesh/bullmq/issues/1456)) ([3cc150e](https://github.com/taskforcesh/bullmq/commit/3cc150e32cb5971ad4ba6ff91246aaf75296c165))


### Features

* add support for dynamic rate limiting ([2d51d2b](https://github.com/taskforcesh/bullmq/commit/2d51d2b33ef49059503e1bca7a582c71f6861ef4))
* **rate-limit:** remove group key support and improve global rate limit ([81f780a](https://github.com/taskforcesh/bullmq/commit/81f780aeed81e670107d01d01265d407a30e2a62))


### BREAKING CHANGES

* **rate-limit:** limit by group keys has been removed in favor
of a much simpler and efficent rate-limit implementation.
* **backoff:** object mapping is replaced by single function
