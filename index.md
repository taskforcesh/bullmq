
# What is BullMQ

BullMQ is a fast and robust distributed job and message queue. It is available natively for **TypeScript/JavaScript** ([Node.js](https://nodejs.org) and [Bun](https://bun.sh)), **Python**, **Elixir**, **Rust**, **.NET** and **PHP**, and it can run on top of [Redis™](https://redis.io) (or compatible datastores such as [Valkey](https://valkey.io) and [Dragonfly](https://www.dragonflydb.io)) as well as on [PostgreSQL](https://www.postgresql.org).

BullMQ helps you solve many of the problems found in modern architectures, from offloading heavy work out of your web servers to orchestrating complex workflows across micro-services written in different languages.

The library is designed so that it will fulfill the following goals:

- **At-least-once delivery**: every job is delivered to a worker at least once. Under normal operation each job is processed exactly once, but if a worker crashes or loses the lock of a job while processing it, the job can be processed again, so design your processors to be [idempotent](https://docs.bullmq.io/patterns/idempotent-jobs.md).
- **Easy to scale horizontally**: add more workers, on as many machines as you need, to process jobs in parallel.
- **Consistent**: every state transition of a job is atomic, implemented as Lua scripts on Redis and as transactional SQL functions on PostgreSQL.
- **High performance**: get the highest possible throughput from your datastore by combining efficient scripts, pipelining and a polling-free design.
- **Language and datastore agnostic**: every SDK shares the exact same scripts and data model, so producers and workers written in different languages can work on the same queues.

View the repository, see open issues, and contribute back [on GitHub](https://github.com/taskforcesh/bullmq)!

## Supported languages

All the SDKs are developed in the same [repository](https://github.com/taskforcesh/bullmq) and are built on top of the same Lua and SQL scripts, which guarantees identical behavior across languages. A job added from a PHP web application can be processed by a Python worker, and its result consumed by a Node.js service.

| Language                                       | Package                                                                         | Install                                     | Redis™ | PostgreSQL |
| ---------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------- | ------ | ---------- |
| [TypeScript](https://docs.bullmq.io/quick-start.md) (Node.js and Bun) | [bullmq](https://www.npmjs.com/package/bullmq)                                  | `npm install bullmq`                        | ✅     | ✅         |
| [Python](https://docs.bullmq.io/python/introduction.md)               | [bullmq](https://pypi.org/project/bullmq/)                                      | `pip install bullmq`                        | ✅     | ✅         |
| [Elixir](https://docs.bullmq.io/elixir/introduction.md)               | [bullmq](https://hex.pm/packages/bullmq)                                        | `{:bullmq, "~> 2.3"}`                       | ✅     | ✅         |
| [.NET](https://docs.bullmq.io/dotnet/introduction.md)                 | [BullMQ](https://www.nuget.org/packages/BullMQ)                                 | `dotnet add package BullMQ`                 | ✅     | ✅         |
| [Rust](https://docs.bullmq.io/rust/introduction.md)                   | [bullmq-official](https://crates.io/crates/bullmq-official)                     | `cargo add bullmq-official --rename bullmq` | ✅     | ❌         |
| [PHP](https://docs.bullmq.io/php/introduction.md)                     | [taskforcesh/bullmq-php](https://github.com/taskforcesh/bullmq/tree/master/php) | Composer                                    | ✅     | ❌         |

The TypeScript package is the reference implementation and the one covered by the [Guide](https://docs.bullmq.io/guide/introduction.md), so it is usually the first to receive new features. The other SDKs implement the core classes (`Queue`, `Worker`, `QueueEvents`, `FlowProducer` and job schedulers), with the exception of PHP, which provides a producer-only `Queue` client. Check the introduction page of each language for the details.

> **Note:** If your platform does not have a native SDK, you can still use BullMQ through the [BullMQ Proxy](https://github.com/taskforcesh/bullmq-proxy), which exposes queues over HTTP.

## Supported datastores

BullMQ is not tied to a specific datastore. The high-level classes talk to a _backend_ that implements every queue operation, so you can choose the datastore that best fits your infrastructure:

- **Redis™ 6.2 or newer** (the default). BullMQ also works with compatible servers such as [Valkey](https://valkey.io) and [Dragonfly](https://docs.bullmq.io/guide/redis-tm-compatibility/dragonfly.md), managed services such as [AWS ElastiCache](https://docs.bullmq.io/guide/redis-tm-hosting/aws-elasticache.md) and [AWS MemoryDB](https://docs.bullmq.io/guide/redis-tm-hosting/aws-memorydb.md), and [Redis Cluster](https://docs.bullmq.io/patterns/redis-cluster.md). In Node.js you can use [ioredis](https://github.com/redis/ioredis) (default), [node-redis](https://github.com/redis/node-redis), [Bun's built-in Redis client](https://bun.sh/docs/api/redis) or [Valkey GLIDE](https://github.com/valkey-io/valkey-glide). Read more in [Connections](https://docs.bullmq.io/guide/connections.md).
- **PostgreSQL 13 or newer**. Run the very same API on PostgreSQL, so your jobs can live in the same database as the rest of your data, without operating a separate Redis instance. Read more in [PostgreSQL backend](https://docs.bullmq.io/guide/postgresql.md).

You can also implement your own backend, see [Providing a custom backend](https://docs.bullmq.io/guide/connections.md#providing-a-custom-backend).

## **Features**

If you are new to Message Queues, you may wonder why they are needed after all. Queues can solve many different problems in an elegant way, from smoothing out processing peaks to creating robust communication channels between micro-services or offloading heavy work from one server to many smaller workers, and many other use cases. Check the [Patterns](https://docs.bullmq.io/patterns/adding-bulks.md) section for getting some inspiration and information about best practices.

- [x] **Minimal CPU usage due to a polling-free design**
- [x] **Distributed job execution based on Redis™ or PostgreSQL**
- [x] **Native SDKs for TypeScript, Python, Elixir, Rust, .NET and PHP, all interoperable**
- [x] **LIFO and FIFO jobs**
- [x] **Priorities**
- [x] **Delayed jobs**
- [x] **Job schedulers for repeatable jobs, using cron expressions or fixed intervals**
- [x] **Retries of failed jobs with built-in or custom backoff strategies**
- [x] **Deduplication and debouncing of jobs**
- [x] **Rate limiting and global concurrency per queue**
- [x] **Concurrency setting per worker**
- [x] **Threaded (sandboxed) processing functions, using child processes or worker threads**
- [x] **Automatic recovery from process crashes (stalled jobs)**
- [x] **Parent-Child dependencies (flows)**
- [x] **Job cancellation**
- [x] **Real-time events and custom events**
- [x] **Metrics, with Prometheus export**
- [x] **OpenTelemetry support**
- [x] **Real-time messaging between processes with the** [**Relay**](https://docs.bullmq.io/guide/relay.md) **(experimental)**

## Ecosystem

- [**BullMQ Pro**](https://docs.bullmq.io/bullmq-pro/introduction.md): the commercial version of BullMQ, with advanced features such as groups, batches and observables, and dedicated support from the authors.
- [**Taskforce.sh**](https://taskforce.sh): the official dashboard to monitor and manage your queues and jobs.
- [**NestJS**](https://docs.bullmq.io/guide/nestjs.md): official integration with the [NestJS](https://nestjs.com) framework.

### Used by

BullMQ is used by many organizations big and small, here are some notable examples:

![](https://raw.githubusercontent.com/taskforcesh/bullmq/master/docs/gitbook/.gitbook/assets/clipart1565701.png)

![](https://raw.githubusercontent.com/taskforcesh/bullmq/master/docs/gitbook/.gitbook/assets/wordmark-logo.png)

![](https://raw.githubusercontent.com/taskforcesh/bullmq/master/docs/gitbook/.gitbook/assets/datawrapper-logo.png)

![](<https://raw.githubusercontent.com/taskforcesh/bullmq/master/docs/gitbook/.gitbook/assets/curri-small%20(1).png>)
