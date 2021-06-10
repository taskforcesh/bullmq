# [1.33.0](https://github.com/taskforcesh/bullmq/compare/v1.32.0...v1.33.0) (2021-06-10)


### Features

* **job:** add getDependenciesCount method ([ae39a4c](https://github.com/taskforcesh/bullmq/commit/ae39a4c77a958242cb445dbb32ae27b15a953653))

# [1.32.0](https://github.com/taskforcesh/bullmq/compare/v1.31.1...v1.32.0) (2021-06-07)


### Features

* **flow-producer:** add getFlow method ([ce93d04](https://github.com/taskforcesh/bullmq/commit/ce93d04c962686aff34f670f2decadadbf1cf4ca))

## [1.31.1](https://github.com/taskforcesh/bullmq/compare/v1.31.0...v1.31.1) (2021-06-07)


### Bug Fixes

* **worker:** remove processed key when removeOnComplete ([4ec1b73](https://github.com/taskforcesh/bullmq/commit/4ec1b739d6aeeb2fc21887b58f5978027ddcdb50))

# [1.31.0](https://github.com/taskforcesh/bullmq/compare/v1.30.2...v1.31.0) (2021-06-04)


### Features

* **job:** extend getDependencies to support pagination ([9b61bbb](https://github.com/taskforcesh/bullmq/commit/9b61bbb9160358f629cd458fa8dc4c9b6ebcd9f5))

## [1.30.2](https://github.com/taskforcesh/bullmq/compare/v1.30.1...v1.30.2) (2021-06-03)


### Bug Fixes

* **job:** parse results in getDependencies for processed jobs ([6fdc701](https://github.com/taskforcesh/bullmq/commit/6fdc7011ba910e5ca9c6d87926cc523ef38ef3ca))

## [1.30.1](https://github.com/taskforcesh/bullmq/compare/v1.30.0...v1.30.1) (2021-06-02)


### Bug Fixes

* **move-to-waiting-children:** make opts optional ([33bd76a](https://github.com/taskforcesh/bullmq/commit/33bd76a2cac9be450b5d76c6cfe16751c7569ceb))

# [1.30.0](https://github.com/taskforcesh/bullmq/compare/v1.29.1...v1.30.0) (2021-06-02)


### Features

* add some event typing ([934c004](https://github.com/taskforcesh/bullmq/commit/934c0040b0802bb67f44a979584405d795a8ab5e))

## [1.29.1](https://github.com/taskforcesh/bullmq/compare/v1.29.0...v1.29.1) (2021-05-31)


### Bug Fixes

* **move-stalled-jobs-to-wait:** send failedReason to queueEvents ([7c510b5](https://github.com/taskforcesh/bullmq/commit/7c510b542558bd4b1330371b73331f37b97a818d))

# [1.29.0](https://github.com/taskforcesh/bullmq/compare/v1.28.2...v1.29.0) (2021-05-31)


### Features

* add move to waiting children for manual processing ([#477](https://github.com/taskforcesh/bullmq/issues/477)) ([f312f29](https://github.com/taskforcesh/bullmq/commit/f312f293b8cac79af9c14848ffd1b11b65a806c3))

## [1.28.2](https://github.com/taskforcesh/bullmq/compare/v1.28.1...v1.28.2) (2021-05-31)


### Bug Fixes

* **obliterate:** remove job logs ([ea91895](https://github.com/taskforcesh/bullmq/commit/ea918950d7696241047a23773cc13cd675209c4b))

## [1.28.1](https://github.com/taskforcesh/bullmq/compare/v1.28.0...v1.28.1) (2021-05-31)


### Bug Fixes

* **get-workers:** use strict equality on name fixes [#564](https://github.com/taskforcesh/bullmq/issues/564) ([4becfa6](https://github.com/taskforcesh/bullmq/commit/4becfa66e09dacf9830804898c45cb3317dcf438))

# [1.28.0](https://github.com/taskforcesh/bullmq/compare/v1.27.0...v1.28.0) (2021-05-24)


### Features

* **flow-producer:** expose client connection ([17d4263](https://github.com/taskforcesh/bullmq/commit/17d4263abfa57797535cd8773c4cc316ff5149d2))

# [1.27.0](https://github.com/taskforcesh/bullmq/compare/v1.26.5...v1.27.0) (2021-05-24)


### Features

* **repeat:** add immediately opt for repeat ([d095573](https://github.com/taskforcesh/bullmq/commit/d095573f8e7ce5911f777df48368382eceb99d6a))

## [1.26.5](https://github.com/taskforcesh/bullmq/compare/v1.26.4...v1.26.5) (2021-05-21)


### Bug Fixes

* **movetofinished:** use parent queue for events ([1b17b62](https://github.com/taskforcesh/bullmq/commit/1b17b62a794728a318f1079e73d07e33fe65c9c7))

## [1.26.4](https://github.com/taskforcesh/bullmq/compare/v1.26.3...v1.26.4) (2021-05-20)


### Bug Fixes

* **removejob:** delete processed hash ([a2a5058](https://github.com/taskforcesh/bullmq/commit/a2a5058f18ab77ed4d0114d48f47e6144d632cbf))

## [1.26.3](https://github.com/taskforcesh/bullmq/compare/v1.26.2...v1.26.3) (2021-05-19)


### Bug Fixes

* ensure connection reconnects when pausing fixes [#160](https://github.com/taskforcesh/bullmq/issues/160) ([f38fee8](https://github.com/taskforcesh/bullmq/commit/f38fee84def75dd8a38cbb8bfb5aa662485ddf91))

## [1.26.2](https://github.com/taskforcesh/bullmq/compare/v1.26.1...v1.26.2) (2021-05-18)


### Bug Fixes

* **getjoblogs:** no reversed pagination ([fb0c3a5](https://github.com/taskforcesh/bullmq/commit/fb0c3a50f0d37851a8f35cb4c478259a63d93461))

## [1.26.1](https://github.com/taskforcesh/bullmq/compare/v1.26.0...v1.26.1) (2021-05-17)

### Bug Fixes

- **flow-producer:** use custom jobId as parentId for children fixes [#552](https://github.com/taskforcesh/bullmq/issues/552) ([645b576](https://github.com/taskforcesh/bullmq/commit/645b576c1aabd8426ab77a68c199a594867cd729))

# [1.26.0](https://github.com/taskforcesh/bullmq/compare/v1.25.1...v1.26.0) (2021-05-16)

### Features

- **custombackoff:** provide job as third parameter ([ddaf8dc](https://github.com/taskforcesh/bullmq/commit/ddaf8dc2f95ca336cb117a540edd4640d5d579e4))

## [1.25.2](https://github.com/taskforcesh/bullmq/compare/v1.25.1...v1.25.2) (2021-05-16)

### Bug Fixes

- **flow-producer:** process parent with children as empty array fixes [#547](https://github.com/taskforcesh/bullmq/issues/547) ([48168f0](https://github.com/taskforcesh/bullmq/commit/48168f07cbaed7ed522c68d127a0c7d5e4cb380e))

## [1.25.1](https://github.com/taskforcesh/bullmq/compare/v1.25.0...v1.25.1) (2021-05-13)

### Bug Fixes

- **addbulk:** should not consider repeat option ([c85357e](https://github.com/taskforcesh/bullmq/commit/c85357e415b9ea66f845f751a4943b5c48c2bb18))

# [1.25.0](https://github.com/taskforcesh/bullmq/compare/v1.24.5...v1.25.0) (2021-05-11)

### Features

- **job:** add sizeLimit option when creating a job ([f10aeeb](https://github.com/taskforcesh/bullmq/commit/f10aeeb62520d20b31d35440524d147ac4adcc9c))

## [1.24.5](https://github.com/taskforcesh/bullmq/compare/v1.24.4...v1.24.5) (2021-05-08)

### Bug Fixes

- **deps:** upgrading lodash to 4.17.21 ([6e90c3f](https://github.com/taskforcesh/bullmq/commit/6e90c3f0a3d2735875ebf44457b342629aa14572))

## [1.24.4](https://github.com/taskforcesh/bullmq/compare/v1.24.3...v1.24.4) (2021-05-07)

### Bug Fixes

- **cluster:** add redis cluster support ([5a7dd14](https://github.com/taskforcesh/bullmq/commit/5a7dd145bd3ae11850cac6d1b4fb9b01af0e6766))
- **redisclient:** not reference types from import ([022fc04](https://github.com/taskforcesh/bullmq/commit/022fc042a17c1754af7d74acabb7dd5c397576ab))

## [1.24.3](https://github.com/taskforcesh/bullmq/compare/v1.24.2...v1.24.3) (2021-05-05)

### Bug Fixes

- **sandbox:** properly redirect stdout ([#525](https://github.com/taskforcesh/bullmq/issues/525)) ([c8642a0](https://github.com/taskforcesh/bullmq/commit/c8642a0724dc3d2f77abc4b5d6d24efa67c1e592))

## [1.24.2](https://github.com/taskforcesh/bullmq/compare/v1.24.1...v1.24.2) (2021-05-05)

### Bug Fixes

- **sandbox:** handle broken processor files ([2326983](https://github.com/taskforcesh/bullmq/commit/23269839af0be2f7cf2a4f6062563d30904bc259))

## [1.24.1](https://github.com/taskforcesh/bullmq/compare/v1.24.0...v1.24.1) (2021-05-05)

### Bug Fixes

- **queueevents:** add active type fixes [#519](https://github.com/taskforcesh/bullmq/issues/519) ([10af883](https://github.com/taskforcesh/bullmq/commit/10af883db849cf9392b26724903f88752d9be92c))

# [1.24.0](https://github.com/taskforcesh/bullmq/compare/v1.23.1...v1.24.0) (2021-05-03)

### Features

- add option for non-blocking getNextJob ([13ce2cf](https://github.com/taskforcesh/bullmq/commit/13ce2cfd4ccd64f45567df31de11af95b0fe67d9))

## [1.23.1](https://github.com/taskforcesh/bullmq/compare/v1.23.0...v1.23.1) (2021-05-03)

### Bug Fixes

- add return type for job.waitUntilFinished() ([59ede97](https://github.com/taskforcesh/bullmq/commit/59ede976061a738503f70d9eb0c92a4b1d6ae4a3))

# [1.23.0](https://github.com/taskforcesh/bullmq/compare/v1.22.2...v1.23.0) (2021-04-30)

### Features

- **job:** pass parent opts to addBulk ([7f21615](https://github.com/taskforcesh/bullmq/commit/7f216153293e45c4f33f2592561c925ca4464d44))

## [1.22.2](https://github.com/taskforcesh/bullmq/compare/v1.22.1...v1.22.2) (2021-04-29)

### Bug Fixes

- add missing Redis Cluster types fixes [#406](https://github.com/taskforcesh/bullmq/issues/406) ([07743ff](https://github.com/taskforcesh/bullmq/commit/07743ff310ad716802afdd5bdc6844eb5296318e))

## [1.22.1](https://github.com/taskforcesh/bullmq/compare/v1.22.0...v1.22.1) (2021-04-28)

### Bug Fixes

- **addjob:** fix redis cluster CROSSSLOT ([a5fd1d7](https://github.com/taskforcesh/bullmq/commit/a5fd1d7a0713585d11bd862bfe2d426d5242bd3c))

# [1.22.0](https://github.com/taskforcesh/bullmq/compare/v1.21.0...v1.22.0) (2021-04-28)

### Features

- **jobcreate:** allow passing parent in job.create ([ede3626](https://github.com/taskforcesh/bullmq/commit/ede3626b65fb5d3f4cebc55c813e9fa4b482b887))

# [1.21.0](https://github.com/taskforcesh/bullmq/compare/v1.20.6...v1.21.0) (2021-04-26)

### Features

- add typing for addNextRepeatableJob ([a3be937](https://github.com/taskforcesh/bullmq/commit/a3be9379e29ae3e01264e2269e8b03aa614fd42c))

## [1.20.6](https://github.com/taskforcesh/bullmq/compare/v1.20.5...v1.20.6) (2021-04-25)

### Bug Fixes

- **movetocompleted:** should not complete before children ([812ff66](https://github.com/taskforcesh/bullmq/commit/812ff664b3e162dd87831ca04ebfdb783cc7ae5b))

## [1.20.5](https://github.com/taskforcesh/bullmq/compare/v1.20.4...v1.20.5) (2021-04-23)

### Bug Fixes

- **obliterate:** correctly remove many jobs ([b5ae4ce](https://github.com/taskforcesh/bullmq/commit/b5ae4ce92aeaf000408ffbbcd22d829cee20f2f8))

## [1.20.4](https://github.com/taskforcesh/bullmq/compare/v1.20.3...v1.20.4) (2021-04-23)

### Bug Fixes

- remove internal deps on barrel fixes [#469](https://github.com/taskforcesh/bullmq/issues/469) ([#495](https://github.com/taskforcesh/bullmq/issues/495)) ([60dbeed](https://github.com/taskforcesh/bullmq/commit/60dbeed7ff1d9b6cb0e35590713fee8a7be09477))

## [1.20.3](https://github.com/taskforcesh/bullmq/compare/v1.20.2...v1.20.3) (2021-04-23)

### Bug Fixes

- **flows:** correct typings fixes [#492](https://github.com/taskforcesh/bullmq/issues/492) ([a77f80b](https://github.com/taskforcesh/bullmq/commit/a77f80bc07e7627f512323f0dcc9141fe408809e))

## [1.20.2](https://github.com/taskforcesh/bullmq/compare/v1.20.1...v1.20.2) (2021-04-22)

### Bug Fixes

- **movetodelayed:** check if job is in active state ([4e63f70](https://github.com/taskforcesh/bullmq/commit/4e63f70aac367d4dd695bbe07c72a08a82a65d97))

## [1.20.1](https://github.com/taskforcesh/bullmq/compare/v1.20.0...v1.20.1) (2021-04-22)

### Bug Fixes

- **worker:** make token optional in processor function fixes [#490](https://github.com/taskforcesh/bullmq/issues/490) ([3940bd7](https://github.com/taskforcesh/bullmq/commit/3940bd71c6faf3bd5fce572b9c1f11cb5b5d2123))

# [1.20.0](https://github.com/taskforcesh/bullmq/compare/v1.19.3...v1.20.0) (2021-04-21)

### Features

- **worker:** passing token in processor function ([2249724](https://github.com/taskforcesh/bullmq/commit/2249724b1bc6fbf40b0291400011f201fd02dab3))

## [1.19.3](https://github.com/taskforcesh/bullmq/compare/v1.19.2...v1.19.3) (2021-04-20)

### Bug Fixes

- **movetocompleted:** throw an error if job is not in active state ([c2fe5d2](https://github.com/taskforcesh/bullmq/commit/c2fe5d292fcf8ac2e53906c30282df69d43321b1))

## [1.19.2](https://github.com/taskforcesh/bullmq/compare/v1.19.1...v1.19.2) (2021-04-19)

### Bug Fixes

- **worker:** close base class connection [#451](https://github.com/taskforcesh/bullmq/issues/451) ([0875306](https://github.com/taskforcesh/bullmq/commit/0875306ae801a7cbfe04758dc2481cb86ca2ef69))

## [1.19.1](https://github.com/taskforcesh/bullmq/compare/v1.19.0...v1.19.1) (2021-04-19)

### Bug Fixes

- remove repeatable with obliterate ([1c5e581](https://github.com/taskforcesh/bullmq/commit/1c5e581a619ba707863c2a6e9f3e5f6eadfbe64f))

# [1.19.0](https://github.com/taskforcesh/bullmq/compare/v1.18.2...v1.19.0) (2021-04-19)

### Features

- add workerDelay option to limiter ([9b6ab8a](https://github.com/taskforcesh/bullmq/commit/9b6ab8ad4bc0a94068f3bc707ad9c0ed01596068))

## [1.18.2](https://github.com/taskforcesh/bullmq/compare/v1.18.1...v1.18.2) (2021-04-16)

### Bug Fixes

- add parentKey property to Job ([febc60d](https://github.com/taskforcesh/bullmq/commit/febc60dba94c29b85be3e1bc2547fa83ed932806))

## [1.18.1](https://github.com/taskforcesh/bullmq/compare/v1.18.0...v1.18.1) (2021-04-16)

### Bug Fixes

- rename Flow to FlowProducer class ([c64321d](https://github.com/taskforcesh/bullmq/commit/c64321d03e2af7cee88eaf6df6cd2e5b7840ae64))

# [1.18.0](https://github.com/taskforcesh/bullmq/compare/v1.17.0...v1.18.0) (2021-04-16)

### Features

- add remove support for flows ([4e8a7ef](https://github.com/taskforcesh/bullmq/commit/4e8a7efd53f918937478ae13f5da7dee9ea9d8b3))

# [1.17.0](https://github.com/taskforcesh/bullmq/compare/v1.16.2...v1.17.0) (2021-04-16)

### Features

- **job:** consider waiting-children state ([2916dd5](https://github.com/taskforcesh/bullmq/commit/2916dd5d7ba9438d2eae66436899d32ec8ac0e91))

## [1.16.2](https://github.com/taskforcesh/bullmq/compare/v1.16.1...v1.16.2) (2021-04-14)

### Bug Fixes

- read lua scripts serially ([69e73b8](https://github.com/taskforcesh/bullmq/commit/69e73b87bc6855623240a7b1a45368a7914b23b7))

## [1.16.1](https://github.com/taskforcesh/bullmq/compare/v1.16.0...v1.16.1) (2021-04-12)

### Bug Fixes

- **flow:** relative dependency path fixes [#466](https://github.com/taskforcesh/bullmq/issues/466) ([d104bf8](https://github.com/taskforcesh/bullmq/commit/d104bf802d6d1000ac1ccd781fa7a07bce2fe140))

# [1.16.0](https://github.com/taskforcesh/bullmq/compare/v1.15.1...v1.16.0) (2021-04-12)

### Features

- add support for flows (parent-child dependencies) ([#454](https://github.com/taskforcesh/bullmq/issues/454)) ([362212c](https://github.com/taskforcesh/bullmq/commit/362212c58c4be36b5435df862503699deb8bb79c))

## [1.15.1](https://github.com/taskforcesh/bullmq/compare/v1.15.0...v1.15.1) (2021-03-19)

### Bug Fixes

- **obliterate:** safer implementation ([82f571f](https://github.com/taskforcesh/bullmq/commit/82f571f2548c61c776b897fd1c5050bb09c8afca))

# [1.15.0](https://github.com/taskforcesh/bullmq/compare/v1.14.8...v1.15.0) (2021-03-18)

### Features

- add method to "obliterate" a queue, fixes [#430](https://github.com/taskforcesh/bullmq/issues/430) ([624be0e](https://github.com/taskforcesh/bullmq/commit/624be0ed48159c2aa405025938925a723330e0c2))

## [1.14.8](https://github.com/taskforcesh/bullmq/compare/v1.14.7...v1.14.8) (2021-03-06)

### Bug Fixes

- specify promise type to make TS 4.1 and 4.2 happy. ([#418](https://github.com/taskforcesh/bullmq/issues/418)) ([702f609](https://github.com/taskforcesh/bullmq/commit/702f609b410d8b0652c2d0504a8a67526966fdc3))

## [1.14.7](https://github.com/taskforcesh/bullmq/compare/v1.14.6...v1.14.7) (2021-02-16)

### Bug Fixes

- remove "client" property of QueueBaseOptions ([#324](https://github.com/taskforcesh/bullmq/issues/324)) ([e0b9e71](https://github.com/taskforcesh/bullmq/commit/e0b9e71c4da4a93af54c4386af461c61ab5f146c))

## [1.14.6](https://github.com/taskforcesh/bullmq/compare/v1.14.5...v1.14.6) (2021-02-16)

### Bug Fixes

- remove next job in removeRepeatableByKey fixes [#165](https://github.com/taskforcesh/bullmq/issues/165) ([fb3a7c2](https://github.com/taskforcesh/bullmq/commit/fb3a7c2f429d535dd9f038687d7230d61201defc))

## [1.14.5](https://github.com/taskforcesh/bullmq/compare/v1.14.4...v1.14.5) (2021-02-16)

### Bug Fixes

- add jobId support to repeatable jobs fixes [#396](https://github.com/taskforcesh/bullmq/issues/396) ([c2dc669](https://github.com/taskforcesh/bullmq/commit/c2dc6693a4546e547245bc7ec1e71b4841829619))

## [1.14.4](https://github.com/taskforcesh/bullmq/compare/v1.14.3...v1.14.4) (2021-02-08)

### Bug Fixes

- reconnect at start fixes [#337](https://github.com/taskforcesh/bullmq/issues/337) ([fb33772](https://github.com/taskforcesh/bullmq/commit/fb3377280b3bda04a15a62d2901bdd78b869e08c))

## [1.14.3](https://github.com/taskforcesh/bullmq/compare/v1.14.2...v1.14.3) (2021-02-07)

### Bug Fixes

- **worker:** avoid possible infinite loop fixes [#389](https://github.com/taskforcesh/bullmq/issues/389) ([d05566e](https://github.com/taskforcesh/bullmq/commit/d05566ec0153f31a1257f7338399fdb55c959487))

## [1.14.2](https://github.com/taskforcesh/bullmq/compare/v1.14.1...v1.14.2) (2021-02-02)

### Bug Fixes

- improve job timeout notification by giving the job name and id in the error message ([#387](https://github.com/taskforcesh/bullmq/issues/387)) ([ca886b1](https://github.com/taskforcesh/bullmq/commit/ca886b1f854051aed0888f5b872a64b052b2383e))

## [1.14.1](https://github.com/taskforcesh/bullmq/compare/v1.14.0...v1.14.1) (2021-02-01)

### Bug Fixes

- job finish queue events race condition ([355bca5](https://github.com/taskforcesh/bullmq/commit/355bca5ee128bf4ff37608746f9c6f7cca580eb0))

# [1.14.0](https://github.com/taskforcesh/bullmq/compare/v1.13.0...v1.14.0) \(2021-01-06\)

### Features

- **job:** expose extendLock as a public method \([17e8431](https://github.com/taskforcesh/bullmq/commit/17e8431af8bba58612bf9913c63ab5d38afecbb9)\)

# [1.13.0](https://github.com/taskforcesh/bullmq/compare/v1.12.3...v1.13.0) \(2020-12-30\)

### Features

- add support for manually processing jobs fixes [\#327](https://github.com/taskforcesh/bullmq/issues/327) \([e42bfd2](https://github.com/taskforcesh/bullmq/commit/e42bfd2814fc5136b175470c3085355090cc2e01)\)

## [1.12.3](https://github.com/taskforcesh/bullmq/compare/v1.12.2...v1.12.3) \(2020-12-28\)

### Bug Fixes

- correctly handle "falsy" data values fixes [\#264](https://github.com/taskforcesh/bullmq/issues/264) \([becad91](https://github.com/taskforcesh/bullmq/commit/becad91350fd4ac01037e5b0d4a8a93724dd8dbd)\)
- **worker:** setname on worker blocking connection \([645b633](https://github.com/taskforcesh/bullmq/commit/645b6338f5883b0c21ae78007777d86b45422615)\)

## [1.12.2](https://github.com/taskforcesh/bullmq/compare/v1.12.1...v1.12.2) \(2020-12-23\)

### Bug Fixes

- catch errors from Repeat \([\#348](https://github.com/taskforcesh/bullmq/issues/348)\) \([09a1a98](https://github.com/taskforcesh/bullmq/commit/09a1a98fc42dc1a9ae98bfb29c0cca3fac02013f)\)

## [1.12.1](https://github.com/taskforcesh/bullmq/compare/v1.12.0...v1.12.1) \(2020-12-21\)

### Bug Fixes

- correctly handle "falsy" data values fixes [\#264](https://github.com/taskforcesh/bullmq/issues/264) \([cf1dbaf](https://github.com/taskforcesh/bullmq/commit/cf1dbaf7e60d74fc8443a5f8a537455f28a8dba3)\)

# [1.12.0](https://github.com/taskforcesh/bullmq/compare/v1.11.2...v1.12.0) \(2020-12-16\)

### Features

- add ability to get if queue is paused or not \([e98b7d8](https://github.com/taskforcesh/bullmq/commit/e98b7d8973df830cc29e0afc5d86e82c9a7ce76f)\)

## [1.11.2](https://github.com/taskforcesh/bullmq/compare/v1.11.1...v1.11.2) \(2020-12-15\)

### Bug Fixes

- promote jobs to the right "list" when paused \([d3df615](https://github.com/taskforcesh/bullmq/commit/d3df615d37b1114c02eacb45f23643ee2f05374d)\)

## [1.11.1](https://github.com/taskforcesh/bullmq/compare/v1.11.0...v1.11.1) \(2020-12-15\)

### Bug Fixes

- clientCommandMessageReg to support GCP memorystore v5 \([8408dda](https://github.com/taskforcesh/bullmq/commit/8408dda9fa64fc0b968e88fb2726e0a30f717ed7)\)

# [1.11.0](https://github.com/taskforcesh/bullmq/compare/v1.10.0...v1.11.0) \(2020-11-24\)

### Bug Fixes

- add generic type to processor \([d4f6501](https://github.com/taskforcesh/bullmq/commit/d4f650120804bd6161f0eeda5162ad5a96811a05)\)

### Features

- add name and return types to queue, worker and processor \([4879715](https://github.com/taskforcesh/bullmq/commit/4879715ec7c917f11e3a0ac3c5f5126029340ed3)\)

# [1.10.0](https://github.com/taskforcesh/bullmq/compare/v1.9.0...v1.10.0) \(2020-10-20\)

### Bug Fixes

- **job:** remove listeners before resolving promise \([563ce92](https://github.com/taskforcesh/bullmq/commit/563ce9218f5dd81f2bc836f9e8ccdedc549f09dd)\)
- **worker:** continue processing if handleFailed fails. fixes [\#286](https://github.com/taskforcesh/bullmq/issues/286) \([4ef1cbc](https://github.com/taskforcesh/bullmq/commit/4ef1cbc13d53897b57ae3d271afbaa1b213824aa)\)
- **worker:** fix memory leak on Promise.race \([\#282](https://github.com/taskforcesh/bullmq/issues/282)\) \([a78ab2b](https://github.com/taskforcesh/bullmq/commit/a78ab2b362e54f897eec6c8b16f16ecccf7875c2)\)
- **worker:** setname on worker blocking connection \([\#291](https://github.com/taskforcesh/bullmq/issues/291)\) \([50a87fc](https://github.com/taskforcesh/bullmq/commit/50a87fcb1dab976a6a0273d2b0cc4b31b63c015f)\)
- remove async for loop in child pool fixes [\#229](https://github.com/taskforcesh/bullmq/issues/229) \([d77505e](https://github.com/taskforcesh/bullmq/commit/d77505e989cd1395465c5222613555f79e4d9720)\)

### Features

- **sandbox:** kill child workers gracefully \([\#243](https://github.com/taskforcesh/bullmq/issues/243)\) \([4262837](https://github.com/taskforcesh/bullmq/commit/4262837bc67e007fe44606670dce48ee7fec65cd)\)

# [1.9.0](https://github.com/taskforcesh/bullmq/compare/v1.8.14...v1.9.0) \(2020-07-19\)

### Features

- add grouped rate limiting \([3a958dd](https://github.com/taskforcesh/bullmq/commit/3a958dd30d09a049b0d761679d3b8d92709e815e)\)

## [1.8.14](https://github.com/taskforcesh/bullmq/compare/v1.8.13...v1.8.14) \(2020-07-03\)

### Bug Fixes

- **typescript:** fix typings, upgrade ioredis dependencies \([\#220](https://github.com/taskforcesh/bullmq/issues/220)\) \([7059f20](https://github.com/taskforcesh/bullmq/commit/7059f2089553a206ab3937f7fd0d0b9de96aa7b7)\)
- **worker:** return this.closing when calling close \([b68c845](https://github.com/taskforcesh/bullmq/commit/b68c845c77de6b2973ec31d2f22958ab60ad87aa)\)

## [1.8.13](https://github.com/taskforcesh/bullmq/compare/v1.8.12...v1.8.13) \(2020-06-05\)

### Bug Fixes

- **redis-connection:** run the load command for reused redis client \([fab9bba](https://github.com/taskforcesh/bullmq/commit/fab9bba4caee8fd44523febb3bde588b151e8514)\)

## [1.8.12](https://github.com/taskforcesh/bullmq/compare/v1.8.11...v1.8.12) \(2020-06-04\)

### Bug Fixes

- remove unused options \([23aadc3](https://github.com/taskforcesh/bullmq/commit/23aadc300b947693f4afb22296d236a924bd11ca)\)

## [1.8.11](https://github.com/taskforcesh/bullmq/compare/v1.8.10...v1.8.11) \(2020-05-29\)

### Bug Fixes

- **scheduler:** remove unnecessary division by 4096 \([4d25e95](https://github.com/taskforcesh/bullmq/commit/4d25e95f9522388bd85e932e04b6668e3da57686)\)

## [1.8.10](https://github.com/taskforcesh/bullmq/compare/v1.8.9...v1.8.10) \(2020-05-28\)

### Bug Fixes

- **scheduler:** divide timestamp by 4096 in update set fixes [\#168](https://github.com/taskforcesh/bullmq/issues/168) \([0c5db83](https://github.com/taskforcesh/bullmq/commit/0c5db8391bb8994bee19f25a33efb9dfee792d7b)\)

## [1.8.9](https://github.com/taskforcesh/bullmq/compare/v1.8.8...v1.8.9) \(2020-05-25\)

### Bug Fixes

- **scheduler:** divide next timestamp by 4096 \([\#204](https://github.com/taskforcesh/bullmq/issues/204)\) \([9562d74](https://github.com/taskforcesh/bullmq/commit/9562d74625e20b7b6de8750339c85345ba027357)\)

## [1.8.8](https://github.com/taskforcesh/bullmq/compare/v1.8.7...v1.8.8) \(2020-05-25\)

### Bug Fixes

- **queue-base:** error event is passed through \([ad14e77](https://github.com/taskforcesh/bullmq/commit/ad14e777171c0c44b7e50752d9847dec23f46158)\)
- **redis-connection:** error event is passed through \([a15b1a1](https://github.com/taskforcesh/bullmq/commit/a15b1a1824c6863ecf3e5132e22924fc3ff161f6)\)
- **worker:** error event is passed through \([d7f0374](https://github.com/taskforcesh/bullmq/commit/d7f03749ce300e917399a435a3f426e66145dd8c)\)

## [1.8.7](https://github.com/taskforcesh/bullmq/compare/v1.8.6...v1.8.7) \(2020-04-10\)

### Bug Fixes

- **worker:** do not use global child pool fixes [\#172](https://github.com/taskforcesh/bullmq/issues/172) \([bc65f26](https://github.com/taskforcesh/bullmq/commit/bc65f26dd47c59d0a7277ac947140405557be9a5)\)

## [1.8.6](https://github.com/taskforcesh/bullmq/compare/v1.8.5...v1.8.6) \(2020-04-10\)

### Bug Fixes

- **workers:** do not call super.close\(\) \([ebd2ae1](https://github.com/taskforcesh/bullmq/commit/ebd2ae1a5613d71643c5a7ba3f685d77585de68e)\)
- make sure closing is returned in every close call \([88c5948](https://github.com/taskforcesh/bullmq/commit/88c5948d33a9a7b7a4f4f64f3183727b87d80207)\)
- **scheduler:** duplicate connections fixes [\#174](https://github.com/taskforcesh/bullmq/issues/174) \([011b8ac](https://github.com/taskforcesh/bullmq/commit/011b8acfdec54737d94a9fead2423e060e3364db)\)
- **worker:** return this.closing when calling close \([06d3d4f](https://github.com/taskforcesh/bullmq/commit/06d3d4f476444a2d2af8538d60cb2561a1915868)\)

## [1.8.5](https://github.com/taskforcesh/bullmq/compare/v1.8.4...v1.8.5) \(2020-04-05\)

### Bug Fixes

- removed deprecated and unused node-uuid \([c810579](https://github.com/taskforcesh/bullmq/commit/c810579029d33ef47d5a7563e63126a69c62fd87)\)

## [1.8.4](https://github.com/taskforcesh/bullmq/compare/v1.8.3...v1.8.4) \(2020-03-17\)

### Bug Fixes

- **job:** added nullable/optional properties \([cef134f](https://github.com/taskforcesh/bullmq/commit/cef134f7c4d87e1b80ba42a5e06c3877956ff4cc)\)

## [1.8.3](https://github.com/taskforcesh/bullmq/compare/v1.8.2...v1.8.3) \(2020-03-13\)

### Bug Fixes

- **sandbox:** If the child process is killed, remove it from the pool. \([8fb0fb5](https://github.com/taskforcesh/bullmq/commit/8fb0fb569a0236b37d3bae06bf58a2a1da3221c6)\)

## [1.8.2](https://github.com/taskforcesh/bullmq/compare/v1.8.1...v1.8.2) \(2020-03-03\)

### Bug Fixes

- restore the Job timestamp when deserializing JSON data \([\#138](https://github.com/taskforcesh/bullmq/issues/138)\) \([\#152](https://github.com/taskforcesh/bullmq/issues/152)\) \([c171bd4](https://github.com/taskforcesh/bullmq/commit/c171bd47f7b75378e75307a1decdc0f630ac1cd6)\)

## [1.8.1](https://github.com/taskforcesh/bullmq/compare/v1.8.0...v1.8.1) \(2020-03-02\)

### Bug Fixes

- modified imports to work when esModuleInterop is disabled \([\#132](https://github.com/taskforcesh/bullmq/issues/132)\) \([01681f2](https://github.com/taskforcesh/bullmq/commit/01681f282bafac2df2c602edb51d6bde3483896c)\)

# [1.8.0](https://github.com/taskforcesh/bullmq/compare/v1.7.0...v1.8.0) \(2020-03-02\)

### Bug Fixes

- cleanup signatures for queue add and addBulk \([\#127](https://github.com/taskforcesh/bullmq/issues/127)\) \([48e221b](https://github.com/taskforcesh/bullmq/commit/48e221b53909079a4def9c48c1b69cebabd0ed74)\)
- exit code 12 when using inspect with child process \([\#137](https://github.com/taskforcesh/bullmq/issues/137)\) \([43ebc67](https://github.com/taskforcesh/bullmq/commit/43ebc67cec3e8f283f9a555b4466cf918226687b)\)

### Features

- **types:** add sandboxed job processor types \([\#114](https://github.com/taskforcesh/bullmq/issues/114)\) \([a50a88c](https://github.com/taskforcesh/bullmq/commit/a50a88cd1658fa9d568235283a4c23a74eb8ed2a)\)

# [1.7.0](https://github.com/taskforcesh/bullmq/compare/v1.6.8...v1.7.0) \(2020-03-02\)

### Features

- made queue name publicly readable for [\#140](https://github.com/taskforcesh/bullmq/issues/140) \([f2bba2e](https://github.com/taskforcesh/bullmq/commit/f2bba2efd9d85986b01bb35c847a232b5c42ae57)\)

## [1.6.8](https://github.com/taskforcesh/bullmq/compare/v1.6.7...v1.6.8) \(2020-02-22\)

### Bug Fixes

- modified QueueGetters.getJob and Job.fromId to also return null to \([65183fc](https://github.com/taskforcesh/bullmq/commit/65183fcf542d0227ec1d4d6637b46b5381331787)\)
- modified QueueGetters.getJob and Job.fromId to return undefined \([ede352b](https://github.com/taskforcesh/bullmq/commit/ede352be75ffe05bf633516db9eda88467c562bf)\)

## [1.6.7](https://github.com/taskforcesh/bullmq/compare/v1.6.6...v1.6.7) \(2020-01-16\)

### Bug Fixes

- don't fail a job when the worker already lost the lock \([23c0bf7](https://github.com/taskforcesh/bullmq/commit/23c0bf70eab6d166b0483336f103323d1bf2ca64)\)

## [1.6.6](https://github.com/taskforcesh/bullmq/compare/v1.6.5...v1.6.6) \(2020-01-05\)

### Bug Fixes

- remove duplicate active entry \([1d2cca3](https://github.com/taskforcesh/bullmq/commit/1d2cca38ee61289adcee4899a91f7dcbc93a7c05)\)

## [1.6.5](https://github.com/taskforcesh/bullmq/compare/v1.6.4...v1.6.5) \(2020-01-05\)

### Bug Fixes

- get rid of flushdb/flushall in tests \([550c67b](https://github.com/taskforcesh/bullmq/commit/550c67b25de5f6d800e5e317398044cd16b85924)\)

## [1.6.4](https://github.com/taskforcesh/bullmq/compare/v1.6.3...v1.6.4) \(2020-01-05\)

### Bug Fixes

- delete logs when cleaning jobs in set \([b11c6c7](https://github.com/taskforcesh/bullmq/commit/b11c6c7c9f4f1c49eac93b98fdc93ac8f861c8b2)\)

## [1.6.3](https://github.com/taskforcesh/bullmq/compare/v1.6.2...v1.6.3) \(2020-01-01\)

### Bug Fixes

- add tslib dependency fixes [\#65](https://github.com/taskforcesh/bullmq/issues/65) \([7ad7995](https://github.com/taskforcesh/bullmq/commit/7ad799544a9c30b30aa96df8864119159c9a1185)\)

## [1.6.2](https://github.com/taskforcesh/bullmq/compare/v1.6.1...v1.6.2) \(2019-12-16\)

### Bug Fixes

- change default QueueEvents lastEventId to $ \([3c5b01d](https://github.com/taskforcesh/bullmq/commit/3c5b01d16ee1442f5802a0fe4e7675c14f7a7f1f)\)
- ensure QE ready before adding test events \([fd190f4](https://github.com/taskforcesh/bullmq/commit/fd190f4be792b03273481c8aaf73be5ca42663d1)\)
- explicitly test the behavior of .on and .once \([ea11087](https://github.com/taskforcesh/bullmq/commit/ea11087b292d9325105707b53f92ac61c334a147)\)

## [1.6.1](https://github.com/taskforcesh/bullmq/compare/v1.6.0...v1.6.1) \(2019-12-16\)

### Bug Fixes

- check of existing redis instance \([dd466b3](https://github.com/taskforcesh/bullmq/commit/dd466b332b03b430108126531d59ff9e66ce9521)\)

# [1.6.0](https://github.com/taskforcesh/bullmq/compare/v1.5.0...v1.6.0) \(2019-12-12\)

### Features

- add generic type to job data and return value \([87c0531](https://github.com/taskforcesh/bullmq/commit/87c0531efc2716db37f8a0886848cdb786709554)\)

# [1.5.0](https://github.com/taskforcesh/bullmq/compare/v1.4.3...v1.5.0) \(2019-11-22\)

### Features

- remove delay dependency \([97e1a30](https://github.com/taskforcesh/bullmq/commit/97e1a3015d853e615ddd623af07f12a194ccab2c)\)
- remove dependence on Bluebird.delay [\#67](https://github.com/taskforcesh/bullmq/issues/67) \([bedbaf2](https://github.com/taskforcesh/bullmq/commit/bedbaf25af6479e387cd7548e246dca7c72fc140)\)

## [1.4.3](https://github.com/taskforcesh/bullmq/compare/v1.4.2...v1.4.3) \(2019-11-21\)

### Bug Fixes

- check in moveToFinished to use default val for opts.maxLenEvents \([d1118aa](https://github.com/taskforcesh/bullmq/commit/d1118aab77f755b4a65e3dd8ea2e195baf3d2602)\)

## [1.4.2](https://github.com/taskforcesh/bullmq/compare/v1.4.1...v1.4.2) \(2019-11-21\)

### Bug Fixes

- avoid Job&lt;-&gt;Queue circular json error \([5752727](https://github.com/taskforcesh/bullmq/commit/5752727a6294e1b8d35f6a49e4953375510e10e6)\)
- avoid the .toJSON serializer interface [\#70](https://github.com/taskforcesh/bullmq/issues/70) \([5941b82](https://github.com/taskforcesh/bullmq/commit/5941b82b646e46d53970197a404e5ea54f09d008)\)

## [1.4.1](https://github.com/taskforcesh/bullmq/compare/v1.4.0...v1.4.1) \(2019-11-08\)

### Bug Fixes

- default job settings [\#58](https://github.com/taskforcesh/bullmq/issues/58) \([667fc6e](https://github.com/taskforcesh/bullmq/commit/667fc6e00ae4d6da639d285a104fb67e01c95bbd)\)

# [1.4.0](https://github.com/taskforcesh/bullmq/compare/v1.3.0...v1.4.0) \(2019-11-06\)

### Features

- job.progress\(\) return last progress for sandboxed processors \([5c4b146](https://github.com/taskforcesh/bullmq/commit/5c4b146ca8e42c8a29f9db87326a17deac30e10e)\)

# [1.3.0](https://github.com/taskforcesh/bullmq/compare/v1.2.0...v1.3.0) \(2019-11-05\)

### Features

- test worker extends job lock while job is active \([577efdf](https://github.com/taskforcesh/bullmq/commit/577efdfb1d2d3140be78dee3bd658b5ce969b16d)\)

# [1.2.0](https://github.com/taskforcesh/bullmq/compare/v1.1.0...v1.2.0) \(2019-11-03\)

### Bug Fixes

- only run coveralls after success \([bd51893](https://github.com/taskforcesh/bullmq/commit/bd51893c35793657b65246a2f5a06469488c8a06)\)

### Features

- added code coverage and coveralls \([298cfc4](https://github.com/taskforcesh/bullmq/commit/298cfc48e35e648e6a22ac0d1633ac16c7b6e3de)\)
- added missing deps for coverage \([6f3ab8d](https://github.com/taskforcesh/bullmq/commit/6f3ab8d78ba8503a76447f0db5abf0c1c4f8e185)\)
- ignore commitlint file in coverage \([f874441](https://github.com/taskforcesh/bullmq/commit/f8744411a1b20b95e568502be15ec50cf8520926)\)
- only upload coverage once after all tests pass \([a7f73ec](https://github.com/taskforcesh/bullmq/commit/a7f73ecc2f51544f1d810de046ba073cb7aa5663)\)

# [1.1.0](https://github.com/taskforcesh/bullmq/compare/v1.0.1...v1.1.0) \(2019-11-01\)

### Bug Fixes

- failing build \([bb21d53](https://github.com/taskforcesh/bullmq/commit/bb21d53b199885dcc97e7fe20f60caf65e55e782)\)
- fix failing tests \([824eb6b](https://github.com/taskforcesh/bullmq/commit/824eb6bfb2b750b823d057c894797ccb336245d8)\)

### Features

- initial version of job locking mechanism \([1d4fa38](https://github.com/taskforcesh/bullmq/commit/1d4fa383e39f4f5dcb69a71a1359dd5dea75544c)\)

## [1.0.1](https://github.com/taskforcesh/bullmq/compare/v1.0.0...v1.0.1) \(2019-10-27\)

### Bug Fixes

- save job stacktrace on failure \([85dfe52](https://github.com/taskforcesh/bullmq/commit/85dfe525079a5f89c1901dbf35c7ddc6663afc24)\)
- simplify logic for stackTraceLimit \([296bd89](https://github.com/taskforcesh/bullmq/commit/296bd89514d430a499afee934dcae2aec41cffa2)\)

# 1.0.0 \(2019-10-20\)

### Bug Fixes

- add compilation step before running tests \([64abc13](https://github.com/taskforcesh/bullmq/commit/64abc13681f8735fb3ee5add5b271bb4da618047)\)
- add extra client to worker fixes [\#34](https://github.com/taskforcesh/bullmq/issues/34) \([90bd891](https://github.com/taskforcesh/bullmq/commit/90bd891c7514f5e9e397d7aad15069ee55bebacd)\)
- add missing dependency \([b92e330](https://github.com/taskforcesh/bullmq/commit/b92e330aad35ae54f43376f92ad1b41209012b76)\)
- check closing after resuming from pause \([7b2cef3](https://github.com/taskforcesh/bullmq/commit/7b2cef3677e2b3af0370e0023aec4b971ad313fe)\)
- default opts \([333c73b](https://github.com/taskforcesh/bullmq/commit/333c73b5819a263ae92bdb54f0406c19db5cb64f)\)
- do not block if blockTime is zero \([13b2df2](https://github.com/taskforcesh/bullmq/commit/13b2df20cf045c069b8b581751e117722681dcd4)\)
- do not exec if closing \([b1d1c08](https://github.com/taskforcesh/bullmq/commit/b1d1c08a2948088eeb3dd65de78085329bac671b)\)
- do not trim if maxEvents is undefined \([7edd8f4](https://github.com/taskforcesh/bullmq/commit/7edd8f47b392c8b3a7369196befdafa4b29421d1)\)
- emit wait event in add job \([39cba31](https://github.com/taskforcesh/bullmq/commit/39cba31a30b7ef762a8d55d4bc34efec636207bf)\)
- fix a couple of job tests \([e66b97b](https://github.com/taskforcesh/bullmq/commit/e66b97be4577d5ab373fff0f3f45d73de7842a37)\)
- fix compiling error \([3cf2617](https://github.com/taskforcesh/bullmq/commit/3cf261703292d263d1e2017ae30eb490121dab4e)\)
- fix more tests \([6a07b35](https://github.com/taskforcesh/bullmq/commit/6a07b3518f856e8f7158be032110c925ed5c924f)\)
- fix progress script \([4228e27](https://github.com/taskforcesh/bullmq/commit/4228e2768c0cf404e09642ebb4053147d0badb56)\)
- fix retry functionality \([ec41ea4](https://github.com/taskforcesh/bullmq/commit/ec41ea4e0bd88b10b1ba434ef5ceb0952bb59f7b)\)
- fix several floating promises \([590a4a9](https://github.com/taskforcesh/bullmq/commit/590a4a925167a7c7d6c0d9764bbb5ab69235beb7)\)
- fixed reprocess lua script \([b78296f](https://github.com/taskforcesh/bullmq/commit/b78296f33517b8c5d79b300fef920edd03149d2f)\)
- improve concurrency mechanism \([a3f6148](https://github.com/taskforcesh/bullmq/commit/a3f61489e3c9891f42749ff85bd41064943c62dc)\)
- improve disconnection for queue events \([56b53a1](https://github.com/taskforcesh/bullmq/commit/56b53a1aca1e527b50f04d906653060fe8ca644e)\)
- initialize events comsumption in constructor \([dbb66cd](https://github.com/taskforcesh/bullmq/commit/dbb66cda9722d44eca806fa6ad1cabdaabac846a)\)
- make ioredis typings a normal dependency \([fb80b90](https://github.com/taskforcesh/bullmq/commit/fb80b90b12931a12a1a93c5e204dbf90eed4f48f)\)
- minor fixes \([7791cda](https://github.com/taskforcesh/bullmq/commit/7791cdac2bfb6a7fbbab9c95c5d89b1eae226a4c)\)
- parse progres and return value in events \([9e43d0e](https://github.com/taskforcesh/bullmq/commit/9e43d0e30ab90a290942418718cde1f5bfbdcf56)\)
- properly emit event for progress \([3f70175](https://github.com/taskforcesh/bullmq/commit/3f701750b1c957027825ee90b58141cd2556694f)\)
- reduce drain delay to 5 seconds \([c6cfe7c](https://github.com/taskforcesh/bullmq/commit/c6cfe7c0b50cabe5e5eb31f4b631a8b1d3706611)\)
- remove buggy close\(\) on redis-connection \(fixes 5 failing tests\) \([64c2ede](https://github.com/taskforcesh/bullmq/commit/64c2edec5e738f43676d0f4ca61bdea8609203fc)\)
- remove unused dependencies \([34293c8](https://github.com/taskforcesh/bullmq/commit/34293c84bb0ed54f18d70c86821c3ac627d376a5)\)
- replace init by waitUntilReady \([4336161](https://github.com/taskforcesh/bullmq/commit/43361610de5b1a993a1c65f3f21ac745b8face21)\)
- reworked initialization of redis clients \([c17d4be](https://github.com/taskforcesh/bullmq/commit/c17d4be5a2ecdda3efcdc6b9d7aecdfaccd06d83)\)
- several fixes to make the lib work on other ts projects \([3cac1b0](https://github.com/taskforcesh/bullmq/commit/3cac1b0715613d9df51cb1ed6fe0859bcfbb8e9b)\)
- throw error messages instead of codes \([9267541](https://github.com/taskforcesh/bullmq/commit/92675413f1c3b9564574dc264ffcab0d6089e70e)\)
- update tests after merge \([51f75a4](https://github.com/taskforcesh/bullmq/commit/51f75a4929e7ae2704e42fa9035e335fe60d8dc0)\)
- wait until ready before trying to get jobs \([f3b768f](https://github.com/taskforcesh/bullmq/commit/f3b768f251ddafa207466af552376065b35bec8f)\)
- **connections:** reused connections \([1e808d2](https://github.com/taskforcesh/bullmq/commit/1e808d24018a29f6611f4fccd2f5754de0fa3e39)\)
- waitUntilFinished improvements \([18d4afe](https://github.com/taskforcesh/bullmq/commit/18d4afef08f04d19cb8d931e02fff8f962d07ee7)\)

### Features

- add cleaned event \([c544775](https://github.com/taskforcesh/bullmq/commit/c544775803626b5f03cf6f7c3cf18ed1d92debab)\)
- add empty method \([4376112](https://github.com/taskforcesh/bullmq/commit/4376112369d869c0a5c7ab4a543cfc50200e1414)\)
- add retry errors \([f6a7990](https://github.com/taskforcesh/bullmq/commit/f6a7990fb74585985729c5d95e2238acde6cf74a)\)
- add script to generate typedocs \([d0a8cb3](https://github.com/taskforcesh/bullmq/commit/d0a8cb32ef9090652017f8fbf2ca42f0960687f7)\)
- add some new tests for compat class, more minor fixes \([bc0f653](https://github.com/taskforcesh/bullmq/commit/bc0f653ecf7aedd5a46eee6f912ecd6849395dca)\)
- add support for adding jobs in bulk \([b62bddc](https://github.com/taskforcesh/bullmq/commit/b62bddc054b266a809b4b1646558a095a276d6d1)\)
- add trimEvents method to queue client \([b7da7c4](https://github.com/taskforcesh/bullmq/commit/b7da7c4de2de81282aa41f8b7624b9030edf7d15)\)
- automatically trim events \([279bbba](https://github.com/taskforcesh/bullmq/commit/279bbbab7e96ad8676ed3bd68663cb199067ea67)\)
- emit global stalled event fixes [\#10](https://github.com/taskforcesh/bullmq/issues/10) \([241f229](https://github.com/taskforcesh/bullmq/commit/241f229761691b9ac17124da005f91594a78273d)\)
- get rid of Job3 in favor of bullmq Job class \([7590cea](https://github.com/taskforcesh/bullmq/commit/7590ceae7abe32a8824e4a265f95fef2f9a6665f)\)
- implement close in redis connection fixes [\#8](https://github.com/taskforcesh/bullmq/issues/8) \([6de8b48](https://github.com/taskforcesh/bullmq/commit/6de8b48c9612ea39bb28db5f4130cb2a2bb5ee90)\)
- make delay in backoffs optional \([30d59e5](https://github.com/taskforcesh/bullmq/commit/30d59e519794780a8198222d0bbd88779c623275)\)
- move async initialization to constructors \([3fbacd0](https://github.com/taskforcesh/bullmq/commit/3fbacd088bc3bfbd61ed8ff173e4401193ce48ec)\)
- port a lot of functionality from bull 3.x \([ec9f3d2](https://github.com/taskforcesh/bullmq/commit/ec9f3d266c1aca0c27cb600f056d813c81259b4c)\)
- port more features from bull 3.x \([75bd261](https://github.com/taskforcesh/bullmq/commit/75bd26158678ee45a14e04fd7c3a1f96219979a2)\)
- ported tests and functionality from bull 3 \([1b6b192](https://github.com/taskforcesh/bullmq/commit/1b6b1927c7e8e6b6f1bf0bbd6c74eb59cc17deb6)\)
- **workers:** support for async backoffs \([c555837](https://github.com/taskforcesh/bullmq/commit/c55583701e5bdd4e6436a61c833e506bc05749de)\)
- remove support of bull3 config format in compat class \([d909486](https://github.com/taskforcesh/bullmq/commit/d9094868e34c2af21f810aaef4542951a509ccf8)\)
- support global:progress event \([60f4d85](https://github.com/taskforcesh/bullmq/commit/60f4d85d332b3be4a80db7aa179f3a9ceeb1d6f8)\)
- trim option to event stream [\#21](https://github.com/taskforcesh/bullmq/issues/21) & fix [\#17](https://github.com/taskforcesh/bullmq/issues/17) \([7eae653](https://github.com/taskforcesh/bullmq/commit/7eae65340820043101fadf1f87802f506020d553)\)

## Changelog

### 4.0.0-beta.2

#### Fixed

- Removed humans, they weren't doing fine with animals.

#### Changed

- Animals are now super cute, all of them.

### 4.0.0-beta.1

#### Added

- Introduced animals into the world, we believe they're going to be a neat addition.

### 4.0.0-beta.0
