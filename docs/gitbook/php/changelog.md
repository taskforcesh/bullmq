## [1.0.3](https://github.com/taskforcesh/bullmq/compare/vphp1.0.2...vphp1.0.3) (2026-07-24)


### Bug Fixes

* **connection:** use more permissive typing on NodeRedisRawClient options ([#4184](https://github.com/taskforcesh/bullmq/issues/4184)) ([#4187](https://github.com/taskforcesh/bullmq/issues/4187)) ([0feec14](https://github.com/taskforcesh/bullmq/commit/0feec14452865c419961edb9c733f9951b6a663f)), closes [#4170](https://github.com/taskforcesh/bullmq/issues/4170)
* **deps:** update dependency msgpackr to v2.0.2 [security] ([#4202](https://github.com/taskforcesh/bullmq/issues/4202)) ([fbe04af](https://github.com/taskforcesh/bullmq/commit/fbe04af1b3e9c7c9683229544914a54c5bb1f8d8))
* **queue:** retrieve jobs in same transaction under getJobs ([#4300](https://github.com/taskforcesh/bullmq/issues/4300)) (python) (elixir) (php) (rust) ([8571503](https://github.com/taskforcesh/bullmq/commit/8571503034a43c6d5882e290051957215fd20fee))


### Features

* add QueueEvents, queue/worker getters, and missing options [rust] ([#4229](https://github.com/taskforcesh/bullmq/issues/4229)) ([60ae049](https://github.com/taskforcesh/bullmq/commit/60ae0492a3200f8496976a3b51609e7e54eafd1b))
* idiomatic builder-based ergonomics across the public API [rust] ([#4288](https://github.com/taskforcesh/bullmq/issues/4288)) ([bbf0844](https://github.com/taskforcesh/bullmq/commit/bbf0844a250d08d6bfafacb43360f26a57cb9c87))

## [1.0.2](https://github.com/taskforcesh/bullmq/compare/vphp1.0.1...vphp1.0.2) (2026-04-03)


### Features

* **deduplication:** add keepLastIfActive option for at-least-once-after-active semantics ([#3902](https://github.com/taskforcesh/bullmq/issues/3902)) ([aa529bc](https://github.com/taskforcesh/bullmq/commit/aa529bc512b15cdb9d173cc9cc3b0d9f8b8959eb))

## [1.0.1](https://github.com/taskforcesh/bullmq/compare/vphp1.0.0...vphp1.0.1) (2025-12-19)


### Bug Fixes

* **release:** correct php release condition check [php] ([#3617](https://github.com/taskforcesh/bullmq/issues/3617)) ([7ac421c](https://github.com/taskforcesh/bullmq/commit/7ac421cb2e754ba262a18bb17d47f15fb22a6962))

# 0.1.0 (2025-12-09)


### Features

* initial php package ([d365bb3](https://github.com/taskforcesh/bullmq/commit/d365bb3f31193afc3c89c54a0d78aaac2abd2cbf))
