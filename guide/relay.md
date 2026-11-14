# Relay

The **Relay** lets the processes of your system talk to each other through the
datastore BullMQ already uses (Redis or PostgreSQL). Any process can publish a
message on a **topic**, and every subscription that matches it receives the
message, on whatever machine it runs.

```typescript
import { Relay } from 'bullmq';

const relay = new Relay({ connection: { host: 'localhost', port: 6379 } });

// On any process:
await relay.subscribe('orders.*.status', message => {
  console.log(message.topic, message.data);
});

// On any other process:
await relay.publish('orders.42.status', { status: 'shipped' });
```

> **Warning:** The Relay is **experimental**. Its API may change in minor releases while it
> is being completed.

## What it is for

Queues are for **work**: every job is processed by exactly one worker, with
retries, rate limits and persistence. The Relay is for **telling other
processes that something happened**, or what the current state of something
is:

- Showing live job progress in the API server a user is connected to, while
  the job runs on a worker somewhere else
  ([example](https://docs.bullmq.io/guide/relay/examples/live-job-progress.md)).
- Pushing real-time notifications to the API server that holds a user's
  WebSocket connection ([example](https://docs.bullmq.io/guide/relay/examples/realtime-notifications.md)).
- Invalidating in-memory caches on every instance of a service
  ([example](https://docs.bullmq.io/guide/relay/examples/cache-invalidation.md)).
- Distributing live configuration and feature flags
  ([example](https://docs.bullmq.io/guide/relay/examples/live-configuration.md)).
- Controlling a fleet of workers: changing their concurrency, pausing them
  ([example](https://docs.bullmq.io/guide/relay/examples/controlling-workers.md)).
- Cancelling jobs running on other workers
  ([example](https://docs.bullmq.io/guide/relay/examples/cancelling-jobs-on-other-workers.md)).

## How it compares

|                                | Queue             | `QueueEvents`            | Redis pub/sub         | Relay                                     |
| ------------------------------ | ----------------- | ------------------------ | --------------------- | ----------------------------------------- |
| Each message goes to           | One worker        | Every listener           | Every subscriber      | Every matching subscription               |
| What you can publish           | Jobs              | Queue events only        | Anything              | Anything (JSON)                           |
| Addressing                     | Queue name        | Queue name               | Channel or glob       | Topic keypaths with `*` and `>` wildcards |
| Process briefly disconnected   | Jobs wait         | Resumes from its last id | **Messages are lost** | Messages wait in its inbox                |
| Latest value for new listeners | –                 | –                        | –                     | [Retained messages](https://docs.bullmq.io/guide/relay/retained-messages.md) |
| Datastores                     | Redis, PostgreSQL | Redis, PostgreSQL        | Redis                 | Redis, PostgreSQL                         |

For a comparison with event-streaming platforms, see
[Relay compared to Kafka](https://docs.bullmq.io/guide/relay/relay-vs-kafka.md).

## How it works

Every process that creates a `Relay` is a **node**. A node registers itself in
the datastore, keeps a lease alive with heartbeats, and has its own **inbox**.

When a message is published, the datastore itself finds every subscription
whose pattern matches the topic, and appends **one entry to the inbox of each
node** involved, listing which of that node's subscriptions it is for. Each
node reads its inbox and calls the listeners.

- **Routing happens in the datastore.** All the logic (topic matching,
  subscriptions, leases, inboxes) runs in atomic Lua scripts on Redis and SQL
  functions on PostgreSQL. The `Relay` class only reads its inbox and calls
  your listeners, so every BullMQ runtime behaves exactly the same.
- **Inboxes are durable.** A node that briefly loses its connection reads the
  messages published in the meantime when it reconnects. A node that stops
  renewing its lease (it crashed, or was frozen for too long) is removed
  together with its subscriptions and inbox.
- **Only interested nodes are reached.** A message is written only to the
  inboxes of nodes with a matching subscription.

Read more in [Nodes and failures](https://docs.bullmq.io/guide/relay/nodes-and-failures.md) and
[Backends](https://docs.bullmq.io/guide/relay/backends.md).

## Contents

- [Getting started](https://docs.bullmq.io/guide/relay/getting-started.md)
- [Topics and patterns](https://docs.bullmq.io/guide/relay/topics-and-patterns.md)
- [Publishing and subscribing](https://docs.bullmq.io/guide/relay/messages.md)
- [Retained messages](https://docs.bullmq.io/guide/relay/retained-messages.md)
- [Nodes and failures](https://docs.bullmq.io/guide/relay/nodes-and-failures.md)
- [Backends: Redis and PostgreSQL](https://docs.bullmq.io/guide/relay/backends.md)
- [Reference](https://docs.bullmq.io/guide/relay/reference.md)
- [Relay compared to Kafka](https://docs.bullmq.io/guide/relay/relay-vs-kafka.md)
- Examples:
  - [Live job progress](https://docs.bullmq.io/guide/relay/examples/live-job-progress.md)
  - [Real-time notifications for WebSocket servers](https://docs.bullmq.io/guide/relay/examples/realtime-notifications.md)
  - [Cache invalidation](https://docs.bullmq.io/guide/relay/examples/cache-invalidation.md)
  - [Live configuration and feature flags](https://docs.bullmq.io/guide/relay/examples/live-configuration.md)
  - [Controlling workers](https://docs.bullmq.io/guide/relay/examples/controlling-workers.md)
  - [Cancelling jobs on other workers](https://docs.bullmq.io/guide/relay/examples/cancelling-jobs-on-other-workers.md)
