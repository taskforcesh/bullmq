# Publishing and subscribing

## Payloads

`publish` accepts any JSON-serializable value: objects, arrays, strings,
numbers, booleans and `null`. The value is serialized with `JSON.stringify`,
so the usual JSON rules apply: `undefined` is published as `null`, `Date`
objects arrive as ISO strings, and class instances arrive as plain objects.

The serialized payload can be up to **512 KiB** by default; change it with
the `maxMessageSize` option (in bytes). Larger messages are rejected with a
`RelayError` (`DataTooLarge`).

{% hint style="info" %}
Keep messages small. Publish what changed and an id, and let receivers fetch
anything big (a job's data, a document) when they need it.
{% endhint %}

## Who receives a message

A message is delivered to **every subscription whose pattern matches its
topic**, on every live node:

- Each subscription receives its own copy, even if several subscriptions of
  the same node match.
- A subscription receives each message once.
- The publishing node receives its own messages if it has a matching
  subscription.
- Nodes in other namespaces never receive it.

`publish` resolves with `{ mid, nodes, endpoints }`: the message id and how
many nodes and subscriptions it was written for. With `nodes: 0` nobody was
listening, and the message is gone (except a
[retained message](retained-messages.md)).

## Order

Messages published one after another by the same publisher (awaiting each
`publish`) are delivered to every subscription in that order. There is no
ordering guarantee between messages published concurrently, by the same
process or by different ones.

If you need to detect stale updates, compare the message ids: `mid` is
unique and increasing within a namespace, so a message with a higher `mid`
was published later.

## Delivery guarantees

A message is written to the inboxes of the nodes that are subscribed **at the
moment it is published**, in the same atomic operation that resolves the
subscriptions. From there:

- **Brief disconnections are covered.** If a node loses its connection, the
  messages published meanwhile wait in its inbox and are delivered when it
  reconnects.
- **Removed nodes lose their messages.** If a node stops renewing its lease
  (it crashed, or was frozen for longer than `leaseDuration`), it is removed
  with its subscriptions and inbox. See
  [Nodes and failures](nodes-and-failures.md).
- **Subscriptions only see what comes after them.** Subscribing does not
  replay earlier messages, except the topic's
  [retained message](retained-messages.md).

In other words, the Relay is for live messages. It is not a log: when a
message must be processed reliably, exactly once and with retries, use a
queue.

## Listeners

Listeners are called in the order messages are delivered. Listeners are not
awaited: an `async` listener runs while the next messages are delivered, so
long work in a listener doesn't hold up the others.

Errors thrown by a listener (or rejections of an `async` listener) are
emitted as `'error'` events on the relay and don't affect delivery to other
listeners.

```typescript
relay.on('error', err => logger.error(err, 'relay listener failed'));

await relay.subscribe('orders.>', async message => {
  await audit.record(message.topic, message.data); // may throw
});
```

## Unsubscribing

`unsubscribe()` stops delivery to that listener at once, and removes the
subscription from the datastore. It is safe to call more than once.

```typescript
const subscription = await relay.subscribe('jobs.42.progress', onProgress);
// later
await subscription.unsubscribe();
```

Closing the relay removes all its subscriptions.
