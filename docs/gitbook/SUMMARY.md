# Table of contents

* [Quick Start](README.md)
* [What is BullMQ](what-is-bullmq.md)
* [API Reference](index.md)
* [Changelog](changelog.md)

## Guide

* [Introduction](guide/introduction.md)
* [Connections](guide/connections.md)
* [Queues](guide/queues.md)
* [Workers](guide/workers/README.md)
  * [Concurrency](guide/workers/concurrency.md)
  * [Graceful shutdown](guide/workers/graceful-shutdown.md)
  * [Stalled Jobs](guide/workers/stalled-jobs.md)
  * [Sandboxed processors](guide/workers/sandboxed-processors.md)
  * [Pausing queues](guide/workers/pausing-queues.md)
* [Jobs](guide/jobs/README.md)
  * [FIFO](guide/jobs/fifo.md)
  * [LIFO](guide/jobs/lifo.md)
  * [Delayed](guide/jobs/delayed.md)
  * [Repeatable](guide/jobs/repeatable.md)
  * [Prioritized](guide/jobs/proritized.md)
  * [Stalled](guide/jobs/stalled.md)
  * [Getters](guide/jobs/getters.md)
* [Rate limiting](guide/rate-limiting.md)
* [Retrying failing jobs](guide/retrying-failing-jobs.md)
* [Returning job data](guide/returning-job-data.md)
* [Events](guide/events.md)
* [QueueScheduler](guide/queuescheduler.md)
* [Architecture](guide/architecture.md)

## Patterns

* [Manually processing jobs](patterns/manually-fetching-jobs.md)
* [Producer - Consumer](patterns/producer-consumer.md)
* [Flows](patterns/flows.md)
* [Real time updates](patterns/real-time-updates.md)
* [Sender - Receiver](patterns/sender-receiver.md)
* [Working with batches](patterns/working-with-batches.md)
* [Idempotent jobs](patterns/idempotent-jobs.md)
* [Debounce jobs](patterns/debounce-jobs.md)

## Bull 3.x Migration

* [Compatibility class](bull-3.x-migration/compatibility-class.md)
* [Migration](bull-3.x-migration/migration.md)

