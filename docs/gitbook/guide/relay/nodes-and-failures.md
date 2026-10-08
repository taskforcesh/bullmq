# Nodes and failures

Every `Relay` instance is a **node**: it registers itself in the datastore
with a unique id (`relay.nodeId`) and keeps a **lease** alive with
heartbeats. Each node has its own inbox, read continuously on a dedicated
connection.

## Leases and heartbeats

| Option              | Default             | Meaning                                                 |
| ------------------- | ------------------- | ------------------------------------------------------- |
| `leaseDuration`     | `30000` ms          | How long the node stays registered without a heartbeat. |
| `heartbeatInterval` | `leaseDuration / 3` | How often the node renews its lease.                    |
| `sweepInterval`     | `leaseDuration`     | How often the node removes nodes whose lease expired.   |

As soon as a node's lease expires, publishers stop writing to its inbox. Any
node may then **sweep** it: remove the node with its subscriptions and inbox.
Expiry uses the datastore's clock, so clock differences between your
machines don't matter.

A shorter lease detects dead nodes sooner, at the cost of more heartbeats. A
longer lease tolerates longer pauses (garbage collection, a busy event loop,
a slow network) before a node is considered dead.

## What happens when…

| Situation                                                       | Result                                                                                                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| The connection drops for less than the lease                    | Messages published meanwhile wait in the inbox and are delivered on reconnection.                                                  |
| The process is paused or disconnected for longer than the lease | It stops receiving messages and is swept. When it comes back, it [recovers](#recovery); the messages published meanwhile are lost. |
| The process crashes                                             | It is swept once its lease expires. Its subscriptions are removed.                                                                 |
| The process calls `close()`                                     | It is removed at once, with its subscriptions and inbox.                                                                           |
| The datastore is unreachable                                    | `publish` and `subscribe` fail; heartbeats and inbox reads fail and are retried, and are reported as `'error'` events.             |

## Recovery

A node that was swept while still running notices it on its next heartbeat.
It then registers again, restores all its subscriptions, and emits
`'recovered'`:

```typescript
relay.on('recovered', () => {
  // Messages published while this node was gone were lost: resynchronize
  // any state built from them.
  localCache.clear();
});
```

[Retained messages](retained-messages.md) are not delivered again on
recovery.

## Sweeping

Every node sweeps periodically, at most 100 expired nodes at a time, and
emits `'swept'` with the ids it removed:

```typescript
relay.on('swept', nodeIds =>
  logger.info({ nodeIds }, 'removed dead relay nodes'),
);
```

## Graceful shutdown

Close the relay when the process stops, so the other nodes don't have to
wait for its lease to expire:

```typescript
async function shutdown() {
  await worker.close();
  await relay.close();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

`close()` stops the timers, interrupts the inbox read, unregisters the node
and closes the connections the relay opened. Messages still in the inbox are
dropped.

## Connections

A node uses two connections: one for commands and one for reading its inbox
(a blocking read on Redis, `LISTEN` on PostgreSQL). Create one relay per
process and share it, rather than one per module.
