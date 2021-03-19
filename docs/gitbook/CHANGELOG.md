## [1.15.1](https://github.com/taskforcesh/bullmq/compare/v1.15.0...v1.15.1) (2021-03-19)


### Bug Fixes

* **obliterate:** safer implementation ([82f571f](https://github.com/taskforcesh/bullmq/commit/82f571f2548c61c776b897fd1c5050bb09c8afca))

# [1.15.0](https://github.com/taskforcesh/bullmq/compare/v1.14.8...v1.15.0) (2021-03-18)


### Features

* add method to "obliterate" a queue, fixes [#430](https://github.com/taskforcesh/bullmq/issues/430) ([624be0e](https://github.com/taskforcesh/bullmq/commit/624be0ed48159c2aa405025938925a723330e0c2))

## [1.14.8](https://github.com/taskforcesh/bullmq/compare/v1.14.7...v1.14.8) (2021-03-06)


### Bug Fixes

* specify promise type to make TS 4.1 and 4.2 happy. ([#418](https://github.com/taskforcesh/bullmq/issues/418)) ([702f609](https://github.com/taskforcesh/bullmq/commit/702f609b410d8b0652c2d0504a8a67526966fdc3))

## [1.14.7](https://github.com/taskforcesh/bullmq/compare/v1.14.6...v1.14.7) (2021-02-16)


### Bug Fixes

* remove "client" property of QueueBaseOptions ([#324](https://github.com/taskforcesh/bullmq/issues/324)) ([e0b9e71](https://github.com/taskforcesh/bullmq/commit/e0b9e71c4da4a93af54c4386af461c61ab5f146c))

## [1.14.6](https://github.com/taskforcesh/bullmq/compare/v1.14.5...v1.14.6) (2021-02-16)


### Bug Fixes

* remove next job in removeRepeatableByKey fixes [#165](https://github.com/taskforcesh/bullmq/issues/165) ([fb3a7c2](https://github.com/taskforcesh/bullmq/commit/fb3a7c2f429d535dd9f038687d7230d61201defc))

## [1.14.5](https://github.com/taskforcesh/bullmq/compare/v1.14.4...v1.14.5) (2021-02-16)


### Bug Fixes

* add jobId support to repeatable jobs fixes [#396](https://github.com/taskforcesh/bullmq/issues/396) ([c2dc669](https://github.com/taskforcesh/bullmq/commit/c2dc6693a4546e547245bc7ec1e71b4841829619))

## [1.14.4](https://github.com/taskforcesh/bullmq/compare/v1.14.3...v1.14.4) (2021-02-08)


### Bug Fixes

* reconnect at start fixes [#337](https://github.com/taskforcesh/bullmq/issues/337) ([fb33772](https://github.com/taskforcesh/bullmq/commit/fb3377280b3bda04a15a62d2901bdd78b869e08c))

## [1.14.3](https://github.com/taskforcesh/bullmq/compare/v1.14.2...v1.14.3) (2021-02-07)


### Bug Fixes

* **worker:** avoid possible infinite loop fixes [#389](https://github.com/taskforcesh/bullmq/issues/389) ([d05566e](https://github.com/taskforcesh/bullmq/commit/d05566ec0153f31a1257f7338399fdb55c959487))

## [1.14.2](https://github.com/taskforcesh/bullmq/compare/v1.14.1...v1.14.2) (2021-02-02)


### Bug Fixes

* improve job timeout notification by giving the job name and id in the error message ([#387](https://github.com/taskforcesh/bullmq/issues/387)) ([ca886b1](https://github.com/taskforcesh/bullmq/commit/ca886b1f854051aed0888f5b872a64b052b2383e))

## [1.14.1](https://github.com/taskforcesh/bullmq/compare/v1.14.0...v1.14.1) (2021-02-01)


### Bug Fixes

* job finish queue events race condition ([355bca5](https://github.com/taskforcesh/bullmq/commit/355bca5ee128bf4ff37608746f9c6f7cca580eb0))
