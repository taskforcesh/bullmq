## [4.0.3](https://github.com/taskforcesh/bullmq-pro/compare/v4.0.2...v4.0.3) (2022-11-19)

### Bug Fixes

- **stalled:** use type result as table ([#113](https://github.com/taskforcesh/bullmq-pro/issues/113)) ([0507801](https://github.com/taskforcesh/bullmq-pro/commit/05078015f0ed687d8151780bb102a43d7da642ca))

## [4.0.2](https://github.com/taskforcesh/bullmq-pro/compare/v4.0.1...v4.0.2) (2022-11-08)

### Bug Fixes

- **promote:** consider groups ([#109](https://github.com/taskforcesh/bullmq-pro/issues/109)) ([c46c67b](https://github.com/taskforcesh/bullmq-pro/commit/c46c67b785fe521e5742582460c960bc16fd5c60))

## [4.0.1](https://github.com/taskforcesh/bullmq-pro/compare/v4.0.0...v4.0.1) (2022-11-07)

### Features

- **flows:** allow parent on root jobs in addBulk method ([#1488](https://github.com/taskforcesh/bullmq/issues/1488)) ref [#1480](https://github.com/taskforcesh/bullmq/issues/1480) ([92308e5](https://github.com/taskforcesh/bullmq/commit/92308e53acf14e0ce108d94ecd616633ac93e35d))

# [4.0.0](https://github.com/taskforcesh/bullmq-pro/compare/v3.0.0...v4.0.0) (2022-10-27)

### Bug Fixes

- **job:** send failed event when failParentOnFailure ([#1481](https://github.com/taskforcesh/bullmq/issues/1481)) fixes [#1469](https://github.com/taskforcesh/bullmq/issues/1469) ([b20eb6f](https://github.com/taskforcesh/bullmq/commit/b20eb6f65c7e2c4593d5f9f4d4b940f780bf26d2))
- **redis:** replace throw exception by console.error ([fafa2f8](https://github.com/taskforcesh/bullmq/commit/fafa2f89e796796f950e6c4abbdda4d3d71ad1b0))
- **connection:** validate array of strings in Cluster ([#1468](https://github.com/taskforcesh/bullmq/issues/1468)) fixes [#1467](https://github.com/taskforcesh/bullmq/issues/1467) ([8355182](https://github.com/taskforcesh/bullmq/commit/8355182a372b68ec62e9c3953bacbd69e0abfc74))
- **worker:** clear stalled jobs timer when closing worker ([1567a0d](https://github.com/taskforcesh/bullmq/commit/1567a0df0ca3c8d43a18990fe488888f4ff68040))
- **getters:** fix return type of getJobLogs ([d452927](https://github.com/taskforcesh/bullmq/commit/d4529278c59b2c94eee604c7d4455acc490679e9))
- **sandbox:** get open port using built-in module instead of get-port ([#1446](https://github.com/taskforcesh/bullmq/issues/1446)) ([6db6288](https://github.com/taskforcesh/bullmq/commit/6db628868a9d64c5a3e47d1c9201017e6d05c1ae))
- **job:** update delay value when moving to wait ([#1436](https://github.com/taskforcesh/bullmq/issues/1436)) ([9560915](https://github.com/taskforcesh/bullmq/commit/95609158c1800cf661f22ad7995541fb9474826a))
- **connection:** throw error when no noeviction policy ([3468390](https://github.com/taskforcesh/bullmq/commit/3468390dd6331291f4cf71a54c32028a06d1d99e))
- **compat:** remove Queue3 class ([#1421](https://github.com/taskforcesh/bullmq/issues/1421)) ([fc797f7](https://github.com/taskforcesh/bullmq/commit/fc797f7cd334c19a95cb1290ddb6611cd3417179))
- **delayed:** promote delayed jobs instead of picking one by one ([1b938af](https://github.com/taskforcesh/bullmq/commit/1b938af75069d69772ddf2b03f95db7f53eada68))
- **delayed:** remove marker when promoting delayed job ([1aea0dc](https://github.com/taskforcesh/bullmq/commit/1aea0dcc5fb29086cef3d0c432c387d6f8261963))
- **getters:** compensate for "mark" job id ([231b9aa](https://github.com/taskforcesh/bullmq/commit/231b9aa0f4781e4493d3ea272c33b27c0b7dc0ab))
- **sandbox:** remove progress method ([b43267b](https://github.com/taskforcesh/bullmq/commit/b43267be50f9eade8233500d189d46940a01cc29))
- **stalled-jobs:** handle job id 0 ([829e6e0](https://github.com/taskforcesh/bullmq/commit/829e6e0252e78bf2cbc55ab1d3bd153faa0cee4c))
- **worker:** do not allow stalledInterval to be less than zero ([831ffc5](https://github.com/taskforcesh/bullmq/commit/831ffc520ccd3c6ea63af6b04ddddc9f7829c667))
- **worker:** use connection closing to determine closing status ([fe1d173](https://github.com/taskforcesh/bullmq/commit/fe1d17321f1eb49bd872c52965392add22729941))

### Features

- **redis-connection:** allow providing scripts for extension ([#1472](https://github.com/taskforcesh/bullmq/issues/1472)) ([f193cfb](https://github.com/taskforcesh/bullmq/commit/f193cfb1830e127f9fd47a969baad30011a0e3a4))
- **flow-producer:** allow parent opts in root job when adding a flow ([#1110](https://github.com/taskforcesh/bullmq/issues/1110)) ref [#1097](https://github.com/taskforcesh/bullmq/issues/1097) ([3c3ac71](https://github.com/taskforcesh/bullmq/commit/3c3ac718ad84f6bd0cc1575013c948e767b46f38))
- **job-options:** add failParentOnFailure option ([#1339](https://github.com/taskforcesh/bullmq/issues/1339)) ([65e5c36](https://github.com/taskforcesh/bullmq/commit/65e5c3678771f26555c9128bdb908dd62e3584f9))
- improve delayed jobs and remove QueueSchedulerPro ([1f66e5a](https://github.com/taskforcesh/bullmq/commit/1f66e5a6c891d52e0671e58a685dbca511e45e7e))
- move stalled jobs check and handling to WorkerPro class from QueueSchedulerPro ([13769cb](https://github.com/taskforcesh/bullmq/commit/13769cbe38ba22793cbc66e9706a6be28a7f1512))

### Performance Improvements

- **scripts:** pre-build scripts ([#1441](https://github.com/taskforcesh/bullmq/issues/1441)) ([7f72603](https://github.com/taskforcesh/bullmq/commit/7f72603d463f705d0617898cb221f832c49a4aa3))
- **events:** remove data and opts from added event ([e13d4b8](https://github.com/taskforcesh/bullmq/commit/e13d4b8e0c4f99203f4249ccc86e369d124ff483))

### BREAKING CHANGES

- Remove QueueSchedulerPro class.
  WorkerPro class should handle QueueSchedulerPro functionalities.
- **compat:** The compatibility class for Bullv3 is no longer available.
- Failed and stalled events are now produced by the WorkerPro class instead of by the QueueSchedulerPro.
- The minimum Redis recommended version is 6.2.0.
