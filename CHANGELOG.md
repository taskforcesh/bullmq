## [1.8.13](https://github.com/taskforcesh/bullmq/compare/v1.8.12...v1.8.13) (2020-06-05)


### Bug Fixes

* **redis-connection:** run the load command for reused redis client ([fab9bba](https://github.com/taskforcesh/bullmq/commit/fab9bba4caee8fd44523febb3bde588b151e8514))

## [1.8.12](https://github.com/taskforcesh/bullmq/compare/v1.8.11...v1.8.12) (2020-06-04)


### Bug Fixes

* remove unused options ([23aadc3](https://github.com/taskforcesh/bullmq/commit/23aadc300b947693f4afb22296d236a924bd11ca))

## [1.8.11](https://github.com/taskforcesh/bullmq/compare/v1.8.10...v1.8.11) (2020-05-29)


### Bug Fixes

* **scheduler:** remove unnecessary division by 4096 ([4d25e95](https://github.com/taskforcesh/bullmq/commit/4d25e95f9522388bd85e932e04b6668e3da57686))

## [1.8.10](https://github.com/taskforcesh/bullmq/compare/v1.8.9...v1.8.10) (2020-05-28)


### Bug Fixes

* **scheduler:** divide timestamp by 4096 in update set fixes [#168](https://github.com/taskforcesh/bullmq/issues/168) ([0c5db83](https://github.com/taskforcesh/bullmq/commit/0c5db8391bb8994bee19f25a33efb9dfee792d7b))

## [1.8.9](https://github.com/taskforcesh/bullmq/compare/v1.8.8...v1.8.9) (2020-05-25)


### Bug Fixes

* **scheduler:** divide next timestamp  by 4096 ([#204](https://github.com/taskforcesh/bullmq/issues/204)) ([9562d74](https://github.com/taskforcesh/bullmq/commit/9562d74625e20b7b6de8750339c85345ba027357))

## [1.8.8](https://github.com/taskforcesh/bullmq/compare/v1.8.7...v1.8.8) (2020-05-25)


### Bug Fixes

* **queue-base:** error event is passed through ([ad14e77](https://github.com/taskforcesh/bullmq/commit/ad14e777171c0c44b7e50752d9847dec23f46158))
* **redis-connection:** error event is passed through ([a15b1a1](https://github.com/taskforcesh/bullmq/commit/a15b1a1824c6863ecf3e5132e22924fc3ff161f6))
* **worker:** error event is passed through ([d7f0374](https://github.com/taskforcesh/bullmq/commit/d7f03749ce300e917399a435a3f426e66145dd8c))

## [1.8.7](https://github.com/taskforcesh/bullmq/compare/v1.8.6...v1.8.7) (2020-04-10)


### Bug Fixes

* **worker:** do not use global child pool fixes [#172](https://github.com/taskforcesh/bullmq/issues/172) ([bc65f26](https://github.com/taskforcesh/bullmq/commit/bc65f26dd47c59d0a7277ac947140405557be9a5))

## [1.8.6](https://github.com/taskforcesh/bullmq/compare/v1.8.5...v1.8.6) (2020-04-10)


### Bug Fixes

* **workers:** do not call super.close() ([ebd2ae1](https://github.com/taskforcesh/bullmq/commit/ebd2ae1a5613d71643c5a7ba3f685d77585de68e))
* make sure closing is returned in every close call ([88c5948](https://github.com/taskforcesh/bullmq/commit/88c5948d33a9a7b7a4f4f64f3183727b87d80207))
* **scheduler:** duplicate connections fixes [#174](https://github.com/taskforcesh/bullmq/issues/174) ([011b8ac](https://github.com/taskforcesh/bullmq/commit/011b8acfdec54737d94a9fead2423e060e3364db))
* **worker:** return this.closing when calling close ([06d3d4f](https://github.com/taskforcesh/bullmq/commit/06d3d4f476444a2d2af8538d60cb2561a1915868))

## [1.8.5](https://github.com/taskforcesh/bullmq/compare/v1.8.4...v1.8.5) (2020-04-05)


### Bug Fixes

* removed deprecated and unused node-uuid ([c810579](https://github.com/taskforcesh/bullmq/commit/c810579029d33ef47d5a7563e63126a69c62fd87))

## [1.8.4](https://github.com/taskforcesh/bullmq/compare/v1.8.3...v1.8.4) (2020-03-17)


### Bug Fixes

* **job:** added nullable/optional properties ([cef134f](https://github.com/taskforcesh/bullmq/commit/cef134f7c4d87e1b80ba42a5e06c3877956ff4cc))

## [1.8.3](https://github.com/taskforcesh/bullmq/compare/v1.8.2...v1.8.3) (2020-03-13)


### Bug Fixes

* **sandbox:** If the child process is killed, remove it from the pool. ([8fb0fb5](https://github.com/taskforcesh/bullmq/commit/8fb0fb569a0236b37d3bae06bf58a2a1da3221c6))

## [1.8.2](https://github.com/taskforcesh/bullmq/compare/v1.8.1...v1.8.2) (2020-03-03)


### Bug Fixes

* restore the Job timestamp when deserializing JSON data ([#138](https://github.com/taskforcesh/bullmq/issues/138)) ([#152](https://github.com/taskforcesh/bullmq/issues/152)) ([c171bd4](https://github.com/taskforcesh/bullmq/commit/c171bd47f7b75378e75307a1decdc0f630ac1cd6))

## [1.8.1](https://github.com/taskforcesh/bullmq/compare/v1.8.0...v1.8.1) (2020-03-02)


### Bug Fixes

* modified imports to work when esModuleInterop is disabled ([#132](https://github.com/taskforcesh/bullmq/issues/132)) ([01681f2](https://github.com/taskforcesh/bullmq/commit/01681f282bafac2df2c602edb51d6bde3483896c))

# [1.8.0](https://github.com/taskforcesh/bullmq/compare/v1.7.0...v1.8.0) (2020-03-02)


### Bug Fixes

* cleanup signatures for queue add and addBulk ([#127](https://github.com/taskforcesh/bullmq/issues/127)) ([48e221b](https://github.com/taskforcesh/bullmq/commit/48e221b53909079a4def9c48c1b69cebabd0ed74))
* exit code 12 when using inspect with child process ([#137](https://github.com/taskforcesh/bullmq/issues/137)) ([43ebc67](https://github.com/taskforcesh/bullmq/commit/43ebc67cec3e8f283f9a555b4466cf918226687b))


### Features

* **types:** add sandboxed job processor types ([#114](https://github.com/taskforcesh/bullmq/issues/114)) ([a50a88c](https://github.com/taskforcesh/bullmq/commit/a50a88cd1658fa9d568235283a4c23a74eb8ed2a))

# [1.7.0](https://github.com/taskforcesh/bullmq/compare/v1.6.8...v1.7.0) (2020-03-02)


### Features

* made queue name publicly readable for [#140](https://github.com/taskforcesh/bullmq/issues/140) ([f2bba2e](https://github.com/taskforcesh/bullmq/commit/f2bba2efd9d85986b01bb35c847a232b5c42ae57))

## [1.6.8](https://github.com/taskforcesh/bullmq/compare/v1.6.7...v1.6.8) (2020-02-22)


### Bug Fixes

* modified QueueGetters.getJob and Job.fromId to also return null to ([65183fc](https://github.com/taskforcesh/bullmq/commit/65183fcf542d0227ec1d4d6637b46b5381331787))
* modified QueueGetters.getJob and Job.fromId to return undefined ([ede352b](https://github.com/taskforcesh/bullmq/commit/ede352be75ffe05bf633516db9eda88467c562bf))

## [1.6.7](https://github.com/taskforcesh/bullmq/compare/v1.6.6...v1.6.7) (2020-01-16)


### Bug Fixes

* don't fail a job when the worker already lost the lock ([23c0bf7](https://github.com/taskforcesh/bullmq/commit/23c0bf70eab6d166b0483336f103323d1bf2ca64))

## [1.6.6](https://github.com/taskforcesh/bullmq/compare/v1.6.5...v1.6.6) (2020-01-05)


### Bug Fixes

* remove duplicate active entry ([1d2cca3](https://github.com/taskforcesh/bullmq/commit/1d2cca38ee61289adcee4899a91f7dcbc93a7c05))

## [1.6.5](https://github.com/taskforcesh/bullmq/compare/v1.6.4...v1.6.5) (2020-01-05)


### Bug Fixes

* get rid of flushdb/flushall in tests ([550c67b](https://github.com/taskforcesh/bullmq/commit/550c67b25de5f6d800e5e317398044cd16b85924))

## [1.6.4](https://github.com/taskforcesh/bullmq/compare/v1.6.3...v1.6.4) (2020-01-05)


### Bug Fixes

* delete logs when cleaning jobs in set ([b11c6c7](https://github.com/taskforcesh/bullmq/commit/b11c6c7c9f4f1c49eac93b98fdc93ac8f861c8b2))

## [1.6.3](https://github.com/taskforcesh/bullmq/compare/v1.6.2...v1.6.3) (2020-01-01)


### Bug Fixes

* add tslib dependency fixes [#65](https://github.com/taskforcesh/bullmq/issues/65) ([7ad7995](https://github.com/taskforcesh/bullmq/commit/7ad799544a9c30b30aa96df8864119159c9a1185))

## [1.6.2](https://github.com/taskforcesh/bullmq/compare/v1.6.1...v1.6.2) (2019-12-16)


### Bug Fixes

* change default QueueEvents lastEventId to $ ([3c5b01d](https://github.com/taskforcesh/bullmq/commit/3c5b01d16ee1442f5802a0fe4e7675c14f7a7f1f))
* ensure QE ready before adding test events ([fd190f4](https://github.com/taskforcesh/bullmq/commit/fd190f4be792b03273481c8aaf73be5ca42663d1))
* explicitly test the behavior of .on and .once ([ea11087](https://github.com/taskforcesh/bullmq/commit/ea11087b292d9325105707b53f92ac61c334a147))

## [1.6.1](https://github.com/taskforcesh/bullmq/compare/v1.6.0...v1.6.1) (2019-12-16)


### Bug Fixes

* check of existing redis instance ([dd466b3](https://github.com/taskforcesh/bullmq/commit/dd466b332b03b430108126531d59ff9e66ce9521))

# [1.6.0](https://github.com/taskforcesh/bullmq/compare/v1.5.0...v1.6.0) (2019-12-12)


### Features

* add generic type to job data and return value ([87c0531](https://github.com/taskforcesh/bullmq/commit/87c0531efc2716db37f8a0886848cdb786709554))

# [1.5.0](https://github.com/taskforcesh/bullmq/compare/v1.4.3...v1.5.0) (2019-11-22)


### Features

* remove delay dependency ([97e1a30](https://github.com/taskforcesh/bullmq/commit/97e1a3015d853e615ddd623af07f12a194ccab2c))
* remove dependence on Bluebird.delay [#67](https://github.com/taskforcesh/bullmq/issues/67) ([bedbaf2](https://github.com/taskforcesh/bullmq/commit/bedbaf25af6479e387cd7548e246dca7c72fc140))

## [1.4.3](https://github.com/taskforcesh/bullmq/compare/v1.4.2...v1.4.3) (2019-11-21)


### Bug Fixes

* check in moveToFinished to use default val for opts.maxLenEvents ([d1118aa](https://github.com/taskforcesh/bullmq/commit/d1118aab77f755b4a65e3dd8ea2e195baf3d2602))

## [1.4.2](https://github.com/taskforcesh/bullmq/compare/v1.4.1...v1.4.2) (2019-11-21)


### Bug Fixes

* avoid Job<->Queue circular json error ([5752727](https://github.com/taskforcesh/bullmq/commit/5752727a6294e1b8d35f6a49e4953375510e10e6))
* avoid the .toJSON serializer interface [#70](https://github.com/taskforcesh/bullmq/issues/70) ([5941b82](https://github.com/taskforcesh/bullmq/commit/5941b82b646e46d53970197a404e5ea54f09d008))

## [1.4.1](https://github.com/taskforcesh/bullmq/compare/v1.4.0...v1.4.1) (2019-11-08)


### Bug Fixes

* default job settings [#58](https://github.com/taskforcesh/bullmq/issues/58) ([667fc6e](https://github.com/taskforcesh/bullmq/commit/667fc6e00ae4d6da639d285a104fb67e01c95bbd))

# [1.4.0](https://github.com/taskforcesh/bullmq/compare/v1.3.0...v1.4.0) (2019-11-06)


### Features

* job.progress() return last progress for sandboxed processors ([5c4b146](https://github.com/taskforcesh/bullmq/commit/5c4b146ca8e42c8a29f9db87326a17deac30e10e))

# [1.3.0](https://github.com/taskforcesh/bullmq/compare/v1.2.0...v1.3.0) (2019-11-05)


### Features

* test worker extends job lock while job is active ([577efdf](https://github.com/taskforcesh/bullmq/commit/577efdfb1d2d3140be78dee3bd658b5ce969b16d))

# [1.2.0](https://github.com/taskforcesh/bullmq/compare/v1.1.0...v1.2.0) (2019-11-03)


### Bug Fixes

* only run coveralls after success ([bd51893](https://github.com/taskforcesh/bullmq/commit/bd51893c35793657b65246a2f5a06469488c8a06))


### Features

* added code coverage and coveralls ([298cfc4](https://github.com/taskforcesh/bullmq/commit/298cfc48e35e648e6a22ac0d1633ac16c7b6e3de))
* added missing deps for coverage ([6f3ab8d](https://github.com/taskforcesh/bullmq/commit/6f3ab8d78ba8503a76447f0db5abf0c1c4f8e185))
* ignore commitlint file in coverage ([f874441](https://github.com/taskforcesh/bullmq/commit/f8744411a1b20b95e568502be15ec50cf8520926))
* only upload coverage once after all tests pass ([a7f73ec](https://github.com/taskforcesh/bullmq/commit/a7f73ecc2f51544f1d810de046ba073cb7aa5663))

# [1.1.0](https://github.com/taskforcesh/bullmq/compare/v1.0.1...v1.1.0) (2019-11-01)


### Bug Fixes

* failing build ([bb21d53](https://github.com/taskforcesh/bullmq/commit/bb21d53b199885dcc97e7fe20f60caf65e55e782))
* fix failing tests ([824eb6b](https://github.com/taskforcesh/bullmq/commit/824eb6bfb2b750b823d057c894797ccb336245d8))


### Features

* initial version of job locking mechanism ([1d4fa38](https://github.com/taskforcesh/bullmq/commit/1d4fa383e39f4f5dcb69a71a1359dd5dea75544c))

## [1.0.1](https://github.com/taskforcesh/bullmq/compare/v1.0.0...v1.0.1) (2019-10-27)


### Bug Fixes

* save job stacktrace on failure ([85dfe52](https://github.com/taskforcesh/bullmq/commit/85dfe525079a5f89c1901dbf35c7ddc6663afc24))
* simplify logic for stackTraceLimit ([296bd89](https://github.com/taskforcesh/bullmq/commit/296bd89514d430a499afee934dcae2aec41cffa2))

# 1.0.0 (2019-10-20)


### Bug Fixes

* add compilation step before running tests ([64abc13](https://github.com/taskforcesh/bullmq/commit/64abc13681f8735fb3ee5add5b271bb4da618047))
* add extra client to worker fixes [#34](https://github.com/taskforcesh/bullmq/issues/34) ([90bd891](https://github.com/taskforcesh/bullmq/commit/90bd891c7514f5e9e397d7aad15069ee55bebacd))
* add missing dependency ([b92e330](https://github.com/taskforcesh/bullmq/commit/b92e330aad35ae54f43376f92ad1b41209012b76))
* check closing after resuming from pause ([7b2cef3](https://github.com/taskforcesh/bullmq/commit/7b2cef3677e2b3af0370e0023aec4b971ad313fe))
* default opts ([333c73b](https://github.com/taskforcesh/bullmq/commit/333c73b5819a263ae92bdb54f0406c19db5cb64f))
* do not block if blockTime is zero ([13b2df2](https://github.com/taskforcesh/bullmq/commit/13b2df20cf045c069b8b581751e117722681dcd4))
* do not exec if closing ([b1d1c08](https://github.com/taskforcesh/bullmq/commit/b1d1c08a2948088eeb3dd65de78085329bac671b))
* do not trim if maxEvents is undefined ([7edd8f4](https://github.com/taskforcesh/bullmq/commit/7edd8f47b392c8b3a7369196befdafa4b29421d1))
* emit wait event in add job ([39cba31](https://github.com/taskforcesh/bullmq/commit/39cba31a30b7ef762a8d55d4bc34efec636207bf))
* fix a couple of job tests ([e66b97b](https://github.com/taskforcesh/bullmq/commit/e66b97be4577d5ab373fff0f3f45d73de7842a37))
* fix compiling error ([3cf2617](https://github.com/taskforcesh/bullmq/commit/3cf261703292d263d1e2017ae30eb490121dab4e))
* fix more tests ([6a07b35](https://github.com/taskforcesh/bullmq/commit/6a07b3518f856e8f7158be032110c925ed5c924f))
* fix progress script ([4228e27](https://github.com/taskforcesh/bullmq/commit/4228e2768c0cf404e09642ebb4053147d0badb56))
* fix retry functionality ([ec41ea4](https://github.com/taskforcesh/bullmq/commit/ec41ea4e0bd88b10b1ba434ef5ceb0952bb59f7b))
* fix several floating promises ([590a4a9](https://github.com/taskforcesh/bullmq/commit/590a4a925167a7c7d6c0d9764bbb5ab69235beb7))
* fixed reprocess lua script ([b78296f](https://github.com/taskforcesh/bullmq/commit/b78296f33517b8c5d79b300fef920edd03149d2f))
* improve concurrency mechanism ([a3f6148](https://github.com/taskforcesh/bullmq/commit/a3f61489e3c9891f42749ff85bd41064943c62dc))
* improve disconnection for queue events ([56b53a1](https://github.com/taskforcesh/bullmq/commit/56b53a1aca1e527b50f04d906653060fe8ca644e))
* initialize events comsumption in constructor ([dbb66cd](https://github.com/taskforcesh/bullmq/commit/dbb66cda9722d44eca806fa6ad1cabdaabac846a))
* make ioredis typings a normal dependency ([fb80b90](https://github.com/taskforcesh/bullmq/commit/fb80b90b12931a12a1a93c5e204dbf90eed4f48f))
* minor fixes ([7791cda](https://github.com/taskforcesh/bullmq/commit/7791cdac2bfb6a7fbbab9c95c5d89b1eae226a4c))
* parse progres and return value in events ([9e43d0e](https://github.com/taskforcesh/bullmq/commit/9e43d0e30ab90a290942418718cde1f5bfbdcf56))
* properly emit event for progress ([3f70175](https://github.com/taskforcesh/bullmq/commit/3f701750b1c957027825ee90b58141cd2556694f))
* reduce drain delay to 5 seconds ([c6cfe7c](https://github.com/taskforcesh/bullmq/commit/c6cfe7c0b50cabe5e5eb31f4b631a8b1d3706611))
* remove buggy close() on redis-connection (fixes 5 failing tests) ([64c2ede](https://github.com/taskforcesh/bullmq/commit/64c2edec5e738f43676d0f4ca61bdea8609203fc))
* remove unused dependencies ([34293c8](https://github.com/taskforcesh/bullmq/commit/34293c84bb0ed54f18d70c86821c3ac627d376a5))
* replace init by waitUntilReady ([4336161](https://github.com/taskforcesh/bullmq/commit/43361610de5b1a993a1c65f3f21ac745b8face21))
* reworked initialization of redis clients ([c17d4be](https://github.com/taskforcesh/bullmq/commit/c17d4be5a2ecdda3efcdc6b9d7aecdfaccd06d83))
* several fixes to make the lib work on other ts projects ([3cac1b0](https://github.com/taskforcesh/bullmq/commit/3cac1b0715613d9df51cb1ed6fe0859bcfbb8e9b))
* throw error messages instead of codes ([9267541](https://github.com/taskforcesh/bullmq/commit/92675413f1c3b9564574dc264ffcab0d6089e70e))
* update tests after merge ([51f75a4](https://github.com/taskforcesh/bullmq/commit/51f75a4929e7ae2704e42fa9035e335fe60d8dc0))
* wait until ready before trying to get jobs ([f3b768f](https://github.com/taskforcesh/bullmq/commit/f3b768f251ddafa207466af552376065b35bec8f))
* **connections:** reused connections ([1e808d2](https://github.com/taskforcesh/bullmq/commit/1e808d24018a29f6611f4fccd2f5754de0fa3e39))
* waitUntilFinished improvements ([18d4afe](https://github.com/taskforcesh/bullmq/commit/18d4afef08f04d19cb8d931e02fff8f962d07ee7))


### Features

* add cleaned event ([c544775](https://github.com/taskforcesh/bullmq/commit/c544775803626b5f03cf6f7c3cf18ed1d92debab))
* add empty method ([4376112](https://github.com/taskforcesh/bullmq/commit/4376112369d869c0a5c7ab4a543cfc50200e1414))
* add retry errors ([f6a7990](https://github.com/taskforcesh/bullmq/commit/f6a7990fb74585985729c5d95e2238acde6cf74a))
* add script to generate typedocs ([d0a8cb3](https://github.com/taskforcesh/bullmq/commit/d0a8cb32ef9090652017f8fbf2ca42f0960687f7))
* add some new tests for compat class, more minor fixes ([bc0f653](https://github.com/taskforcesh/bullmq/commit/bc0f653ecf7aedd5a46eee6f912ecd6849395dca))
* add support for adding jobs in bulk ([b62bddc](https://github.com/taskforcesh/bullmq/commit/b62bddc054b266a809b4b1646558a095a276d6d1))
* add trimEvents method to queue client ([b7da7c4](https://github.com/taskforcesh/bullmq/commit/b7da7c4de2de81282aa41f8b7624b9030edf7d15))
* automatically trim events ([279bbba](https://github.com/taskforcesh/bullmq/commit/279bbbab7e96ad8676ed3bd68663cb199067ea67))
* emit global stalled event fixes [#10](https://github.com/taskforcesh/bullmq/issues/10) ([241f229](https://github.com/taskforcesh/bullmq/commit/241f229761691b9ac17124da005f91594a78273d))
* get rid of Job3 in favor of bullmq Job class ([7590cea](https://github.com/taskforcesh/bullmq/commit/7590ceae7abe32a8824e4a265f95fef2f9a6665f))
* implement close in redis connection fixes [#8](https://github.com/taskforcesh/bullmq/issues/8) ([6de8b48](https://github.com/taskforcesh/bullmq/commit/6de8b48c9612ea39bb28db5f4130cb2a2bb5ee90))
* make delay in backoffs optional ([30d59e5](https://github.com/taskforcesh/bullmq/commit/30d59e519794780a8198222d0bbd88779c623275))
* move async initialization to constructors ([3fbacd0](https://github.com/taskforcesh/bullmq/commit/3fbacd088bc3bfbd61ed8ff173e4401193ce48ec))
* port a lot of functionality from bull 3.x ([ec9f3d2](https://github.com/taskforcesh/bullmq/commit/ec9f3d266c1aca0c27cb600f056d813c81259b4c))
* port more features from bull 3.x ([75bd261](https://github.com/taskforcesh/bullmq/commit/75bd26158678ee45a14e04fd7c3a1f96219979a2))
* ported tests and functionality from bull 3 ([1b6b192](https://github.com/taskforcesh/bullmq/commit/1b6b1927c7e8e6b6f1bf0bbd6c74eb59cc17deb6))
* **workers:** support for async backoffs ([c555837](https://github.com/taskforcesh/bullmq/commit/c55583701e5bdd4e6436a61c833e506bc05749de))
* remove support of bull3 config format in compat class ([d909486](https://github.com/taskforcesh/bullmq/commit/d9094868e34c2af21f810aaef4542951a509ccf8))
* support global:progress event ([60f4d85](https://github.com/taskforcesh/bullmq/commit/60f4d85d332b3be4a80db7aa179f3a9ceeb1d6f8))
* trim option to event stream [#21](https://github.com/taskforcesh/bullmq/issues/21) & fix [#17](https://github.com/taskforcesh/bullmq/issues/17) ([7eae653](https://github.com/taskforcesh/bullmq/commit/7eae65340820043101fadf1f87802f506020d553))

# Changelog

## 4.0.0-beta.2

### Fixed

* Removed humans, they weren't doing fine with animals.

### Changed

* Animals are now super cute, all of them.

## 4.0.0-beta.1

### Added

* Introduced animals into the world, we believe they're going to be a neat addition.

## 4.0.0-beta.0
