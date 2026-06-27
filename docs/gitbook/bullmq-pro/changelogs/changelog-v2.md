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
