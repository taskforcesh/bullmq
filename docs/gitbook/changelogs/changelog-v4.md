## [4.18.2](https://github.com/taskforcesh/bullmq/compare/v4.18.1...v4.18.2) (2024-10-24)


### Bug Fixes

* proper way to get version ([1a433d2](https://github.com/taskforcesh/bullmq/commit/1a433d2a17b58ba8d30f0ecf52d9091f8377978f))

## [4.18.1](https://github.com/taskforcesh/bullmq/compare/v4.18.0...v4.18.1) (2024-10-19)


### Bug Fixes

* use versions for lua commands ([b0a216d](https://github.com/taskforcesh/bullmq/commit/b0a216deacb0295e77b039ea67c100e57b045037))

# [4.18.0](https://github.com/taskforcesh/bullmq/compare/v4.17.0...v4.18.0) (2024-10-14)


### Features

* **queue:** add version support ([a600463](https://github.com/taskforcesh/bullmq/commit/a6004639612118ce5adc2a87f0402386ba8e1c2f))

# [4.17.0](https://github.com/taskforcesh/bullmq/compare/v4.16.0...v4.17.0) (2023-12-21)


### Features

* **sandbox:** support URL (local files) as processor file ([7eea670](https://github.com/taskforcesh/bullmq/commit/7eea6700b33bfd7f36b030b647b819a4c5fd9606))

# [4.16.0](https://github.com/taskforcesh/bullmq/compare/v4.15.4...v4.16.0) (2023-12-18)


### Features

* **queue:** add a paginated getDependencies ([#2327](https://github.com/taskforcesh/bullmq/issues/2327)) ([c5b8ba3](https://github.com/taskforcesh/bullmq/commit/c5b8ba318b12a84a3a6a928345377fa0eaa08ee3))

## [4.15.4](https://github.com/taskforcesh/bullmq/compare/v4.15.3...v4.15.4) (2023-12-14)


### Bug Fixes

* **flows:** update constructor and methods to match queue base ([#2324](https://github.com/taskforcesh/bullmq/issues/2324)) ([d6c2064](https://github.com/taskforcesh/bullmq/commit/d6c2064b1fdd88bd4cc61e049ce055ff620b0062))

## [4.15.3](https://github.com/taskforcesh/bullmq/compare/v4.15.2...v4.15.3) (2023-12-13)


### Bug Fixes

* **sandboxed:** better compatibility with esbuild ([8eaf955](https://github.com/taskforcesh/bullmq/commit/8eaf9550fe8b322df624893c507c55d2cce34b11))

## [4.15.2](https://github.com/taskforcesh/bullmq/compare/v4.15.1...v4.15.2) (2023-12-07)


### Bug Fixes

* **child-processor:** preserve dynamic imports in commonjs ([d97a5e0](https://github.com/taskforcesh/bullmq/commit/d97a5e06816cff04d86facdb8d32b512f29c6fb9))

## [4.15.1](https://github.com/taskforcesh/bullmq/compare/v4.15.0...v4.15.1) (2023-12-06)


### Bug Fixes

* **flows:** add meta key to queues created with flows ([272ec69](https://github.com/taskforcesh/bullmq/commit/272ec69557f601a138e1aaba739f7e7878d5344b))

# [4.15.0](https://github.com/taskforcesh/bullmq/compare/v4.14.4...v4.15.0) (2023-12-05)


### Features

* **sandboxes:** use the more compatible dynamic import instead of require ([6d2fe6e](https://github.com/taskforcesh/bullmq/commit/6d2fe6e7c0473b75aeb9a6d3080b0676f9521065))

## [4.14.4](https://github.com/taskforcesh/bullmq/compare/v4.14.3...v4.14.4) (2023-11-28)


### Bug Fixes

* **repeat-strategy:** add missing Promise return type ([#2301](https://github.com/taskforcesh/bullmq/issues/2301)) ([6f8f534](https://github.com/taskforcesh/bullmq/commit/6f8f5342cc8aa03f596d9ed5b8831f96a1d4c736))

## [4.14.3](https://github.com/taskforcesh/bullmq/compare/v4.14.2...v4.14.3) (2023-11-27)


### Bug Fixes

* **update-progress:** remove old updateProgress script to prevent conflict ([#2298](https://github.com/taskforcesh/bullmq/issues/2298)) (python) ([e65b819](https://github.com/taskforcesh/bullmq/commit/e65b819101f8e0e8fdef8c51cfdf9a52f5e73f13))
* **worker:** get dirname by using module.filename ([#2296](https://github.com/taskforcesh/bullmq/issues/2296)) fixes [#2288](https://github.com/taskforcesh/bullmq/issues/2288) ([6e4db5a](https://github.com/taskforcesh/bullmq/commit/6e4db5a3f3648c6a7e10991f2e18f3dab96fb1d7))

## [4.14.2](https://github.com/taskforcesh/bullmq/compare/v4.14.1...v4.14.2) (2023-11-24)


### Bug Fixes

* **worker:** should cap update progress events ([2cab9e9](https://github.com/taskforcesh/bullmq/commit/2cab9e94f65c7bdd053e3fb5944bcda6e3ebaa39))

## [4.14.1](https://github.com/taskforcesh/bullmq/compare/v4.14.0...v4.14.1) (2023-11-23)


### Bug Fixes

* **worker:** do not wait for slow jobs fixes [#2290](https://github.com/taskforcesh/bullmq/issues/2290) ([568d758](https://github.com/taskforcesh/bullmq/commit/568d7585edb1f2ef15991d4ae4a2425e6834046a))

# [4.14.0](https://github.com/taskforcesh/bullmq/compare/v4.13.3...v4.14.0) (2023-11-18)


### Features

* **worker:** better handling of concurrency when fetching jobs ([#2242](https://github.com/taskforcesh/bullmq/issues/2242)) ([d2e2035](https://github.com/taskforcesh/bullmq/commit/d2e203588878ee64cb21e67141f73b32867dfb40))

## [4.13.3](https://github.com/taskforcesh/bullmq/compare/v4.13.2...v4.13.3) (2023-11-16)


### Bug Fixes

* **utils:** use EventEmitter as a type instead of a namespace ([#2283](https://github.com/taskforcesh/bullmq/issues/2283)) ([41c9d1d](https://github.com/taskforcesh/bullmq/commit/41c9d1d05eedc7351272708e667e8d65eb6773fc))

## [4.13.2](https://github.com/taskforcesh/bullmq/compare/v4.13.1...v4.13.2) (2023-11-09)


### Bug Fixes

* **job:** set delay value on current job instance when it is retried ([#2266](https://github.com/taskforcesh/bullmq/issues/2266)) (python) ([76e075f](https://github.com/taskforcesh/bullmq/commit/76e075f54d5745b6cec3cb11305bf3110d963eae))

## [4.13.1](https://github.com/taskforcesh/bullmq/compare/v4.13.0...v4.13.1) (2023-11-08)


### Bug Fixes

* **connection:** better handling of attached listeners ([02474ad](https://github.com/taskforcesh/bullmq/commit/02474ad59a7b340d7bb2a7415ae7a88e14200398))
* **connection:** move redis instance check to queue base ([13a339a](https://github.com/taskforcesh/bullmq/commit/13a339a730f46ff22acdd4a046e0d9c4b7d88679))

# [4.13.0](https://github.com/taskforcesh/bullmq/compare/v4.12.10...v4.13.0) (2023-11-05)


### Features

* **queue:** improve clean to work iteratively ([#2260](https://github.com/taskforcesh/bullmq/issues/2260)) ([0cfa66f](https://github.com/taskforcesh/bullmq/commit/0cfa66fd0fa0dba9b3941f183cf6f06d8a4f281d))

## [4.12.10](https://github.com/taskforcesh/bullmq/compare/v4.12.9...v4.12.10) (2023-11-05)


### Bug Fixes

* update delay job property when moving to delayed set ([#2261](https://github.com/taskforcesh/bullmq/issues/2261)) ([69ece08](https://github.com/taskforcesh/bullmq/commit/69ece08babd7716c14c38c3dd50630b44c7c1897))

## [4.12.9](https://github.com/taskforcesh/bullmq/compare/v4.12.8...v4.12.9) (2023-11-05)


### Bug Fixes

* **add-job:** trim events when waiting-children event is published ([#2262](https://github.com/taskforcesh/bullmq/issues/2262)) (python) ([198bf05](https://github.com/taskforcesh/bullmq/commit/198bf05fa5a4e1ce50081296033a2e0f26ece498))

## [4.12.8](https://github.com/taskforcesh/bullmq/compare/v4.12.7...v4.12.8) (2023-11-03)


### Bug Fixes

* **worker:** keep extending locks while closing workers ([#2259](https://github.com/taskforcesh/bullmq/issues/2259)) ([c4d12ea](https://github.com/taskforcesh/bullmq/commit/c4d12ea3a9837ffd7f58e2134796137c4181c3de))

## [4.12.7](https://github.com/taskforcesh/bullmq/compare/v4.12.6...v4.12.7) (2023-10-29)


### Performance Improvements

* **redis-connection:** check redis version greater or equal than v6 only once ([#2252](https://github.com/taskforcesh/bullmq/issues/2252)) ([a09b15a](https://github.com/taskforcesh/bullmq/commit/a09b15af0d5dedfa83bce7130ee9094f3fb69e10))

## [4.12.6](https://github.com/taskforcesh/bullmq/compare/v4.12.5...v4.12.6) (2023-10-26)


### Bug Fixes

* **sandbox:** do not return empty object result when it is undefined ([#2247](https://github.com/taskforcesh/bullmq/issues/2247)) ([308db7f](https://github.com/taskforcesh/bullmq/commit/308db7f58758a72b8abb272da8e92509813a2178))

## [4.12.5](https://github.com/taskforcesh/bullmq/compare/v4.12.4...v4.12.5) (2023-10-18)


### Performance Improvements

* **events:** trim events when removing jobs ([#2235](https://github.com/taskforcesh/bullmq/issues/2235)) (python) ([889815c](https://github.com/taskforcesh/bullmq/commit/889815c412666e5fad8f32d2e3a2d41cf650f001))

## [4.12.4](https://github.com/taskforcesh/bullmq/compare/v4.12.3...v4.12.4) (2023-10-13)


### Bug Fixes

* **events:** do not publish removed event on non-existent jobs ([#2227](https://github.com/taskforcesh/bullmq/issues/2227)) ([c134606](https://github.com/taskforcesh/bullmq/commit/c1346064c6cd9f93c59b184f150eac11d51c91b4))

## [4.12.3](https://github.com/taskforcesh/bullmq/compare/v4.12.2...v4.12.3) (2023-10-10)


### Bug Fixes

* **events:** trim events when retrying a job ([#2224](https://github.com/taskforcesh/bullmq/issues/2224)) ([1986b05](https://github.com/taskforcesh/bullmq/commit/1986b05ac03fe4ee48861aa60caadcc9df8170a6))

## [4.12.2](https://github.com/taskforcesh/bullmq/compare/v4.12.1...v4.12.2) (2023-10-05)


### Bug Fixes

* **sandbox:** update progress value on job instance ([#2214](https://github.com/taskforcesh/bullmq/issues/2214)) fixes [#2213](https://github.com/taskforcesh/bullmq/issues/2213) ([3d0f36a](https://github.com/taskforcesh/bullmq/commit/3d0f36a134b7f5c6b6de26967c9d71bcfb346e72))

## [4.12.1](https://github.com/taskforcesh/bullmq/compare/v4.12.0...v4.12.1) (2023-10-04)


### Bug Fixes

* **delayed:** trim events when moving jobs to delayed (python) ([#2211](https://github.com/taskforcesh/bullmq/issues/2211)) ([eca8c2d](https://github.com/taskforcesh/bullmq/commit/eca8c2d4dfeafbd8ac36a49764dbd4897303628c))

# [4.12.0](https://github.com/taskforcesh/bullmq/compare/v4.11.4...v4.12.0) (2023-09-29)


### Features

* expose addJobLog and updateJobProgress to the Queue instance ([#2202](https://github.com/taskforcesh/bullmq/issues/2202)) ([2056939](https://github.com/taskforcesh/bullmq/commit/205693907a4d6c2da9bd0690fb552b1d1e369c08))

## [4.11.4](https://github.com/taskforcesh/bullmq/compare/v4.11.3...v4.11.4) (2023-09-22)


### Bug Fixes

* **queue:** batched unpack now uses range ([#2188](https://github.com/taskforcesh/bullmq/issues/2188)) ([b5e97f4](https://github.com/taskforcesh/bullmq/commit/b5e97f420bc0c4bc82772f3e87883ee522be43d9))

## [4.11.3](https://github.com/taskforcesh/bullmq/compare/v4.11.2...v4.11.3) (2023-09-22)


### Bug Fixes

* **worker:** forward skipVersionCheck to blockingConnection ([#2189](https://github.com/taskforcesh/bullmq/issues/2189)) ref [#2149](https://github.com/taskforcesh/bullmq/issues/2149) ([c8aa9a3](https://github.com/taskforcesh/bullmq/commit/c8aa9a36224cba8ecb19af1bf652f4f1c4c20d40))

## [4.11.2](https://github.com/taskforcesh/bullmq/compare/v4.11.1...v4.11.2) (2023-09-20)


### Bug Fixes

* **worker:** throw exception with NaN as concurrency ([#2184](https://github.com/taskforcesh/bullmq/issues/2184)) ([f36ac8b](https://github.com/taskforcesh/bullmq/commit/f36ac8b61dcd4bb3d9e283278310cd50cfc83fae))

## [4.11.1](https://github.com/taskforcesh/bullmq/compare/v4.11.0...v4.11.1) (2023-09-20)


### Bug Fixes

* **queue:** differentiate score purpose per state in clean method ([#2133](https://github.com/taskforcesh/bullmq/issues/2133)) fixes [#2124](https://github.com/taskforcesh/bullmq/issues/2124) ([862f10b](https://github.com/taskforcesh/bullmq/commit/862f10b586276314d9bffff2a5e6caf939399f7e))

# [4.11.0](https://github.com/taskforcesh/bullmq/compare/v4.10.0...v4.11.0) (2023-09-16)


### Features

* **sandbox:** convert wrapJob method as protected for extension ([#2182](https://github.com/taskforcesh/bullmq/issues/2182)) ([1494b55](https://github.com/taskforcesh/bullmq/commit/1494b5566573356e0248b4a5cab48ae21d82f1da))

# [4.10.0](https://github.com/taskforcesh/bullmq/compare/v4.9.0...v4.10.0) (2023-09-12)


### Bug Fixes

* **move-to-finished:** consider addition of prioritized jobs when processing last active job ([#2176](https://github.com/taskforcesh/bullmq/issues/2176)) (python) ([4b01f35](https://github.com/taskforcesh/bullmq/commit/4b01f359c290cfc62ea74ff3ab0b43ccc6956a02))
* **remove:** change error message when job is locked (python) ([#2175](https://github.com/taskforcesh/bullmq/issues/2175)) ([2f5628f](https://github.com/taskforcesh/bullmq/commit/2f5628feffab66cdcc78abf4d7bb608bdcaa65bb))

# [4.9.0](https://github.com/taskforcesh/bullmq/compare/v4.8.0...v4.9.0) (2023-09-05)


### Features

* **connection:** provide skipVersionCheck option for shared connections ([#2149](https://github.com/taskforcesh/bullmq/issues/2149)) ref [#2148](https://github.com/taskforcesh/bullmq/issues/2148) ([914820f](https://github.com/taskforcesh/bullmq/commit/914820f720cbc48b49f4bd1c46d148eb2bb5b79c))

# [4.8.0](https://github.com/taskforcesh/bullmq/compare/v4.7.4...v4.8.0) (2023-08-20)


### Features

* **sandbox:** emulate moveToDelayed method ([#2122](https://github.com/taskforcesh/bullmq/issues/2122)) ref [#2118](https://github.com/taskforcesh/bullmq/issues/2118) ([4c4559b](https://github.com/taskforcesh/bullmq/commit/4c4559b3c678313b3727c9781a6d3f963bcfda4e))

## [4.7.4](https://github.com/taskforcesh/bullmq/compare/v4.7.3...v4.7.4) (2023-08-19)


### Bug Fixes

* **sandbox:** ignore extra params on processor ([#2142](https://github.com/taskforcesh/bullmq/issues/2142)) ([3602c20](https://github.com/taskforcesh/bullmq/commit/3602c20ab80cbe0a0d3de66210a01ad119e1090b))

## [4.7.3](https://github.com/taskforcesh/bullmq/compare/v4.7.2...v4.7.3) (2023-08-17)


### Bug Fixes

* **worker:** abort rate-limit delay when closing worker ([264a81c](https://github.com/taskforcesh/bullmq/commit/264a81ca5f4e4f88c361d507312324b5f6c3225c))

## [4.7.2](https://github.com/taskforcesh/bullmq/compare/v4.7.1...v4.7.2) (2023-08-12)


### Bug Fixes

* **queue:** throw error when name is not provided ([#2123](https://github.com/taskforcesh/bullmq/issues/2123)) ([78fb0e2](https://github.com/taskforcesh/bullmq/commit/78fb0e2a93cfa59a43a0fb337f857e78f1c6fcf4))

## [4.7.1](https://github.com/taskforcesh/bullmq/compare/v4.7.0...v4.7.1) (2023-08-10)


### Performance Improvements

* **rate-limit:** get pttl only if needed ([#2129](https://github.com/taskforcesh/bullmq/issues/2129)) ([12ce2f3](https://github.com/taskforcesh/bullmq/commit/12ce2f3746626a81ea961961bb1a629077eed68a))

# [4.7.0](https://github.com/taskforcesh/bullmq/compare/v4.6.3...v4.7.0) (2023-08-03)


### Features

* **queue:** add getRateLimitTtl method ([#2105](https://github.com/taskforcesh/bullmq/issues/2105)) ([7426c64](https://github.com/taskforcesh/bullmq/commit/7426c64b109f1beacf742d57a987282597385469))

## [4.6.3](https://github.com/taskforcesh/bullmq/compare/v4.6.2...v4.6.3) (2023-07-28)


### Performance Improvements

* **job:** generate priority limit constant once ([#2102](https://github.com/taskforcesh/bullmq/issues/2102)) ([8880f9f](https://github.com/taskforcesh/bullmq/commit/8880f9f2983282d343d603a89abe5e1e6bff78e5))

## [4.6.2](https://github.com/taskforcesh/bullmq/compare/v4.6.0...v4.6.2) (2023-07-26)


### Performance Improvements

* **retry:** compare prev state instead of regex expression ([#2099](https://github.com/taskforcesh/bullmq/issues/2099)) ([c141283](https://github.com/taskforcesh/bullmq/commit/c1412831903d1fae0955af097e0be049024839fe))

# [4.6.0](https://github.com/taskforcesh/bullmq/compare/v4.5.0...v4.6.0) (2023-07-19)


### Features

* **queue:** add promoteJobs to promote all delayed jobs ([6074592](https://github.com/taskforcesh/bullmq/commit/6074592574256ec4b1c340126288e803e56b1a64))

# [4.5.0](https://github.com/taskforcesh/bullmq/compare/v4.4.0...v4.5.0) (2023-07-18)


### Features

* **job:** add option for removing children in remove method (python) ([#2064](https://github.com/taskforcesh/bullmq/issues/2064)) ([841dc87](https://github.com/taskforcesh/bullmq/commit/841dc87a689897df81438ad1f43e45a4da77c388))

# [4.4.0](https://github.com/taskforcesh/bullmq/compare/v4.3.0...v4.4.0) (2023-07-17)


### Features

* **job:** add removeDependencyOnFailure option ([#1953](https://github.com/taskforcesh/bullmq/issues/1953)) ([ffd49e2](https://github.com/taskforcesh/bullmq/commit/ffd49e289c57252487200d47b92193228ae7451f))

# [4.3.0](https://github.com/taskforcesh/bullmq/compare/v4.2.1...v4.3.0) (2023-07-14)


### Features

* **worker:** add id as part of token ([#2061](https://github.com/taskforcesh/bullmq/issues/2061)) ([e255356](https://github.com/taskforcesh/bullmq/commit/e2553562271e1e4143a8fef616349bb30de4899d))

## [4.2.1](https://github.com/taskforcesh/bullmq/compare/v4.2.0...v4.2.1) (2023-07-10)


### Bug Fixes

* **flow:** emit delayed event when parent is moved to delayed ([#2055](https://github.com/taskforcesh/bullmq/issues/2055)) ([f419ff1](https://github.com/taskforcesh/bullmq/commit/f419ff1ec5cb34986fe4b79402c727a6487e949c))

# [4.2.0](https://github.com/taskforcesh/bullmq/compare/v4.1.0...v4.2.0) (2023-07-03)


### Features

* **common:** add option to change repeatable jobs redis key hash algorithm ([#2023](https://github.com/taskforcesh/bullmq/issues/2023)) ([ca17364](https://github.com/taskforcesh/bullmq/commit/ca17364cc2a52f6577fb66f09ec3168bbf9f1e07))

# [4.1.0](https://github.com/taskforcesh/bullmq/compare/v4.0.0...v4.1.0) (2023-06-23)


### Features

* **queue:** add getPrioritized and getPrioritizedCount methods ([#2005](https://github.com/taskforcesh/bullmq/issues/2005)) ([7363abe](https://github.com/taskforcesh/bullmq/commit/7363abebce6e3bcf067fc7c220d845807ebb1489))

# [4.0.0](https://github.com/taskforcesh/bullmq/compare/v3.15.8...v4.0.0) (2023-06-21)


### Features

* **queue:** add removeDeprecatedPriorityKey method


### Performance Improvements

* **priority:** add prioritized as a new state ([#1984](https://github.com/taskforcesh/bullmq/issues/1984)) (python) ([42a890a](https://github.com/taskforcesh/bullmq/commit/42a890a2bfe45b29348030f886766400f5d41aa3))


### BREAKING CHANGES

* **priority:** priority is separeted in its own zset, no duplication needed

* **job:** change job method name update to updateData

ref [faster priority jobs](https://bullmq.io/news/062123/faster-priority-jobs/)
