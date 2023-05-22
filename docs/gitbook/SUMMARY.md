# Table of contents

* [What is BullMQ](README.md)
* [Quick Start](<README (1).md>)
* [API Reference](https://api.docs.bullmq.io)
* [Changelog](changelog.md)

## Guide

* [Introduction](guide/introduction.md)
* [Connections](guide/connections.md)
* [Queues](guide/queues/README.md)
  * [Auto-removal of jobs](guide/queues/auto-removal-of-jobs.md)
  * [Adding jobs in bulk](guide/queues/adding-bulks.md)
  * [Removing Jobs](guide/queues/removing-jobs.md)
* [Workers](guide/workers/README.md)
  * [Concurrency](guide/workers/concurrency.md)
  * [Graceful shutdown](guide/workers/graceful-shutdown.md)
  * [Stalled Jobs](guide/workers/stalled-jobs.md)
  * [Sandboxed processors](guide/workers/sandboxed-processors.md)
  * [Pausing queues](guide/workers/pausing-queues.md)
* [Jobs](guide/jobs/README.md)
  * [FIFO](guide/jobs/fifo.md)
  * [LIFO](guide/jobs/lifo.md)
  * [Job Ids](guide/jobs/job-ids.md)
  * [Delayed](guide/jobs/delayed.md)
  * [Repeatable](guide/jobs/repeatable.md)
  * [Prioritized](guide/jobs/prioritized.md)
  * [Removing jobs](guide/jobs/removing-job.md)
  * [Stalled](guide/jobs/stalled.md)
  * [Getters](guide/jobs/getters.md)
* [Flows](guide/flows/README.md)
  * [Adding flows in bulk](guide/flows/adding-bulks.md)
  * [Get Flow Tree](guide/flows/get-flow-tree.md)
  * [Fail Parent](guide/flows/fail-parent.md)
* [Metrics](guide/metrics/metrics.md)
* [Rate limiting](guide/rate-limiting.md)
* [Retrying failing jobs](guide/retrying-failing-jobs.md)
* [Returning job data](guide/returning-job-data.md)
* [Events](guide/events.md)
* [QueueScheduler](guide/queuescheduler.md)
* [Architecture](guide/architecture.md)
* [NestJs](guide/nestjs/README.md)
  * [Producers](guide/nestjs/producers.md)
* [Going to production](guide/going-to-production.md)

## Patterns

* [Adding jobs in bulk across different queues](patterns/adding-bulks.md)
* [Manually processing jobs](patterns/manually-fetching-jobs.md)
* [Named Processor](patterns/named-processor.md)
* [Flows](patterns/flows.md)
* [Idempotent jobs](patterns/idempotent-jobs.md)
* [Throttle jobs](patterns/throttle-jobs.md)
* [Process Step Jobs](patterns/process-step-jobs.md)
* [Failing fast when Redis is down](patterns/failing-fast-when-redis-is-down.md)

## BullMQ Pro

* [Introduction](bullmq-pro/introduction.md)
* [Install](bullmq-pro/install.md)
* [Observables](bullmq-pro/observables/README.md)
  * [Cancelation](bullmq-pro/observables/cancelation.md)
* [Groups](bullmq-pro/groups/README.md)
  * [Rate limiting](bullmq-pro/groups/rate-limiting.md)
  * [Concurrency](bullmq-pro/groups/concurrency.md)
  * [Pausing groups](bullmq-pro/groups/pausing-groups.md)
* [NestJs](bullmq-pro/nestjs/README.md)
  * [Producers](bullmq-pro/nestjs/producers.md)
  * [API Reference](https://nestjs.bullmq.pro/)
  * [Changelog](bullmq-pro/nestjs/changelog.md)
* [API Reference](https://api.bullmq.pro)
* [Changelog](bullmq-pro/changelog.md)

## Bull

* [Introduction](bull/introduction.md)
* [Install](bull/install.md)
* [Quick Guide](bull/quick-guide.md)
* [Important Notes](bull/important-notes.md)
* [Reference](https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md)
* [Patterns](bull/patterns/README.md)
  * [Persistent connections](bull/patterns/persistent-connections.md)
  * [Message queue](bull/patterns/message-queue.md)
  * [Returning Job Completions](bull/patterns/returning-job-completions.md)
  * [Reusing Redis Connections](bull/patterns/reusing-redis-connections.md)
  * [Redis cluster](bull/patterns/redis-cluster.md)
  * [Custom backoff strategy](bull/patterns/custom-backoff-strategy.md)
  * [Debugging](bull/patterns/debugging.md)
  * [Manually fetching jobs](bull/patterns/manually-fetching-jobs.md)

## Bull 3.x Migration

* [Compatibility class](bull-3.x-migration/compatibility-class.md)
* [Migration](bull-3.x-migration/migration.md)

## Python

* [Introduction](python/introduction.md)
* [Changelog](python/changelog.md)