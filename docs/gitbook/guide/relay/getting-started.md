# Getting started

## Creating a relay

Create one `Relay` per process. It uses the same connection options as
queues and workers, and it is safe to share it between all the code of that
process.

{% tabs %}
{% tab title="Redis" %}

```typescript
import { Relay } from 'bullmq';

const relay = new Relay({
  connection: { host: 'localhost', port: 6379 },
});

await relay.waitUntilReady();
```

{% endtab %}
{% tab title="PostgreSQL" %}

```typescript
import { Relay, createPostgresRelayBackend } from 'bullmq';

const relay = new Relay({
  connection: {
    connectionString: 'postgres://user:password@localhost:5432/app',
    migrate: true, // or run the migrations yourself, see below
  },
  backend: createPostgresRelayBackend,
});

await relay.waitUntilReady();
```

{% endtab %}
{% endtabs %}

`waitUntilReady()` resolves once the node is registered and reading its
inbox. You don't have to await it: `subscribe` and `publish` wait for it.

On PostgreSQL, the relay needs the tables and functions created by the
`0004_relay` migration. Run your migrations as usual (see the
[PostgreSQL backend](../postgresql.md#migrations) guide) after upgrading
BullMQ, or pass `migrate: true` as above.

## Subscribing

```typescript
const subscription = await relay.subscribe('orders.*.status', message => {
  console.log(message.topic); // 'orders.42.status'
  console.log(message.data); // { status: 'shipped' }
});
```

The first argument is a topic or a pattern: `*` matches one segment and `>`
matches one or more trailing segments. See
[Topics and patterns](topics-and-patterns.md).

The listener receives a `RelayMessage`:

| Field      | Description                                                             |
| ---------- | ----------------------------------------------------------------------- |
| `topic`    | The topic the message was published on.                                 |
| `data`     | The published value.                                                    |
| `mid`      | Message id, unique and increasing within the namespace.                 |
| `ts`       | Publish timestamp (ms since epoch).                                     |
| `retained` | `true` when it is the topic's [retained message](retained-messages.md). |

To stop receiving messages:

```typescript
await subscription.unsubscribe();
```

## Publishing

```typescript
const result = await relay.publish('orders.42.status', { status: 'shipped' });
// { mid: '1873', nodes: 3, endpoints: 5 }
```

`data` can be any JSON-serializable value. The result tells you how many
nodes and subscriptions ("endpoints") the message was delivered to; `0`
means nobody was listening.

You can publish from any process, including one that never subscribes.

## Closing

Close the relay when the process shuts down, for example next to your
workers:

```typescript
process.on('SIGTERM', async () => {
  await worker.close();
  await relay.close();
});
```

`close()` unregisters the node: its subscriptions are removed at once and no
more messages are written to its inbox. If a process exits without closing,
other nodes remove it once its lease expires (30 seconds by default). See
[Nodes and failures](nodes-and-failures.md).

## Namespaces

Relays only exchange messages with relays in the same **namespace**
(`'default'` unless you set one). Use namespaces to isolate environments or
applications that share a datastore:

```typescript
const relay = new Relay({ connection, namespace: 'billing' });
```

On Redis, the `prefix` option (default `bull`) also applies, as for queues.

## Errors

`subscribe` and `publish` reject with a `RelayError` when the datastore
refuses the operation (for example, an invalid topic), with one of the codes
listed in the [reference](reference.md#errors).

Problems that happen in the background, such as a listener throwing or the
connection failing while reading the inbox, are emitted as `'error'` events.
Listen to them, as for any BullMQ class:

```typescript
relay.on('error', err => logger.error(err, 'relay error'));
```
