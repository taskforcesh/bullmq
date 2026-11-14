
# Introduction

BullMQ is an open source library for running background jobs and message queues on top of Redis™ or PostgreSQL. One part of your application adds jobs to a queue, and workers, in the same process or in any number of other processes and machines, process them. BullMQ takes care of delivering every job, retrying the ones that fail, and of delays, priorities, rate limits and schedules.

BullMQ is based on 4 classes that together can be used to resolve many different problems. These classes are [_**Queue**_](https://docs.bullmq.io/api/classes/v6.Queue.html), [_**Worker**_](https://docs.bullmq.io/api/classes/v6.Worker.html), [_**QueueEvents**_](https://docs.bullmq.io/api/classes/v6.QueueEvents.html) and [_**FlowProducer**_](https://docs.bullmq.io/api/classes/v6.FlowProducer.html).

The first class you should know about is the _Queue_ class. This class represents a queue and can be used for adding _**jobs**_ to the queue as well as some other basic manipulation such as pausing, cleaning or getting data from the queue. It is also used to create [_**job schedulers**_](https://docs.bullmq.io/guide/job-schedulers.md), which produce repeatable jobs according to a cron expression or a fixed interval.

Jobs in BullMQ are basically a user created data structure that can be stored in the queue. Jobs are processed by _**workers**_. A _Worker_ is the second class you should be aware about. Workers are instances capable of processing jobs. You can have many workers, either running in the same process, or in separate processes as well as in different machines. They will all consume jobs from the queue and mark the jobs as completed or failed.

The _QueueEvents_ class lets you listen, from any process, to the [events](https://docs.bullmq.io/guide/events.md) produced by all the workers of a given queue, such as jobs being completed, failing or reporting progress.

Finally, the _FlowProducer_ class allows you to add [flows](https://docs.bullmq.io/guide/flows.md): trees of jobs with parent-child dependencies, where a parent job is only processed once all its children have completed, even if the children live in different queues.

Besides these classes, BullMQ also includes the [_**Relay**_](https://docs.bullmq.io/guide/relay.md) (experimental), which lets the processes of your system exchange real-time messages through the same datastore used by your queues.

## Backends

The classes above are datastore agnostic. They delegate every operation to a _backend_, which is responsible for storing the jobs and performing all the state transitions atomically. BullMQ ships with two backends:

- **Redis™** (default): works with Redis 6.2 or newer and compatible servers such as Valkey and Dragonfly, using any of the supported clients (ioredis, node-redis, Bun's Redis client or Valkey GLIDE). See [Connections](https://docs.bullmq.io/guide/connections.md).
- **PostgreSQL**: runs the same API on PostgreSQL 13 or newer. See [PostgreSQL backend](https://docs.bullmq.io/guide/postgresql.md).

Unless stated otherwise, the rest of this guide applies to both backends. Any difference is documented in the [feature parity](https://docs.bullmq.io/guide/postgresql.md#feature-parity-and-limitations) section of the PostgreSQL backend.

## Other languages

This guide uses the TypeScript package, which runs on Node.js and Bun. BullMQ is also available for [Python](https://docs.bullmq.io/python/introduction.md), [Elixir](https://docs.bullmq.io/elixir/introduction.md), [.NET](https://docs.bullmq.io/dotnet/introduction.md), [Rust](https://docs.bullmq.io/rust/introduction.md) and [PHP](https://docs.bullmq.io/php/introduction.md). All the SDKs share the same data model, so the concepts described in this guide apply to them as well, and producers and workers written in different languages can work together on the same queues.
