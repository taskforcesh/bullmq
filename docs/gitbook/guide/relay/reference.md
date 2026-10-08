# Reference

The complete API reference is generated from the source: see
[`Relay`](https://docs.bullmq.io/api/classes/v6.Relay.html). This page
summarizes it.

## Options

```typescript
new Relay(options: RelayOptions)
```

| Option              | Type                  | Default             | Description                                                               |
| ------------------- | --------------------- | ------------------- | ------------------------------------------------------------------------- |
| `connection`        | connection options    | required            | Redis connection (or PostgreSQL, with `backend`).                         |
| `backend`           | `RelayBackendFactory` | Redis               | `createPostgresRelayBackend` for PostgreSQL, or a custom backend.         |
| `prefix`            | `string`              | `'bull'`            | Key prefix (Redis only).                                                  |
| `namespace`         | `string`              | `'default'`         | Relays only exchange messages within a namespace. `[A-Za-z0-9_-]{1,64}`.  |
| `nodeId`            | `string`              | random              | Unique id of this node. `[A-Za-z0-9_-]{1,64}`.                            |
| `leaseDuration`     | `number` (ms)         | `30000`             | How long the node stays registered without a heartbeat.                   |
| `heartbeatInterval` | `number` (ms)         | `leaseDuration / 3` | How often the node renews its lease.                                      |
| `sweepInterval`     | `number` (ms)         | `leaseDuration`     | How often the node removes nodes whose lease expired.                     |
| `maxMessageSize`    | `number` (bytes)      | `524288` (512 KiB)  | Max size of a serialized message.                                         |
| `inboxMaxLength`    | `number`              | `10000`             | Approximate max inbox length per node (Redis only).                       |
| `blockTimeout`      | `number` (ms)         | `5000`              | Max wait of one inbox read; on PostgreSQL, the polling fallback interval. |
| `skipVersionCheck`  | `boolean`             | `false`             | Skip the Redis version check (on PostgreSQL, set it in `connection`).     |

## Methods

| Method                              | Returns                       | Description                                                                      |
| ----------------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| `subscribe(pattern, listener)`      | `Promise<RelaySubscription>`  | Subscribes to a topic or pattern. Exact topics get their retained message first. |
| `publish(topic, data, { retain? })` | `Promise<RelayPublishResult>` | Publishes on a concrete topic. `retain` in ms keeps it as the retained message.  |
| `waitUntilReady()`                  | `Promise<void>`               | Resolves once the node is registered and reading its inbox.                      |
| `close()`                           | `Promise<void>`               | Unregisters the node and closes its connections. Idempotent.                     |

`RelaySubscription`: `{ pattern, unsubscribe(): Promise<void> }`.

`RelayPublishResult`: `{ mid, nodes, endpoints }`, the message id and how
many nodes and subscriptions it was delivered to.

`RelayMessage<T>`: `{ topic, data: T, mid, ts, retained }`.

## Events

| Event         | Arguments  | When                                                                                |
| ------------- | ---------- | ----------------------------------------------------------------------------------- |
| `'error'`     | `Error`    | A listener failed, or a background operation (heartbeat, sweep, inbox read) failed. |
| `'recovered'` | –          | The node was swept while running, registered again and restored its subscriptions.  |
| `'swept'`     | `string[]` | This node removed expired nodes.                                                    |

## Errors

Operations rejected by the datastore throw a `RelayError` with a `code` from
`RelayErrorCode`:

| Code                | Value | Meaning                                                             |
| ------------------- | ----- | ------------------------------------------------------------------- |
| `InvalidTopic`      | `-1`  | The topic doesn't follow the [rules](topics-and-patterns.md#rules). |
| `InvalidPattern`    | `-2`  | The pattern doesn't follow the rules.                               |
| `NodeNotRegistered` | `-3`  | The node was swept; it recovers on its next heartbeat.              |
| `DataTooLarge`      | `-4`  | The serialized message is larger than `maxMessageSize`.             |
| `InvalidId`         | `-5`  | Invalid node or subscription id.                                    |

Using a relay after `close()` throws `Error('Relay is closed')`.

```typescript
import { RelayError, RelayErrorCode } from 'bullmq';

try {
  await relay.publish(topic, data);
} catch (err) {
  if (err instanceof RelayError && err.code === RelayErrorCode.DataTooLarge) {
    // publish an id instead, and let receivers fetch the data
  }
}
```
