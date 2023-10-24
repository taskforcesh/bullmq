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

* **priority:** priority is separeted in its own zset, no duplication needed

* change job method name update to updateData

ref [faster priority jobs](https://bullmq.io/news/062123/faster-priority-jobs/)

## [5.3.5](https://github.com/taskforcesh/bullmq-pro/compare/v5.3.4...v5.3.5) (2023-06-16)


### Bug Fixes

* **deps:** upgrade bullmq to 3.15.8 ([#153](https://github.com/taskforcesh/bullmq-pro/issues/153)) ([7832290](https://github.com/taskforcesh/bullmq-pro/commit/783229095057d147047cd2f95be7d9ab9d0ef5ca))

## [5.3.4](https://github.com/taskforcesh/bullmq-pro/compare/v5.3.3...v5.3.4) (2023-06-06)


### Bug Fixes

* **deps:** upgrade bullmq to 3.15.1 ([#152](https://github.com/taskforcesh/bullmq-pro/issues/152)) ([89df87d](https://github.com/taskforcesh/bullmq-pro/commit/89df87d9561f0b3a2323cecb04a0786fec1a72a5))

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


### Bug Fixes

* **deps:** upgrade bullmq to 3.13.2 ([#144](https://github.com/taskforcesh/bullmq-pro/issues/144)) ([4dd0bb7](https://github.com/taskforcesh/bullmq-pro/commit/4dd0bb7ff69b8270f4adf1f513a7164fb49cc375))

## [5.2.2](https://github.com/taskforcesh/bullmq-pro/compare/v5.2.1...v5.2.2) (2023-04-18)


### Bug Fixes

* **deps:** upgrade bullmq to 3.11.0 ([#143](https://github.com/taskforcesh/bullmq-pro/issues/143)) ([b132957](https://github.com/taskforcesh/bullmq-pro/commit/b132957b43603931c68bfca1a85330905b810faf))

## [5.2.1](https://github.com/taskforcesh/bullmq-pro/compare/v5.2.0...v5.2.1) (2023-04-15)


### Bug Fixes

* **flow-producer-pro:** fix opts assignment ([#140](https://github.com/taskforcesh/bullmq-pro/issues/140)) ([9f8896c](https://github.com/taskforcesh/bullmq-pro/commit/9f8896c5f082d807bb6945780b30c2768015b95f))

# [5.2.0](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.15...v5.2.0) (2023-03-23)


### Features

* **groups:** add repair maxed group function ([a1fa1d8](https://github.com/taskforcesh/bullmq-pro/commit/a1fa1d80cf8ad79c7b9844df163765f61231350a))

## [5.1.15](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.14...v5.1.15) (2023-03-23)


### Bug Fixes

* **deps:** upgrade bullmq to 3.10.2 ([#138](https://github.com/taskforcesh/bullmq-pro/issues/138)) ([186be2b](https://github.com/taskforcesh/bullmq-pro/commit/186be2bfedf474dae6931d2dbc636bd53d900cf8))

## [5.1.14](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.13...v5.1.14) (2023-02-15)


### Bug Fixes

* **deps:** upgrade bullmq to 3.6.6 ([#137](https://github.com/taskforcesh/bullmq-pro/issues/137)) ([2af512a](https://github.com/taskforcesh/bullmq-pro/commit/2af512a4d6f4212d888af5766de8d20ea22b3c3c))

## [5.1.13](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.12...v5.1.13) (2023-02-07)


### Bug Fixes

* upgrade bullmq to v3.6.3 ([74d8d0c](https://github.com/taskforcesh/bullmq-pro/commit/74d8d0c937973c94792abc063a150372364fe0bf))
* **rate-limit:** update group concurrency after manual rate-limit ([de66ec4](https://github.com/taskforcesh/bullmq-pro/commit/de66ec494b8400e3cbb916f5937dc3834a213389))

## [5.1.12](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.11...v5.1.12) (2023-01-26)


### Bug Fixes

* **deps:** upgrade bullmq to 3.5.10 ([#133](https://github.com/taskforcesh/bullmq-pro/issues/133)) ([165b9ee](https://github.com/taskforcesh/bullmq-pro/commit/165b9ee9cbb431ee44434bafde2ed4dd4c865498))

## [5.1.11](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.10...v5.1.11) (2023-01-10)


### Bug Fixes

* **deps:** upgrade bullmq to 3.5.5 ([#132](https://github.com/taskforcesh/bullmq-pro/issues/132)) ([82ad7bd](https://github.com/taskforcesh/bullmq-pro/commit/82ad7bd4daa104ea644f70548b186da4327055be))

## [5.1.10](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.9...v5.1.10) (2022-12-29)


### Bug Fixes

* **deps:** upgrade bullmq to 3.5.1 ([#130](https://github.com/taskforcesh/bullmq-pro/issues/130)) ([5f74bf9](https://github.com/taskforcesh/bullmq-pro/commit/5f74bf9af6f5005c6dc16c4e200e8b7dfddfb91d))
* **stalled:** add activeKey local reference ([#131](https://github.com/taskforcesh/bullmq-pro/issues/131)) ([6554ea4](https://github.com/taskforcesh/bullmq-pro/commit/6554ea4d155e905312dd3398189b611bd54942e0)), closes [taskforcesh/bullmq-pro-support#34](https://github.com/taskforcesh/bullmq-pro-support/issues/34)

## [5.1.9](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.8...v5.1.9) (2022-12-23)


### Bug Fixes

* **job-pro:** fix opts type ([#129](https://github.com/taskforcesh/bullmq-pro/issues/129)) ([262de56](https://github.com/taskforcesh/bullmq-pro/commit/262de56bcb33f107d88fc765215bb809adc502a1)), closes [taskforcesh/issues#114](https://github.com/taskforcesh/issues/issues/114)

## [5.1.8](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.7...v5.1.8) (2022-12-22)


### Bug Fixes

* **worker:** avoid calling run on base class ([aba70f3](https://github.com/taskforcesh/bullmq-pro/commit/aba70f3df50f97221b1b998a416eb8e74ee66465))

## [5.1.7](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.6...v5.1.7) (2022-12-16)


### Bug Fixes

* **deps:** upgrade bullmq to 3.4.2 ([#127](https://github.com/taskforcesh/bullmq-pro/issues/127)) ([b70ac2b](https://github.com/taskforcesh/bullmq-pro/commit/b70ac2bb6bc6af096a2980ab77b7009853a3c809)), closes [taskforcesh/bullmq-pro-support#33](https://github.com/taskforcesh/bullmq-pro-support/issues/33)

## [5.1.6](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.5...v5.1.6) (2022-12-15)


### Bug Fixes

* **remove-job:** check groupId is different than false on removed children ([#126](https://github.com/taskforcesh/bullmq-pro/issues/126)) ([efb54cb](https://github.com/taskforcesh/bullmq-pro/commit/efb54cbbd9486a608beace7f975247f5c6995470)), closes [taskforcesh/bullmq-pro-support#32](https://github.com/taskforcesh/bullmq-pro-support/issues/32)

## [5.1.5](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.4...v5.1.5) (2022-12-13)


### Bug Fixes

* **deps:** upgrade bullmq to 3.4.1 ([#125](https://github.com/taskforcesh/bullmq-pro/issues/125)) ([f451d3b](https://github.com/taskforcesh/bullmq-pro/commit/f451d3b318e0c2b9ce6f9bb8b498d959fdd1fd0f))

## [5.1.4](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.3...v5.1.4) (2022-12-08)


### Bug Fixes

* **rate-limit-group:** several small fixes related to manual group rate limit. ([5b338d6](https://github.com/taskforcesh/bullmq-pro/commit/5b338d6b68af6762ae1c12367cff010596d8a15e))

## [5.1.3](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.2...v5.1.3) (2022-12-08)


### Bug Fixes

* **deps:** upgrade bullmq to 3.3.4 ([#120](https://github.com/taskforcesh/bullmq-pro/issues/120)) ([9e86994](https://github.com/taskforcesh/bullmq-pro/commit/9e8699412e795b020d165865543e2e3491576e17))

## [5.1.2](https://github.com/taskforcesh/bullmq-pro/compare/v5.1.1...v5.1.2) (2022-12-07)


### Bug Fixes

* **deps:** upgrade bullmq to 3.2.4 ([#121](https://github.com/taskforcesh/bullmq-pro/issues/121)) ([0399d09](https://github.com/taskforcesh/bullmq-pro/commit/0399d096b56eb75eab2e30448c885b81239db735))

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


### Bug Fixes

* **deps:** upgrade bullmq to 2.4.0 ([#110](https://github.com/taskforcesh/bullmq-pro/issues/110)) ([a926798](https://github.com/taskforcesh/bullmq-pro/commit/a926798beb7c87e23967823c20c9948e014520ce))

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

* **deps:** upgrade bullmq to 1.91.1 ([#96](https://github.com/taskforcesh/bullmq-pro/issues/96)) ([c95e34c](https://github.com/taskforcesh/bullmq-pro/commit/c95e34c9548c3add5351d9a83c42307fa534ff05))

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


### Bug Fixes

* **deps:** upgrade bullmq to 1.90.1 ([#91](https://github.com/taskforcesh/bullmq-pro/issues/91)) ([e3a6dac](https://github.com/taskforcesh/bullmq-pro/commit/e3a6dacfe58252d7373a96b54e41b18dd37367f7))

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
