# [5.63.0](https://github.com/taskforcesh/bullmq/compare/v5.62.2...v5.63.0) (2025-10-31)


### Bug Fixes

* **queue:** emit progress event when calling updateJobProgress ([#3528](https://github.com/taskforcesh/bullmq/issues/3528)) ([c82df83](https://github.com/taskforcesh/bullmq/commit/c82df834dc83b3cf889b6a1aba9d18ec8b5eaf70))


### Features

* **queue:** support getMeta method ([#3513](https://github.com/taskforcesh/bullmq/issues/3513)) ([e212d1c](https://github.com/taskforcesh/bullmq/commit/e212d1c8f0945dbff2d95309afe1376366910482))

## [5.62.2](https://github.com/taskforcesh/bullmq/compare/v5.62.1...v5.62.2) (2025-10-30)


### Bug Fixes

* upsertJobScheduler does not apply change on existing scheduled job ([#3524](https://github.com/taskforcesh/bullmq/issues/3524)) ([98f73b3](https://github.com/taskforcesh/bullmq/commit/98f73b3f33aa79cdd67d0c4090cc86a8e4cfeb4c)), closes [#3500](https://github.com/taskforcesh/bullmq/issues/3500)

## [5.62.1](https://github.com/taskforcesh/bullmq/compare/v5.62.0...v5.62.1) (2025-10-30)


### Performance Improvements

* **worker:** call moveToActive after special errors ([#3497](https://github.com/taskforcesh/bullmq/issues/3497)) ([37e9db5](https://github.com/taskforcesh/bullmq/commit/37e9db52a67b4e120139c1d2620cc0f73a08c006))

# [5.62.0](https://github.com/taskforcesh/bullmq/compare/v5.61.2...v5.62.0) (2025-10-28)


### Features

* **queue:** support getGlobalRateLimit method ([#3511](https://github.com/taskforcesh/bullmq/issues/3511)) ([6a31e0a](https://github.com/taskforcesh/bullmq/commit/6a31e0aeab1311d7d089811ede7e11a98b6dd408))

## [5.61.2](https://github.com/taskforcesh/bullmq/compare/v5.61.0...v5.61.2) (2025-10-23)


### Bug Fixes

* **worker:** only emit error when moveToActive failed ([0aa7cc5](https://github.com/taskforcesh/bullmq/commit/0aa7cc57db27a4e7b9fe3c5f52600abba749b053))
* **queue:** emit removed event when calling remove method ([#3492](https://github.com/taskforcesh/bullmq/issues/3492)) fixes [#2668](https://github.com/taskforcesh/bullmq/issues/2668) ([7a3f2fa1](https://github.com/taskforcesh/bullmq/commit/7a3f2fa131e20de80c45877a1018e1ccdf8a6506))
* **worker:** emit error once when failure happens in moveToFinished ([#3498](https://github.com/taskforcesh/bullmq/issues/3498)) ([4b4bd97e](https://github.com/taskforcesh/bullmq/commit/4b4bd97ee78af861121e2ccb90f210e4a74fbd26))

## [5.61.0](https://github.com/taskforcesh/bullmq/compare/v5.60.0...v5.61.0) (2025-10-06)

### Features

* **queue:** add removeGlobalRateLimit method ([#3481](https://github.com/taskforcesh/bullmq/issues/3481)) ([d3fff80](https://github.com/taskforcesh/bullmq/commit/d3fff80f7135251db65e22cba8852a5584030cb1))

### Bug Fixes

* **worker:** do not retry processor when connection errors happen ([#3482](https://github.com/taskforcesh/bullmq/issues/3482)) ([f1573b3](https://github.com/taskforcesh/bullmq/commit/f1573b3023807aab9a68ea6b2ce16a58afe4402b))

## [5.60.0](https://github.com/taskforcesh/bullmq/compare/v5.59.0...v5.60.0) (2025-10-03)

### Features

* **queue:** support global rate limit ([#3468](https://github.com/taskforcesh/bullmq/issues/3468)) ref [#3019](https://github.com/taskforcesh/bullmq/issues/3019) ([bef57a0](https://github.com/taskforcesh/bullmq/commit/bef57a0e252a5d8bd0bf319d0bca3b1ad0e6519f))

## [5.59.0](https://github.com/taskforcesh/bullmq/compare/v5.58.9...v5.59.0) (2025-09-29)

### Features

* **deduplication:** support replace option in single mode ([#3472](https://github.com/taskforcesh/bullmq/issues/3472)) ([eea35b7](https://github.com/taskforcesh/bullmq/commit/eea35b763c0965e129cf0ef4a104d05aa1f65f74))
* **sandbox:** support mjs files ([#3476](https://github.com/taskforcesh/bullmq/issues/3476)) ref [#3474](https://github.com/taskforcesh/bullmq/issues/3474) ([2e2b214](https://github.com/taskforcesh/bullmq/commit/2e2b21454cc6125fcf3abfec939d6d6d8d02c40b))
* **worker:** support maxStartedAttempts option ([#3331](https://github.com/taskforcesh/bullmq/issues/3331)) ([9384a64](https://github.com/taskforcesh/bullmq/commit/9384a64d6d48718220e472c26d0c03e7b7e8e555))

### Performance Improvements

* **worker:** only consider infinity retry on connection errors ([#3473](https://github.com/taskforcesh/bullmq/issues/3473)) ([9d5a678](https://github.com/taskforcesh/bullmq/commit/9d5a678660f6bb927ad375d7de58814d392dbe9d))

## [5.58.9](https://github.com/taskforcesh/bullmq/compare/v5.58.8...v5.58.9) (2025-09-26)

### Performance Improvements

* **metrics:** use lua script when calling getMetrics ([#3459](https://github.com/taskforcesh/bullmq/issues/3459)) ([61987c6](https://github.com/taskforcesh/bullmq/commit/61987c62ca71ec11a84b98e6dd51a6d5ebf1737d))

## [5.58.8](https://github.com/taskforcesh/bullmq/compare/v5.58.7...v5.58.8) (2025-09-25)

### Bug Fixes

* **job-scheduler:** fix unstable upsert ([#3446](https://github.com/taskforcesh/bullmq/issues/3446)) ([2241101](https://github.com/taskforcesh/bullmq/commit/22411010beca628d172790cfbac45e3cd3d102ed))

## [5.58.7](https://github.com/taskforcesh/bullmq/compare/v5.58.6...v5.58.7) (2025-09-19)

### Bug Fixes

* **job:** add custom jobId validation to prevent : inclusion ([#3384](https://github.com/taskforcesh/bullmq/issues/3384)) fixes [#3382](https://github.com/taskforcesh/bullmq/issues/3382) ([845a6f5](https://github.com/taskforcesh/bullmq/commit/845a6f5fdede9ecf4050e8b5617feb56dbb3c9a1))

## [5.58.6](https://github.com/taskforcesh/bullmq/compare/v5.58.5...v5.58.6) (2025-09-19)


### Bug Fixes

* **deps:** upgrade uuid to v11 ([#3452](https://github.com/taskforcesh/bullmq/issues/3452)) ([bd8fbc1](https://github.com/taskforcesh/bullmq/commit/bd8fbc164caaa01f665d0c7e94177d0584d04f8c))
* **events:** set prev param as active when calling retryJob script ([#3426](https://github.com/taskforcesh/bullmq/issues/3426)) ([e0ebd15](https://github.com/taskforcesh/bullmq/commit/e0ebd15e47b95f9300d6683475ec5d2176f07c95))
* **deduplication:** validate id option is provided ([#3443](https://github.com/taskforcesh/bullmq/issues/3443)) fixes [#3432](https://github.com/taskforcesh/bullmq/issues/3432) ([533b844](https://github.com/taskforcesh/bullmq/commit/533b84461a908a3d0182002f16e9c0c0a0260014))

## [5.58.5](https://github.com/taskforcesh/bullmq/compare/v5.58.4...v5.58.5) (2025-09-04)


### Bug Fixes

* **queue:** preserve Job type inference when no explicit type for JobBase ([#3423](https://github.com/taskforcesh/bullmq/issues/3423)) fixes [#3421](https://github.com/taskforcesh/bullmq/issues/3421) ([f642818](https://github.com/taskforcesh/bullmq/commit/f6428188f39f054e8b94579435b16e260aff27cd))

## [5.58.4](https://github.com/taskforcesh/bullmq/compare/v5.58.3...v5.58.4) (2025-08-30)


### Bug Fixes

* **types:** export Processor type ([#3418](https://github.com/taskforcesh/bullmq/issues/3418)) ([70e8a3f](https://github.com/taskforcesh/bullmq/commit/70e8a3f91595dcdc2d21122170ef4af1f53972ad))

## [5.58.3](https://github.com/taskforcesh/bullmq/compare/v5.58.2...v5.58.3) (2025-08-29)


### Bug Fixes

* **job-scheduler:** consider undefined type in getJobScheduler return type ([#3412](https://github.com/taskforcesh/bullmq/issues/3412)) ([ffc6e26](https://github.com/taskforcesh/bullmq/commit/ffc6e26eb66533fc6eae4c406bb4b9a9f7590d9b))

## [5.58.2](https://github.com/taskforcesh/bullmq/compare/v5.58.1...v5.58.2) (2025-08-26)


### Bug Fixes

* **job:** consider parent update when retrying ([#3402](https://github.com/taskforcesh/bullmq/issues/3402)) (python) fixes [#3320](https://github.com/taskforcesh/bullmq/issues/3320) ([316d1ed](https://github.com/taskforcesh/bullmq/commit/316d1ed32680e690b1d2ab92c79a53e0d4c00c2d))

## [5.58.1](https://github.com/taskforcesh/bullmq/compare/v5.58.0...v5.58.1) (2025-08-23)


### Bug Fixes

* **job:** prevent unnecessary tryCatch calls in getTraces ([#3400](https://github.com/taskforcesh/bullmq/issues/3400)) ([d71b872](https://github.com/taskforcesh/bullmq/commit/d71b87245c8196d19dfeaf82e6ef14c91fb9a7c5))

# [5.58.0](https://github.com/taskforcesh/bullmq/compare/v5.57.0...v5.58.0) (2025-08-15)


### Features

* **worker:** adds jobName and attemptsMade span attributes when processJob is called ([#3199](https://github.com/taskforcesh/bullmq/issues/3199)) ([db0a922](https://github.com/taskforcesh/bullmq/commit/db0a922741d8c7eae8d5119a0831cd734aba02a2))

# [5.57.0](https://github.com/taskforcesh/bullmq/compare/v5.56.10...v5.57.0) (2025-08-13)


### Features

* **sandbox:** support moveToWaitingChildren method ([#3389](https://github.com/taskforcesh/bullmq/issues/3389)) ([0fecc6c](https://github.com/taskforcesh/bullmq/commit/0fecc6cd0d0dea06f486ab0b0fe760d866f1fc34))

## [5.56.10](https://github.com/taskforcesh/bullmq/compare/v5.56.9...v5.56.10) (2025-08-10)


### Bug Fixes

* **scheduler:** consider startDate to generate nextMillis when using pattern ([#3385](https://github.com/taskforcesh/bullmq/issues/3385)) fixes [#3378](https://github.com/taskforcesh/bullmq/issues/3378) ([53754fb](https://github.com/taskforcesh/bullmq/commit/53754fb239cf1b021ffc55391990d879d363dcf7))

## [5.56.9](https://github.com/taskforcesh/bullmq/compare/v5.56.8...v5.56.9) (2025-07-31)


### Bug Fixes

* **worker:** emit failed event when children are failed in moveToWaitingChildren ([#3346](https://github.com/taskforcesh/bullmq/issues/3346)) ([93df852](https://github.com/taskforcesh/bullmq/commit/93df852f97f04023d791546d30a6af24fbca6114))

## [5.56.8](https://github.com/taskforcesh/bullmq/compare/v5.56.7...v5.56.8) (2025-07-27)


### Bug Fixes

* **queue:** add support for 'waiting' parameter in clean method ([#3338](https://github.com/taskforcesh/bullmq/issues/3338)) fixes [#3125](https://github.com/taskforcesh/bullmq/issues/3125) ([edb7147](https://github.com/taskforcesh/bullmq/commit/edb714764066b06c068c8c8a5140b010f27c3b9a))

## [5.56.7](https://github.com/taskforcesh/bullmq/compare/v5.56.6...v5.56.7) (2025-07-25)


### Bug Fixes

* **flow:** remove parent from active when there are unsuccessful children ([#3348](https://github.com/taskforcesh/bullmq/issues/3348)) ([34ee339](https://github.com/taskforcesh/bullmq/commit/34ee33955a660b0696f4b6cff6d8d39fdcd160db))
* **worker:** do not keep active jobs when pausing or closing ([#3350](https://github.com/taskforcesh/bullmq/issues/3350)) fixes [#3349](https://github.com/taskforcesh/bullmq/issues/3349) ([424d155](https://github.com/taskforcesh/bullmq/commit/424d15508172a028479059920ed6bfcf1c54a389))

## [5.56.6](https://github.com/taskforcesh/bullmq/compare/v5.56.5...v5.56.6) (2025-07-25)


### Bug Fixes

* **repeat:** use legacy updateRepeatableJob script when old format is present ([#3364](https://github.com/taskforcesh/bullmq/issues/3364)) fixes [#3275](https://github.com/taskforcesh/bullmq/issues/3275) ([1e221d5](https://github.com/taskforcesh/bullmq/commit/1e221d5404dcea750a08342c832a682e454135a3))

## [5.56.5](https://github.com/taskforcesh/bullmq/compare/v5.56.4...v5.56.5) (2025-07-19)


### Bug Fixes

* **rate-limit:** throw right error message if job does not exist ([#3354](https://github.com/taskforcesh/bullmq/issues/3354)) ([83d9695](https://github.com/taskforcesh/bullmq/commit/83d969541f19fa9703eb73ff0006cd29a358c1e7))

## [5.56.4](https://github.com/taskforcesh/bullmq/compare/v5.56.3...v5.56.4) (2025-07-11)


### Bug Fixes

* **connection:** ignore info command when skipVersionCheck is provided as true ([#3342](https://github.com/taskforcesh/bullmq/issues/3342)) fixes [#3341](https://github.com/taskforcesh/bullmq/issues/3341) ([b94d7ed](https://github.com/taskforcesh/bullmq/commit/b94d7ed5602e366b4401051b236f31ac2dd2a90d))

## [5.56.3](https://github.com/taskforcesh/bullmq/compare/v5.56.2...v5.56.3) (2025-07-10)


### Bug Fixes

* **scheduler:** take offset into the startMillis calculation ([#2944](https://github.com/taskforcesh/bullmq/issues/2944)) fixes [#247](https://github.com/taskforcesh/bullmq/issues/247) ([1e3f3c5](https://github.com/taskforcesh/bullmq/commit/1e3f3c507a7ceb8d8147941adc9de69367947a5e))

## [5.56.2](https://github.com/taskforcesh/bullmq/compare/v5.56.1...v5.56.2) (2025-07-08)


### Performance Improvements

* **woker:** keep lower blockTimeout when consuming delayed markers ([#3333](https://github.com/taskforcesh/bullmq/issues/3333)) ([e687d7c](https://github.com/taskforcesh/bullmq/commit/e687d7cf86108138bbd5e911b11ab3c5717fc23c))

## [5.56.1](https://github.com/taskforcesh/bullmq/compare/v5.56.0...v5.56.1) (2025-07-03)


### Performance Improvements

* **worker:** do not wait rate limit when fetching jobs ([#3322](https://github.com/taskforcesh/bullmq/issues/3322)) ([c32e6a0](https://github.com/taskforcesh/bullmq/commit/c32e6a0ff6df8bc34c9c13238c192974a93f7ddb))

# [5.56.0](https://github.com/taskforcesh/bullmq/compare/v5.55.0...v5.56.0) (2025-06-22)


### Features

* **deduplication:** add support for replace and extend options ([#3260](https://github.com/taskforcesh/bullmq/issues/3260)) ref [#2767](https://github.com/taskforcesh/bullmq/issues/2767) [#3151](https://github.com/taskforcesh/bullmq/issues/3151) [#3250](https://github.com/taskforcesh/bullmq/issues/3250) ([4a53609](https://github.com/taskforcesh/bullmq/commit/4a5360936c1a543a1ff31ebbb6ab1289cc8ddf07))

# [5.55.0](https://github.com/taskforcesh/bullmq/compare/v5.54.3...v5.55.0) (2025-06-21)


### Features

* **worker:** allow calling moveToWait when job is processing ([#3302](https://github.com/taskforcesh/bullmq/issues/3302)) ref [#3296](https://github.com/taskforcesh/bullmq/issues/3296) ([e742511](https://github.com/taskforcesh/bullmq/commit/e742511baf35225718c01e621623eab661f37284))

## [5.54.3](https://github.com/taskforcesh/bullmq/compare/v5.54.2...v5.54.3) (2025-06-18)


### Bug Fixes

* **scheduler:** fix slot calculation when using every ([#3307](https://github.com/taskforcesh/bullmq/issues/3307)) ([588719e](https://github.com/taskforcesh/bullmq/commit/588719ee49c7615affeb69d3a431025757115c10))

## [5.54.2](https://github.com/taskforcesh/bullmq/compare/v5.54.1...v5.54.2) (2025-06-17)


### Bug Fixes

* avoid circular reference between scripts and queue ([#3301](https://github.com/taskforcesh/bullmq/issues/3301)) ([fb65677](https://github.com/taskforcesh/bullmq/commit/fb65677f2d636e1aca3cc75cb3b740b8729b3358))

## [5.54.1](https://github.com/taskforcesh/bullmq/compare/v5.54.0...v5.54.1) (2025-06-17)


### Performance Improvements

* **scheduler:** save offset value when every is provided ([#3142](https://github.com/taskforcesh/bullmq/issues/3142)) ([98f35bc](https://github.com/taskforcesh/bullmq/commit/98f35bc1eabb3ab1010737869c310d2001a84fac))

# [5.54.0](https://github.com/taskforcesh/bullmq/compare/v5.53.3...v5.54.0) (2025-06-15)


### Features

* **backoff:** add jitter option ([#3291](https://github.com/taskforcesh/bullmq/issues/3291)) ([86c4c6d](https://github.com/taskforcesh/bullmq/commit/86c4c6dd25ef868f1f37c917ab11cb663e330e2f))

## [5.53.3](https://github.com/taskforcesh/bullmq/compare/v5.53.2...v5.53.3) (2025-06-13)


### Bug Fixes

* **worker:** avoid dangling jobs to hang the queue with rate limit ([#3297](https://github.com/taskforcesh/bullmq/issues/3297)) fixes [#3289](https://github.com/taskforcesh/bullmq/issues/3289) ([263d33d](https://github.com/taskforcesh/bullmq/commit/263d33d536a92daf578c56cbb58765917046e052))

## [5.53.2](https://github.com/taskforcesh/bullmq/compare/v5.53.1...v5.53.2) (2025-06-02)


### Performance Improvements

* **stalled:** fail stalled jobs in a lazy way ([#3266](https://github.com/taskforcesh/bullmq/issues/3266)) ([5cbf064](https://github.com/taskforcesh/bullmq/commit/5cbf0647e106d45d78318a5e5e9fb017261374c9))

## [5.53.1](https://github.com/taskforcesh/bullmq/compare/v5.53.0...v5.53.1) (2025-05-30)


### Bug Fixes

* **job:** do not parse ignored failures in getDependencies ([#3284](https://github.com/taskforcesh/bullmq/issues/3284)) fixes [#3283](https://github.com/taskforcesh/bullmq/issues/3283) ([04ca6b5](https://github.com/taskforcesh/bullmq/commit/04ca6b55c15698aab3ceaf72bd2ed9c589d76197))
* **scheduler:** remove current job when it is in delayed state ([#3269](https://github.com/taskforcesh/bullmq/issues/3269)) fixes [#3262](https://github.com/taskforcesh/bullmq/issues/3262) [#3272](https://github.com/taskforcesh/bullmq/issues/3272) ([1ca4cbd](https://github.com/taskforcesh/bullmq/commit/1ca4cbd17a58c7eba83030bd6440d0f5e5d69633))

# [5.53.0](https://github.com/taskforcesh/bullmq/compare/v5.52.3...v5.53.0) (2025-05-21)


### Features

* **sandbox:** add getIgnoredChildrenFailures method in job's wrapper ([#3263](https://github.com/taskforcesh/bullmq/issues/3263)) ([5d2723d](https://github.com/taskforcesh/bullmq/commit/5d2723dd82e636846e2ff886abb4c0161c15a441))

## [5.52.3](https://github.com/taskforcesh/bullmq/compare/v5.52.2...v5.52.3) (2025-05-19)


### Bug Fixes

* **flow:** add new error code when parent has failed children ([#3268](https://github.com/taskforcesh/bullmq/issues/3268)) ([b8fba5e](https://github.com/taskforcesh/bullmq/commit/b8fba5e937a41d0c7ddc97443e9fa8d0f0de566b))


### Features

* **job:** add moveToCompleted method [python] ([#3251](https://github.com/taskforcesh/bullmq/issues/3251)) ([6a8e3e2](https://github.com/taskforcesh/bullmq/commit/6a8e3e206384b56063c6f5a46ca030d2b330c712))

## [5.52.2](https://github.com/taskforcesh/bullmq/compare/v5.52.1...v5.52.2) (2025-05-08)


### Bug Fixes

* **worker:** maxStalledCount no less than 0 ([#3249](https://github.com/taskforcesh/bullmq/issues/3249)) fixes [#3248](https://github.com/taskforcesh/bullmq/issues/3248) ([34dcb8c](https://github.com/taskforcesh/bullmq/commit/34dcb8c3d01a822b07852bc928d882bd6e4049d2))

## [5.52.1](https://github.com/taskforcesh/bullmq/compare/v5.52.0...v5.52.1) (2025-05-02)


### Bug Fixes

* **remove:** pass correct children meta references ([#3245](https://github.com/taskforcesh/bullmq/issues/3245)) ([01c62ad](https://github.com/taskforcesh/bullmq/commit/01c62ada0cea80c73ba28d79fd14ea5ba78fdc7d))

# [5.52.0](https://github.com/taskforcesh/bullmq/compare/v5.51.1...v5.52.0) (2025-05-01)


### Bug Fixes

* **connection:** add str type in connection option [python] ([#3212](https://github.com/taskforcesh/bullmq/issues/3212)) ([72fac42](https://github.com/taskforcesh/bullmq/commit/72fac4297f5a60e0c2ae0831507cb16ce8baed5f))


### Features

* **flow:** support failed children in getFlow and getDependencies methods ([#3243](https://github.com/taskforcesh/bullmq/issues/3243)) ([d3b1cff](https://github.com/taskforcesh/bullmq/commit/d3b1cff4cf02aad8ae0812b1d465316a067118d0))

## [5.51.1](https://github.com/taskforcesh/bullmq/compare/v5.51.0...v5.51.1) (2025-04-26)


### Bug Fixes

* **queue-events:** omit telemetry options ([#3239](https://github.com/taskforcesh/bullmq/issues/3239)) ([e4dac2c](https://github.com/taskforcesh/bullmq/commit/e4dac2c39fac0c8cce34fbcb98a0c72c1619ed4e))

# [5.51.0](https://github.com/taskforcesh/bullmq/compare/v5.50.0...v5.51.0) (2025-04-25)


### Bug Fixes

* **job-scheduler:** remove next delayed job if present even if scheduler does not exist ([#3203](https://github.com/taskforcesh/bullmq/issues/3203)) ref [#3197](https://github.com/taskforcesh/bullmq/issues/3197) ([61395bf](https://github.com/taskforcesh/bullmq/commit/61395bf0b2fc656d1cdaf094fc62a03920ebe07d))


### Features

* **flow:** support ignored children in getFlow and getDependencies methods ([#3238](https://github.com/taskforcesh/bullmq/issues/3238)) ref [#3213](https://github.com/taskforcesh/bullmq/issues/3213) ([2927803](https://github.com/taskforcesh/bullmq/commit/2927803b4b1eaddb77d3690634beb9c071b5adf7))

# [5.50.0](https://github.com/taskforcesh/bullmq/compare/v5.49.2...v5.50.0) (2025-04-25)


### Bug Fixes

* **deduplication:** remove deduplication key only when jobId matches with the last one being saved ([#3236](https://github.com/taskforcesh/bullmq/issues/3236)) ([192e82c](https://github.com/taskforcesh/bullmq/commit/192e82caa0f7f530ed495740ec2ade37fe89b43b))


### Features

* **queue:** add getIgnoredChildrenFailures method ([#3194](https://github.com/taskforcesh/bullmq/issues/3194)) ([4affb11](https://github.com/taskforcesh/bullmq/commit/4affb11be26afad9f867db19a210c361ba64dd4b))

## [5.49.2](https://github.com/taskforcesh/bullmq/compare/v5.49.1...v5.49.2) (2025-04-21)


### Performance Improvements

* **flow:** change parent failure in a lazy way ([#3228](https://github.com/taskforcesh/bullmq/issues/3228)) ([6b37a37](https://github.com/taskforcesh/bullmq/commit/6b37a379cc65abe7b4c60ba427065957c9080a08))

## [5.49.1](https://github.com/taskforcesh/bullmq/compare/v5.49.0...v5.49.1) (2025-04-17)


### Bug Fixes

* **flow-producer:** use FlowProducer prefix by default when calling getFlow ([#3224](https://github.com/taskforcesh/bullmq/issues/3224)) ([bd17aad](https://github.com/taskforcesh/bullmq/commit/bd17aad64ec73917548e1bb45ee611b799363cc0))

# [5.49.0](https://github.com/taskforcesh/bullmq/compare/v5.48.1...v5.49.0) (2025-04-16)


### Features

* **job:** expose stalledCounter attribute ([#3218](https://github.com/taskforcesh/bullmq/issues/3218)) ([9456472](https://github.com/taskforcesh/bullmq/commit/94564724593699d13bc0ac238e23c13737edbbf2))

## [5.48.1](https://github.com/taskforcesh/bullmq/compare/v5.48.0...v5.48.1) (2025-04-10)


### Bug Fixes

* made line split more compatible ([#3208](https://github.com/taskforcesh/bullmq/issues/3208)) ([3c2349a](https://github.com/taskforcesh/bullmq/commit/3c2349a2936d0c59cfa8d136585a0c0156de3212)), closes [#3204](https://github.com/taskforcesh/bullmq/issues/3204)

# [5.48.0](https://github.com/taskforcesh/bullmq/compare/v5.47.3...v5.48.0) (2025-04-08)


### Features

* add removeUnprocessedChildren ([#3190](https://github.com/taskforcesh/bullmq/issues/3190)) ([4b96266](https://github.com/taskforcesh/bullmq/commit/4b96266d4a7e2fe4b1b3eba12e9e7cc5a64fc044))

## [5.47.3](https://github.com/taskforcesh/bullmq/compare/v5.47.2...v5.47.3) (2025-04-08)


### Bug Fixes

* **job-scheduler:** fix endDate presence validation ([#3195](https://github.com/taskforcesh/bullmq/issues/3195)) ([339f13e](https://github.com/taskforcesh/bullmq/commit/339f13e277c7c087adc9023f5a433d9a21c661a2))

## [5.47.2](https://github.com/taskforcesh/bullmq/compare/v5.47.1...v5.47.2) (2025-04-06)


### Bug Fixes

* **flow:** remove job from dependencies when failParentOnFailure or continueParentOnFailure ([#3201](https://github.com/taskforcesh/bullmq/issues/3201)) ([1fbcbec](https://github.com/taskforcesh/bullmq/commit/1fbcbec56969fc4aa628f77e4b05d2c6844894ae))

## [5.47.1](https://github.com/taskforcesh/bullmq/compare/v5.47.0...v5.47.1) (2025-04-05)


### Bug Fixes

* **flow-producer:** fix queueName otel attribute when passing it to addNode ([#3198](https://github.com/taskforcesh/bullmq/issues/3198)) ([758ea26](https://github.com/taskforcesh/bullmq/commit/758ea2647b3dad683796351919b0380172fa717f))

# [5.47.0](https://github.com/taskforcesh/bullmq/compare/v5.46.1...v5.47.0) (2025-04-04)


### Features

* **flows:** add continueParentOnFailure option ([#3181](https://github.com/taskforcesh/bullmq/issues/3181)) ([738d375](https://github.com/taskforcesh/bullmq/commit/738d3752934746a347fd04e59e9dcd4726777508))

## [5.46.1](https://github.com/taskforcesh/bullmq/compare/v5.46.0...v5.46.1) (2025-04-03)


### Bug Fixes

* **queue-events:** pass right path for JobProgress type ([#3192](https://github.com/taskforcesh/bullmq/issues/3192)) fixes [#3191](https://github.com/taskforcesh/bullmq/issues/3191) ([33c62e6](https://github.com/taskforcesh/bullmq/commit/33c62e67268daf24d92653abb5b857ac2241b3aa))

# [5.46.0](https://github.com/taskforcesh/bullmq/compare/v5.45.2...v5.46.0) (2025-04-02)


### Features

* **updateProgress:** allow more types to be used as progress ([#3187](https://github.com/taskforcesh/bullmq/issues/3187)) ([f16b748](https://github.com/taskforcesh/bullmq/commit/f16b748d7e3af2535ccdc54e12500af74874a235))

## [5.45.2](https://github.com/taskforcesh/bullmq/compare/v5.45.1...v5.45.2) (2025-03-29)


### Bug Fixes

* **flow:** validate pending dependencies before removing lock ([#3182](https://github.com/taskforcesh/bullmq/issues/3182)) ([8d59e3b](https://github.com/taskforcesh/bullmq/commit/8d59e3b8084c60afad16372b4f7fc22f1b9d3f4e))

## [5.45.1](https://github.com/taskforcesh/bullmq/compare/v5.45.0...v5.45.1) (2025-03-29)


### Bug Fixes

* **job-scheduler:** emit duplicated event when next delayed job exists ([#3172](https://github.com/taskforcesh/bullmq/issues/3172)) ([d57698f](https://github.com/taskforcesh/bullmq/commit/d57698f9af64fd1bb85f571f22b7fd663c3e05ee))

# [5.45.0](https://github.com/taskforcesh/bullmq/compare/v5.44.4...v5.45.0) (2025-03-27)


### Features

* add deduplicated job id to the deduplicated event ([0f21c10](https://github.com/taskforcesh/bullmq/commit/0f21c10bc9fd9a2290e8dde3c9b43bc366fcb15a))

## [5.44.4](https://github.com/taskforcesh/bullmq/compare/v5.44.3...v5.44.4) (2025-03-24)


### Bug Fixes

* **scheduler:** remove next delayed job when possible ([#3153](https://github.com/taskforcesh/bullmq/issues/3153)) ([219c0db](https://github.com/taskforcesh/bullmq/commit/219c0dba7180143b19b4a21dc96db45af941ca7d))

## [5.44.3](https://github.com/taskforcesh/bullmq/compare/v5.44.2...v5.44.3) (2025-03-22)


### Bug Fixes

* **flow:** only validate pending dependencies when moving to completed ([#3164](https://github.com/taskforcesh/bullmq/issues/3164)) ([d3c397f](https://github.com/taskforcesh/bullmq/commit/d3c397fa3f122287026018aaae5ed2c5dfad19aa))

## [5.44.2](https://github.com/taskforcesh/bullmq/compare/v5.44.1...v5.44.2) (2025-03-22)


### Performance Improvements

* **flow:** validate parentKey existence before trying to move it to failed ([#3163](https://github.com/taskforcesh/bullmq/issues/3163)) ([5a88e47](https://github.com/taskforcesh/bullmq/commit/5a88e4745d9449e41c5e2c467b5d02ca21357703))

## [5.44.1](https://github.com/taskforcesh/bullmq/compare/v5.44.0...v5.44.1) (2025-03-21)


### Bug Fixes

* **flow:** consider prioritized state when moving a parent to failed ([#3160](https://github.com/taskforcesh/bullmq/issues/3160)) ([d91d9f4](https://github.com/taskforcesh/bullmq/commit/d91d9f4398584506f5af8b46e4d47b769beaa212))

# [5.44.0](https://github.com/taskforcesh/bullmq/compare/v5.43.1...v5.44.0) (2025-03-18)


### Features

* **prometheus export:** expose global variables ([0325a39](https://github.com/taskforcesh/bullmq/commit/0325a39f4243f3bea682bcfc20dc43b62d3f9fd9))

## [5.43.1](https://github.com/taskforcesh/bullmq/compare/v5.43.0...v5.43.1) (2025-03-15)


### Bug Fixes

* **job-scheduler:** add marker when upserting job scheduler if needed ([#3145](https://github.com/taskforcesh/bullmq/issues/3145)) ([0e137b2](https://github.com/taskforcesh/bullmq/commit/0e137b2e78882b6206b3fa47d4a6babb4fcfc484))

# [5.43.0](https://github.com/taskforcesh/bullmq/compare/v5.42.0...v5.43.0) (2025-03-13)


### Features

* **job:** support ignored and failed counts in getDependenciesCount ([#3137](https://github.com/taskforcesh/bullmq/issues/3137)) ref [#3136](https://github.com/taskforcesh/bullmq/issues/3136) ([83953db](https://github.com/taskforcesh/bullmq/commit/83953db54cad80e4ec0a7659f41cb5bc086ccacf))

# [5.42.0](https://github.com/taskforcesh/bullmq/compare/v5.41.9...v5.42.0) (2025-03-12)


### Bug Fixes

* **flow:** consider to fail a parent not in waiting-children when failParentOnFailure is provided ([#3098](https://github.com/taskforcesh/bullmq/issues/3098)) ([589adb4](https://github.com/taskforcesh/bullmq/commit/589adb4f89bcb7d7721200333c2d605eb6ba7864))
* **job-scheduler:** restore iterationCount attribute ([#3134](https://github.com/taskforcesh/bullmq/issues/3134)) ([eec7114](https://github.com/taskforcesh/bullmq/commit/eec711468de39ec10da9206d7f8c5ad1eb0df882))


### Features

* **job:** add complete span in moveToCompleted method ([#3132](https://github.com/taskforcesh/bullmq/issues/3132)) ([c37123c](https://github.com/taskforcesh/bullmq/commit/c37123cc84632328d8c4e251641688eb36ac1a8a))


### Performance Improvements

* **worker:** optimize job retrieval for failed jobs in chunks ([#3127](https://github.com/taskforcesh/bullmq/issues/3127)) ([e0f02ce](https://github.com/taskforcesh/bullmq/commit/e0f02ceb00ced5ca00a6c73d96801a040c40d958))

## [5.41.9](https://github.com/taskforcesh/bullmq/compare/v5.41.8...v5.41.9) (2025-03-11)


### Bug Fixes

* **scheduler:** remove multi when updating a job scheduler ([#3108](https://github.com/taskforcesh/bullmq/issues/3108)) ([4b619ca](https://github.com/taskforcesh/bullmq/commit/4b619cab9a6bf8d25efec83dcdf0adaaa362e12a))

## [5.41.8](https://github.com/taskforcesh/bullmq/compare/v5.41.7...v5.41.8) (2025-03-08)


### Bug Fixes

* **job:** deserialize priority in fromJSON ([#3126](https://github.com/taskforcesh/bullmq/issues/3126)) ([c3269b1](https://github.com/taskforcesh/bullmq/commit/c3269b11e2def4e2acd4eafc02ce7958a8fcf63e))
* **worker:** cast delay_until to integer [python] ([#3116](https://github.com/taskforcesh/bullmq/issues/3116)) ([db617e4](https://github.com/taskforcesh/bullmq/commit/db617e48ef1dd52446bfd73e15f24957df2ca315))

## [5.41.7](https://github.com/taskforcesh/bullmq/compare/v5.41.6...v5.41.7) (2025-02-27)


### Bug Fixes

* **scheduler:** validate repeatKey if present when cleaning failed jobs ([#3115](https://github.com/taskforcesh/bullmq/issues/3115)) fixes [#3114](https://github.com/taskforcesh/bullmq/issues/3114) ([d4cad84](https://github.com/taskforcesh/bullmq/commit/d4cad8402628f1773299c9cf33e6cc6a0e694037))

## [5.41.6](https://github.com/taskforcesh/bullmq/compare/v5.41.5...v5.41.6) (2025-02-26)


### Bug Fixes

* **flow:** consider delayed state when moving a parent to failed ([#3112](https://github.com/taskforcesh/bullmq/issues/3112)) ([6a28b86](https://github.com/taskforcesh/bullmq/commit/6a28b861346a3efa89574a78b396954d6c4ed113))
* **telemetry:** fix span name for moveToFailed logic ([#3113](https://github.com/taskforcesh/bullmq/issues/3113)) ([7a4b500](https://github.com/taskforcesh/bullmq/commit/7a4b500dc63320807e051d8efd2b8fee07bb0db5))

## [5.41.5](https://github.com/taskforcesh/bullmq/compare/v5.41.4...v5.41.5) (2025-02-21)


### Bug Fixes

* **job-scheduler:** consider removing current job from wait, paused or prioritized ([#3066](https://github.com/taskforcesh/bullmq/issues/3066)) ([97cd2b1](https://github.com/taskforcesh/bullmq/commit/97cd2b147d541e0984d1c2e107110e1a9d56d9b5))

## [5.41.4](https://github.com/taskforcesh/bullmq/compare/v5.41.3...v5.41.4) (2025-02-21)


### Performance Improvements

* **delayed:** add marker once when promoting delayed jobs ([#3096](https://github.com/taskforcesh/bullmq/issues/3096)) (python) ([38912fb](https://github.com/taskforcesh/bullmq/commit/38912fba969d614eb44d05517ba2ec8bc418a16e))

## [5.41.3](https://github.com/taskforcesh/bullmq/compare/v5.41.2...v5.41.3) (2025-02-19)


### Bug Fixes

* **worker:** do not execute run method when no processor is defined when resuming ([#3089](https://github.com/taskforcesh/bullmq/issues/3089)) ([4a66933](https://github.com/taskforcesh/bullmq/commit/4a66933496db68a84ec7eb7c153fcedb7bd14c7b))

## [5.41.2](https://github.com/taskforcesh/bullmq/compare/v5.41.1...v5.41.2) (2025-02-16)


### Bug Fixes

* **worker:** do not resume when closing ([#3080](https://github.com/taskforcesh/bullmq/issues/3080)) ([024ee0f](https://github.com/taskforcesh/bullmq/commit/024ee0f3f0e808c256712d3ccb1bcadb025eb931))

## [5.41.1](https://github.com/taskforcesh/bullmq/compare/v5.41.0...v5.41.1) (2025-02-15)


### Bug Fixes

* **job:** set processedBy when moving job to active in moveToFinished ([#3077](https://github.com/taskforcesh/bullmq/issues/3077)) fixes [#3073](https://github.com/taskforcesh/bullmq/issues/3073) ([1aa970c](https://github.com/taskforcesh/bullmq/commit/1aa970ced3c55949aea6726c4ad29531089f5370))

# [5.41.0](https://github.com/taskforcesh/bullmq/compare/v5.40.5...v5.41.0) (2025-02-14)


### Features

* **job:** add moveToWait method for manual processing ([#2978](https://github.com/taskforcesh/bullmq/issues/2978)) ([5a97491](https://github.com/taskforcesh/bullmq/commit/5a97491a0319df320b7858657e03c357284e0108))
* **queue:** support removeGlobalConcurrency method ([#3076](https://github.com/taskforcesh/bullmq/issues/3076)) ([ece8532](https://github.com/taskforcesh/bullmq/commit/ece853203adb420466dfaf3ff8bccc73fb917147))


### Performance Improvements

* **add-job:** add job into wait or prioritized state when delay is provided as 0 ([#3052](https://github.com/taskforcesh/bullmq/issues/3052)) ([3e990eb](https://github.com/taskforcesh/bullmq/commit/3e990eb742b3a12065110f33135f282711fdd7b9))

## [5.40.5](https://github.com/taskforcesh/bullmq/compare/v5.40.4...v5.40.5) (2025-02-14)


### Bug Fixes

* **drain:** pass delayed key for redis cluster ([#3074](https://github.com/taskforcesh/bullmq/issues/3074)) ([05ea32b](https://github.com/taskforcesh/bullmq/commit/05ea32b7e4f0cd4099783fd81d2b3214d7a293d5))

## [5.40.4](https://github.com/taskforcesh/bullmq/compare/v5.40.3...v5.40.4) (2025-02-13)


### Bug Fixes

* **job-scheduler:** restore limit option to be saved ([#3071](https://github.com/taskforcesh/bullmq/issues/3071)) ([3e649f7](https://github.com/taskforcesh/bullmq/commit/3e649f7399514b343447ed2073cc07e4661f7390))

## [5.40.3](https://github.com/taskforcesh/bullmq/compare/v5.40.2...v5.40.3) (2025-02-12)


### Bug Fixes

* **job-scheduler:** return undefined in getJobScheduler when it does not exist ([#3065](https://github.com/taskforcesh/bullmq/issues/3065)) fixes [#3062](https://github.com/taskforcesh/bullmq/issues/3062) ([548cc1c](https://github.com/taskforcesh/bullmq/commit/548cc1ce8080042b4b44009ea99108bd24193895))

## [5.40.2](https://github.com/taskforcesh/bullmq/compare/v5.40.1...v5.40.2) (2025-02-07)


### Bug Fixes

* fix return type of getNextJob ([b970281](https://github.com/taskforcesh/bullmq/commit/b9702812e6961f0f5a834f66d43cfb2feabaafd8))

## [5.40.1](https://github.com/taskforcesh/bullmq/compare/v5.40.0...v5.40.1) (2025-02-07)


### Bug Fixes

* **worker:** wait fetched jobs to be processed when closing ([#3059](https://github.com/taskforcesh/bullmq/issues/3059)) ([d4de2f5](https://github.com/taskforcesh/bullmq/commit/d4de2f5e88d57ea00274e62ab23d09f4806196f8))

# [5.40.0](https://github.com/taskforcesh/bullmq/compare/v5.39.2...v5.40.0) (2025-02-02)


### Features

* **job-scheduler:** revert add delayed job and update in the same script ([9f0f1ba](https://github.com/taskforcesh/bullmq/commit/9f0f1ba9b17874a757ac38c1878792c0df3c5a9a))

## [5.39.2](https://github.com/taskforcesh/bullmq/compare/v5.39.1...v5.39.2) (2025-02-02)


### Bug Fixes

* **worker:** evaluate if a job needs to be fetched when moving to failed ([#3043](https://github.com/taskforcesh/bullmq/issues/3043)) ([406e21c](https://github.com/taskforcesh/bullmq/commit/406e21c9aadd7670f353c1c6b102a401fc327653))

## [5.39.1](https://github.com/taskforcesh/bullmq/compare/v5.39.0...v5.39.1) (2025-01-30)


### Bug Fixes

* **retry-job:** consider updating failures in job ([#3036](https://github.com/taskforcesh/bullmq/issues/3036)) ([21e8495](https://github.com/taskforcesh/bullmq/commit/21e8495b5f2bf5418d86f60b59fad25d306a0298))

# [5.39.0](https://github.com/taskforcesh/bullmq/compare/v5.38.0...v5.39.0) (2025-01-29)


### Features

* **job-scheduler:** save limit option ([#3033](https://github.com/taskforcesh/bullmq/issues/3033)) ([a1571ea](https://github.com/taskforcesh/bullmq/commit/a1571ea03be6c6c41794fa272c38c29588351bbf))

# [5.38.0](https://github.com/taskforcesh/bullmq/compare/v5.37.0...v5.38.0) (2025-01-28)


### Bug Fixes

* **flow-producer:** add support for skipWaitingForReady ([6d829fc](https://github.com/taskforcesh/bullmq/commit/6d829fceda9f204f193c533ffc780962692b8f16))


### Features

* **queue:** add option to skip wait until connection ready ([e728299](https://github.com/taskforcesh/bullmq/commit/e72829922d4234b92290346dce5d33f5b98ee373))

# [5.37.0](https://github.com/taskforcesh/bullmq/compare/v5.36.0...v5.37.0) (2025-01-25)


### Features

* **queue-getters:** add prometheus exporter ([078ae9d](https://github.com/taskforcesh/bullmq/commit/078ae9db80f6ca64ff0a8135b57a6dc71d71cb1e))

# [5.36.0](https://github.com/taskforcesh/bullmq/compare/v5.35.1...v5.36.0) (2025-01-24)


### Features

* **job-scheduler:** save iteration count ([#3018](https://github.com/taskforcesh/bullmq/issues/3018)) ([ad5c07c](https://github.com/taskforcesh/bullmq/commit/ad5c07cc7672a3f7a7185310b1250763a5fef76b))

## [5.35.1](https://github.com/taskforcesh/bullmq/compare/v5.35.0...v5.35.1) (2025-01-23)


### Bug Fixes

* **worker:** avoid possible hazard in closing worker ([0f07467](https://github.com/taskforcesh/bullmq/commit/0f0746727176d7ff285ae2d1f35048109b4574c5))

# [5.35.0](https://github.com/taskforcesh/bullmq/compare/v5.34.10...v5.35.0) (2025-01-22)


### Features

* **sandbox:** add support for getChildrenValues ([dcc3b06](https://github.com/taskforcesh/bullmq/commit/dcc3b0628f992546d7b93f509795e5d4eb3e1b15))

## [5.34.10](https://github.com/taskforcesh/bullmq/compare/v5.34.9...v5.34.10) (2025-01-14)


### Bug Fixes

* **job-scheduler:** use delayed job data when template data is not present ([#3010](https://github.com/taskforcesh/bullmq/issues/3010)) fixes [#3009](https://github.com/taskforcesh/bullmq/issues/3009) ([95edb40](https://github.com/taskforcesh/bullmq/commit/95edb4008fcd32f09ec0953d862692d4ac7608c0))

## [5.34.9](https://github.com/taskforcesh/bullmq/compare/v5.34.8...v5.34.9) (2025-01-12)


### Bug Fixes

* **job-scheduler:** add next delayed job only when prevMillis matches with producerId ([#3001](https://github.com/taskforcesh/bullmq/issues/3001)) ([4ea35dd](https://github.com/taskforcesh/bullmq/commit/4ea35dd9e16ff0197f204210696f41c0c5bd0e30))

## [5.34.8](https://github.com/taskforcesh/bullmq/compare/v5.34.7...v5.34.8) (2025-01-08)


### Performance Improvements

* **job-scheduler:** add delayed job and update scheduler in same script ([#2997](https://github.com/taskforcesh/bullmq/issues/2997)) ([9be28a0](https://github.com/taskforcesh/bullmq/commit/9be28a0c4a907798a447d02ca50662c12333dd82))

## [5.34.7](https://github.com/taskforcesh/bullmq/compare/v5.34.6...v5.34.7) (2025-01-06)


### Performance Improvements

* **job-scheduler:** add delayed job and scheduler in same script ([#2993](https://github.com/taskforcesh/bullmq/issues/2993)) ([95718e8](https://github.com/taskforcesh/bullmq/commit/95718e888ba64b4071f21bbe0823b55a51ab145c))

## [5.34.6](https://github.com/taskforcesh/bullmq/compare/v5.34.5...v5.34.6) (2024-12-31)


### Bug Fixes

* **job-scheduler:** avoid duplicates when upserting in a quick sequence ([#2991](https://github.com/taskforcesh/bullmq/issues/2991)) ([e8cdb99](https://github.com/taskforcesh/bullmq/commit/e8cdb99881bc7cebbc48cb7834da5eafa289712f))

## [5.34.5](https://github.com/taskforcesh/bullmq/compare/v5.34.4...v5.34.5) (2024-12-25)


### Bug Fixes

* **dynamic-rate-limit:** validate job lock cases ([#2975](https://github.com/taskforcesh/bullmq/issues/2975)) ([8bb27ea](https://github.com/taskforcesh/bullmq/commit/8bb27ea4438cbd11e85fa4d0aa516bd1c0e7d51b))

## [5.34.4](https://github.com/taskforcesh/bullmq/compare/v5.34.3...v5.34.4) (2024-12-21)


### Bug Fixes

* **sandbox:** fix issue where job could stay in active forever ([#2979](https://github.com/taskforcesh/bullmq/issues/2979)) ([c0a6bcd](https://github.com/taskforcesh/bullmq/commit/c0a6bcdf9594540ef6c8ec08df28550f4f5e1950))

## [5.34.3](https://github.com/taskforcesh/bullmq/compare/v5.34.2...v5.34.3) (2024-12-18)


### Bug Fixes

* **sandboxed:** fix detecting special errors by sending default messages ([#2967](https://github.com/taskforcesh/bullmq/issues/2967)) fixes [#2962](https://github.com/taskforcesh/bullmq/issues/2962) ([52b0e34](https://github.com/taskforcesh/bullmq/commit/52b0e34f0a38ac71ebd0667a5fa116ecd73ae4d2))

## [5.34.2](https://github.com/taskforcesh/bullmq/compare/v5.34.1...v5.34.2) (2024-12-14)


### Bug Fixes

* **scripts:** make sure jobs fields are not empty before unpack ([4360572](https://github.com/taskforcesh/bullmq/commit/4360572745a929c7c4f6266ec03d4eba77a9715c))

## [5.34.1](https://github.com/taskforcesh/bullmq/compare/v5.34.0...v5.34.1) (2024-12-13)


### Bug Fixes

* guarantee every repeatable jobs are slotted ([9917df1](https://github.com/taskforcesh/bullmq/commit/9917df166aff2e2f143c45297f41ac8520bfc8ae))
* **job-scheduler:** avoid duplicated delayed jobs when repeatable jobs are retried ([af75315](https://github.com/taskforcesh/bullmq/commit/af75315f0c7923f5e0a667a9ed4606b28b89b719))

# [5.34.0](https://github.com/taskforcesh/bullmq/compare/v5.33.1...v5.34.0) (2024-12-10)


### Features

* **telemetry:** add option to omit context propagation on jobs ([#2946](https://github.com/taskforcesh/bullmq/issues/2946)) ([6514c33](https://github.com/taskforcesh/bullmq/commit/6514c335231cb6e727819cf5e0c56ed3f5132838))

## [5.33.1](https://github.com/taskforcesh/bullmq/compare/v5.33.0...v5.33.1) (2024-12-10)


### Bug Fixes

* **job-scheduler:** omit deduplication and debounce options from template options ([#2960](https://github.com/taskforcesh/bullmq/issues/2960)) ([b5fa6a3](https://github.com/taskforcesh/bullmq/commit/b5fa6a3208a8f2a39777dc30c2db2f498addb907))

# [5.33.0](https://github.com/taskforcesh/bullmq/compare/v5.32.0...v5.33.0) (2024-12-09)


### Features

* replace multi by lua scripts in moveToFailed ([#2958](https://github.com/taskforcesh/bullmq/issues/2958)) ([c19c914](https://github.com/taskforcesh/bullmq/commit/c19c914969169c660a3e108126044c5152faf0cd))

# [5.32.0](https://github.com/taskforcesh/bullmq/compare/v5.31.2...v5.32.0) (2024-12-08)


### Features

* **queue:** enhance getJobSchedulers method to include template information ([#2956](https://github.com/taskforcesh/bullmq/issues/2956)) ref [#2875](https://github.com/taskforcesh/bullmq/issues/2875) ([5b005cd](https://github.com/taskforcesh/bullmq/commit/5b005cd94ba0f98677bed4a44f8669c81f073f26))

## [5.31.2](https://github.com/taskforcesh/bullmq/compare/v5.31.1...v5.31.2) (2024-12-06)


### Bug Fixes

* **worker:** catch connection error when moveToActive is called ([#2952](https://github.com/taskforcesh/bullmq/issues/2952)) ([544fc7c](https://github.com/taskforcesh/bullmq/commit/544fc7c9e4755e6b62b82216e25c0cb62734ed59))

## [5.31.1](https://github.com/taskforcesh/bullmq/compare/v5.31.0...v5.31.1) (2024-12-04)


### Bug Fixes

* **scheduler-template:** remove console.log when getting template information ([#2950](https://github.com/taskforcesh/bullmq/issues/2950)) ([3402bfe](https://github.com/taskforcesh/bullmq/commit/3402bfe0d01e5e5205db74d2106cd19d7df53fcb))

# [5.31.0](https://github.com/taskforcesh/bullmq/compare/v5.30.1...v5.31.0) (2024-12-02)


### Features

* **queue:** enhance getJobScheduler method to include template information ([#2929](https://github.com/taskforcesh/bullmq/issues/2929)) ref [#2875](https://github.com/taskforcesh/bullmq/issues/2875) ([cb99080](https://github.com/taskforcesh/bullmq/commit/cb990808db19dd79b5048ee99308fa7d1eaa2e9f))

## [5.30.1](https://github.com/taskforcesh/bullmq/compare/v5.30.0...v5.30.1) (2024-11-30)


### Bug Fixes

* **flow:** allow using removeOnFail and failParentOnFailure in parents ([#2947](https://github.com/taskforcesh/bullmq/issues/2947)) fixes [#2229](https://github.com/taskforcesh/bullmq/issues/2229) ([85f6f6f](https://github.com/taskforcesh/bullmq/commit/85f6f6f181003fafbf75304a268170f0d271ccc3))

# [5.30.0](https://github.com/taskforcesh/bullmq/compare/v5.29.1...v5.30.0) (2024-11-29)


### Bug Fixes

* **job-scheduler:** upsert template when same pattern options are provided ([#2943](https://github.com/taskforcesh/bullmq/issues/2943)) ref [#2940](https://github.com/taskforcesh/bullmq/issues/2940) ([b56c3b4](https://github.com/taskforcesh/bullmq/commit/b56c3b45a87e52f5faf25406a2b992d1bfed4900))


### Features

* **queue:** add getJobSchedulersCount method ([#2945](https://github.com/taskforcesh/bullmq/issues/2945)) ([38820dc](https://github.com/taskforcesh/bullmq/commit/38820dc8c267c616ada9931198e9e3e9d2f0d536))

## [5.29.1](https://github.com/taskforcesh/bullmq/compare/v5.29.0...v5.29.1) (2024-11-23)


### Bug Fixes

* **scheduler:** remove deprecation warning on immediately option ([#2923](https://github.com/taskforcesh/bullmq/issues/2923)) ([14ca7f4](https://github.com/taskforcesh/bullmq/commit/14ca7f44f31a393a8b6d0ce4ed244e0063198879))

# [5.29.0](https://github.com/taskforcesh/bullmq/compare/v5.28.2...v5.29.0) (2024-11-22)


### Features

* **queue:** refactor a protected addJob method allowing telemetry extensions ([09f2571](https://github.com/taskforcesh/bullmq/commit/09f257196f6d5a6690edbf55f12d585cec86ee8f))

## [5.28.2](https://github.com/taskforcesh/bullmq/compare/v5.28.1...v5.28.2) (2024-11-22)


### Bug Fixes

* **queue:** change _jobScheduler from private to protected for extension ([#2920](https://github.com/taskforcesh/bullmq/issues/2920)) ([34c2348](https://github.com/taskforcesh/bullmq/commit/34c23485bcb32b3c69046b2fb37e5db8927561ce))

## [5.28.1](https://github.com/taskforcesh/bullmq/compare/v5.28.0...v5.28.1) (2024-11-20)


### Bug Fixes

* **scheduler:** use Job class from getter for extension ([#2917](https://github.com/taskforcesh/bullmq/issues/2917)) ([5fbb075](https://github.com/taskforcesh/bullmq/commit/5fbb075dd4abd51cc84a59575261de84e56633d8))

# [5.28.0](https://github.com/taskforcesh/bullmq/compare/v5.27.0...v5.28.0) (2024-11-19)


### Features

* **job-scheduler:** add telemetry support to the job scheduler ([72ea950](https://github.com/taskforcesh/bullmq/commit/72ea950ea251aa12f879ba19c0b5dfeb6a093da2))

# [5.27.0](https://github.com/taskforcesh/bullmq/compare/v5.26.2...v5.27.0) (2024-11-19)


### Features

* **queue:** add rateLimit method ([#2896](https://github.com/taskforcesh/bullmq/issues/2896)) ([db84ad5](https://github.com/taskforcesh/bullmq/commit/db84ad51a945c754c3cd03e5e718cd8d0341a8b4))
* **queue:** add removeRateLimitKey method ([#2806](https://github.com/taskforcesh/bullmq/issues/2806)) ([ff70613](https://github.com/taskforcesh/bullmq/commit/ff706131bf642fb7544b9d15994d75b1edcb27dc))


### Performance Improvements

* **marker:** add base markers while consuming jobs to get workers busy ([#2904](https://github.com/taskforcesh/bullmq/issues/2904)) fixes [#2842](https://github.com/taskforcesh/bullmq/issues/2842) ([1759c8b](https://github.com/taskforcesh/bullmq/commit/1759c8bc111cab9e43d5fccb4d8d2dccc9c39fb4))

## [5.26.2](https://github.com/taskforcesh/bullmq/compare/v5.26.1...v5.26.2) (2024-11-15)


### Bug Fixes

* **telemetry:** do not set span on parent context if undefined ([c417a23](https://github.com/taskforcesh/bullmq/commit/c417a23bb28d9effa42115e954b18cc41c1fc043))

## [5.26.1](https://github.com/taskforcesh/bullmq/compare/v5.26.0...v5.26.1) (2024-11-14)


### Bug Fixes

* **queue:** fix generics to be able to properly be extended ([f2495e5](https://github.com/taskforcesh/bullmq/commit/f2495e5ee9ecdb26492da510dc38730718cb28c5))

# [5.26.0](https://github.com/taskforcesh/bullmq/compare/v5.25.6...v5.26.0) (2024-11-14)


### Features

* improve queue getters to use generic job type ([#2905](https://github.com/taskforcesh/bullmq/issues/2905)) ([c9531ec](https://github.com/taskforcesh/bullmq/commit/c9531ec7a49126a017611eb2fd2eaea8fcb5ada5))

## [5.25.6](https://github.com/taskforcesh/bullmq/compare/v5.25.5...v5.25.6) (2024-11-11)


### Bug Fixes

* **job-scheculer:** avoid hazards when upserting job schedulers concurrently ([022f7b7](https://github.com/taskforcesh/bullmq/commit/022f7b7d0a0ce14387ed2b9fed791e1f56e34770))

## [5.25.5](https://github.com/taskforcesh/bullmq/compare/v5.25.4...v5.25.5) (2024-11-11)


### Bug Fixes

* **connection:** do not allow to set blockingConnection option ([#2851](https://github.com/taskforcesh/bullmq/issues/2851)) ([9391cc2](https://github.com/taskforcesh/bullmq/commit/9391cc22200914ecc8958972ebc580862a70f63c))

## [5.25.4](https://github.com/taskforcesh/bullmq/compare/v5.25.3...v5.25.4) (2024-11-10)


### Bug Fixes

* **repeatable:** only apply immediately in the first iteration ([f69cfbc](https://github.com/taskforcesh/bullmq/commit/f69cfbcbc5516a854adbbc29b259d08e65a19705))

## [5.25.3](https://github.com/taskforcesh/bullmq/compare/v5.25.2...v5.25.3) (2024-11-08)


### Bug Fixes

* **scripts:** set package version by default for extension ([#2887](https://github.com/taskforcesh/bullmq/issues/2887)) ([b955340](https://github.com/taskforcesh/bullmq/commit/b955340b940e4c1e330445526cd572e0ab25daa9))

## [5.25.2](https://github.com/taskforcesh/bullmq/compare/v5.25.1...v5.25.2) (2024-11-08)


### Bug Fixes

* **worker:** allow retrieving concurrency value ([#2883](https://github.com/taskforcesh/bullmq/issues/2883)) fixes [#2880](https://github.com/taskforcesh/bullmq/issues/2880) ([52f6317](https://github.com/taskforcesh/bullmq/commit/52f6317ecd2080a5c9684a4fe384e20d86f21de4))

## [5.25.1](https://github.com/taskforcesh/bullmq/compare/v5.25.0...v5.25.1) (2024-11-07)


### Bug Fixes

* **connection:** set packageVersion as protected attribute for extension ([#2884](https://github.com/taskforcesh/bullmq/issues/2884)) ([411ccae](https://github.com/taskforcesh/bullmq/commit/411ccae9419e008d916be6cf71c4d57dd2a07b2b))

# [5.25.0](https://github.com/taskforcesh/bullmq/compare/v5.24.0...v5.25.0) (2024-11-06)


### Features

* **queue-events:** add QueueEventsProducer for publishing custom events ([#2844](https://github.com/taskforcesh/bullmq/issues/2844)) ([5eb03cd](https://github.com/taskforcesh/bullmq/commit/5eb03cd7f27027191eb4bc4ed7386755fd9be1fb))

# [5.24.0](https://github.com/taskforcesh/bullmq/compare/v5.23.1...v5.24.0) (2024-11-05)


### Features

* **flows:** add telemetry support ([#2879](https://github.com/taskforcesh/bullmq/issues/2879)) ([5ed154b](https://github.com/taskforcesh/bullmq/commit/5ed154ba240dbe9eb5c22e27ad02e851c0f3cf69))

## [5.23.1](https://github.com/taskforcesh/bullmq/compare/v5.23.0...v5.23.1) (2024-11-05)


### Bug Fixes

* **deps:** bump msgpackr to 1.1.2 to resolve ERR_BUFFER_OUT_OF_BOUNDS error ([#2882](https://github.com/taskforcesh/bullmq/issues/2882)) ref [#2747](https://github.com/taskforcesh/bullmq/issues/2747) ([4d2136c](https://github.com/taskforcesh/bullmq/commit/4d2136cc6ba340e511a539c130c9a739fe1055d0))

# [5.23.0](https://github.com/taskforcesh/bullmq/compare/v5.22.0...v5.23.0) (2024-11-02)


### Features

* **scheduler:** add getJobScheduler method ([#2877](https://github.com/taskforcesh/bullmq/issues/2877)) ref [#2875](https://github.com/taskforcesh/bullmq/issues/2875) ([956d98c](https://github.com/taskforcesh/bullmq/commit/956d98c6890484742bb080919c70692234f28c69))

# [5.22.0](https://github.com/taskforcesh/bullmq/compare/v5.21.2...v5.22.0) (2024-10-31)


### Features

* **queue:** add a telemetry interface ([#2721](https://github.com/taskforcesh/bullmq/issues/2721)) ([273b574](https://github.com/taskforcesh/bullmq/commit/273b574e6b5628680990eb02e1930809c9cba5bb))

## [5.21.2](https://github.com/taskforcesh/bullmq/compare/v5.21.1...v5.21.2) (2024-10-22)


### Bug Fixes

* proper way to get version ([b4e25c1](https://github.com/taskforcesh/bullmq/commit/b4e25c13cafc001748ee6eb590133feb8ee24d7b))

## [5.21.1](https://github.com/taskforcesh/bullmq/compare/v5.21.0...v5.21.1) (2024-10-18)


### Bug Fixes

* **scripts:** add missing wait in isJobInList ([9ef865c](https://github.com/taskforcesh/bullmq/commit/9ef865c7de6086cb3c906721fd046aeed1e0d27f))

# [5.21.0](https://github.com/taskforcesh/bullmq/compare/v5.20.1...v5.21.0) (2024-10-18)


### Features

* **queue:** add option to skip metas update ([b7dd925](https://github.com/taskforcesh/bullmq/commit/b7dd925e7f2a4468c98a05f3a3ca1a476482b6c0))

## [5.20.1](https://github.com/taskforcesh/bullmq/compare/v5.20.0...v5.20.1) (2024-10-18)


### Bug Fixes

* **redis:** use version for naming loaded lua scripts ([fe73f6d](https://github.com/taskforcesh/bullmq/commit/fe73f6d4d776dc9f99ad3a094e5c59c5fafc96f1))

# [5.20.0](https://github.com/taskforcesh/bullmq/compare/v5.19.1...v5.20.0) (2024-10-13)


### Features

* **queue:** add queue version support ([#2822](https://github.com/taskforcesh/bullmq/issues/2822)) ([3a4781b](https://github.com/taskforcesh/bullmq/commit/3a4781bf7cadf04f6a324871654eed8f01cdadae))

## [5.19.1](https://github.com/taskforcesh/bullmq/compare/v5.19.0...v5.19.1) (2024-10-12)


### Bug Fixes

* **sandbox:** fix serialization of error with circular references are present ([#2815](https://github.com/taskforcesh/bullmq/issues/2815)) fix [#2813](https://github.com/taskforcesh/bullmq/issues/2813) ([a384d92](https://github.com/taskforcesh/bullmq/commit/a384d926bee15bffa84178a8fad7b94a6a08b572))

# [5.19.0](https://github.com/taskforcesh/bullmq/compare/v5.18.0...v5.19.0) (2024-10-11)


### Features

* **repeat:** deprecate immediately on job scheduler ([ed047f7](https://github.com/taskforcesh/bullmq/commit/ed047f7ab69ebdb445343b6cb325e90b95ee9dc5))

# [5.18.0](https://github.com/taskforcesh/bullmq/compare/v5.17.1...v5.18.0) (2024-10-09)


### Features

* **job:** expose priority value ([#2804](https://github.com/taskforcesh/bullmq/issues/2804)) ([9abec3d](https://github.com/taskforcesh/bullmq/commit/9abec3dbc4c69f2496c5ff6b5d724f4d1a5ca62f))

## [5.17.1](https://github.com/taskforcesh/bullmq/compare/v5.17.0...v5.17.1) (2024-10-07)


### Bug Fixes

* **repeat:** also consider startDate when using "every" ([25bbaa8](https://github.com/taskforcesh/bullmq/commit/25bbaa81af87f9944a64bc4fb7e0c76ef223ada4))

# [5.17.0](https://github.com/taskforcesh/bullmq/compare/v5.16.0...v5.17.0) (2024-10-07)


### Bug Fixes

* **sandbox:** catch exit errors ([#2800](https://github.com/taskforcesh/bullmq/issues/2800)) ([6babb9e](https://github.com/taskforcesh/bullmq/commit/6babb9e2f355feaf9bd1a8ed229c1001e6de7144))


### Features

* **job:** add deduplication logic ([#2796](https://github.com/taskforcesh/bullmq/issues/2796)) ([0a4982d](https://github.com/taskforcesh/bullmq/commit/0a4982d05d27c066248290ab9f59349b802d02d5))

# [5.16.0](https://github.com/taskforcesh/bullmq/compare/v5.15.0...v5.16.0) (2024-10-06)


### Features

* **queue:** add new upsertJobScheduler, getJobSchedulers and removeJobSchedulers methods ([dd6b6b2](https://github.com/taskforcesh/bullmq/commit/dd6b6b2263badd8f29db65d1fa6bcdf5a1e9f6e2))

# [5.15.0](https://github.com/taskforcesh/bullmq/compare/v5.14.0...v5.15.0) (2024-10-01)


### Features

* **worker-fork:** allow passing fork options ([#2795](https://github.com/taskforcesh/bullmq/issues/2795)) ([f7a4292](https://github.com/taskforcesh/bullmq/commit/f7a4292e064b41236f4489b3d7785a4c599a6435))

# [5.14.0](https://github.com/taskforcesh/bullmq/compare/v5.13.2...v5.14.0) (2024-09-30)


### Features

* **worker-thread:** allow passing Worker options ([#2791](https://github.com/taskforcesh/bullmq/issues/2791)) ref [#1555](https://github.com/taskforcesh/bullmq/issues/1555) ([6a1f7a9](https://github.com/taskforcesh/bullmq/commit/6a1f7a9f0303561d6ec7b2005ba0227132b89e07))

## [5.13.2](https://github.com/taskforcesh/bullmq/compare/v5.13.1...v5.13.2) (2024-09-20)


### Bug Fixes

* **repeatable:** avoid delayed job deletion if next job already existed ([#2778](https://github.com/taskforcesh/bullmq/issues/2778)) ([6a851c1](https://github.com/taskforcesh/bullmq/commit/6a851c1140b336f0e458b6dfe1022470ac41fceb))

## [5.13.1](https://github.com/taskforcesh/bullmq/compare/v5.13.0...v5.13.1) (2024-09-18)


### Bug Fixes

* **connection:** allow passing connection string into IORedis ([#2746](https://github.com/taskforcesh/bullmq/issues/2746)) ([73005e8](https://github.com/taskforcesh/bullmq/commit/73005e8583110f43914df879aef3481b42f3b3af))

# [5.13.0](https://github.com/taskforcesh/bullmq/compare/v5.12.15...v5.13.0) (2024-09-11)


### Features

* **queue:** add getDebounceJobId method ([#2717](https://github.com/taskforcesh/bullmq/issues/2717)) ([a68ead9](https://github.com/taskforcesh/bullmq/commit/a68ead95f32a7d9dabba602895d05c22794b2c02))

## [5.12.15](https://github.com/taskforcesh/bullmq/compare/v5.12.14...v5.12.15) (2024-09-10)


### Bug Fixes

* **metrics:** differentiate points in different minutes to be more accurate ([#2766](https://github.com/taskforcesh/bullmq/issues/2766)) (python) ([7cb670e](https://github.com/taskforcesh/bullmq/commit/7cb670e1bf9560a24de3da52427b4f6b6152a59a))
* **pattern:** do not save offset when immediately is provided ([#2756](https://github.com/taskforcesh/bullmq/issues/2756)) ([a8cb8a2](https://github.com/taskforcesh/bullmq/commit/a8cb8a21ea52437ac507097994ef0fde058c5433))

## [5.12.14](https://github.com/taskforcesh/bullmq/compare/v5.12.13...v5.12.14) (2024-09-05)


### Performance Improvements

* **metrics:** save zeros as much as max data points ([#2758](https://github.com/taskforcesh/bullmq/issues/2758)) ([3473054](https://github.com/taskforcesh/bullmq/commit/347305451a9f5d7f2c16733eb139b5de96ea4b9c))

## [5.12.13](https://github.com/taskforcesh/bullmq/compare/v5.12.12...v5.12.13) (2024-09-03)


### Bug Fixes

* **repeat:** replace delayed job when updating repeat key ([88029bb](https://github.com/taskforcesh/bullmq/commit/88029bbeab2a58768f9c438318f540010cd286a7))

## [5.12.12](https://github.com/taskforcesh/bullmq/compare/v5.12.11...v5.12.12) (2024-08-29)


### Bug Fixes

* **flows:** throw error when queueName contains colon ([#2719](https://github.com/taskforcesh/bullmq/issues/2719)) fixes [#2718](https://github.com/taskforcesh/bullmq/issues/2718) ([9ef97c3](https://github.com/taskforcesh/bullmq/commit/9ef97c37663e209f03c501a357b6b1a662b24d99))

## [5.12.11](https://github.com/taskforcesh/bullmq/compare/v5.12.10...v5.12.11) (2024-08-28)


### Bug Fixes

* **sandboxed:** properly update data on wrapped job ([#2739](https://github.com/taskforcesh/bullmq/issues/2739)) fixes [#2731](https://github.com/taskforcesh/bullmq/issues/2731) ([9c4b245](https://github.com/taskforcesh/bullmq/commit/9c4b2454025a14459de47b0586a09130d7a93cae))

## [5.12.10](https://github.com/taskforcesh/bullmq/compare/v5.12.9...v5.12.10) (2024-08-22)


### Bug Fixes

* **flow:** remove debounce key when parent is moved to fail ([#2720](https://github.com/taskforcesh/bullmq/issues/2720)) ([d51aabe](https://github.com/taskforcesh/bullmq/commit/d51aabe999a489c285f871d21e36c3c84e2bef33))

## [5.12.9](https://github.com/taskforcesh/bullmq/compare/v5.12.8...v5.12.9) (2024-08-17)


### Performance Improvements

* **fifo-queue:** use linked list structure for queue ([#2629](https://github.com/taskforcesh/bullmq/issues/2629)) ([df74578](https://github.com/taskforcesh/bullmq/commit/df7457844a769e5644eb11d31d1a05a9d5b4e084))

## [5.12.8](https://github.com/taskforcesh/bullmq/compare/v5.12.7...v5.12.8) (2024-08-17)


### Bug Fixes

* **flow:** recursive ignoreDependencyOnFailure option ([#2712](https://github.com/taskforcesh/bullmq/issues/2712)) ([53bc9eb](https://github.com/taskforcesh/bullmq/commit/53bc9eb68b5bb0a470a8fe64ef78ece5cde44632))

## [5.12.7](https://github.com/taskforcesh/bullmq/compare/v5.12.6...v5.12.7) (2024-08-16)


### Bug Fixes

* **job:** throw error if removeDependencyOnFailure and ignoreDependencyOnFailure are used together ([#2711](https://github.com/taskforcesh/bullmq/issues/2711)) ([967632c](https://github.com/taskforcesh/bullmq/commit/967632c9ef8468aab59f0b36d1d828bcde1fbd70))

## [5.12.6](https://github.com/taskforcesh/bullmq/compare/v5.12.5...v5.12.6) (2024-08-14)


### Bug Fixes

* **job:** change moveToFinished return type to reflect jobData ([#2706](https://github.com/taskforcesh/bullmq/issues/2706)) ref [#2342](https://github.com/taskforcesh/bullmq/issues/2342) ([de094a3](https://github.com/taskforcesh/bullmq/commit/de094a361a25886acbee0112bb4341c6b285b1c9))
* **stalled:** support removeDependencyOnFailure option when job is stalled ([#2708](https://github.com/taskforcesh/bullmq/issues/2708)) ([e0d3790](https://github.com/taskforcesh/bullmq/commit/e0d3790e755c4dfe31006b52f177f08b40348e61))

## [5.12.5](https://github.com/taskforcesh/bullmq/compare/v5.12.4...v5.12.5) (2024-08-13)


### Bug Fixes

* **connection:** remove unnecessary process.env.CI reference ([#2705](https://github.com/taskforcesh/bullmq/issues/2705)) ([53de304](https://github.com/taskforcesh/bullmq/commit/53de3049493ef79e02af40e8e450e2056c134155))

## [5.12.4](https://github.com/taskforcesh/bullmq/compare/v5.12.3...v5.12.4) (2024-08-12)


### Bug Fixes

* **worker:** fix close sequence to reduce risk for open handlers ([#2656](https://github.com/taskforcesh/bullmq/issues/2656)) ([8468e44](https://github.com/taskforcesh/bullmq/commit/8468e44e5e9e39c7b65691945c26688a9e5d2275))

## [5.12.3](https://github.com/taskforcesh/bullmq/compare/v5.12.2...v5.12.3) (2024-08-10)


### Bug Fixes

* **flow:** validate parentData before ignoreDependencyOnFailure when stalled check happens ([#2702](https://github.com/taskforcesh/bullmq/issues/2702)) (python) ([9416501](https://github.com/taskforcesh/bullmq/commit/9416501551b1ad464e59bdba1045a5a9955e2ea4))

## [5.12.2](https://github.com/taskforcesh/bullmq/compare/v5.12.1...v5.12.2) (2024-08-09)


### Performance Improvements

* **worker:** promote delayed jobs while queue is rate limited ([#2697](https://github.com/taskforcesh/bullmq/issues/2697)) ref [#2582](https://github.com/taskforcesh/bullmq/issues/2582) ([f3290ac](https://github.com/taskforcesh/bullmq/commit/f3290ace2f117e26357f9fae611a255af26b950b))

## [5.12.1](https://github.com/taskforcesh/bullmq/compare/v5.12.0...v5.12.1) (2024-08-07)


### Bug Fixes

* **job:** consider passing stackTraceLimit as 0 ([#2692](https://github.com/taskforcesh/bullmq/issues/2692)) ref [#2487](https://github.com/taskforcesh/bullmq/issues/2487) ([509a36b](https://github.com/taskforcesh/bullmq/commit/509a36baf8d8cf37176e406fd28e33f712229d27))

# [5.12.0](https://github.com/taskforcesh/bullmq/compare/v5.11.0...v5.12.0) (2024-08-01)


### Features

* **queue-events:** pass debounceId as a param of debounced event ([#2678](https://github.com/taskforcesh/bullmq/issues/2678)) ([97fb97a](https://github.com/taskforcesh/bullmq/commit/97fb97a054d6cebbe1d7ff1cb5c46d7da1c018d8))

# [5.11.0](https://github.com/taskforcesh/bullmq/compare/v5.10.4...v5.11.0) (2024-07-29)


### Features

* **job:** allow passing debounce as option ([#2666](https://github.com/taskforcesh/bullmq/issues/2666)) ([163ccea](https://github.com/taskforcesh/bullmq/commit/163ccea19ef48191c4db6da27638ff6fb0080a74))

## [5.10.4](https://github.com/taskforcesh/bullmq/compare/v5.10.3...v5.10.4) (2024-07-26)


### Bug Fixes

* **repeatable:** remove repeat hash when removing repeatable job ([#2676](https://github.com/taskforcesh/bullmq/issues/2676)) ([97a297d](https://github.com/taskforcesh/bullmq/commit/97a297d90ad8b27bcddb7db6a8a158acfb549389))

## [5.10.3](https://github.com/taskforcesh/bullmq/compare/v5.10.2...v5.10.3) (2024-07-19)


### Bug Fixes

* **repeatable:** keep legacy repeatables if it exists instead of creating one with new structure ([#2665](https://github.com/taskforcesh/bullmq/issues/2665)) ([93fad41](https://github.com/taskforcesh/bullmq/commit/93fad41a9520961d0e6814d82454bc916a039501))

## [5.10.2](https://github.com/taskforcesh/bullmq/compare/v5.10.1...v5.10.2) (2024-07-19)


### Performance Improvements

* **worker:** fetch next job on failure ([#2342](https://github.com/taskforcesh/bullmq/issues/2342)) ([f917b80](https://github.com/taskforcesh/bullmq/commit/f917b8090f306c0580aac12f6bd4394fd9ef003d))

## [5.10.1](https://github.com/taskforcesh/bullmq/compare/v5.10.0...v5.10.1) (2024-07-18)


### Bug Fixes

* **repeatable:** consider removing legacy repeatable job ([#2658](https://github.com/taskforcesh/bullmq/issues/2658)) fixes [#2661](https://github.com/taskforcesh/bullmq/issues/2661) ([a6764ae](https://github.com/taskforcesh/bullmq/commit/a6764aecb557fb918d061f5e5c2e26e4afa3e8ee))
* **repeatable:** pass custom key as an args in addRepeatableJob to prevent CROSSSLOT issue ([#2662](https://github.com/taskforcesh/bullmq/issues/2662)) fixes [#2660](https://github.com/taskforcesh/bullmq/issues/2660) ([9d8f874](https://github.com/taskforcesh/bullmq/commit/9d8f874b959e09662985f38c4614b95ab4d5e89c))

# [5.10.0](https://github.com/taskforcesh/bullmq/compare/v5.9.0...v5.10.0) (2024-07-16)


### Features

* **repeatable:** new repeatables structure ([#2617](https://github.com/taskforcesh/bullmq/issues/2617)) ref [#2612](https://github.com/taskforcesh/bullmq/issues/2612) fixes [#2399](https://github.com/taskforcesh/bullmq/issues/2399) [#2596](https://github.com/taskforcesh/bullmq/issues/2596) ([8376a9a](https://github.com/taskforcesh/bullmq/commit/8376a9a9007f58ac7eab1a3a1c2f9e7ec373bbd6))

# [5.9.0](https://github.com/taskforcesh/bullmq/compare/v5.8.7...v5.9.0) (2024-07-15)


### Features

* **queue:** support global concurrency ([#2496](https://github.com/taskforcesh/bullmq/issues/2496)) ref [#2465](https://github.com/taskforcesh/bullmq/issues/2465) ([47ba055](https://github.com/taskforcesh/bullmq/commit/47ba055c1ea36178b684fd11c1e82cde7ec93ac8))

## [5.8.7](https://github.com/taskforcesh/bullmq/compare/v5.8.6...v5.8.7) (2024-07-11)


### Performance Improvements

* **delayed:** keep moving delayed jobs to waiting when queue is paused ([#2640](https://github.com/taskforcesh/bullmq/issues/2640)) (python) ([b89e2e0](https://github.com/taskforcesh/bullmq/commit/b89e2e0913c0886561fc1c2470771232f17f5b3b))

## [5.8.6](https://github.com/taskforcesh/bullmq/compare/v5.8.5...v5.8.6) (2024-07-11)


### Bug Fixes

* **delayed:** avoid using jobId in order to schedule delayed jobs ([#2587](https://github.com/taskforcesh/bullmq/issues/2587)) (python) ([228db2c](https://github.com/taskforcesh/bullmq/commit/228db2c780a1ca8323900fc568156495a13355a3))

## [5.8.5](https://github.com/taskforcesh/bullmq/compare/v5.8.4...v5.8.5) (2024-07-10)


### Bug Fixes

* **parent:** consider re-adding child that is in completed state using same jobIds ([#2627](https://github.com/taskforcesh/bullmq/issues/2627)) (python) fixes [#2554](https://github.com/taskforcesh/bullmq/issues/2554) ([00cd017](https://github.com/taskforcesh/bullmq/commit/00cd0174539fbe1cc4628b9b6e1a7eb87a5ef705))

## [5.8.4](https://github.com/taskforcesh/bullmq/compare/v5.8.3...v5.8.4) (2024-07-05)


### Bug Fixes

* **queue-getters:** consider passing maxJobs when calling getRateLimitTtl ([#2631](https://github.com/taskforcesh/bullmq/issues/2631)) fixes [#2628](https://github.com/taskforcesh/bullmq/issues/2628) ([9f6609a](https://github.com/taskforcesh/bullmq/commit/9f6609ab1856c473b2d5cf0710068ce2751d708e))

## [5.8.3](https://github.com/taskforcesh/bullmq/compare/v5.8.2...v5.8.3) (2024-06-28)


### Bug Fixes

* **job:** consider changing priority to 0 ([#2599](https://github.com/taskforcesh/bullmq/issues/2599)) ([4dba122](https://github.com/taskforcesh/bullmq/commit/4dba122174ab5173315fca7fdbb7454761514a53))

## [5.8.2](https://github.com/taskforcesh/bullmq/compare/v5.8.1...v5.8.2) (2024-06-15)


### Bug Fixes

* **priority:** consider paused state when calling getCountsPerPriority (python) ([#2609](https://github.com/taskforcesh/bullmq/issues/2609)) ([6e99250](https://github.com/taskforcesh/bullmq/commit/6e992504b2a7a2fa76f1d04ad53d1512e98add7f))

## [5.8.1](https://github.com/taskforcesh/bullmq/compare/v5.8.0...v5.8.1) (2024-06-12)


### Bug Fixes

* **priority:** use module instead of bit.band to keep order (python) ([#2597](https://github.com/taskforcesh/bullmq/issues/2597)) ([9ece15b](https://github.com/taskforcesh/bullmq/commit/9ece15b17420fe0bee948a5307e870915e3bce87))

# [5.8.0](https://github.com/taskforcesh/bullmq/compare/v5.7.15...v5.8.0) (2024-06-11)


### Features

* **queue:** add getCountsPerPriority method ([#2595](https://github.com/taskforcesh/bullmq/issues/2595)) ([77971f4](https://github.com/taskforcesh/bullmq/commit/77971f42b9fc425ad66e0b581e800ea429fc254e))

## [5.7.15](https://github.com/taskforcesh/bullmq/compare/v5.7.14...v5.7.15) (2024-06-04)


### Performance Improvements

* **job:** set processedBy using hmset ([#2592](https://github.com/taskforcesh/bullmq/issues/2592)) (python) ([238680b](https://github.com/taskforcesh/bullmq/commit/238680b84593690a73d542dbe1120611c3508b47))

## [5.7.14](https://github.com/taskforcesh/bullmq/compare/v5.7.13...v5.7.14) (2024-05-29)


### Bug Fixes

* **worker:** properly cancel blocking command during disconnections ([2cf12b3](https://github.com/taskforcesh/bullmq/commit/2cf12b3622b0517f645971ece8acdcf673bede97))

## [5.7.13](https://github.com/taskforcesh/bullmq/compare/v5.7.12...v5.7.13) (2024-05-28)


### Bug Fixes

* extendlock, createbulk use pipeline no multi command ([#2584](https://github.com/taskforcesh/bullmq/pull/2584)) ([a053d9b](https://github.com/taskforcesh/bullmq/commit/a053d9b87e9799b151e2563b499dbff309b9d2e5))

## [5.7.12](https://github.com/taskforcesh/bullmq/compare/v5.7.11...v5.7.12) (2024-05-24)


### Bug Fixes

* **repeat:** throw error when endDate is pointing to the past ([#2574](https://github.com/taskforcesh/bullmq/issues/2574)) ([5bd7990](https://github.com/taskforcesh/bullmq/commit/5bd79900ea3ace8ec6aa00525aff81a345f8e18e))

## [5.7.11](https://github.com/taskforcesh/bullmq/compare/v5.7.10...v5.7.11) (2024-05-23)


### Bug Fixes

* **retry-job:** throw error when job is not in active state ([#2576](https://github.com/taskforcesh/bullmq/issues/2576)) ([ca207f5](https://github.com/taskforcesh/bullmq/commit/ca207f593d0ed455ecc59d9e0ef389a9a50d9634))

## [5.7.10](https://github.com/taskforcesh/bullmq/compare/v5.7.9...v5.7.10) (2024-05-21)


### Bug Fixes

* **sandboxed:** ensure DelayedError is checked in Sandboxed processors ([#2567](https://github.com/taskforcesh/bullmq/issues/2567)) fixes [#2566](https://github.com/taskforcesh/bullmq/issues/2566) ([8158fa1](https://github.com/taskforcesh/bullmq/commit/8158fa114f57619b31f101bc8d0688a09c6218bb))

## [5.7.9](https://github.com/taskforcesh/bullmq/compare/v5.7.8...v5.7.9) (2024-05-16)


### Bug Fixes

* **job:** validate job existence when adding a log ([#2562](https://github.com/taskforcesh/bullmq/issues/2562)) ([f87e3fe](https://github.com/taskforcesh/bullmq/commit/f87e3fe029e48d8964722da762326e531c2256ee))

## [5.7.8](https://github.com/taskforcesh/bullmq/compare/v5.7.7...v5.7.8) (2024-05-01)


### Bug Fixes

* **worker:** make sure clearTimeout is always called after bzpopmin ([782382e](https://github.com/taskforcesh/bullmq/commit/782382e599218024bb9912ff0572c4aa9b1f22a3))

## [5.7.7](https://github.com/taskforcesh/bullmq/compare/v5.7.6...v5.7.7) (2024-04-30)


### Bug Fixes

* **worker:** force timeout on bzpopmin command ([#2543](https://github.com/taskforcesh/bullmq/issues/2543)) ([ae7cb6c](https://github.com/taskforcesh/bullmq/commit/ae7cb6caefdbfa5ca0d28589cef4b896ffcce2db))

## [5.7.6](https://github.com/taskforcesh/bullmq/compare/v5.7.5...v5.7.6) (2024-04-27)


### Performance Improvements

* **worker:** do not call bzpopmin when blockDelay is lower or equal 0 ([#2544](https://github.com/taskforcesh/bullmq/issues/2544)) ref [#2466](https://github.com/taskforcesh/bullmq/issues/2466) ([9760b85](https://github.com/taskforcesh/bullmq/commit/9760b85dfbcc9b3c744f616961ef939e8951321d))

## [5.7.5](https://github.com/taskforcesh/bullmq/compare/v5.7.4...v5.7.5) (2024-04-24)


### Bug Fixes

* **stalled:** consider ignoreDependencyOnFailure option (python) ([#2540](https://github.com/taskforcesh/bullmq/issues/2540)) fixes [#2531](https://github.com/taskforcesh/bullmq/issues/2531) ([0140959](https://github.com/taskforcesh/bullmq/commit/0140959cabd2613794631e41ebe4c2ddee6f91da))

## [5.7.4](https://github.com/taskforcesh/bullmq/compare/v5.7.3...v5.7.4) (2024-04-21)


### Performance Improvements

* **worker:** reset delays after generating blockTimeout value ([#2529](https://github.com/taskforcesh/bullmq/issues/2529)) ([e92cea4](https://github.com/taskforcesh/bullmq/commit/e92cea4a9d7c99f649f6626d1c0a1e1e994179d6))

## [5.7.3](https://github.com/taskforcesh/bullmq/compare/v5.7.2...v5.7.3) (2024-04-20)


### Bug Fixes

* **worker:** return minimumBlockTimeout depending on redis version (python) ([#2532](https://github.com/taskforcesh/bullmq/issues/2532)) ([83dfb63](https://github.com/taskforcesh/bullmq/commit/83dfb63e72a1a36a4dfc40f122efb54fbb796339))

## [5.7.2](https://github.com/taskforcesh/bullmq/compare/v5.7.1...v5.7.2) (2024-04-18)


### Bug Fixes

* **stalled:** consider failParentOnFailure when moving child into failed ([#2526](https://github.com/taskforcesh/bullmq/issues/2526)) fixes [#2464](https://github.com/taskforcesh/bullmq/issues/2464) (python) ([5e31eb0](https://github.com/taskforcesh/bullmq/commit/5e31eb096169ea57350db591bcebfc2264a6b6dc))

## [5.7.1](https://github.com/taskforcesh/bullmq/compare/v5.7.0...v5.7.1) (2024-04-10)


### Bug Fixes

* **worker:** use 0.002 as minimum timeout for redis version lower than 7.0.8 ([#2515](https://github.com/taskforcesh/bullmq/issues/2515)) fixes [#2466](https://github.com/taskforcesh/bullmq/issues/2466) ([44f7d21](https://github.com/taskforcesh/bullmq/commit/44f7d21850747d9c636c78e08b9e577d684fb885))

# [5.7.0](https://github.com/taskforcesh/bullmq/compare/v5.6.0...v5.7.0) (2024-04-09)


### Features

* allow arbitrary large drainDelay ([9693321](https://github.com/taskforcesh/bullmq/commit/96933217bf79658e5bb23fd7afe47e0b1150a40d))

# [5.6.0](https://github.com/taskforcesh/bullmq/compare/v5.5.4...v5.6.0) (2024-04-08)


### Features

* Nothing changed, triggered by a python version release

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

* **job:** stack trace limit ([#2487](https://github.com/taskforcesh/bullmq/issues/2487)) ([cce3bc3](https://github.com/taskforcesh/bullmq/commit/cce3bc3092eb7cf56c2a6c68e9fd8980f5f1f26a))

## [5.4.5](https://github.com/taskforcesh/bullmq/compare/v5.4.4...v5.4.5) (2024-03-22)


### Bug Fixes

* **scripts:** use command name in error message when moving to finished ([#2483](https://github.com/taskforcesh/bullmq/issues/2483)) ([3c335d4](https://github.com/taskforcesh/bullmq/commit/3c335d49ba637145648c1ef0864d8e0d297dd890))

## [5.4.4](https://github.com/taskforcesh/bullmq/compare/v5.4.3...v5.4.4) (2024-03-21)


### Bug Fixes

* **queue:** use QueueOptions type in opts attribute ([#2481](https://github.com/taskforcesh/bullmq/issues/2481)) ([51a589f](https://github.com/taskforcesh/bullmq/commit/51a589f7e07b5336eb35ed00a1b795501b24f254))

## [5.4.3](https://github.com/taskforcesh/bullmq/compare/v5.4.2...v5.4.3) (2024-03-17)


### Bug Fixes

* **worker:** validate drainDelay must be greater than 0 ([#2477](https://github.com/taskforcesh/bullmq/issues/2477)) ([ab43693](https://github.com/taskforcesh/bullmq/commit/ab436938d895125635aef0393ae2fb5c77c16c1f))

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
* **worker:** markers use now a dedicated key in redis instead of using a special Job ID. ([`73cf5fc`](https://github.com/taskforcesh/bullmq/commit/73cf5fc1e6e13d8329e1e4e700a8db92173e0624)) ([`0bac0fb`](https://github.com/taskforcesh/bullmq/commit/0bac0fbb97afa968aa7644f1438b86d7bc18bbc5))

* references:
  - [Better Queue Markers](https://bullmq.io/news/231204/better-queue-markers/)
  - [BullMQ v5 Migration Notes](https://bullmq.io/news/231221/bullmqv5-release/)
