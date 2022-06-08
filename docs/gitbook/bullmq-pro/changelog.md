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
