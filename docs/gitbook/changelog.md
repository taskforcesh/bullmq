## [1.80.6](https://github.com/taskforcesh/bullmq/compare/v1.80.5...v1.80.6) (2022-04-22)


### Bug Fixes

* **job:** delete token when moving to delayed ([#1208](https://github.com/taskforcesh/bullmq/issues/1208)) ([37acf41](https://github.com/taskforcesh/bullmq/commit/37acf4109d17090dfaef992267e48130d34f7187))

## [1.80.5](https://github.com/taskforcesh/bullmq/compare/v1.80.4...v1.80.5) (2022-04-21)


### Bug Fixes

* **queue-base:** emit close error when no closing ([#1203](https://github.com/taskforcesh/bullmq/issues/1203)) fixes [#1205](https://github.com/taskforcesh/bullmq/issues/1205) ([4d76582](https://github.com/taskforcesh/bullmq/commit/4d7658272af94b57a09486e1141b0e15a7bac3ba))

## [1.80.4](https://github.com/taskforcesh/bullmq/compare/v1.80.3...v1.80.4) (2022-04-19)


### Bug Fixes

* **queue-scheduler:** apply isNotConnectionError ([#1189](https://github.com/taskforcesh/bullmq/issues/1189)) fixes [#1181](https://github.com/taskforcesh/bullmq/issues/1181) ([605d685](https://github.com/taskforcesh/bullmq/commit/605d68595d8fa1d9d47348a3fa9e0d7a4e28c706))

## [1.80.3](https://github.com/taskforcesh/bullmq/compare/v1.80.2...v1.80.3) (2022-04-15)


### Bug Fixes

* **cluster:** check correct Upstash host ([#1195](https://github.com/taskforcesh/bullmq/issues/1195)) fixes [#1193](https://github.com/taskforcesh/bullmq/issues/1193) ([69f2863](https://github.com/taskforcesh/bullmq/commit/69f28632408c741219c1ba49304d36f49cf5cb83))

## [1.80.2](https://github.com/taskforcesh/bullmq/compare/v1.80.1...v1.80.2) (2022-04-15)


### Bug Fixes

* **job:** remove Error from Promise return in moveToWaitingChildren ([#1197](https://github.com/taskforcesh/bullmq/issues/1197)) ([180a8bf](https://github.com/taskforcesh/bullmq/commit/180a8bf8fb2fe62b9929765a6dfd084574c77936))

## [1.80.1](https://github.com/taskforcesh/bullmq/compare/v1.80.0...v1.80.1) (2022-04-14)


### Bug Fixes

* **worker:** restore worker suffix to empty string ([#1194](https://github.com/taskforcesh/bullmq/issues/1194)) fixes [#1185](https://github.com/taskforcesh/bullmq/issues/1185) ([2666ea5](https://github.com/taskforcesh/bullmq/commit/2666ea5b8532645da24482cf01c5692da5f2ceda))

# [1.80.0](https://github.com/taskforcesh/bullmq/compare/v1.79.1...v1.80.0) (2022-04-12)


### Features

* **worker-listener:** use generics in events ([#1190](https://github.com/taskforcesh/bullmq/issues/1190)) ref [#1188](https://github.com/taskforcesh/bullmq/issues/1188) ([2821193](https://github.com/taskforcesh/bullmq/commit/28211937d9ed405330eede5ad7d4b0b817accf39))

## [1.79.1](https://github.com/taskforcesh/bullmq/compare/v1.79.0...v1.79.1) (2022-04-12)


### Bug Fixes

* **connection:** remove Queue reconnect overrides ([#1119](https://github.com/taskforcesh/bullmq/issues/1119)) ([83f1c79](https://github.com/taskforcesh/bullmq/commit/83f1c797b8a5272028c8d78d5ce464236e90909e))

# [1.79.0](https://github.com/taskforcesh/bullmq/compare/v1.78.2...v1.79.0) (2022-04-08)


### Features

* **queue-getters:** add getQueueEvents ([#1085](https://github.com/taskforcesh/bullmq/issues/1085)) ([f10a20a](https://github.com/taskforcesh/bullmq/commit/f10a20a90ab6dbf2d9f3f75ba99dacbdc797c329))

## [1.78.2](https://github.com/taskforcesh/bullmq/compare/v1.78.1...v1.78.2) (2022-03-31)


### Bug Fixes

* **clean:** consider processedOn and finishedOn attributes ([#1158](https://github.com/taskforcesh/bullmq/issues/1158)) ([8c3cb72](https://github.com/taskforcesh/bullmq/commit/8c3cb72235ec6123da389553f37433c2943e0f57))

## [1.78.1](https://github.com/taskforcesh/bullmq/compare/v1.78.0...v1.78.1) (2022-03-24)


### Bug Fixes

* **queue:** close repeat connection when calling close ([#1154](https://github.com/taskforcesh/bullmq/issues/1154)) ([7d79616](https://github.com/taskforcesh/bullmq/commit/7d796167229048ec79660ca5d3ac8a7c85d125e7))

# [1.78.0](https://github.com/taskforcesh/bullmq/compare/v1.77.3...v1.78.0) (2022-03-23)


### Features

* **cron-parser:** upgrades version to 4.2.1 ([#1149](https://github.com/taskforcesh/bullmq/issues/1149)) fixes [#1147](https://github.com/taskforcesh/bullmq/issues/1147) ([88a6c9c](https://github.com/taskforcesh/bullmq/commit/88a6c9c437172035173628842909f5170eb481f7))

## [1.77.3](https://github.com/taskforcesh/bullmq/compare/v1.77.2...v1.77.3) (2022-03-22)


### Bug Fixes

* **async-send:** check proc.send type ([#1150](https://github.com/taskforcesh/bullmq/issues/1150)) ([4f44173](https://github.com/taskforcesh/bullmq/commit/4f44173f0a3cc54705ca9a7e1730aeff26ea1c5a))

## [1.77.2](https://github.com/taskforcesh/bullmq/compare/v1.77.1...v1.77.2) (2022-03-20)


### Bug Fixes

* **trim-events:** consider maxLenEvents as 0 ([#1137](https://github.com/taskforcesh/bullmq/issues/1137)) ([bc58a49](https://github.com/taskforcesh/bullmq/commit/bc58a49fba1b6f4e3595a0371ecf8410000a9021))


### Performance Improvements

* **clean:** speed up clean operation using deletion marker ([#1144](https://github.com/taskforcesh/bullmq/issues/1144)) ([5fb32ef](https://github.com/taskforcesh/bullmq/commit/5fb32ef2c60843d8d1f2cbc000aacf4df3388b7e))

## [1.77.1](https://github.com/taskforcesh/bullmq/compare/v1.77.0...v1.77.1) (2022-03-17)


### Bug Fixes

* **flow:** remove processed children ([#1060](https://github.com/taskforcesh/bullmq/issues/1060)) fixes [#1056](https://github.com/taskforcesh/bullmq/issues/1056) ([6b54e86](https://github.com/taskforcesh/bullmq/commit/6b54e86c12f287a13da036f3ec7801b8656f0434))

# [1.77.0](https://github.com/taskforcesh/bullmq/compare/v1.76.6...v1.77.0) (2022-03-16)


### Features

* allow QueueScheduler to be extended ([289beb8](https://github.com/taskforcesh/bullmq/commit/289beb87d2ef3e3dd7583159f7be2b5450f7de3c))

## [1.76.6](https://github.com/taskforcesh/bullmq/compare/v1.76.5...v1.76.6) (2022-03-15)


### Bug Fixes

* **master:** do not export master file ([#1136](https://github.com/taskforcesh/bullmq/issues/1136)) fixes [#1125](https://github.com/taskforcesh/bullmq/issues/1125) ref [#1129](https://github.com/taskforcesh/bullmq/issues/1129) ([6aa2f96](https://github.com/taskforcesh/bullmq/commit/6aa2f9657b8787aa791ab5af7267a6d27d7d7869))

## [1.76.5](https://github.com/taskforcesh/bullmq/compare/v1.76.4...v1.76.5) (2022-03-15)


### Bug Fixes

* **queue:** sanitize job types in getJobs and getJobsCount ([#1113](https://github.com/taskforcesh/bullmq/issues/1113)) fixes [#1112](https://github.com/taskforcesh/bullmq/issues/1112) ([d452b29](https://github.com/taskforcesh/bullmq/commit/d452b29773cead153a73b8322adda3164fb610d8))

## [1.76.4](https://github.com/taskforcesh/bullmq/compare/v1.76.3...v1.76.4) (2022-03-13)


### Performance Improvements

* **move-to-finished:** avoid an extra roundtrip when using rate limit ([#1131](https://github.com/taskforcesh/bullmq/issues/1131)) ([1711547](https://github.com/taskforcesh/bullmq/commit/171154707bf5cbcb750ea9d2a9957128c1abc044))

## [1.76.3](https://github.com/taskforcesh/bullmq/compare/v1.76.2...v1.76.3) (2022-03-10)


### Bug Fixes

* **drained:** emit event only once when queue has drained the waiting list ([#1123](https://github.com/taskforcesh/bullmq/issues/1123)) fixes [#1121](https://github.com/taskforcesh/bullmq/issues/1121) ref [#1070](https://github.com/taskforcesh/bullmq/issues/1070) ([b89b4e8](https://github.com/taskforcesh/bullmq/commit/b89b4e8a83fe4c9349ac5a9c439fc07374ff1e63))

## [1.76.2](https://github.com/taskforcesh/bullmq/compare/v1.76.1...v1.76.2) (2022-03-09)


### Bug Fixes

* **utils:** fix proc.send type ([#1122](https://github.com/taskforcesh/bullmq/issues/1122)) fixes [#1120](https://github.com/taskforcesh/bullmq/issues/1120) ([da23977](https://github.com/taskforcesh/bullmq/commit/da239774379825d9f0a51c118740bc0fefa568bd))

## [1.76.1](https://github.com/taskforcesh/bullmq/compare/v1.76.0...v1.76.1) (2022-03-04)


### Bug Fixes

* **get-waiting-children-count:** consider waiting-children status only ([#1117](https://github.com/taskforcesh/bullmq/issues/1117)) ([1820df7](https://github.com/taskforcesh/bullmq/commit/1820df73c17ce119d2fdb0f526fc95f99845a5ec))

# [1.76.0](https://github.com/taskforcesh/bullmq/compare/v1.75.1...v1.76.0) (2022-03-02)


### Features

* **metrics:** add metrics support ([ab51326](https://github.com/taskforcesh/bullmq/commit/ab51326cf318b4b48e37a1a77f5609e405eecb45))

## [1.75.1](https://github.com/taskforcesh/bullmq/compare/v1.75.0...v1.75.1) (2022-02-26)


### Bug Fixes

* **rate-limiter:** move job to wait after retry when groupKey is missed ([#1103](https://github.com/taskforcesh/bullmq/issues/1103)) fixes [#1084](https://github.com/taskforcesh/bullmq/issues/1084) ([8aeab37](https://github.com/taskforcesh/bullmq/commit/8aeab37ac5a5c1c760be21bff2ba8752a485577c))

# [1.75.0](https://github.com/taskforcesh/bullmq/compare/v1.74.3...v1.75.0) (2022-02-24)


### Bug Fixes

* **cluster:** check for host presence in Upstash validation ([#1102](https://github.com/taskforcesh/bullmq/issues/1102)) fixes [#1101](https://github.com/taskforcesh/bullmq/issues/1101) ([54d4eac](https://github.com/taskforcesh/bullmq/commit/54d4eac52cfe13d4be99410932c0226c8d06d5d5))


### Features

* **retry-jobs:** allow to retry completed jobs ([#1082](https://github.com/taskforcesh/bullmq/issues/1082)) ([e17b3f2](https://github.com/taskforcesh/bullmq/commit/e17b3f21606757a16630988a69c9607e8c843bd2))

## [1.74.3](https://github.com/taskforcesh/bullmq/compare/v1.74.2...v1.74.3) (2022-02-24)


### Bug Fixes

* **connection:** throw error when Upstash host is provided ([#1098](https://github.com/taskforcesh/bullmq/issues/1098)) fixes [#1087](https://github.com/taskforcesh/bullmq/issues/1087) ([5156d0a](https://github.com/taskforcesh/bullmq/commit/5156d0a4812d8c649a3b41bd98e3e0efb41d0491))

## [1.74.2](https://github.com/taskforcesh/bullmq/compare/v1.74.1...v1.74.2) (2022-02-23)


### Bug Fixes

* **move-to-finished:** increment attemptsMade when moving job to active ([#1095](https://github.com/taskforcesh/bullmq/issues/1095)) fixes [#1094](https://github.com/taskforcesh/bullmq/issues/1094) ([321b0e1](https://github.com/taskforcesh/bullmq/commit/321b0e1d515d01c5b3f1ca9f404cd571e3f753b7))

## [1.74.1](https://github.com/taskforcesh/bullmq/compare/v1.74.0...v1.74.1) (2022-02-20)


### Bug Fixes

* **flow:** respect defaultJobOptions from queue opts ([#1080](https://github.com/taskforcesh/bullmq/issues/1080)) fixes [#1034](https://github.com/taskforcesh/bullmq/issues/1034) ([0aca072](https://github.com/taskforcesh/bullmq/commit/0aca072f805302e660b6675fd4097ba893c91eb0))

# [1.74.0](https://github.com/taskforcesh/bullmq/compare/v1.73.0...v1.74.0) (2022-02-19)


### Features

* **retry-jobs:** pass timestamp as option ([#1054](https://github.com/taskforcesh/bullmq/issues/1054)) ([1522359](https://github.com/taskforcesh/bullmq/commit/15223590b235f749af9cb229fc784760d4b3add2))

# [1.73.0](https://github.com/taskforcesh/bullmq/compare/v1.72.0...v1.73.0) (2022-02-16)


### Features

* **job:** add prefix getter ([#1077](https://github.com/taskforcesh/bullmq/issues/1077)) ([db9ef10](https://github.com/taskforcesh/bullmq/commit/db9ef105a7a524d7502664d52bd9f9c7dfa9477f))
* **queue-getters:** add getQueueSchedulers ([#1078](https://github.com/taskforcesh/bullmq/issues/1078)) ref [#1075](https://github.com/taskforcesh/bullmq/issues/1075) ([0b3b1c4](https://github.com/taskforcesh/bullmq/commit/0b3b1c4382de34bd68733d162c2fa2ba9417f79c))

# [1.72.0](https://github.com/taskforcesh/bullmq/compare/v1.71.0...v1.72.0) (2022-02-15)


### Features

* **backoff:** validate UnrecoverableError presence ([#1074](https://github.com/taskforcesh/bullmq/issues/1074)) ([1defeac](https://github.com/taskforcesh/bullmq/commit/1defeac3f251a13aad57f3027d8eb8f857e40acb))

# [1.71.0](https://github.com/taskforcesh/bullmq/compare/v1.70.0...v1.71.0) (2022-02-14)


### Features

* **get-job-counts:** add default values ([#1068](https://github.com/taskforcesh/bullmq/issues/1068)) ([1c7f841](https://github.com/taskforcesh/bullmq/commit/1c7f841a52b3ea18fa7878f10986b362ccc6c4fe))

# [1.70.0](https://github.com/taskforcesh/bullmq/compare/v1.69.1...v1.70.0) (2022-02-11)


### Features

* **sandbox:** pass parent property ([#1065](https://github.com/taskforcesh/bullmq/issues/1065)) ([1fd33f6](https://github.com/taskforcesh/bullmq/commit/1fd33f6fd3a3af17753de8c4d48e14ef86c7409c))

## [1.69.1](https://github.com/taskforcesh/bullmq/compare/v1.69.0...v1.69.1) (2022-02-10)


### Bug Fixes

* **move-to-finished:** validate lock first ([#1064](https://github.com/taskforcesh/bullmq/issues/1064)) ([9da1b29](https://github.com/taskforcesh/bullmq/commit/9da1b29486c6c6e2b097ec2f6107494a36525495))

# [1.69.0](https://github.com/taskforcesh/bullmq/compare/v1.68.4...v1.69.0) (2022-02-08)


### Features

* **job:** pass queueName into sandbox ([#1053](https://github.com/taskforcesh/bullmq/issues/1053)) fixes [#1050](https://github.com/taskforcesh/bullmq/issues/1050) ref [#1051](https://github.com/taskforcesh/bullmq/issues/1051) ([12bb19c](https://github.com/taskforcesh/bullmq/commit/12bb19c1586d8755b973a80be97f407630827d4f))

## [1.68.4](https://github.com/taskforcesh/bullmq/compare/v1.68.3...v1.68.4) (2022-02-05)


### Bug Fixes

* **clean:** consider checking parent jobs when cleaning ([#1048](https://github.com/taskforcesh/bullmq/issues/1048)) ([0708a24](https://github.com/taskforcesh/bullmq/commit/0708a24c7f4cb6d1cda776ed983d3f20fc3261f1))

## [1.68.3](https://github.com/taskforcesh/bullmq/compare/v1.68.2...v1.68.3) (2022-02-04)


### Bug Fixes

* **drain:** delete priority queueKey ([#1049](https://github.com/taskforcesh/bullmq/issues/1049)) ([2e6129a](https://github.com/taskforcesh/bullmq/commit/2e6129a4a08783eeafa2f0b69c10ac810f53d085))

## [1.68.2](https://github.com/taskforcesh/bullmq/compare/v1.68.1...v1.68.2) (2022-02-03)


### Performance Improvements

* **remove-parent-dependency:** do not emit wait event in hard deletions ([#1045](https://github.com/taskforcesh/bullmq/issues/1045)) ([4069821](https://github.com/taskforcesh/bullmq/commit/40698218d13a880615f832a9926f0f057b1c33f9))

## [1.68.1](https://github.com/taskforcesh/bullmq/compare/v1.68.0...v1.68.1) (2022-02-01)


### Bug Fixes

* **update:** throw error when missing job key ([#1042](https://github.com/taskforcesh/bullmq/issues/1042)) ([a00ae5c](https://github.com/taskforcesh/bullmq/commit/a00ae5c9b3f6d51cb0229adca29d13d932fc5601))

# [1.68.0](https://github.com/taskforcesh/bullmq/compare/v1.67.3...v1.68.0) (2022-01-29)


### Features

* **queue:** add retryJobs method for failed jobs ([#1024](https://github.com/taskforcesh/bullmq/issues/1024)) ([310a730](https://github.com/taskforcesh/bullmq/commit/310a730ed322501cc19cdd5cf5244bc8eee6fee2))


### Performance Improvements

* **lua:** call del command with multiple keys ([#1035](https://github.com/taskforcesh/bullmq/issues/1035)) ([9cfaab8](https://github.com/taskforcesh/bullmq/commit/9cfaab8965d0c9f92460d31d6c3083839c36447f))

## [1.67.3](https://github.com/taskforcesh/bullmq/compare/v1.67.2...v1.67.3) (2022-01-28)


### Bug Fixes

* **drain:** consider checking parent jobs when draining ([#992](https://github.com/taskforcesh/bullmq/issues/992)) ([81b7221](https://github.com/taskforcesh/bullmq/commit/81b72213a9ff31d6b297825391de77557598ebd1))

## [1.67.2](https://github.com/taskforcesh/bullmq/compare/v1.67.1...v1.67.2) (2022-01-28)


### Bug Fixes

* **repeat:** consider immediately option with cron ([#1030](https://github.com/taskforcesh/bullmq/issues/1030)) fixes [#1020](https://github.com/taskforcesh/bullmq/issues/1020) ([b9e7488](https://github.com/taskforcesh/bullmq/commit/b9e748870385a88b2384df40f50df3144c11d7e0))

## [1.67.1](https://github.com/taskforcesh/bullmq/compare/v1.67.0...v1.67.1) (2022-01-27)


### Bug Fixes

* **retry:** pass state in error message ([#1027](https://github.com/taskforcesh/bullmq/issues/1027)) ([c646a45](https://github.com/taskforcesh/bullmq/commit/c646a45377fdfaff340185d1f7bedceb80c214c2))


### Performance Improvements

* **retry:** delete props in retryJob lua script ([#1016](https://github.com/taskforcesh/bullmq/issues/1016)) ([547cedd](https://github.com/taskforcesh/bullmq/commit/547cedd5ecd30c9a73d37e4053b9e518cb3fbe53))

# [1.67.0](https://github.com/taskforcesh/bullmq/compare/v1.66.1...v1.67.0) (2022-01-26)


### Features

* add support for removeOn based on time ([6c4ac75](https://github.com/taskforcesh/bullmq/commit/6c4ac75bb3ac239cc83ef6144d69c04b2bba1311))

## [1.66.1](https://github.com/taskforcesh/bullmq/compare/v1.66.0...v1.66.1) (2022-01-25)


### Bug Fixes

* **job:** increase attemptsMade when moving job to active ([#1009](https://github.com/taskforcesh/bullmq/issues/1009)) fixes [#1002](https://github.com/taskforcesh/bullmq/issues/1002) ([0974ae0](https://github.com/taskforcesh/bullmq/commit/0974ae0ff6db73c223be4b18fb2aab53b6a23c88))

# [1.66.0](https://github.com/taskforcesh/bullmq/compare/v1.65.1...v1.66.0) (2022-01-23)


### Features

* **queue-events:** add retries-exhausted event ([#1010](https://github.com/taskforcesh/bullmq/issues/1010)) ([e476f35](https://github.com/taskforcesh/bullmq/commit/e476f35f5c3f9b1baf2bbc3d46712b8ba597f73c))

## [1.65.1](https://github.com/taskforcesh/bullmq/compare/v1.65.0...v1.65.1) (2022-01-21)


### Bug Fixes

* dont loop through empty modules paths ([#1013](https://github.com/taskforcesh/bullmq/issues/1013)) fixes [#1012](https://github.com/taskforcesh/bullmq/issues/1012) ([86e84df](https://github.com/taskforcesh/bullmq/commit/86e84df933c2662380b00a11b5f4000f2618d218))

# [1.65.0](https://github.com/taskforcesh/bullmq/compare/v1.64.4...v1.65.0) (2022-01-21)


### Features

* **queue:** add JobType and JobState unions for better typing ([#1011](https://github.com/taskforcesh/bullmq/issues/1011)) ([3b9b79d](https://github.com/taskforcesh/bullmq/commit/3b9b79dbdd754ab66c3948e7e16380f2d5513262))

## [1.64.4](https://github.com/taskforcesh/bullmq/compare/v1.64.3...v1.64.4) (2022-01-19)


### Bug Fixes

* **queue:** use 0 as initial value for getJobCountByTypes reducer ([#1005](https://github.com/taskforcesh/bullmq/issues/1005)) ([f0e23ef](https://github.com/taskforcesh/bullmq/commit/f0e23ef01b97d36c775db0bf8c9dd2f63f6cb194))

## [1.64.3](https://github.com/taskforcesh/bullmq/compare/v1.64.2...v1.64.3) (2022-01-17)


### Bug Fixes

* **worker:** blockTime must be integer on older Redis ([6fedc0a](https://github.com/taskforcesh/bullmq/commit/6fedc0a03bdb217ef0dbae60d49fccb0f2a5dbdb))

## [1.64.2](https://github.com/taskforcesh/bullmq/compare/v1.64.1...v1.64.2) (2022-01-14)


### Bug Fixes

* **remove-job:** consider removing parent dependency key in lua scripts ([#990](https://github.com/taskforcesh/bullmq/issues/990)) ([661abf0](https://github.com/taskforcesh/bullmq/commit/661abf0921e663c9ea2fa7d59c12da35950637dc))

## [1.64.1](https://github.com/taskforcesh/bullmq/compare/v1.64.0...v1.64.1) (2022-01-14)


### Bug Fixes

* **sandbox:** exit uncaughtException instead of throwing error ([013d6a5](https://github.com/taskforcesh/bullmq/commit/013d6a5ee0c70266ae740abfa596ca9e506de71b))

# [1.64.0](https://github.com/taskforcesh/bullmq/compare/v1.63.3...v1.64.0) (2022-01-07)


### Features

* **sanboxed-process:** support .cjs files ([#984](https://github.com/taskforcesh/bullmq/issues/984)) ([531e4de](https://github.com/taskforcesh/bullmq/commit/531e4de1525f2cf322e0b97f5537ed43276ff72b))

## [1.63.3](https://github.com/taskforcesh/bullmq/compare/v1.63.2...v1.63.3) (2022-01-06)


### Bug Fixes

* **job:** throw error when delay and repeat are provided together ([#983](https://github.com/taskforcesh/bullmq/issues/983)) ([07b0082](https://github.com/taskforcesh/bullmq/commit/07b008273ead9360fc43564fa9ff1a7503616ceb))

## [1.63.2](https://github.com/taskforcesh/bullmq/compare/v1.63.1...v1.63.2) (2022-01-04)


### Bug Fixes

* **queue:** add missing error event typing ([#979](https://github.com/taskforcesh/bullmq/issues/979)) ([afdaac6](https://github.com/taskforcesh/bullmq/commit/afdaac6b072c7af5973222cc7fb69f3f138f3b0b))

## [1.63.1](https://github.com/taskforcesh/bullmq/compare/v1.63.0...v1.63.1) (2022-01-04)


### Bug Fixes

* **update-progress:** throw error if job key is missing ([#978](https://github.com/taskforcesh/bullmq/issues/978)) ref [#977](https://github.com/taskforcesh/bullmq/issues/977) ([b03aaf1](https://github.com/taskforcesh/bullmq/commit/b03aaf10ca694745d143def2129f952b9bac18a6))

# [1.63.0](https://github.com/taskforcesh/bullmq/compare/v1.62.0...v1.63.0) (2021-12-31)


### Features

* **job:** use generic types for static methods ([#975](https://github.com/taskforcesh/bullmq/issues/975)) ([f78f4d0](https://github.com/taskforcesh/bullmq/commit/f78f4d0f75adb5c73558b3e8cf511db22f972791))

# [1.62.0](https://github.com/taskforcesh/bullmq/compare/v1.61.0...v1.62.0) (2021-12-31)


### Bug Fixes

* add deprecated tag in progress and Queue3 class ([#973](https://github.com/taskforcesh/bullmq/issues/973)) ([6abdf5b](https://github.com/taskforcesh/bullmq/commit/6abdf5b66717cc8bc8ddb048029f7d9b92509942))


### Features

* **queue:** add better event typing ([#971](https://github.com/taskforcesh/bullmq/issues/971)) ([596fd7b](https://github.com/taskforcesh/bullmq/commit/596fd7b260f2e95607f0eb4ff9553fb35137ec54))

# [1.61.0](https://github.com/taskforcesh/bullmq/compare/v1.60.0...v1.61.0) (2021-12-29)


### Features

* **queue:** reuse generic typing for jobs ([5c10818](https://github.com/taskforcesh/bullmq/commit/5c10818d90724cccdf510f0358c01233aeac77e4))
* **worker:** reuse generic typing for jobs ([9adcdb7](https://github.com/taskforcesh/bullmq/commit/9adcdb798b4ee55835123a9f3d04c1397b176dc1))

# [1.60.0](https://github.com/taskforcesh/bullmq/compare/v1.59.4...v1.60.0) (2021-12-29)


### Features

* **queue-scheduler:** add better event typing ([#963](https://github.com/taskforcesh/bullmq/issues/963)) ([b23c006](https://github.com/taskforcesh/bullmq/commit/b23c006e2bfce8a0709f0eb8e8739261b68c2f48))

## [1.59.4](https://github.com/taskforcesh/bullmq/compare/v1.59.3...v1.59.4) (2021-12-21)


### Bug Fixes

* downgrade typescript to 3.9.10 fixes [#917](https://github.com/taskforcesh/bullmq/issues/917) ([#960](https://github.com/taskforcesh/bullmq/issues/960)) ([4e51fe0](https://github.com/taskforcesh/bullmq/commit/4e51fe00751092ee8f521039a3f2b41d881b71ae))

## [1.59.3](https://github.com/taskforcesh/bullmq/compare/v1.59.2...v1.59.3) (2021-12-21)


### Bug Fixes

* **worker:** fix undefined moveToActive ([87e8cab](https://github.com/taskforcesh/bullmq/commit/87e8cab16dad6f8bd9e9ec369ef7e79f471180be))

## [1.59.2](https://github.com/taskforcesh/bullmq/compare/v1.59.1...v1.59.2) (2021-12-17)


### Bug Fixes

* **package:** add jsnext:main prop ([#953](https://github.com/taskforcesh/bullmq/issues/953)) ([1a92bf7](https://github.com/taskforcesh/bullmq/commit/1a92bf7d41860f758841c5a833c1192d9a84a25f))

## [1.59.1](https://github.com/taskforcesh/bullmq/compare/v1.59.0...v1.59.1) (2021-12-17)


### Bug Fixes

* copy lua files to correct location ([2be1120](https://github.com/taskforcesh/bullmq/commit/2be1120974692ee57ec00e30d6dbbef670d88a1e))

# [1.59.0](https://github.com/taskforcesh/bullmq/compare/v1.58.0...v1.59.0) (2021-12-17)


### Bug Fixes

* correct dist path ([067d4c2](https://github.com/taskforcesh/bullmq/commit/067d4c2009b877f8bf6e6145507a41a53e5f7af3))


### Features

* also export bullmq as an ESM ([e97e5b5](https://github.com/taskforcesh/bullmq/commit/e97e5b52b079adf2ed79f7cb61699e40a91e34e8))

# [1.58.0](https://github.com/taskforcesh/bullmq/compare/v1.57.4...v1.58.0) (2021-12-15)


### Features

* **worker:** add better event typing ([#940](https://github.com/taskforcesh/bullmq/issues/940)) ([a326d4f](https://github.com/taskforcesh/bullmq/commit/a326d4f27e96ffa462a908ac14356d29839ff073))

## [1.57.4](https://github.com/taskforcesh/bullmq/compare/v1.57.3...v1.57.4) (2021-12-14)


### Bug Fixes

* **move-to-active:** add try catch in moveToActive call ([#933](https://github.com/taskforcesh/bullmq/issues/933)) ([bab45b0](https://github.com/taskforcesh/bullmq/commit/bab45b05d08c625557e2df65921e12f48081d39c))
* **redis-connection:** consider cluster redisOptions config ([#934](https://github.com/taskforcesh/bullmq/issues/934)) ([5130f63](https://github.com/taskforcesh/bullmq/commit/5130f63ad969efa9649ab8f9abf36a72e8f553f4))

## [1.57.3](https://github.com/taskforcesh/bullmq/compare/v1.57.2...v1.57.3) (2021-12-14)


### Bug Fixes

* remove debug console.error ([#932](https://github.com/taskforcesh/bullmq/issues/932)) ([271aac3](https://github.com/taskforcesh/bullmq/commit/271aac3417bc7f76ac02435b456552677b2847db))

## [1.57.2](https://github.com/taskforcesh/bullmq/compare/v1.57.1...v1.57.2) (2021-12-11)


### Bug Fixes

* **connection:** check instance options to console log deprecation message ([#927](https://github.com/taskforcesh/bullmq/issues/927)) ([fc1e2b9](https://github.com/taskforcesh/bullmq/commit/fc1e2b9f3f20db53f9dc7ecdfa4644f02acc9f83))


### Performance Improvements

* **add-job:** save parent data as json ([#859](https://github.com/taskforcesh/bullmq/issues/859)) ([556d4ee](https://github.com/taskforcesh/bullmq/commit/556d4ee427090f60270945a7fd438e2595bb43e9))

## [1.57.1](https://github.com/taskforcesh/bullmq/compare/v1.57.0...v1.57.1) (2021-12-11)


### Bug Fixes

* **worker:** better handling of block timeout ([be4c933](https://github.com/taskforcesh/bullmq/commit/be4c933ae0a7a790d24a081b2ed4e7e1c0216e47))

# [1.57.0](https://github.com/taskforcesh/bullmq/compare/v1.56.0...v1.57.0) (2021-12-08)


### Features

* **queue-events:** add better event typing ([#919](https://github.com/taskforcesh/bullmq/issues/919)) ([e980080](https://github.com/taskforcesh/bullmq/commit/e980080767bc56ae09a5c5cf33728a85a023bb42))

# [1.56.0](https://github.com/taskforcesh/bullmq/compare/v1.55.1...v1.56.0) (2021-12-06)


### Bug Fixes

* emit drain event if no jobs left when completing ([9ad78a9](https://github.com/taskforcesh/bullmq/commit/9ad78a91c0a4a74cf84bd77d351d98195104f0b6))
* **worker:** use client for setting worker name ([af65c2c](https://github.com/taskforcesh/bullmq/commit/af65c2cd0d3fb232c617b018d4991f3276db11ea))


### Features

* **worker:** make moveToActive protected ([d2897ee](https://github.com/taskforcesh/bullmq/commit/d2897ee7bbf4aee5251ac4fb28705f2bebbe7bfe))

## [1.55.1](https://github.com/taskforcesh/bullmq/compare/v1.55.0...v1.55.1) (2021-12-03)


### Bug Fixes

* **worker:** always try to move to active after waiting for job ([#914](https://github.com/taskforcesh/bullmq/issues/914)) ([97b7084](https://github.com/taskforcesh/bullmq/commit/97b708451bf4ce14a461a50f8a24d14b0e40dd4b))

# [1.55.0](https://github.com/taskforcesh/bullmq/compare/v1.54.6...v1.55.0) (2021-12-02)


### Features

* **script-loader:** lua script loader with include support ([#897](https://github.com/taskforcesh/bullmq/issues/897)) ([64b6ccf](https://github.com/taskforcesh/bullmq/commit/64b6ccf2a373b40d7ea763b3d35cf34f36ba11da))

## [1.54.6](https://github.com/taskforcesh/bullmq/compare/v1.54.5...v1.54.6) (2021-11-30)


### Bug Fixes

* **stalled:** save finishedOn when job stalled more than allowable limit ([#900](https://github.com/taskforcesh/bullmq/issues/900)) ([eb89edf](https://github.com/taskforcesh/bullmq/commit/eb89edf2f4eb85dedb1485de32e79331940a654f))

## [1.54.5](https://github.com/taskforcesh/bullmq/compare/v1.54.4...v1.54.5) (2021-11-26)


### Bug Fixes

* **tsconfig:** only include node types ([#895](https://github.com/taskforcesh/bullmq/issues/895)) ([5f4fdca](https://github.com/taskforcesh/bullmq/commit/5f4fdca5f416f2cd9d83eb0fba84e56c24320b63))

## [1.54.4](https://github.com/taskforcesh/bullmq/compare/v1.54.3...v1.54.4) (2021-11-24)


### Bug Fixes

* **child-processor:** add deprecation warning for progress method ([#890](https://github.com/taskforcesh/bullmq/issues/890)) ([f80b19a](https://github.com/taskforcesh/bullmq/commit/f80b19a5aa85413b8906aa0fac1bfd09bec990cb))

## [1.54.3](https://github.com/taskforcesh/bullmq/compare/v1.54.2...v1.54.3) (2021-11-22)


### Bug Fixes

* **clean:** use range values in lua script ([#885](https://github.com/taskforcesh/bullmq/issues/885)) ([02ef63a](https://github.com/taskforcesh/bullmq/commit/02ef63a8163e627a270a1c1bd74989a67c3f15f7))

## [1.54.2](https://github.com/taskforcesh/bullmq/compare/v1.54.1...v1.54.2) (2021-11-20)


### Bug Fixes

* **job:** use this when use new operators ([#884](https://github.com/taskforcesh/bullmq/issues/884)) ([7b84283](https://github.com/taskforcesh/bullmq/commit/7b842839e1d30967ebf15b901033e3b31e929df8))

## [1.54.1](https://github.com/taskforcesh/bullmq/compare/v1.54.0...v1.54.1) (2021-11-19)


### Bug Fixes

* **job:** change private attributes to protected for extensions ([#882](https://github.com/taskforcesh/bullmq/issues/882)) ([ffcc3f0](https://github.com/taskforcesh/bullmq/commit/ffcc3f083c23e6de3587c38fb7aacb2e19085351))

# [1.54.0](https://github.com/taskforcesh/bullmq/compare/v1.53.0...v1.54.0) (2021-11-17)


### Features

* **load-includes:** export includes to be reused in extensions ([#877](https://github.com/taskforcesh/bullmq/issues/877)) ([b56c4a9](https://github.com/taskforcesh/bullmq/commit/b56c4a9cf2ecebb44481618026589162be61680a))

# [1.53.0](https://github.com/taskforcesh/bullmq/compare/v1.52.2...v1.53.0) (2021-11-16)


### Features

* **queue-events:** add cleaned event ([#865](https://github.com/taskforcesh/bullmq/issues/865)) ([b3aebad](https://github.com/taskforcesh/bullmq/commit/b3aebad8a62311e135d53be2e7c5e47740547465))

## [1.52.2](https://github.com/taskforcesh/bullmq/compare/v1.52.1...v1.52.2) (2021-11-14)


### Bug Fixes

* **worker:** change private attributes to protected for pro extension ([#874](https://github.com/taskforcesh/bullmq/issues/874)) ([1c73881](https://github.com/taskforcesh/bullmq/commit/1c738819b49f206688ed7b3b9d103077045e1b05))

## [1.52.1](https://github.com/taskforcesh/bullmq/compare/v1.52.0...v1.52.1) (2021-11-12)


### Performance Improvements

* **clean:** speed up clean method when called with limit param ([#864](https://github.com/taskforcesh/bullmq/issues/864)) ([09b5cb4](https://github.com/taskforcesh/bullmq/commit/09b5cb45a79c4bc53a52d540918c22477a066e16))

# [1.52.0](https://github.com/taskforcesh/bullmq/compare/v1.51.3...v1.52.0) (2021-11-11)


### Features

* **queue:** add waiting event type declaration ([#872](https://github.com/taskforcesh/bullmq/issues/872)) ([f29925d](https://github.com/taskforcesh/bullmq/commit/f29925da3b12f573582ea188ec386e86023cefc9))

## [1.51.3](https://github.com/taskforcesh/bullmq/compare/v1.51.2...v1.51.3) (2021-11-04)


### Bug Fixes

* **move-to-failed:** delete closing check that prevents script execution ([#858](https://github.com/taskforcesh/bullmq/issues/858)) fixes [#834](https://github.com/taskforcesh/bullmq/issues/834) ([d50814f](https://github.com/taskforcesh/bullmq/commit/d50814f864448c10fec8e93651a2095fa4ef3f4e))

## [1.51.2](https://github.com/taskforcesh/bullmq/compare/v1.51.1...v1.51.2) (2021-11-03)


### Bug Fixes

* **flow:** remove repeat option from FlowJob opts ([#853](https://github.com/taskforcesh/bullmq/issues/853)) fixes [#851](https://github.com/taskforcesh/bullmq/issues/851) ([c9ee2f1](https://github.com/taskforcesh/bullmq/commit/c9ee2f100a23aa24034598b7d452c69720d7aabd))

## [1.51.1](https://github.com/taskforcesh/bullmq/compare/v1.51.0...v1.51.1) (2021-10-29)


### Bug Fixes

* **commands:** copy includes lua scripts ([#843](https://github.com/taskforcesh/bullmq/issues/843)) fixes [#837](https://github.com/taskforcesh/bullmq/issues/837) ([cab33e0](https://github.com/taskforcesh/bullmq/commit/cab33e08bc78bd3c45b86158a818100beeb06d81))

# [1.51.0](https://github.com/taskforcesh/bullmq/compare/v1.50.7...v1.51.0) (2021-10-28)


### Features

* **flow:** consider continually adding jobs ([#828](https://github.com/taskforcesh/bullmq/issues/828)) fixes [#826](https://github.com/taskforcesh/bullmq/issues/826) ([b0fde69](https://github.com/taskforcesh/bullmq/commit/b0fde69f4370160a891e4654485c09745066b80b))

## [1.50.7](https://github.com/taskforcesh/bullmq/compare/v1.50.6...v1.50.7) (2021-10-28)


### Bug Fixes

* override enableReadyCheck, maxRetriesPerRequest fixes reconnection ([09ba358](https://github.com/taskforcesh/bullmq/commit/09ba358b6f761bdc52b0f5b2aa315cc6c2a9db6e))
* **queue-base:** deprecation warning on missing connection ([2f79802](https://github.com/taskforcesh/bullmq/commit/2f79802378d7e015b5d0702945a71c1c2073251e))

## [1.50.6](https://github.com/taskforcesh/bullmq/compare/v1.50.5...v1.50.6) (2021-10-28)


### Bug Fixes

* **queue-base:** show connection deprecation warning ([#832](https://github.com/taskforcesh/bullmq/issues/832)) fixes [#829](https://github.com/taskforcesh/bullmq/issues/829) ([5d023fe](https://github.com/taskforcesh/bullmq/commit/5d023fe7b671a2547398fd68995ccd85216cc7a5))

## [1.50.5](https://github.com/taskforcesh/bullmq/compare/v1.50.4...v1.50.5) (2021-10-21)


### Bug Fixes

* **child-pool:** pipe process stdout and stderr([#822](https://github.com/taskforcesh/bullmq/issues/822)) fixes [#821](https://github.com/taskforcesh/bullmq/issues/821) ([13f5c62](https://github.com/taskforcesh/bullmq/commit/13f5c62174925e4638acda6a9de379668048189d))

## [1.50.4](https://github.com/taskforcesh/bullmq/compare/v1.50.3...v1.50.4) (2021-10-20)


### Bug Fixes

* properly pass sharedConnection option to worker base class ([56557f1](https://github.com/taskforcesh/bullmq/commit/56557f1c0c3fb04bc3dd8824819c2d4367324c3b))

## [1.50.3](https://github.com/taskforcesh/bullmq/compare/v1.50.2...v1.50.3) (2021-10-18)


### Bug Fixes

* **msgpackr:** upgrade version to 1.4.6 to support esm bundlers ([#818](https://github.com/taskforcesh/bullmq/issues/818)) fixes [#813](https://github.com/taskforcesh/bullmq/issues/813) ([913d7a9](https://github.com/taskforcesh/bullmq/commit/913d7a9a892d2c7e2fa5822367355c2dee888583))

## [1.50.2](https://github.com/taskforcesh/bullmq/compare/v1.50.1...v1.50.2) (2021-10-12)


### Bug Fixes

* **msgpack:** replace msgpack by msgpackr ([dc13a75](https://github.com/taskforcesh/bullmq/commit/dc13a75374bbd29fefbf3e56f822e763df3712d9))

## [1.50.1](https://github.com/taskforcesh/bullmq/compare/v1.50.0...v1.50.1) (2021-10-12)


### Bug Fixes

* **queue-getters:** only getting the first 2 jobs ([653873a](https://github.com/taskforcesh/bullmq/commit/653873a6a86dd6c3e1afc3142efbe11014d80557))

# [1.50.0](https://github.com/taskforcesh/bullmq/compare/v1.49.0...v1.50.0) (2021-10-12)


### Features

* easier to build extensions on top of BullMQ ([b1a9e64](https://github.com/taskforcesh/bullmq/commit/b1a9e64a9184addc0b8245a04013e1c896e9c2bc))

# [1.49.0](https://github.com/taskforcesh/bullmq/compare/v1.48.3...v1.49.0) (2021-10-08)


### Features

* **sandboxed-process:** handle init-failed error ([#797](https://github.com/taskforcesh/bullmq/issues/797)) ([5d2f553](https://github.com/taskforcesh/bullmq/commit/5d2f55342b19ee99d34f8d8003f09359cfe17d4f))

## [1.48.3](https://github.com/taskforcesh/bullmq/compare/v1.48.2...v1.48.3) (2021-10-05)


### Bug Fixes

* **change-delay:** add current time to delay ([#789](https://github.com/taskforcesh/bullmq/issues/789)) fixes [#787](https://github.com/taskforcesh/bullmq/issues/787) ([4a70def](https://github.com/taskforcesh/bullmq/commit/4a70def6e85cf9ea384ec5f38c3c4f83e4eb523c))

## [1.48.2](https://github.com/taskforcesh/bullmq/compare/v1.48.1...v1.48.2) (2021-09-24)


### Performance Improvements

* **obliterate:** do not pass unused variables ([#766](https://github.com/taskforcesh/bullmq/issues/766)) ([e9abfa6](https://github.com/taskforcesh/bullmq/commit/e9abfa6f821064901770a9b72adfb00cac96154c))

## [1.48.1](https://github.com/taskforcesh/bullmq/compare/v1.48.0...v1.48.1) (2021-09-23)


### Bug Fixes

* **obliterate:** consider dependencies and processed keys ([#765](https://github.com/taskforcesh/bullmq/issues/765)) ([fd6bad8](https://github.com/taskforcesh/bullmq/commit/fd6bad8c7444c21e6f1d67611a28f8e4aace293d))

# [1.48.0](https://github.com/taskforcesh/bullmq/compare/v1.47.2...v1.48.0) (2021-09-23)


### Features

* **queue:** add drain lua script ([#764](https://github.com/taskforcesh/bullmq/issues/764)) ([2daa698](https://github.com/taskforcesh/bullmq/commit/2daa698a7cc5dc8a6cd087b2d29356bc02fb4944))

## [1.47.2](https://github.com/taskforcesh/bullmq/compare/v1.47.1...v1.47.2) (2021-09-22)


### Bug Fixes

* **flow-producer:** use default prefix in add method ([#763](https://github.com/taskforcesh/bullmq/issues/763)) fixes [#762](https://github.com/taskforcesh/bullmq/issues/762) ([fffdb55](https://github.com/taskforcesh/bullmq/commit/fffdb55f37917776494a4471673ef4564e0faab5))

## [1.47.1](https://github.com/taskforcesh/bullmq/compare/v1.47.0...v1.47.1) (2021-09-17)


### Bug Fixes

* **running:** move running attribute before first async call ([#756](https://github.com/taskforcesh/bullmq/issues/756)) ([f7f0660](https://github.com/taskforcesh/bullmq/commit/f7f066076bbe6cbcbf716ae622d55c6c1ae9b270))

# [1.47.0](https://github.com/taskforcesh/bullmq/compare/v1.46.7...v1.47.0) (2021-09-16)


### Features

* **queue-events:** launch without launching process ([#750](https://github.com/taskforcesh/bullmq/issues/750)) ([23a2360](https://github.com/taskforcesh/bullmq/commit/23a23606e727ca13b24924a1e867c6b557d6a09d))

## [1.46.7](https://github.com/taskforcesh/bullmq/compare/v1.46.6...v1.46.7) (2021-09-16)


### Bug Fixes

* **wait-for-job:** add catch block and emit error ([#749](https://github.com/taskforcesh/bullmq/issues/749)) ([b407f9a](https://github.com/taskforcesh/bullmq/commit/b407f9ac429c825984856eebca58bbfd16feb9d3))

## [1.46.6](https://github.com/taskforcesh/bullmq/compare/v1.46.5...v1.46.6) (2021-09-15)


### Bug Fixes

* **connection:** fail only if redis connection does not recover ([#751](https://github.com/taskforcesh/bullmq/issues/751)) ([8d59ced](https://github.com/taskforcesh/bullmq/commit/8d59ced27831a636f40ed4233eba3d4ac0654534))

## [1.46.5](https://github.com/taskforcesh/bullmq/compare/v1.46.4...v1.46.5) (2021-09-12)


### Bug Fixes

* **is-finished:** reject when missing job key ([#746](https://github.com/taskforcesh/bullmq/issues/746)) fixes [#85](https://github.com/taskforcesh/bullmq/issues/85) ([bd49bd2](https://github.com/taskforcesh/bullmq/commit/bd49bd20492676559072e5e16adb6d4e47afb22b))

## [1.46.4](https://github.com/taskforcesh/bullmq/compare/v1.46.3...v1.46.4) (2021-09-10)


### Bug Fixes

* **wait-until-finished:** isFinished return failedReason or returnValue ([#743](https://github.com/taskforcesh/bullmq/issues/743)) fixes [#555](https://github.com/taskforcesh/bullmq/issues/555) ([63acae9](https://github.com/taskforcesh/bullmq/commit/63acae98cb083ec978ea17833819d1a21086be33))

## [1.46.3](https://github.com/taskforcesh/bullmq/compare/v1.46.2...v1.46.3) (2021-09-08)


### Bug Fixes

* **add-job:** throw error when missing parent key ([#739](https://github.com/taskforcesh/bullmq/issues/739)) ([d751070](https://github.com/taskforcesh/bullmq/commit/d751070f4ab6553c782341270574ccd253d309b8))

## [1.46.2](https://github.com/taskforcesh/bullmq/compare/v1.46.1...v1.46.2) (2021-09-07)


### Bug Fixes

* **queue-events:** duplicate connection ([#733](https://github.com/taskforcesh/bullmq/issues/733)) fixes [#726](https://github.com/taskforcesh/bullmq/issues/726) ([e2531ed](https://github.com/taskforcesh/bullmq/commit/e2531ed0c1dc195f210f8cf996e9ffe04c9e4b7d))

## [1.46.1](https://github.com/taskforcesh/bullmq/compare/v1.46.0...v1.46.1) (2021-09-06)


### Bug Fixes

* **redis-connection:** improve closing fixes [#721](https://github.com/taskforcesh/bullmq/issues/721) ([9d8eb03](https://github.com/taskforcesh/bullmq/commit/9d8eb0306ef5e63c9d34ffd5c96fc15491da639d))

# [1.46.0](https://github.com/taskforcesh/bullmq/compare/v1.45.0...v1.46.0) (2021-09-02)


### Features

* **worker:** launch without launching process ([#724](https://github.com/taskforcesh/bullmq/issues/724)) ([af689e4](https://github.com/taskforcesh/bullmq/commit/af689e4e3945b9bc68bfc08c8f0ad57644206c5b)), closes [#436](https://github.com/taskforcesh/bullmq/issues/436)

# [1.45.0](https://github.com/taskforcesh/bullmq/compare/v1.44.3...v1.45.0) (2021-09-02)


### Features

* **queue-scheduler:** launch without launching process ([#729](https://github.com/taskforcesh/bullmq/issues/729)) ([f1932a7](https://github.com/taskforcesh/bullmq/commit/f1932a789af13da9b705a72d6f633f984a218862)), closes [#436](https://github.com/taskforcesh/bullmq/issues/436)

## [1.44.3](https://github.com/taskforcesh/bullmq/compare/v1.44.2...v1.44.3) (2021-09-02)


### Bug Fixes

* **queuescheduler:** handle shared connections fixes [#721](https://github.com/taskforcesh/bullmq/issues/721) ([32a2b2e](https://github.com/taskforcesh/bullmq/commit/32a2b2eccfa3ba1516eacd71e334cae6c787ce4c))

## [1.44.2](https://github.com/taskforcesh/bullmq/compare/v1.44.1...v1.44.2) (2021-08-29)


### Bug Fixes

* **worker:** use spread operator in processing map keys ([#720](https://github.com/taskforcesh/bullmq/issues/720)) ([32f1e57](https://github.com/taskforcesh/bullmq/commit/32f1e570a9a3369174a228f729f1d1330dcb6965))

## [1.44.1](https://github.com/taskforcesh/bullmq/compare/v1.44.0...v1.44.1) (2021-08-29)


### Bug Fixes

* **retry:** throw error when retry non failed job ([#717](https://github.com/taskforcesh/bullmq/issues/717)) ([bb9b192](https://github.com/taskforcesh/bullmq/commit/bb9b192e9a1a4f3c25374fcb8c0fb2159eb3f779))

# [1.44.0](https://github.com/taskforcesh/bullmq/compare/v1.43.0...v1.44.0) (2021-08-27)


### Features

* **queue-events:** add waiting-children event ([#704](https://github.com/taskforcesh/bullmq/issues/704)) ([18b0b79](https://github.com/taskforcesh/bullmq/commit/18b0b7954313274a61fcc058380bfb9d682c059d))


# [1.43.0](https://github.com/taskforcesh/bullmq/compare/v1.42.1...v1.43.0) \(2021-08-25\)


### Features

* **events:** add added event when job is created \([\#699](https://github.com/taskforcesh/bullmq/issues/699)\) \([f533cc5](https://github.com/taskforcesh/bullmq/commit/f533cc55a43cf6ea78a60e85102f15b1c1ff69a0)\)

## [1.42.1](https://github.com/taskforcesh/bullmq/compare/v1.42.0...v1.42.1) \(2021-08-23\)


### Bug Fixes

* protect emit calls with throw/catch \([79f879b](https://github.com/taskforcesh/bullmq/commit/79f879bf1bca1acea19485def361cc36f1d13b7e)\)

# [1.42.0](https://github.com/taskforcesh/bullmq/compare/v1.41.0...v1.42.0) \(2021-08-20\)


### Features

* **flows:** add queuesOptions for rate limit \([\#692](https://github.com/taskforcesh/bullmq/issues/692)\) \([6689ec3](https://github.com/taskforcesh/bullmq/commit/6689ec3fadd21904d9935f932c047f540ed8caf0)\), closes [\#621](https://github.com/taskforcesh/bullmq/issues/621)

# [1.41.0](https://github.com/taskforcesh/bullmq/compare/v1.40.4...v1.41.0) \(2021-08-20\)


### Features

* **flow:** add bulk \([dc59fe6](https://github.com/taskforcesh/bullmq/commit/dc59fe62e57b6e761fe4d2ab6179a69dc4792399)\)

## [1.40.4](https://github.com/taskforcesh/bullmq/compare/v1.40.3...v1.40.4) \(2021-08-06\)

### Bug Fixes

* **rate-limiter:** check groupKey is not undefined \([999b918](https://github.com/taskforcesh/bullmq/commit/999b91868814caf4c5c1ddee40798178b71e0ea8)\)

## [1.40.3](https://github.com/taskforcesh/bullmq/compare/v1.40.2...v1.40.3) \(2021-08-06\)

### Bug Fixes

* **redis-connection:** add error event in waitUntilReady \([ac4101e](https://github.com/taskforcesh/bullmq/commit/ac4101e3e798110c022d6c9f10f3b98f5e86b151)\)

## [1.40.2](https://github.com/taskforcesh/bullmq/compare/v1.40.1...v1.40.2) \(2021-08-06\)

### Bug Fixes

* move clientCommandMessageReg to utils \([dd5d555](https://github.com/taskforcesh/bullmq/commit/dd5d5553fe768eb18b17b53c7f75e7066024e382)\)

## [1.40.1](https://github.com/taskforcesh/bullmq/compare/v1.40.0...v1.40.1) \(2021-07-24\)

### Bug Fixes

* connection hangs with failed connection fixes [\#656](https://github.com/taskforcesh/bullmq/issues/656) \([c465611](https://github.com/taskforcesh/bullmq/commit/c465611ed76afd2adfd0e05a8babd6e369f5c310)\)

# [1.40.0](https://github.com/taskforcesh/bullmq/compare/v1.39.5...v1.40.0) \(2021-07-22\)

### Features

* **worker:** retry with delay errors in run loop \([409fe7f](https://github.com/taskforcesh/bullmq/commit/409fe7fc09b87b7916a3362a463bb9e0f17ecea8)\)

## [1.39.5](https://github.com/taskforcesh/bullmq/compare/v1.39.4...v1.39.5) \(2021-07-21\)

### Bug Fixes

* **move-to-finished:** remove stalled jobs when finishing \([3867126](https://github.com/taskforcesh/bullmq/commit/38671261ccc00ca7fefa677663e45a40a92df555)\)

## [1.39.4](https://github.com/taskforcesh/bullmq/compare/v1.39.3...v1.39.4) \(2021-07-21\)

### Bug Fixes

* **repeatable:** validate endDate when adding next repeatable job \([1324cbb](https://github.com/taskforcesh/bullmq/commit/1324cbb4effd55e98c29d95a21afca7cd045b46c)\)

## [1.39.3](https://github.com/taskforcesh/bullmq/compare/v1.39.2...v1.39.3) \(2021-07-16\)

### Bug Fixes

* connect if redis client has status "wait" \([f711717](https://github.com/taskforcesh/bullmq/commit/f711717f56822aef43c9fd0440e30fad0876ba62)\)

## [1.39.2](https://github.com/taskforcesh/bullmq/compare/v1.39.1...v1.39.2) \(2021-07-15\)

### Bug Fixes

* **queue:** ensure the Queue constructor doesn't try to set queue options if the client is closed \([b40c6eb](https://github.com/taskforcesh/bullmq/commit/b40c6eb931a71d0ae9f6454eb70d84259a6981b7)\)

## [1.39.1](https://github.com/taskforcesh/bullmq/compare/v1.39.0...v1.39.1) \(2021-07-15\)

### Bug Fixes

* **sandbox:** use updateProgress method name \([27d62c3](https://github.com/taskforcesh/bullmq/commit/27d62c32b2fac091b2700d6077de593c9fda4c22)\)

# [1.39.0](https://github.com/taskforcesh/bullmq/compare/v1.38.1...v1.39.0) \(2021-07-13\)

### Features

* **worker+scheduler:** add a "running" attribute for healthchecking \([aae358e](https://github.com/taskforcesh/bullmq/commit/aae358e067a0b6f20124751cffcdeaebac6eb7fd)\)

## [1.38.1](https://github.com/taskforcesh/bullmq/compare/v1.38.0...v1.38.1) \(2021-07-12\)

### Bug Fixes

* **reprocess:** do not store job.id in added list \([9c0605e](https://github.com/taskforcesh/bullmq/commit/9c0605e10f0bbdce94153d3f318d56c23bfd3269)\)

# [1.38.0](https://github.com/taskforcesh/bullmq/compare/v1.37.1...v1.38.0) \(2021-07-12\)

### Features

* **queue:** add missing events typings \([b42e78c](https://github.com/taskforcesh/bullmq/commit/b42e78c36cb6a6579a4c7cce1d7e969b230ff5b6)\)

## [1.37.1](https://github.com/taskforcesh/bullmq/compare/v1.37.0...v1.37.1) \(2021-07-02\)

### Bug Fixes

* **stalled-jobs:** move stalled jobs to wait in batches \([a23fcb8](https://github.com/taskforcesh/bullmq/commit/a23fcb82d4ca20cbc4b8cd8b544b2d2eaddd86c3)\), closes [\#422](https://github.com/taskforcesh/bullmq/issues/422)

# [1.37.0](https://github.com/taskforcesh/bullmq/compare/v1.36.1...v1.37.0) \(2021-06-30\)

### Features

* **job:** add changeDelay method for delayed jobs \([f0a9f9c](https://github.com/taskforcesh/bullmq/commit/f0a9f9c6479062413abc0ac9a6f744329571a618)\)

## [1.36.1](https://github.com/taskforcesh/bullmq/compare/v1.36.0...v1.36.1) \(2021-06-22\)

### Bug Fixes

* **worker:** change active event typing \([220b4f6](https://github.com/taskforcesh/bullmq/commit/220b4f619b30a8f04979e9abd0139e46d89b424d)\)

# [1.36.0](https://github.com/taskforcesh/bullmq/compare/v1.35.0...v1.36.0) \(2021-06-20\)

### Bug Fixes

* **queue-events:** fix drained typing \([9cf711d](https://github.com/taskforcesh/bullmq/commit/9cf711d4d4e7d8214dfd93a243c35d0bf135cdaf)\)

### Features

* **worker:** add active event typing \([5508cdf](https://github.com/taskforcesh/bullmq/commit/5508cdf7cf372ae2f4af0ef576016eb901580671)\)
* **worker:** add progress event typing \([119cb7c](https://github.com/taskforcesh/bullmq/commit/119cb7cd7a91c0f1866f5957faf2850afadbe709)\)

# [1.35.0](https://github.com/taskforcesh/bullmq/compare/v1.34.2...v1.35.0) \(2021-06-19\)

### Features

* **worker:** add drained event typing \([ed5f315](https://github.com/taskforcesh/bullmq/commit/ed5f3155415693d2a6dbfb779397d53d74b704e2)\)

## [1.34.2](https://github.com/taskforcesh/bullmq/compare/v1.34.1...v1.34.2) \(2021-06-18\)

### Bug Fixes

* **worker:** await for processing functions \([0566804](https://github.com/taskforcesh/bullmq/commit/056680470283f134b447a8ba39afa29e1e113585)\)

## [1.34.1](https://github.com/taskforcesh/bullmq/compare/v1.34.0...v1.34.1) \(2021-06-18\)

### Bug Fixes

* **redis-connection:** remove error event listener from client \([2d70fe7](https://github.com/taskforcesh/bullmq/commit/2d70fe7cc7d43673674ec2ba0204c10661b34e95)\)

# [1.34.0](https://github.com/taskforcesh/bullmq/compare/v1.33.1...v1.34.0) \(2021-06-11\)

### Features

* **job:** expose queueName \([8683bd4](https://github.com/taskforcesh/bullmq/commit/8683bd470cc7304f087d646fd40c5bc3acc1263c)\)

## [1.33.1](https://github.com/taskforcesh/bullmq/compare/v1.33.0...v1.33.1) \(2021-06-10\)

### Bug Fixes

* **job:** destructure default opts for pagination \([73363a5](https://github.com/taskforcesh/bullmq/commit/73363a551f56608f8936ad1f730d0a9c778aafd2)\)

# [1.33.0](https://github.com/taskforcesh/bullmq/compare/v1.32.0...v1.33.0) \(2021-06-10\)

### Features

* **job:** add getDependenciesCount method \([ae39a4c](https://github.com/taskforcesh/bullmq/commit/ae39a4c77a958242cb445dbb32ae27b15a953653)\)

# [1.32.0](https://github.com/taskforcesh/bullmq/compare/v1.31.1...v1.32.0) \(2021-06-07\)

### Features

* **flow-producer:** add getFlow method \([ce93d04](https://github.com/taskforcesh/bullmq/commit/ce93d04c962686aff34f670f2decadadbf1cf4ca)\)

## [1.31.1](https://github.com/taskforcesh/bullmq/compare/v1.31.0...v1.31.1) \(2021-06-07\)

### Bug Fixes

* **worker:** remove processed key when removeOnComplete \([4ec1b73](https://github.com/taskforcesh/bullmq/commit/4ec1b739d6aeeb2fc21887b58f5978027ddcdb50)\)

# [1.31.0](https://github.com/taskforcesh/bullmq/compare/v1.30.2...v1.31.0) \(2021-06-04\)

### Features

* **job:** extend getDependencies to support pagination \([9b61bbb](https://github.com/taskforcesh/bullmq/commit/9b61bbb9160358f629cd458fa8dc4c9b6ebcd9f5)\)

## [1.30.2](https://github.com/taskforcesh/bullmq/compare/v1.30.1...v1.30.2) \(2021-06-03\)

### Bug Fixes

* **job:** parse results in getDependencies for processed jobs \([6fdc701](https://github.com/taskforcesh/bullmq/commit/6fdc7011ba910e5ca9c6d87926cc523ef38ef3ca)\)

## [1.30.1](https://github.com/taskforcesh/bullmq/compare/v1.30.0...v1.30.1) \(2021-06-02\)

### Bug Fixes

* **move-to-waiting-children:** make opts optional \([33bd76a](https://github.com/taskforcesh/bullmq/commit/33bd76a2cac9be450b5d76c6cfe16751c7569ceb)\)

# [1.30.0](https://github.com/taskforcesh/bullmq/compare/v1.29.1...v1.30.0) \(2021-06-02\)

### Features

* add some event typing \([934c004](https://github.com/taskforcesh/bullmq/commit/934c0040b0802bb67f44a979584405d795a8ab5e)\)

## [1.29.1](https://github.com/taskforcesh/bullmq/compare/v1.29.0...v1.29.1) \(2021-05-31\)

### Bug Fixes

* **move-stalled-jobs-to-wait:** send failedReason to queueEvents \([7c510b5](https://github.com/taskforcesh/bullmq/commit/7c510b542558bd4b1330371b73331f37b97a818d)\)

# [1.29.0](https://github.com/taskforcesh/bullmq/compare/v1.28.2...v1.29.0) \(2021-05-31\)

### Features

* add move to waiting children for manual processing \([\#477](https://github.com/taskforcesh/bullmq/issues/477)\) \([f312f29](https://github.com/taskforcesh/bullmq/commit/f312f293b8cac79af9c14848ffd1b11b65a806c3)\)

## [1.28.2](https://github.com/taskforcesh/bullmq/compare/v1.28.1...v1.28.2) \(2021-05-31\)

### Bug Fixes

* **obliterate:** remove job logs \([ea91895](https://github.com/taskforcesh/bullmq/commit/ea918950d7696241047a23773cc13cd675209c4b)\)

## [1.28.1](https://github.com/taskforcesh/bullmq/compare/v1.28.0...v1.28.1) \(2021-05-31\)

### Bug Fixes

* **get-workers:** use strict equality on name fixes [\#564](https://github.com/taskforcesh/bullmq/issues/564) \([4becfa6](https://github.com/taskforcesh/bullmq/commit/4becfa66e09dacf9830804898c45cb3317dcf438)\)

# [1.28.0](https://github.com/taskforcesh/bullmq/compare/v1.27.0...v1.28.0) \(2021-05-24\)

### Features

* **flow-producer:** expose client connection \([17d4263](https://github.com/taskforcesh/bullmq/commit/17d4263abfa57797535cd8773c4cc316ff5149d2)\)

# [1.27.0](https://github.com/taskforcesh/bullmq/compare/v1.26.5...v1.27.0) \(2021-05-24\)

### Features

* **repeat:** add immediately opt for repeat \([d095573](https://github.com/taskforcesh/bullmq/commit/d095573f8e7ce5911f777df48368382eceb99d6a)\)

## [1.26.5](https://github.com/taskforcesh/bullmq/compare/v1.26.4...v1.26.5) \(2021-05-21\)

### Bug Fixes

* **movetofinished:** use parent queue for events \([1b17b62](https://github.com/taskforcesh/bullmq/commit/1b17b62a794728a318f1079e73d07e33fe65c9c7)\)

## [1.26.4](https://github.com/taskforcesh/bullmq/compare/v1.26.3...v1.26.4) \(2021-05-20\)

### Bug Fixes

* **removejob:** delete processed hash \([a2a5058](https://github.com/taskforcesh/bullmq/commit/a2a5058f18ab77ed4d0114d48f47e6144d632cbf)\)

## [1.26.3](https://github.com/taskforcesh/bullmq/compare/v1.26.2...v1.26.3) \(2021-05-19\)

### Bug Fixes

* ensure connection reconnects when pausing fixes [\#160](https://github.com/taskforcesh/bullmq/issues/160) \([f38fee8](https://github.com/taskforcesh/bullmq/commit/f38fee84def75dd8a38cbb8bfb5aa662485ddf91)\)

## [1.26.2](https://github.com/taskforcesh/bullmq/compare/v1.26.1...v1.26.2) \(2021-05-18\)

### Bug Fixes

* **getjoblogs:** no reversed pagination \([fb0c3a5](https://github.com/taskforcesh/bullmq/commit/fb0c3a50f0d37851a8f35cb4c478259a63d93461)\)

## [1.26.1](https://github.com/taskforcesh/bullmq/compare/v1.26.0...v1.26.1) \(2021-05-17\)

### Bug Fixes

* **flow-producer:** use custom jobId as parentId for children fixes [\#552](https://github.com/taskforcesh/bullmq/issues/552) \([645b576](https://github.com/taskforcesh/bullmq/commit/645b576c1aabd8426ab77a68c199a594867cd729)\)

# [1.26.0](https://github.com/taskforcesh/bullmq/compare/v1.25.1...v1.26.0) \(2021-05-16\)

### Features

* **custombackoff:** provide job as third parameter \([ddaf8dc](https://github.com/taskforcesh/bullmq/commit/ddaf8dc2f95ca336cb117a540edd4640d5d579e4)\)

## [1.25.2](https://github.com/taskforcesh/bullmq/compare/v1.25.1...v1.25.2) \(2021-05-16\)

### Bug Fixes

* **flow-producer:** process parent with children as empty array fixes [\#547](https://github.com/taskforcesh/bullmq/issues/547) \([48168f0](https://github.com/taskforcesh/bullmq/commit/48168f07cbaed7ed522c68d127a0c7d5e4cb380e)\)

## [1.25.1](https://github.com/taskforcesh/bullmq/compare/v1.25.0...v1.25.1) \(2021-05-13\)

### Bug Fixes

* **addbulk:** should not consider repeat option \([c85357e](https://github.com/taskforcesh/bullmq/commit/c85357e415b9ea66f845f751a4943b5c48c2bb18)\)

# [1.25.0](https://github.com/taskforcesh/bullmq/compare/v1.24.5...v1.25.0) \(2021-05-11\)

### Features

* **job:** add sizeLimit option when creating a job \([f10aeeb](https://github.com/taskforcesh/bullmq/commit/f10aeeb62520d20b31d35440524d147ac4adcc9c)\)

## [1.24.5](https://github.com/taskforcesh/bullmq/compare/v1.24.4...v1.24.5) \(2021-05-08\)

### Bug Fixes

* **deps:** upgrading lodash to 4.17.21 \([6e90c3f](https://github.com/taskforcesh/bullmq/commit/6e90c3f0a3d2735875ebf44457b342629aa14572)\)

## [1.24.4](https://github.com/taskforcesh/bullmq/compare/v1.24.3...v1.24.4) \(2021-05-07\)

### Bug Fixes

* **cluster:** add redis cluster support \([5a7dd14](https://github.com/taskforcesh/bullmq/commit/5a7dd145bd3ae11850cac6d1b4fb9b01af0e6766)\)
* **redisclient:** not reference types from import \([022fc04](https://github.com/taskforcesh/bullmq/commit/022fc042a17c1754af7d74acabb7dd5c397576ab)\)

## [1.24.3](https://github.com/taskforcesh/bullmq/compare/v1.24.2...v1.24.3) \(2021-05-05\)

### Bug Fixes

* **sandbox:** properly redirect stdout \([\#525](https://github.com/taskforcesh/bullmq/issues/525)\) \([c8642a0](https://github.com/taskforcesh/bullmq/commit/c8642a0724dc3d2f77abc4b5d6d24efa67c1e592)\)

## [1.24.2](https://github.com/taskforcesh/bullmq/compare/v1.24.1...v1.24.2) \(2021-05-05\)

### Bug Fixes

* **sandbox:** handle broken processor files \([2326983](https://github.com/taskforcesh/bullmq/commit/23269839af0be2f7cf2a4f6062563d30904bc259)\)

## [1.24.1](https://github.com/taskforcesh/bullmq/compare/v1.24.0...v1.24.1) \(2021-05-05\)

### Bug Fixes

* **queueevents:** add active type fixes [\#519](https://github.com/taskforcesh/bullmq/issues/519) \([10af883](https://github.com/taskforcesh/bullmq/commit/10af883db849cf9392b26724903f88752d9be92c)\)

# [1.24.0](https://github.com/taskforcesh/bullmq/compare/v1.23.1...v1.24.0) \(2021-05-03\)

### Features

* add option for non-blocking getNextJob \([13ce2cf](https://github.com/taskforcesh/bullmq/commit/13ce2cfd4ccd64f45567df31de11af95b0fe67d9)\)

## [1.23.1](https://github.com/taskforcesh/bullmq/compare/v1.23.0...v1.23.1) \(2021-05-03\)

### Bug Fixes

* add return type for job.waitUntilFinished\(\) \([59ede97](https://github.com/taskforcesh/bullmq/commit/59ede976061a738503f70d9eb0c92a4b1d6ae4a3)\)

# [1.23.0](https://github.com/taskforcesh/bullmq/compare/v1.22.2...v1.23.0) \(2021-04-30\)

### Features

* **job:** pass parent opts to addBulk \([7f21615](https://github.com/taskforcesh/bullmq/commit/7f216153293e45c4f33f2592561c925ca4464d44)\)

## [1.22.2](https://github.com/taskforcesh/bullmq/compare/v1.22.1...v1.22.2) \(2021-04-29\)

### Bug Fixes

* add missing Redis Cluster types fixes [\#406](https://github.com/taskforcesh/bullmq/issues/406) \([07743ff](https://github.com/taskforcesh/bullmq/commit/07743ff310ad716802afdd5bdc6844eb5296318e)\)

## [1.22.1](https://github.com/taskforcesh/bullmq/compare/v1.22.0...v1.22.1) \(2021-04-28\)

### Bug Fixes

* **addjob:** fix redis cluster CROSSSLOT \([a5fd1d7](https://github.com/taskforcesh/bullmq/commit/a5fd1d7a0713585d11bd862bfe2d426d5242bd3c)\)

# [1.22.0](https://github.com/taskforcesh/bullmq/compare/v1.21.0...v1.22.0) \(2021-04-28\)

### Features

* **jobcreate:** allow passing parent in job.create \([ede3626](https://github.com/taskforcesh/bullmq/commit/ede3626b65fb5d3f4cebc55c813e9fa4b482b887)\)

# [1.21.0](https://github.com/taskforcesh/bullmq/compare/v1.20.6...v1.21.0) \(2021-04-26\)

### Features

* add typing for addNextRepeatableJob \([a3be937](https://github.com/taskforcesh/bullmq/commit/a3be9379e29ae3e01264e2269e8b03aa614fd42c)\)

## [1.20.6](https://github.com/taskforcesh/bullmq/compare/v1.20.5...v1.20.6) \(2021-04-25\)

### Bug Fixes

* **movetocompleted:** should not complete before children \([812ff66](https://github.com/taskforcesh/bullmq/commit/812ff664b3e162dd87831ca04ebfdb783cc7ae5b)\)

## [1.20.5](https://github.com/taskforcesh/bullmq/compare/v1.20.4...v1.20.5) \(2021-04-23\)

### Bug Fixes

* **obliterate:** correctly remove many jobs \([b5ae4ce](https://github.com/taskforcesh/bullmq/commit/b5ae4ce92aeaf000408ffbbcd22d829cee20f2f8)\)

## [1.20.4](https://github.com/taskforcesh/bullmq/compare/v1.20.3...v1.20.4) \(2021-04-23\)

### Bug Fixes

* remove internal deps on barrel fixes [\#469](https://github.com/taskforcesh/bullmq/issues/469) \([\#495](https://github.com/taskforcesh/bullmq/issues/495)\) \([60dbeed](https://github.com/taskforcesh/bullmq/commit/60dbeed7ff1d9b6cb0e35590713fee8a7be09477)\)

## [1.20.3](https://github.com/taskforcesh/bullmq/compare/v1.20.2...v1.20.3) \(2021-04-23\)

### Bug Fixes

* **flows:** correct typings fixes [\#492](https://github.com/taskforcesh/bullmq/issues/492) \([a77f80b](https://github.com/taskforcesh/bullmq/commit/a77f80bc07e7627f512323f0dcc9141fe408809e)\)

## [1.20.2](https://github.com/taskforcesh/bullmq/compare/v1.20.1...v1.20.2) \(2021-04-22\)

### Bug Fixes

* **movetodelayed:** check if job is in active state \([4e63f70](https://github.com/taskforcesh/bullmq/commit/4e63f70aac367d4dd695bbe07c72a08a82a65d97)\)

## [1.20.1](https://github.com/taskforcesh/bullmq/compare/v1.20.0...v1.20.1) \(2021-04-22\)

### Bug Fixes

* **worker:** make token optional in processor function fixes [\#490](https://github.com/taskforcesh/bullmq/issues/490) \([3940bd7](https://github.com/taskforcesh/bullmq/commit/3940bd71c6faf3bd5fce572b9c1f11cb5b5d2123)\)

# [1.20.0](https://github.com/taskforcesh/bullmq/compare/v1.19.3...v1.20.0) \(2021-04-21\)

### Features

* **worker:** passing token in processor function \([2249724](https://github.com/taskforcesh/bullmq/commit/2249724b1bc6fbf40b0291400011f201fd02dab3)\)

## [1.19.3](https://github.com/taskforcesh/bullmq/compare/v1.19.2...v1.19.3) \(2021-04-20\)

### Bug Fixes

* **movetocompleted:** throw an error if job is not in active state \([c2fe5d2](https://github.com/taskforcesh/bullmq/commit/c2fe5d292fcf8ac2e53906c30282df69d43321b1)\)

## [1.19.2](https://github.com/taskforcesh/bullmq/compare/v1.19.1...v1.19.2) \(2021-04-19\)

### Bug Fixes

* **worker:** close base class connection [\#451](https://github.com/taskforcesh/bullmq/issues/451) \([0875306](https://github.com/taskforcesh/bullmq/commit/0875306ae801a7cbfe04758dc2481cb86ca2ef69)\)

## [1.19.1](https://github.com/taskforcesh/bullmq/compare/v1.19.0...v1.19.1) \(2021-04-19\)

### Bug Fixes

* remove repeatable with obliterate \([1c5e581](https://github.com/taskforcesh/bullmq/commit/1c5e581a619ba707863c2a6e9f3e5f6eadfbe64f)\)

# [1.19.0](https://github.com/taskforcesh/bullmq/compare/v1.18.2...v1.19.0) \(2021-04-19\)

### Features

* add workerDelay option to limiter \([9b6ab8a](https://github.com/taskforcesh/bullmq/commit/9b6ab8ad4bc0a94068f3bc707ad9c0ed01596068)\)

## [1.18.2](https://github.com/taskforcesh/bullmq/compare/v1.18.1...v1.18.2) \(2021-04-16\)

### Bug Fixes

* add parentKey property to Job \([febc60d](https://github.com/taskforcesh/bullmq/commit/febc60dba94c29b85be3e1bc2547fa83ed932806)\)

## [1.18.1](https://github.com/taskforcesh/bullmq/compare/v1.18.0...v1.18.1) \(2021-04-16\)

### Bug Fixes

* rename Flow to FlowProducer class \([c64321d](https://github.com/taskforcesh/bullmq/commit/c64321d03e2af7cee88eaf6df6cd2e5b7840ae64)\)

# [1.18.0](https://github.com/taskforcesh/bullmq/compare/v1.17.0...v1.18.0) \(2021-04-16\)

### Features

* add remove support for flows \([4e8a7ef](https://github.com/taskforcesh/bullmq/commit/4e8a7efd53f918937478ae13f5da7dee9ea9d8b3)\)

# [1.17.0](https://github.com/taskforcesh/bullmq/compare/v1.16.2...v1.17.0) \(2021-04-16\)

### Features

* **job:** consider waiting-children state \([2916dd5](https://github.com/taskforcesh/bullmq/commit/2916dd5d7ba9438d2eae66436899d32ec8ac0e91)\)

## [1.16.2](https://github.com/taskforcesh/bullmq/compare/v1.16.1...v1.16.2) \(2021-04-14\)

### Bug Fixes

* read lua scripts serially \([69e73b8](https://github.com/taskforcesh/bullmq/commit/69e73b87bc6855623240a7b1a45368a7914b23b7)\)

## [1.16.1](https://github.com/taskforcesh/bullmq/compare/v1.16.0...v1.16.1) \(2021-04-12\)

### Bug Fixes

* **flow:** relative dependency path fixes [\#466](https://github.com/taskforcesh/bullmq/issues/466) \([d104bf8](https://github.com/taskforcesh/bullmq/commit/d104bf802d6d1000ac1ccd781fa7a07bce2fe140)\)

# [1.16.0](https://github.com/taskforcesh/bullmq/compare/v1.15.1...v1.16.0) \(2021-04-12\)

### Features

* add support for flows \(parent-child dependencies\) \([\#454](https://github.com/taskforcesh/bullmq/issues/454)\) \([362212c](https://github.com/taskforcesh/bullmq/commit/362212c58c4be36b5435df862503699deb8bb79c)\)

## [1.15.1](https://github.com/taskforcesh/bullmq/compare/v1.15.0...v1.15.1) \(2021-03-19\)

### Bug Fixes

* **obliterate:** safer implementation \([82f571f](https://github.com/taskforcesh/bullmq/commit/82f571f2548c61c776b897fd1c5050bb09c8afca)\)

# [1.15.0](https://github.com/taskforcesh/bullmq/compare/v1.14.8...v1.15.0) \(2021-03-18\)

### Features

* add method to "obliterate" a queue, fixes [\#430](https://github.com/taskforcesh/bullmq/issues/430) \([624be0e](https://github.com/taskforcesh/bullmq/commit/624be0ed48159c2aa405025938925a723330e0c2)\)

## [1.14.8](https://github.com/taskforcesh/bullmq/compare/v1.14.7...v1.14.8) \(2021-03-06\)

### Bug Fixes

* specify promise type to make TS 4.1 and 4.2 happy. \([\#418](https://github.com/taskforcesh/bullmq/issues/418)\) \([702f609](https://github.com/taskforcesh/bullmq/commit/702f609b410d8b0652c2d0504a8a67526966fdc3)\)

## [1.14.7](https://github.com/taskforcesh/bullmq/compare/v1.14.6...v1.14.7) \(2021-02-16\)

### Bug Fixes

* remove "client" property of QueueBaseOptions \([\#324](https://github.com/taskforcesh/bullmq/issues/324)\) \([e0b9e71](https://github.com/taskforcesh/bullmq/commit/e0b9e71c4da4a93af54c4386af461c61ab5f146c)\)

## [1.14.6](https://github.com/taskforcesh/bullmq/compare/v1.14.5...v1.14.6) \(2021-02-16\)

### Bug Fixes

* remove next job in removeRepeatableByKey fixes [\#165](https://github.com/taskforcesh/bullmq/issues/165) \([fb3a7c2](https://github.com/taskforcesh/bullmq/commit/fb3a7c2f429d535dd9f038687d7230d61201defc)\)

## [1.14.5](https://github.com/taskforcesh/bullmq/compare/v1.14.4...v1.14.5) \(2021-02-16\)

### Bug Fixes

* add jobId support to repeatable jobs fixes [\#396](https://github.com/taskforcesh/bullmq/issues/396) \([c2dc669](https://github.com/taskforcesh/bullmq/commit/c2dc6693a4546e547245bc7ec1e71b4841829619)\)

## [1.14.4](https://github.com/taskforcesh/bullmq/compare/v1.14.3...v1.14.4) \(2021-02-08\)

### Bug Fixes

* reconnect at start fixes [\#337](https://github.com/taskforcesh/bullmq/issues/337) \([fb33772](https://github.com/taskforcesh/bullmq/commit/fb3377280b3bda04a15a62d2901bdd78b869e08c)\)

## [1.14.3](https://github.com/taskforcesh/bullmq/compare/v1.14.2...v1.14.3) \(2021-02-07\)

### Bug Fixes

* **worker:** avoid possible infinite loop fixes [\#389](https://github.com/taskforcesh/bullmq/issues/389) \([d05566e](https://github.com/taskforcesh/bullmq/commit/d05566ec0153f31a1257f7338399fdb55c959487)\)

## [1.14.2](https://github.com/taskforcesh/bullmq/compare/v1.14.1...v1.14.2) \(2021-02-02\)

### Bug Fixes

* improve job timeout notification by giving the job name and id in the error message \([\#387](https://github.com/taskforcesh/bullmq/issues/387)\) \([ca886b1](https://github.com/taskforcesh/bullmq/commit/ca886b1f854051aed0888f5b872a64b052b2383e)\)

## [1.14.1](https://github.com/taskforcesh/bullmq/compare/v1.14.0...v1.14.1) \(2021-02-01\)

### Bug Fixes

* job finish queue events race condition \([355bca5](https://github.com/taskforcesh/bullmq/commit/355bca5ee128bf4ff37608746f9c6f7cca580eb0)\)

# [1.14.0](https://github.com/taskforcesh/bullmq/compare/v1.13.0...v1.14.0) \(2021-01-06\)

### Features

* **job:** expose extendLock as a public method \([17e8431](https://github.com/taskforcesh/bullmq/commit/17e8431af8bba58612bf9913c63ab5d38afecbb9)\)

# [1.13.0](https://github.com/taskforcesh/bullmq/compare/v1.12.3...v1.13.0) \(2020-12-30\)

### Features

* add support for manually processing jobs fixes [\#327](https://github.com/taskforcesh/bullmq/issues/327) \([e42bfd2](https://github.com/taskforcesh/bullmq/commit/e42bfd2814fc5136b175470c3085355090cc2e01)\)

## [1.12.3](https://github.com/taskforcesh/bullmq/compare/v1.12.2...v1.12.3) \(2020-12-28\)

### Bug Fixes

* correctly handle "falsy" data values fixes [\#264](https://github.com/taskforcesh/bullmq/issues/264) \([becad91](https://github.com/taskforcesh/bullmq/commit/becad91350fd4ac01037e5b0d4a8a93724dd8dbd)\)
* **worker:** setname on worker blocking connection \([645b633](https://github.com/taskforcesh/bullmq/commit/645b6338f5883b0c21ae78007777d86b45422615)\)

## [1.12.2](https://github.com/taskforcesh/bullmq/compare/v1.12.1...v1.12.2) \(2020-12-23\)

### Bug Fixes

* catch errors from Repeat \([\#348](https://github.com/taskforcesh/bullmq/issues/348)\) \([09a1a98](https://github.com/taskforcesh/bullmq/commit/09a1a98fc42dc1a9ae98bfb29c0cca3fac02013f)\)

## [1.12.1](https://github.com/taskforcesh/bullmq/compare/v1.12.0...v1.12.1) \(2020-12-21\)

### Bug Fixes

* correctly handle "falsy" data values fixes [\#264](https://github.com/taskforcesh/bullmq/issues/264) \([cf1dbaf](https://github.com/taskforcesh/bullmq/commit/cf1dbaf7e60d74fc8443a5f8a537455f28a8dba3)\)

# [1.12.0](https://github.com/taskforcesh/bullmq/compare/v1.11.2...v1.12.0) \(2020-12-16\)

### Features

* add ability to get if queue is paused or not \([e98b7d8](https://github.com/taskforcesh/bullmq/commit/e98b7d8973df830cc29e0afc5d86e82c9a7ce76f)\)

## [1.11.2](https://github.com/taskforcesh/bullmq/compare/v1.11.1...v1.11.2) \(2020-12-15\)

### Bug Fixes

* promote jobs to the right "list" when paused \([d3df615](https://github.com/taskforcesh/bullmq/commit/d3df615d37b1114c02eacb45f23643ee2f05374d)\)

## [1.11.1](https://github.com/taskforcesh/bullmq/compare/v1.11.0...v1.11.1) \(2020-12-15\)

### Bug Fixes

* clientCommandMessageReg to support GCP memorystore v5 \([8408dda](https://github.com/taskforcesh/bullmq/commit/8408dda9fa64fc0b968e88fb2726e0a30f717ed7)\)

# [1.11.0](https://github.com/taskforcesh/bullmq/compare/v1.10.0...v1.11.0) \(2020-11-24\)

### Bug Fixes

* add generic type to processor \([d4f6501](https://github.com/taskforcesh/bullmq/commit/d4f650120804bd6161f0eeda5162ad5a96811a05)\)

### Features

* add name and return types to queue, worker and processor \([4879715](https://github.com/taskforcesh/bullmq/commit/4879715ec7c917f11e3a0ac3c5f5126029340ed3)\)

# [1.10.0](https://github.com/taskforcesh/bullmq/compare/v1.9.0...v1.10.0) \(2020-10-20\)

### Bug Fixes

* **job:** remove listeners before resolving promise \([563ce92](https://github.com/taskforcesh/bullmq/commit/563ce9218f5dd81f2bc836f9e8ccdedc549f09dd)\)
* **worker:** continue processing if handleFailed fails. fixes [\#286](https://github.com/taskforcesh/bullmq/issues/286) \([4ef1cbc](https://github.com/taskforcesh/bullmq/commit/4ef1cbc13d53897b57ae3d271afbaa1b213824aa)\)
* **worker:** fix memory leak on Promise.race \([\#282](https://github.com/taskforcesh/bullmq/issues/282)\) \([a78ab2b](https://github.com/taskforcesh/bullmq/commit/a78ab2b362e54f897eec6c8b16f16ecccf7875c2)\)
* **worker:** setname on worker blocking connection \([\#291](https://github.com/taskforcesh/bullmq/issues/291)\) \([50a87fc](https://github.com/taskforcesh/bullmq/commit/50a87fcb1dab976a6a0273d2b0cc4b31b63c015f)\)
* remove async for loop in child pool fixes [\#229](https://github.com/taskforcesh/bullmq/issues/229) \([d77505e](https://github.com/taskforcesh/bullmq/commit/d77505e989cd1395465c5222613555f79e4d9720)\)

### Features

* **sandbox:** kill child workers gracefully \([\#243](https://github.com/taskforcesh/bullmq/issues/243)\) \([4262837](https://github.com/taskforcesh/bullmq/commit/4262837bc67e007fe44606670dce48ee7fec65cd)\)

# [1.9.0](https://github.com/taskforcesh/bullmq/compare/v1.8.14...v1.9.0) \(2020-07-19\)

### Features

* add grouped rate limiting \([3a958dd](https://github.com/taskforcesh/bullmq/commit/3a958dd30d09a049b0d761679d3b8d92709e815e)\)

## [1.8.14](https://github.com/taskforcesh/bullmq/compare/v1.8.13...v1.8.14) \(2020-07-03\)

### Bug Fixes

* **typescript:** fix typings, upgrade ioredis dependencies \([\#220](https://github.com/taskforcesh/bullmq/issues/220)\) \([7059f20](https://github.com/taskforcesh/bullmq/commit/7059f2089553a206ab3937f7fd0d0b9de96aa7b7)\)
* **worker:** return this.closing when calling close \([b68c845](https://github.com/taskforcesh/bullmq/commit/b68c845c77de6b2973ec31d2f22958ab60ad87aa)\)

## [1.8.13](https://github.com/taskforcesh/bullmq/compare/v1.8.12...v1.8.13) \(2020-06-05\)

### Bug Fixes

* **redis-connection:** run the load command for reused redis client \([fab9bba](https://github.com/taskforcesh/bullmq/commit/fab9bba4caee8fd44523febb3bde588b151e8514)\)

## [1.8.12](https://github.com/taskforcesh/bullmq/compare/v1.8.11...v1.8.12) \(2020-06-04\)

### Bug Fixes

* remove unused options \([23aadc3](https://github.com/taskforcesh/bullmq/commit/23aadc300b947693f4afb22296d236a924bd11ca)\)

## [1.8.11](https://github.com/taskforcesh/bullmq/compare/v1.8.10...v1.8.11) \(2020-05-29\)

### Bug Fixes

* **scheduler:** remove unnecessary division by 4096 \([4d25e95](https://github.com/taskforcesh/bullmq/commit/4d25e95f9522388bd85e932e04b6668e3da57686)\)

## [1.8.10](https://github.com/taskforcesh/bullmq/compare/v1.8.9...v1.8.10) \(2020-05-28\)

### Bug Fixes

* **scheduler:** divide timestamp by 4096 in update set fixes [\#168](https://github.com/taskforcesh/bullmq/issues/168) \([0c5db83](https://github.com/taskforcesh/bullmq/commit/0c5db8391bb8994bee19f25a33efb9dfee792d7b)\)

## [1.8.9](https://github.com/taskforcesh/bullmq/compare/v1.8.8...v1.8.9) \(2020-05-25\)

### Bug Fixes

* **scheduler:** divide next timestamp by 4096 \([\#204](https://github.com/taskforcesh/bullmq/issues/204)\) \([9562d74](https://github.com/taskforcesh/bullmq/commit/9562d74625e20b7b6de8750339c85345ba027357)\)

## [1.8.8](https://github.com/taskforcesh/bullmq/compare/v1.8.7...v1.8.8) \(2020-05-25\)

### Bug Fixes

* **queue-base:** error event is passed through \([ad14e77](https://github.com/taskforcesh/bullmq/commit/ad14e777171c0c44b7e50752d9847dec23f46158)\)
* **redis-connection:** error event is passed through \([a15b1a1](https://github.com/taskforcesh/bullmq/commit/a15b1a1824c6863ecf3e5132e22924fc3ff161f6)\)
* **worker:** error event is passed through \([d7f0374](https://github.com/taskforcesh/bullmq/commit/d7f03749ce300e917399a435a3f426e66145dd8c)\)

## [1.8.7](https://github.com/taskforcesh/bullmq/compare/v1.8.6...v1.8.7) \(2020-04-10\)

### Bug Fixes

* **worker:** do not use global child pool fixes [\#172](https://github.com/taskforcesh/bullmq/issues/172) \([bc65f26](https://github.com/taskforcesh/bullmq/commit/bc65f26dd47c59d0a7277ac947140405557be9a5)\)

## [1.8.6](https://github.com/taskforcesh/bullmq/compare/v1.8.5...v1.8.6) \(2020-04-10\)

### Bug Fixes

* **workers:** do not call super.close\(\) \([ebd2ae1](https://github.com/taskforcesh/bullmq/commit/ebd2ae1a5613d71643c5a7ba3f685d77585de68e)\)
* make sure closing is returned in every close call \([88c5948](https://github.com/taskforcesh/bullmq/commit/88c5948d33a9a7b7a4f4f64f3183727b87d80207)\)
* **scheduler:** duplicate connections fixes [\#174](https://github.com/taskforcesh/bullmq/issues/174) \([011b8ac](https://github.com/taskforcesh/bullmq/commit/011b8acfdec54737d94a9fead2423e060e3364db)\)
* **worker:** return this.closing when calling close \([06d3d4f](https://github.com/taskforcesh/bullmq/commit/06d3d4f476444a2d2af8538d60cb2561a1915868)\)

## [1.8.5](https://github.com/taskforcesh/bullmq/compare/v1.8.4...v1.8.5) \(2020-04-05\)

### Bug Fixes

* removed deprecated and unused node-uuid \([c810579](https://github.com/taskforcesh/bullmq/commit/c810579029d33ef47d5a7563e63126a69c62fd87)\)

## [1.8.4](https://github.com/taskforcesh/bullmq/compare/v1.8.3...v1.8.4) \(2020-03-17\)

### Bug Fixes

* **job:** added nullable/optional properties \([cef134f](https://github.com/taskforcesh/bullmq/commit/cef134f7c4d87e1b80ba42a5e06c3877956ff4cc)\)

## [1.8.3](https://github.com/taskforcesh/bullmq/compare/v1.8.2...v1.8.3) \(2020-03-13\)

### Bug Fixes

* **sandbox:** If the child process is killed, remove it from the pool. \([8fb0fb5](https://github.com/taskforcesh/bullmq/commit/8fb0fb569a0236b37d3bae06bf58a2a1da3221c6)\)

## [1.8.2](https://github.com/taskforcesh/bullmq/compare/v1.8.1...v1.8.2) \(2020-03-03\)

### Bug Fixes

* restore the Job timestamp when deserializing JSON data \([\#138](https://github.com/taskforcesh/bullmq/issues/138)\) \([\#152](https://github.com/taskforcesh/bullmq/issues/152)\) \([c171bd4](https://github.com/taskforcesh/bullmq/commit/c171bd47f7b75378e75307a1decdc0f630ac1cd6)\)

## [1.8.1](https://github.com/taskforcesh/bullmq/compare/v1.8.0...v1.8.1) \(2020-03-02\)

### Bug Fixes

* modified imports to work when esModuleInterop is disabled \([\#132](https://github.com/taskforcesh/bullmq/issues/132)\) \([01681f2](https://github.com/taskforcesh/bullmq/commit/01681f282bafac2df2c602edb51d6bde3483896c)\)

# [1.8.0](https://github.com/taskforcesh/bullmq/compare/v1.7.0...v1.8.0) \(2020-03-02\)

### Bug Fixes

* cleanup signatures for queue add and addBulk \([\#127](https://github.com/taskforcesh/bullmq/issues/127)\) \([48e221b](https://github.com/taskforcesh/bullmq/commit/48e221b53909079a4def9c48c1b69cebabd0ed74)\)
* exit code 12 when using inspect with child process \([\#137](https://github.com/taskforcesh/bullmq/issues/137)\) \([43ebc67](https://github.com/taskforcesh/bullmq/commit/43ebc67cec3e8f283f9a555b4466cf918226687b)\)

### Features

* **types:** add sandboxed job processor types \([\#114](https://github.com/taskforcesh/bullmq/issues/114)\) \([a50a88c](https://github.com/taskforcesh/bullmq/commit/a50a88cd1658fa9d568235283a4c23a74eb8ed2a)\)

# [1.7.0](https://github.com/taskforcesh/bullmq/compare/v1.6.8...v1.7.0) \(2020-03-02\)

### Features

* made queue name publicly readable for [\#140](https://github.com/taskforcesh/bullmq/issues/140) \([f2bba2e](https://github.com/taskforcesh/bullmq/commit/f2bba2efd9d85986b01bb35c847a232b5c42ae57)\)

## [1.6.8](https://github.com/taskforcesh/bullmq/compare/v1.6.7...v1.6.8) \(2020-02-22\)

### Bug Fixes

* modified QueueGetters.getJob and Job.fromId to also return null to \([65183fc](https://github.com/taskforcesh/bullmq/commit/65183fcf542d0227ec1d4d6637b46b5381331787)\)
* modified QueueGetters.getJob and Job.fromId to return undefined \([ede352b](https://github.com/taskforcesh/bullmq/commit/ede352be75ffe05bf633516db9eda88467c562bf)\)

## [1.6.7](https://github.com/taskforcesh/bullmq/compare/v1.6.6...v1.6.7) \(2020-01-16\)

### Bug Fixes

* don't fail a job when the worker already lost the lock \([23c0bf7](https://github.com/taskforcesh/bullmq/commit/23c0bf70eab6d166b0483336f103323d1bf2ca64)\)

## [1.6.6](https://github.com/taskforcesh/bullmq/compare/v1.6.5...v1.6.6) \(2020-01-05\)

### Bug Fixes

* remove duplicate active entry \([1d2cca3](https://github.com/taskforcesh/bullmq/commit/1d2cca38ee61289adcee4899a91f7dcbc93a7c05)\)

## [1.6.5](https://github.com/taskforcesh/bullmq/compare/v1.6.4...v1.6.5) \(2020-01-05\)

### Bug Fixes

* get rid of flushdb/flushall in tests \([550c67b](https://github.com/taskforcesh/bullmq/commit/550c67b25de5f6d800e5e317398044cd16b85924)\)

## [1.6.4](https://github.com/taskforcesh/bullmq/compare/v1.6.3...v1.6.4) \(2020-01-05\)

### Bug Fixes

* delete logs when cleaning jobs in set \([b11c6c7](https://github.com/taskforcesh/bullmq/commit/b11c6c7c9f4f1c49eac93b98fdc93ac8f861c8b2)\)

## [1.6.3](https://github.com/taskforcesh/bullmq/compare/v1.6.2...v1.6.3) \(2020-01-01\)

### Bug Fixes

* add tslib dependency fixes [\#65](https://github.com/taskforcesh/bullmq/issues/65) \([7ad7995](https://github.com/taskforcesh/bullmq/commit/7ad799544a9c30b30aa96df8864119159c9a1185)\)

## [1.6.2](https://github.com/taskforcesh/bullmq/compare/v1.6.1...v1.6.2) \(2019-12-16\)

### Bug Fixes

* change default QueueEvents lastEventId to $ \([3c5b01d](https://github.com/taskforcesh/bullmq/commit/3c5b01d16ee1442f5802a0fe4e7675c14f7a7f1f)\)
* ensure QE ready before adding test events \([fd190f4](https://github.com/taskforcesh/bullmq/commit/fd190f4be792b03273481c8aaf73be5ca42663d1)\)
* explicitly test the behavior of .on and .once \([ea11087](https://github.com/taskforcesh/bullmq/commit/ea11087b292d9325105707b53f92ac61c334a147)\)

## [1.6.1](https://github.com/taskforcesh/bullmq/compare/v1.6.0...v1.6.1) \(2019-12-16\)

### Bug Fixes

* check of existing redis instance \([dd466b3](https://github.com/taskforcesh/bullmq/commit/dd466b332b03b430108126531d59ff9e66ce9521)\)

# [1.6.0](https://github.com/taskforcesh/bullmq/compare/v1.5.0...v1.6.0) \(2019-12-12\)

### Features

* add generic type to job data and return value \([87c0531](https://github.com/taskforcesh/bullmq/commit/87c0531efc2716db37f8a0886848cdb786709554)\)

# [1.5.0](https://github.com/taskforcesh/bullmq/compare/v1.4.3...v1.5.0) \(2019-11-22\)

### Features

* remove delay dependency \([97e1a30](https://github.com/taskforcesh/bullmq/commit/97e1a3015d853e615ddd623af07f12a194ccab2c)\)
* remove dependence on Bluebird.delay [\#67](https://github.com/taskforcesh/bullmq/issues/67) \([bedbaf2](https://github.com/taskforcesh/bullmq/commit/bedbaf25af6479e387cd7548e246dca7c72fc140)\)

## [1.4.3](https://github.com/taskforcesh/bullmq/compare/v1.4.2...v1.4.3) \(2019-11-21\)

### Bug Fixes

* check in moveToFinished to use default val for opts.maxLenEvents \([d1118aa](https://github.com/taskforcesh/bullmq/commit/d1118aab77f755b4a65e3dd8ea2e195baf3d2602)\)

## [1.4.2](https://github.com/taskforcesh/bullmq/compare/v1.4.1...v1.4.2) \(2019-11-21\)

### Bug Fixes

* avoid Job&lt;-&gt;Queue circular json error \([5752727](https://github.com/taskforcesh/bullmq/commit/5752727a6294e1b8d35f6a49e4953375510e10e6)\)
* avoid the .toJSON serializer interface [\#70](https://github.com/taskforcesh/bullmq/issues/70) \([5941b82](https://github.com/taskforcesh/bullmq/commit/5941b82b646e46d53970197a404e5ea54f09d008)\)

## [1.4.1](https://github.com/taskforcesh/bullmq/compare/v1.4.0...v1.4.1) \(2019-11-08\)

### Bug Fixes

* default job settings [\#58](https://github.com/taskforcesh/bullmq/issues/58) \([667fc6e](https://github.com/taskforcesh/bullmq/commit/667fc6e00ae4d6da639d285a104fb67e01c95bbd)\)

# [1.4.0](https://github.com/taskforcesh/bullmq/compare/v1.3.0...v1.4.0) \(2019-11-06\)

### Features

* job.progress\(\) return last progress for sandboxed processors \([5c4b146](https://github.com/taskforcesh/bullmq/commit/5c4b146ca8e42c8a29f9db87326a17deac30e10e)\)

# [1.3.0](https://github.com/taskforcesh/bullmq/compare/v1.2.0...v1.3.0) \(2019-11-05\)

### Features

* test worker extends job lock while job is active \([577efdf](https://github.com/taskforcesh/bullmq/commit/577efdfb1d2d3140be78dee3bd658b5ce969b16d)\)

# [1.2.0](https://github.com/taskforcesh/bullmq/compare/v1.1.0...v1.2.0) \(2019-11-03\)

### Bug Fixes

* only run coveralls after success \([bd51893](https://github.com/taskforcesh/bullmq/commit/bd51893c35793657b65246a2f5a06469488c8a06)\)

### Features

* added code coverage and coveralls \([298cfc4](https://github.com/taskforcesh/bullmq/commit/298cfc48e35e648e6a22ac0d1633ac16c7b6e3de)\)
* added missing deps for coverage \([6f3ab8d](https://github.com/taskforcesh/bullmq/commit/6f3ab8d78ba8503a76447f0db5abf0c1c4f8e185)\)
* ignore commitlint file in coverage \([f874441](https://github.com/taskforcesh/bullmq/commit/f8744411a1b20b95e568502be15ec50cf8520926)\)
* only upload coverage once after all tests pass \([a7f73ec](https://github.com/taskforcesh/bullmq/commit/a7f73ecc2f51544f1d810de046ba073cb7aa5663)\)

# [1.1.0](https://github.com/taskforcesh/bullmq/compare/v1.0.1...v1.1.0) \(2019-11-01\)

### Bug Fixes

* failing build \([bb21d53](https://github.com/taskforcesh/bullmq/commit/bb21d53b199885dcc97e7fe20f60caf65e55e782)\)
* fix failing tests \([824eb6b](https://github.com/taskforcesh/bullmq/commit/824eb6bfb2b750b823d057c894797ccb336245d8)\)

### Features

* initial version of job locking mechanism \([1d4fa38](https://github.com/taskforcesh/bullmq/commit/1d4fa383e39f4f5dcb69a71a1359dd5dea75544c)\)

## [1.0.1](https://github.com/taskforcesh/bullmq/compare/v1.0.0...v1.0.1) \(2019-10-27\)

### Bug Fixes

* save job stacktrace on failure \([85dfe52](https://github.com/taskforcesh/bullmq/commit/85dfe525079a5f89c1901dbf35c7ddc6663afc24)\)
* simplify logic for stackTraceLimit \([296bd89](https://github.com/taskforcesh/bullmq/commit/296bd89514d430a499afee934dcae2aec41cffa2)\)

# 1.0.0 \(2019-10-20\)

### Bug Fixes

* add compilation step before running tests \([64abc13](https://github.com/taskforcesh/bullmq/commit/64abc13681f8735fb3ee5add5b271bb4da618047)\)
* add extra client to worker fixes [\#34](https://github.com/taskforcesh/bullmq/issues/34) \([90bd891](https://github.com/taskforcesh/bullmq/commit/90bd891c7514f5e9e397d7aad15069ee55bebacd)\)
* add missing dependency \([b92e330](https://github.com/taskforcesh/bullmq/commit/b92e330aad35ae54f43376f92ad1b41209012b76)\)
* check closing after resuming from pause \([7b2cef3](https://github.com/taskforcesh/bullmq/commit/7b2cef3677e2b3af0370e0023aec4b971ad313fe)\)
* default opts \([333c73b](https://github.com/taskforcesh/bullmq/commit/333c73b5819a263ae92bdb54f0406c19db5cb64f)\)
* do not block if blockTime is zero \([13b2df2](https://github.com/taskforcesh/bullmq/commit/13b2df20cf045c069b8b581751e117722681dcd4)\)
* do not exec if closing \([b1d1c08](https://github.com/taskforcesh/bullmq/commit/b1d1c08a2948088eeb3dd65de78085329bac671b)\)
* do not trim if maxEvents is undefined \([7edd8f4](https://github.com/taskforcesh/bullmq/commit/7edd8f47b392c8b3a7369196befdafa4b29421d1)\)
* emit wait event in add job \([39cba31](https://github.com/taskforcesh/bullmq/commit/39cba31a30b7ef762a8d55d4bc34efec636207bf)\)
* fix a couple of job tests \([e66b97b](https://github.com/taskforcesh/bullmq/commit/e66b97be4577d5ab373fff0f3f45d73de7842a37)\)
* fix compiling error \([3cf2617](https://github.com/taskforcesh/bullmq/commit/3cf261703292d263d1e2017ae30eb490121dab4e)\)
* fix more tests \([6a07b35](https://github.com/taskforcesh/bullmq/commit/6a07b3518f856e8f7158be032110c925ed5c924f)\)
* fix progress script \([4228e27](https://github.com/taskforcesh/bullmq/commit/4228e2768c0cf404e09642ebb4053147d0badb56)\)
* fix retry functionality \([ec41ea4](https://github.com/taskforcesh/bullmq/commit/ec41ea4e0bd88b10b1ba434ef5ceb0952bb59f7b)\)
* fix several floating promises \([590a4a9](https://github.com/taskforcesh/bullmq/commit/590a4a925167a7c7d6c0d9764bbb5ab69235beb7)\)
* fixed reprocess lua script \([b78296f](https://github.com/taskforcesh/bullmq/commit/b78296f33517b8c5d79b300fef920edd03149d2f)\)
* improve concurrency mechanism \([a3f6148](https://github.com/taskforcesh/bullmq/commit/a3f61489e3c9891f42749ff85bd41064943c62dc)\)
* improve disconnection for queue events \([56b53a1](https://github.com/taskforcesh/bullmq/commit/56b53a1aca1e527b50f04d906653060fe8ca644e)\)
* initialize events comsumption in constructor \([dbb66cd](https://github.com/taskforcesh/bullmq/commit/dbb66cda9722d44eca806fa6ad1cabdaabac846a)\)
* make ioredis typings a normal dependency \([fb80b90](https://github.com/taskforcesh/bullmq/commit/fb80b90b12931a12a1a93c5e204dbf90eed4f48f)\)
* minor fixes \([7791cda](https://github.com/taskforcesh/bullmq/commit/7791cdac2bfb6a7fbbab9c95c5d89b1eae226a4c)\)
* parse progres and return value in events \([9e43d0e](https://github.com/taskforcesh/bullmq/commit/9e43d0e30ab90a290942418718cde1f5bfbdcf56)\)
* properly emit event for progress \([3f70175](https://github.com/taskforcesh/bullmq/commit/3f701750b1c957027825ee90b58141cd2556694f)\)
* reduce drain delay to 5 seconds \([c6cfe7c](https://github.com/taskforcesh/bullmq/commit/c6cfe7c0b50cabe5e5eb31f4b631a8b1d3706611)\)
* remove buggy close\(\) on redis-connection \(fixes 5 failing tests\) \([64c2ede](https://github.com/taskforcesh/bullmq/commit/64c2edec5e738f43676d0f4ca61bdea8609203fc)\)
* remove unused dependencies \([34293c8](https://github.com/taskforcesh/bullmq/commit/34293c84bb0ed54f18d70c86821c3ac627d376a5)\)
* replace init by waitUntilReady \([4336161](https://github.com/taskforcesh/bullmq/commit/43361610de5b1a993a1c65f3f21ac745b8face21)\)
* reworked initialization of redis clients \([c17d4be](https://github.com/taskforcesh/bullmq/commit/c17d4be5a2ecdda3efcdc6b9d7aecdfaccd06d83)\)
* several fixes to make the lib work on other ts projects \([3cac1b0](https://github.com/taskforcesh/bullmq/commit/3cac1b0715613d9df51cb1ed6fe0859bcfbb8e9b)\)
* throw error messages instead of codes \([9267541](https://github.com/taskforcesh/bullmq/commit/92675413f1c3b9564574dc264ffcab0d6089e70e)\)
* update tests after merge \([51f75a4](https://github.com/taskforcesh/bullmq/commit/51f75a4929e7ae2704e42fa9035e335fe60d8dc0)\)
* wait until ready before trying to get jobs \([f3b768f](https://github.com/taskforcesh/bullmq/commit/f3b768f251ddafa207466af552376065b35bec8f)\)
* **connections:** reused connections \([1e808d2](https://github.com/taskforcesh/bullmq/commit/1e808d24018a29f6611f4fccd2f5754de0fa3e39)\)
* waitUntilFinished improvements \([18d4afe](https://github.com/taskforcesh/bullmq/commit/18d4afef08f04d19cb8d931e02fff8f962d07ee7)\)

### Features

* add cleaned event \([c544775](https://github.com/taskforcesh/bullmq/commit/c544775803626b5f03cf6f7c3cf18ed1d92debab)\)
* add empty method \([4376112](https://github.com/taskforcesh/bullmq/commit/4376112369d869c0a5c7ab4a543cfc50200e1414)\)
* add retry errors \([f6a7990](https://github.com/taskforcesh/bullmq/commit/f6a7990fb74585985729c5d95e2238acde6cf74a)\)
* add script to generate typedocs \([d0a8cb3](https://github.com/taskforcesh/bullmq/commit/d0a8cb32ef9090652017f8fbf2ca42f0960687f7)\)
* add some new tests for compat class, more minor fixes \([bc0f653](https://github.com/taskforcesh/bullmq/commit/bc0f653ecf7aedd5a46eee6f912ecd6849395dca)\)
* add support for adding jobs in bulk \([b62bddc](https://github.com/taskforcesh/bullmq/commit/b62bddc054b266a809b4b1646558a095a276d6d1)\)
* add trimEvents method to queue client \([b7da7c4](https://github.com/taskforcesh/bullmq/commit/b7da7c4de2de81282aa41f8b7624b9030edf7d15)\)
* automatically trim events \([279bbba](https://github.com/taskforcesh/bullmq/commit/279bbbab7e96ad8676ed3bd68663cb199067ea67)\)
* emit global stalled event fixes [\#10](https://github.com/taskforcesh/bullmq/issues/10) \([241f229](https://github.com/taskforcesh/bullmq/commit/241f229761691b9ac17124da005f91594a78273d)\)
* get rid of Job3 in favor of bullmq Job class \([7590cea](https://github.com/taskforcesh/bullmq/commit/7590ceae7abe32a8824e4a265f95fef2f9a6665f)\)
* implement close in redis connection fixes [\#8](https://github.com/taskforcesh/bullmq/issues/8) \([6de8b48](https://github.com/taskforcesh/bullmq/commit/6de8b48c9612ea39bb28db5f4130cb2a2bb5ee90)\)
* make delay in backoffs optional \([30d59e5](https://github.com/taskforcesh/bullmq/commit/30d59e519794780a8198222d0bbd88779c623275)\)
* move async initialization to constructors \([3fbacd0](https://github.com/taskforcesh/bullmq/commit/3fbacd088bc3bfbd61ed8ff173e4401193ce48ec)\)
* port a lot of functionality from bull 3.x \([ec9f3d2](https://github.com/taskforcesh/bullmq/commit/ec9f3d266c1aca0c27cb600f056d813c81259b4c)\)
* port more features from bull 3.x \([75bd261](https://github.com/taskforcesh/bullmq/commit/75bd26158678ee45a14e04fd7c3a1f96219979a2)\)
* ported tests and functionality from bull 3 \([1b6b192](https://github.com/taskforcesh/bullmq/commit/1b6b1927c7e8e6b6f1bf0bbd6c74eb59cc17deb6)\)
* **workers:** support for async backoffs \([c555837](https://github.com/taskforcesh/bullmq/commit/c55583701e5bdd4e6436a61c833e506bc05749de)\)
* remove support of bull3 config format in compat class \([d909486](https://github.com/taskforcesh/bullmq/commit/d9094868e34c2af21f810aaef4542951a509ccf8)\)
* support global:progress event \([60f4d85](https://github.com/taskforcesh/bullmq/commit/60f4d85d332b3be4a80db7aa179f3a9ceeb1d6f8)\)
* trim option to event stream [\#21](https://github.com/taskforcesh/bullmq/issues/21) & fix [\#17](https://github.com/taskforcesh/bullmq/issues/17) \([7eae653](https://github.com/taskforcesh/bullmq/commit/7eae65340820043101fadf1f87802f506020d553)\)

## Changelog

## 4.0.0-beta.2

### Fixed

* Removed humans, they weren't doing fine with animals.

### Changed

* Animals are now super cute, all of them.

## 4.0.0-beta.1

### Added

* Introduced animals into the world, we believe they're going to be a neat addition.

## 4.0.0-beta.0
