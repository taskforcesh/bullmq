# Backends: Redis and PostgreSQL

The Relay runs on the same datastores as queues. All its logic is
implemented inside the datastore, as Lua scripts on Redis and SQL functions
on PostgreSQL, behind the `IRelayBackend` interface. Both backends behave
identically: the same test suite runs against each of them.

## Redis

The default backend. It works with every Redis client BullMQ supports
(ioredis, node-redis, Bun's Redis client and Valkey GLIDE), and with Redis
6.2 or newer and compatible servers (Valkey, Dragonfly). Queues still run on
Redis 5.0; only the relay needs 6.2, and checks it when it starts.

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

- **Inboxes** are Redis streams, read with `XREAD BLOCK`. Consumed entries are
  removed on every heartbeat, and each inbox keeps at most `inboxMaxLength`
  unread entries (see [Slow subscribers](messages.md#slow-subscribers)).
- **Keys** live under `{prefix}::relay:{<namespace>}:`. The empty segment
  after the prefix keeps them out of the queues' keys: every queue key is
  `{prefix}:{queue name}:…` with a non-empty name, so no queue (even one
  named `relay`) or job can ever collide with the relay. And every relay key
  ends with a fixed word that no queue key uses, never with a node id or a
  topic, so tools that discover queues by their keys never mistake relay keys
  for queues.
- **Nothing is left behind.** Every key expires on its own: a node's record
  and inbox with its lease, the subscription index with the longest lease of
  the namespace, and retained messages when they expire. A namespace whose
  nodes all crashed disappears by itself, even if no other node ever sweeps
  it. When the last node closes, only the retained messages (and the message
  id counter) remain, until they expire.

### Redis Cluster

The namespace is a [hash tag](../../patterns/redis-cluster.md) in the key
names, so all the keys of a namespace are in one hash slot, whatever the
prefix. No configuration is needed:

```typescript
const relay = new Relay({ connection: cluster, namespace: 'orders' });
```

All the traffic of a namespace goes to one shard: the namespace is the unit
of scale. Use several namespaces to spread unrelated traffic over the
shards. (If the prefix has a hash tag of its own, as for queues, it takes
precedence and every namespace shares the prefix's slot.)

### Keys

For reference, when inspecting a Redis instance (`…` is
`{prefix}::relay:{<namespace>}`):

| Key                          | Type       | Content                                                                    |
| ---------------------------- | ---------- | -------------------------------------------------------------------------- |
| `…:layout`                   | Hash       | Data layout version                                                        |
| `…:nodes`                    | Sorted set | Node ids, scored by lease deadline (ms since epoch)                        |
| `…:started`                  | Sorted set | Node ids, scored by registration time                                      |
| `…:{nodeId}:node`            | Hash       | A node's info, last heartbeat, backlog and dropped messages (its lease)    |
| `…:{nodeId}:inbox`           | Stream     | A node's inbox                                                             |
| `…:subs`                     | Sorted set | Subscription index: by node, by pattern, subscribed patterns and wildcards |
| `…:cleanup`                  | Sorted set | Removed nodes whose subscriptions are still being pruned                   |
| `…:retained`                 | Sorted set | Topics with a retained message, scored by expiry                           |
| `…:{topic}:ret`              | Hash       | A topic's retained message                                                 |
| `…:mid`                      | String     | Message id counter, started at the server time in microseconds             |
| `{prefix}::relay:namespaces` | Sorted set | Namespaces in use, scored by how long (for dashboards)                     |

Nodes refuse to join a namespace written with an incompatible data layout
(`RelayErrorCode.IncompatibleLayout`), so a rolling upgrade never mixes
layouts silently.

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

- **Migration.** The relay's tables and functions come with the `0004_relay`
  migration. It only adds `relay_*` objects, so it is compatible with
  instances still running an older BullMQ 6 release.
- **Cleanup.** Rows don't expire by themselves in PostgreSQL. Instead, every
  sweep removes the expired nodes (with their subscriptions and inbox) and
  the expired retained messages of _every_ namespace, so a namespace whose
  nodes all crashed is cleaned by any relay using the same schema.
- **Inboxes** are rows of the `relay_inbox` table. Publishers send a `NOTIFY`
  to wake the nodes involved; a node that misses a notification still reads
  its inbox after `blockTimeout` (default 5 seconds).
  Like on Redis, each inbox keeps at most `inboxMaxLength` unread rows.
- **Connections.** Each node uses the pool for commands, plus one dedicated
  connection for `LISTEN`. Account for it in `max_connections`.
  An existing `pg.Pool` must have `max >= 2`, since its listener occupies a pool
  slot. When sharing a pool, reserve one slot per relay plus query capacity.
  A pool configuration object can use `max: 1`; its listener is separate.
- **Throughput.** Every listening node receives every `NOTIFY` of the
  namespace (it only reads its inbox when the notification is for it). That
  fits typical PostgreSQL deployments; for very large fleets with heavy
  traffic, prefer Redis.

### Tables

| Table                | Content                                        |
| -------------------- | ---------------------------------------------- |
| `relay_node`         | Registered nodes, their lease, info and stats  |
| `relay_subscription` | Subscriptions (removed with their node)        |
| `relay_inbox`        | Undelivered messages (removed with their node) |
| `relay_retained`     | Retained messages                              |

## Custom backends

A backend implements the `IRelayBackend` interface: a small set of semantic
operations (register a node, renew its lease, sweep, subscribe, remove a
subscription, publish, read the inbox), each of which must be atomic, plus
the read-only [getters](reference.md#inspecting-a-namespace). Pass a factory
as the `backend` option:

```typescript
const relay = new Relay({
  connection,
  backend: options => new MyBackend(options),
});
```

The relay's test suite (`tests/relay.test.ts`, with the backend harness in
`tests/utils/relay.ts`) is written against the interface; running it against
your backend is the best way to check that it behaves like the built-in
ones.
