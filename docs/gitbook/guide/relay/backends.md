# Backends: Redis and PostgreSQL

The Relay runs on the same datastores as queues. All its logic is
implemented inside the datastore, as Lua scripts on Redis and SQL functions
on PostgreSQL, behind the `IRelayBackend` interface. Both backends behave
identically: the same test suite runs against each of them.

## Redis

The default backend. It works with every Redis client BullMQ supports
(ioredis, node-redis, Bun's Redis client and Valkey GLIDE), and with Redis
5.0 or newer and compatible servers.

```typescript
import { Relay } from 'bullmq';

const relay = new Relay({
  connection: { host: 'redis.internal', port: 6379 },
  prefix: 'bull', // default
  namespace: 'default', // default
});
```

You can also pass an existing client instance as `connection`. The relay
duplicates it for its blocking inbox reads and leaves the instance open when
it closes.

- **Inboxes** are Redis streams, read with `XREAD BLOCK`. Each inbox is capped
  at about `inboxMaxLength` entries (default `10000`): a node that falls that
  far behind loses its oldest messages.
- **Keys** live under `{prefix}:relay:{namespace}:`. A namespace with no nodes
  left only keeps its message id counter, plus the retained messages until
  they expire.

### Redis Cluster

All the keys of a namespace must be in the same hash slot, as for a queue.
Use a [hash tag](../../patterns/redis-cluster.md) in the prefix:

```typescript
const relay = new Relay({ connection: cluster, prefix: '{relay}' });
```

All the traffic of a namespace then goes to one shard. Use several namespaces
to spread unrelated traffic.

### Keys

For reference, when inspecting a Redis instance:

| Key                                      | Type   | Content                                          |
| ---------------------------------------- | ------ | ------------------------------------------------ |
| `…:nodes`                                | Set    | Registered node ids                              |
| `…:alive:{nodeId}`                       | String | A node's lease (expires with it)                 |
| `…:inbox:{nodeId}`                       | Stream | A node's inbox                                   |
| `…:eps:{nodeId}`, `…:ep:{nodeId}:{id}`   | Set    | A node's subscriptions                           |
| `…:sub:i:{segment}`, `…:sub:p:{pattern}` | Set    | Subscription index, by first segment and pattern |
| `…:ret:{topic}`                          | Hash   | A topic's retained message                       |
| `…:mid`                                  | String | Message id counter                               |

## PostgreSQL

```typescript
import { Relay, createPostgresRelayBackend } from 'bullmq';

const relay = new Relay({
  connection: {
    connectionString: process.env.DATABASE_URL,
    schema: 'bullmq', // default
  },
  backend: createPostgresRelayBackend,
});
```

`connection` takes the same options as the
[PostgreSQL backend](../postgresql.md) for queues: a connection string, a
`pg` pool configuration, or an existing `pg.Pool`.

- **Migration.** The relay needs the `0004_relay` migration. It only adds new
  `relay_*` tables and functions, so it is compatible with instances still
  running an older BullMQ 6 release.
- **Inboxes** are rows of the `relay_inbox` table. Publishers send a `NOTIFY`
  to wake the nodes involved; a node that misses a notification still reads
  its inbox after `blockTimeout` (default 5 seconds).
- **Connections.** Each node uses the pool for commands, plus one dedicated
  connection for `LISTEN`. Account for it in `max_connections`.
- **Throughput.** Every listening node receives every `NOTIFY` of the
  namespace (it only reads its inbox when the notification is for it). That
  fits typical PostgreSQL deployments; for very large fleets with heavy
  traffic, prefer Redis.

### Tables

| Table                | Content                                        |
| -------------------- | ---------------------------------------------- |
| `relay_node`         | Registered nodes and their lease               |
| `relay_subscription` | Subscriptions (removed with their node)        |
| `relay_inbox`        | Undelivered messages (removed with their node) |
| `relay_retained`     | Retained messages                              |

## Custom backends

A backend implements the `IRelayBackend` interface: a small set of semantic
operations (register a node, renew its lease, sweep, subscribe, remove a
subscription, publish, read the inbox), each of which must be atomic. Pass a factory as
the `backend` option:

```typescript
const relay = new Relay({
  connection,
  backend: options => new MyBackend(options),
});
```

The relay's test suite (`tests/utils/relay-suite.ts`) is written against the
interface; running it against your backend is the best way to check that it
behaves like the built-in ones.
