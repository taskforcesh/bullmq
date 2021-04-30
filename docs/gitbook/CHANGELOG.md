# [1.23.0](https://github.com/taskforcesh/bullmq/compare/v1.22.2...v1.23.0) (2021-04-30)


### Features

* **job:** pass parent opts to addBulk ([7f21615](https://github.com/taskforcesh/bullmq/commit/7f216153293e45c4f33f2592561c925ca4464d44))

## [1.22.2](https://github.com/taskforcesh/bullmq/compare/v1.22.1...v1.22.2) (2021-04-29)


### Bug Fixes

* add missing Redis Cluster types fixes [#406](https://github.com/taskforcesh/bullmq/issues/406) ([07743ff](https://github.com/taskforcesh/bullmq/commit/07743ff310ad716802afdd5bdc6844eb5296318e))

## [1.22.1](https://github.com/taskforcesh/bullmq/compare/v1.22.0...v1.22.1) (2021-04-28)


### Bug Fixes

* **addjob:** fix redis cluster CROSSSLOT ([a5fd1d7](https://github.com/taskforcesh/bullmq/commit/a5fd1d7a0713585d11bd862bfe2d426d5242bd3c))

# [1.22.0](https://github.com/taskforcesh/bullmq/compare/v1.21.0...v1.22.0) (2021-04-28)


### Features

* **jobcreate:** allow passing parent in job.create ([ede3626](https://github.com/taskforcesh/bullmq/commit/ede3626b65fb5d3f4cebc55c813e9fa4b482b887))

# [1.21.0](https://github.com/taskforcesh/bullmq/compare/v1.20.6...v1.21.0) (2021-04-26)


### Features

* add typing for addNextRepeatableJob ([a3be937](https://github.com/taskforcesh/bullmq/commit/a3be9379e29ae3e01264e2269e8b03aa614fd42c))

## [1.20.6](https://github.com/taskforcesh/bullmq/compare/v1.20.5...v1.20.6) (2021-04-25)


### Bug Fixes

* **movetocompleted:** should not complete before children ([812ff66](https://github.com/taskforcesh/bullmq/commit/812ff664b3e162dd87831ca04ebfdb783cc7ae5b))

## [1.20.5](https://github.com/taskforcesh/bullmq/compare/v1.20.4...v1.20.5) (2021-04-23)


### Bug Fixes

* **obliterate:** correctly remove many jobs ([b5ae4ce](https://github.com/taskforcesh/bullmq/commit/b5ae4ce92aeaf000408ffbbcd22d829cee20f2f8))

## [1.20.4](https://github.com/taskforcesh/bullmq/compare/v1.20.3...v1.20.4) (2021-04-23)


### Bug Fixes

* remove internal deps on barrel fixes [#469](https://github.com/taskforcesh/bullmq/issues/469) ([#495](https://github.com/taskforcesh/bullmq/issues/495)) ([60dbeed](https://github.com/taskforcesh/bullmq/commit/60dbeed7ff1d9b6cb0e35590713fee8a7be09477))

## [1.20.3](https://github.com/taskforcesh/bullmq/compare/v1.20.2...v1.20.3) (2021-04-23)


### Bug Fixes

* **flows:** correct typings fixes [#492](https://github.com/taskforcesh/bullmq/issues/492) ([a77f80b](https://github.com/taskforcesh/bullmq/commit/a77f80bc07e7627f512323f0dcc9141fe408809e))

## [1.20.2](https://github.com/taskforcesh/bullmq/compare/v1.20.1...v1.20.2) (2021-04-22)


### Bug Fixes

* **movetodelayed:** check if job is in active state ([4e63f70](https://github.com/taskforcesh/bullmq/commit/4e63f70aac367d4dd695bbe07c72a08a82a65d97))

## [1.20.1](https://github.com/taskforcesh/bullmq/compare/v1.20.0...v1.20.1) (2021-04-22)


### Bug Fixes

* **worker:** make token optional in processor function fixes [#490](https://github.com/taskforcesh/bullmq/issues/490) ([3940bd7](https://github.com/taskforcesh/bullmq/commit/3940bd71c6faf3bd5fce572b9c1f11cb5b5d2123))

# [1.20.0](https://github.com/taskforcesh/bullmq/compare/v1.19.3...v1.20.0) (2021-04-21)


### Features

* **worker:** passing token in processor function ([2249724](https://github.com/taskforcesh/bullmq/commit/2249724b1bc6fbf40b0291400011f201fd02dab3))

## [1.19.3](https://github.com/taskforcesh/bullmq/compare/v1.19.2...v1.19.3) (2021-04-20)


### Bug Fixes

* **movetocompleted:** throw an error if job is not in active state ([c2fe5d2](https://github.com/taskforcesh/bullmq/commit/c2fe5d292fcf8ac2e53906c30282df69d43321b1))

## [1.19.2](https://github.com/taskforcesh/bullmq/compare/v1.19.1...v1.19.2) (2021-04-19)


### Bug Fixes

* **worker:** close base class connection [#451](https://github.com/taskforcesh/bullmq/issues/451) ([0875306](https://github.com/taskforcesh/bullmq/commit/0875306ae801a7cbfe04758dc2481cb86ca2ef69))

## [1.19.1](https://github.com/taskforcesh/bullmq/compare/v1.19.0...v1.19.1) (2021-04-19)


### Bug Fixes

* remove repeatable with obliterate ([1c5e581](https://github.com/taskforcesh/bullmq/commit/1c5e581a619ba707863c2a6e9f3e5f6eadfbe64f))

# [1.19.0](https://github.com/taskforcesh/bullmq/compare/v1.18.2...v1.19.0) (2021-04-19)


### Features

* add workerDelay option to limiter ([9b6ab8a](https://github.com/taskforcesh/bullmq/commit/9b6ab8ad4bc0a94068f3bc707ad9c0ed01596068))

## [1.18.2](https://github.com/taskforcesh/bullmq/compare/v1.18.1...v1.18.2) (2021-04-16)


### Bug Fixes

* add parentKey property to Job ([febc60d](https://github.com/taskforcesh/bullmq/commit/febc60dba94c29b85be3e1bc2547fa83ed932806))

## [1.18.1](https://github.com/taskforcesh/bullmq/compare/v1.18.0...v1.18.1) (2021-04-16)


### Bug Fixes

* rename Flow to FlowProducer class ([c64321d](https://github.com/taskforcesh/bullmq/commit/c64321d03e2af7cee88eaf6df6cd2e5b7840ae64))

# [1.18.0](https://github.com/taskforcesh/bullmq/compare/v1.17.0...v1.18.0) (2021-04-16)


### Features

* add remove support for flows ([4e8a7ef](https://github.com/taskforcesh/bullmq/commit/4e8a7efd53f918937478ae13f5da7dee9ea9d8b3))

# [1.17.0](https://github.com/taskforcesh/bullmq/compare/v1.16.2...v1.17.0) (2021-04-16)


### Features

* **job:** consider waiting-children state ([2916dd5](https://github.com/taskforcesh/bullmq/commit/2916dd5d7ba9438d2eae66436899d32ec8ac0e91))

## [1.16.2](https://github.com/taskforcesh/bullmq/compare/v1.16.1...v1.16.2) (2021-04-14)


### Bug Fixes

* read lua scripts serially ([69e73b8](https://github.com/taskforcesh/bullmq/commit/69e73b87bc6855623240a7b1a45368a7914b23b7))

## [1.16.1](https://github.com/taskforcesh/bullmq/compare/v1.16.0...v1.16.1) (2021-04-12)


### Bug Fixes

* **flow:** relative dependency path fixes [#466](https://github.com/taskforcesh/bullmq/issues/466) ([d104bf8](https://github.com/taskforcesh/bullmq/commit/d104bf802d6d1000ac1ccd781fa7a07bce2fe140))

# [1.16.0](https://github.com/taskforcesh/bullmq/compare/v1.15.1...v1.16.0) (2021-04-12)


### Features

* add support for flows (parent-child dependencies) ([#454](https://github.com/taskforcesh/bullmq/issues/454)) ([362212c](https://github.com/taskforcesh/bullmq/commit/362212c58c4be36b5435df862503699deb8bb79c))
