# Introduction

BullMQ is based in 4 classes that together can be used to resolve many different problems. These classes are [_**Queue**_](https://docs.bullmq.io/api/classes/v6.Queue.html), [_**Worker**_](https://docs.bullmq.io/api/classes/v6.Worker.html), [_**QueueEvents**_](https://docs.bullmq.io/api/classes/v6.QueueEvents.html) and [_**FlowProducer**_](https://docs.bullmq.io/api/classes/v6.FlowProducer.html).

The first class you should know about is the _Queue_ class. This class represents a queue and can be used for adding _**jobs**_ to the queue as well as some other basic manipulation such as pausing, cleaning or getting data from the queue. It is also used to create [_**job schedulers**_](job-schedulers/README.md), which produce repeatable jobs according to a cron expression or a fixed interval.

Jobs in BullMQ are basically a user created data structure that can be stored in the queue. Jobs are processed by _**workers**_. A _Worker_ is the second class you should be aware about. Workers are instances capable of processing jobs. You can have many workers, either running in the same process, or in separate processes as well as in different machines. They will all consume jobs from the queue and mark the jobs as completed or failed.

The _QueueEvents_ class lets you listen, from any process, to the [events](events/README.md) produced by all the workers of a given queue, such as jobs being completed, failing or reporting progress.

Finally, the _FlowProducer_ class allows you to add [flows](flows/README.md): trees of jobs with parent-child dependencies, where a parent job is only processed once all its children have completed, even if the children live in different queues.

Besides these classes, BullMQ also includes the [_**Relay**_](relay/README.md) (experimental), which lets the processes of your system exchange real-time messages through the same datastore used by your queues.

## Backends

The classes above are datastore agnostic. They delegate every operation to a _backend_, which is responsible for storing the jobs and performing all the state transitions atomically. BullMQ ships with two backends:

- **Redis™** (default): works with Redis 6.2 or newer and compatible servers such as Valkey and Dragonfly, using any of the supported clients (ioredis, node-redis, Bun's Redis client or Valkey GLIDE). See [Connections](connections.md).
- **PostgreSQL**: runs the same API on PostgreSQL 13 or newer. See [PostgreSQL backend](postgresql.md).

Unless stated otherwise, the rest of this guide applies to both backends. Any difference is documented in the [feature parity](postgresql.md#feature-parity-and-limitations) section of the PostgreSQL backend.

## Other languages

This guide uses the TypeScript package, which runs on Node.js and Bun. BullMQ is also available for [Python](../python/introduction.md), [Elixir](../elixir/introduction.md), [.NET](../dotnet/introduction.md), [Rust](../rust/introduction.md) and [PHP](../php/introduction.md). All the SDKs share the same data model, so the concepts described in this guide apply to them as well, and producers and workers written in different languages can work together on the same queues.
