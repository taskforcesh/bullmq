# Retained messages

A **retained message** is the last value published on a topic, kept for a
while so that new subscribers get it straight away. It turns a topic into a
piece of live state: the progress of a job, the status of a service, the
current configuration.

```typescript
// Publisher: keep this value for 10 minutes.
await relay.publish('jobs.42.progress', 70, { retain: 10 * 60 * 1000 });

// A subscriber that joins later gets 70 at once, then every new update.
await relay.subscribe('jobs.42.progress', message => {
  console.log(message.data, message.retained); // 70 true, then 80 false…
});
```

## How it works

- `retain` is a duration in milliseconds. The message replaces the topic's
  previous retained message and expires after that time.
- Publishing **without** `retain` delivers the message but doesn't change the
  retained one.
- A new subscription to an **exact topic** receives the retained message
  first, with `retained: true`. The subscription and the retained value are
  read in one atomic operation, so no update can fall in between.
- Subscriptions with **wildcards** don't receive retained messages: a pattern
  like `jobs.*.progress` would otherwise receive the state of every job at
  once.

The retained message is delivered to the listener before `subscribe()`
resolves.

## Choosing the retention

The retention should cover the time during which a new subscriber still
needs the value:

| State                         | Typical retention                                  |
| ----------------------------- | -------------------------------------------------- |
| Progress of a running job     | A bit more than the longest job (minutes to hours) |
| Result of a finished job      | As long as users may open its page (hours)         |
| Service status, configuration | Long (days), and republished whenever it changes   |

When you need the value to outlive the retention, store it in your database
as usual and use the retained message as a cache in front of it.

## Retained messages and recovery

Retained messages are not delivered again when a node
[recovers](nodes-and-failures.md#recovery) its subscriptions after being
removed. If your node keeps state built from retained messages, refresh it on
the `'recovered'` event.
