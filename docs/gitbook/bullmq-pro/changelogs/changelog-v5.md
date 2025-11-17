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
