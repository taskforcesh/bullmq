# Topics and patterns

A **topic** names what a message is about, as a dot-separated keypath from
the general to the specific:

```
queues.emails.jobs.42.progress
tenants.acme.users.17.notifications
config.feature-flags
```

Design topics the way you would design REST paths: one segment per level of
the hierarchy, with identifiers (tenant, user, job…) in their own segments.
That way, a single pattern can observe a whole branch of the hierarchy.

## Rules

| Rule       | Value                                                      |
| ---------- | ---------------------------------------------------------- |
| Separator  | `.`                                                        |
| Segment    | One or more of `A-Z a-z 0-9 _ - : %`                       |
| Max length | 512 bytes                                                  |
| Max depth  | 16 segments                                                |
| Reserved   | Topics whose first segment starts with `$` (for the relay) |

Empty segments (`a..b`, `.a`, `a.`) are invalid. Publishing to an invalid
topic, or subscribing to an invalid pattern, rejects with a `RelayError`
(codes `InvalidTopic` and `InvalidPattern`).

The rules are enforced by the datastore (in the relay's Lua scripts and SQL
functions), so every BullMQ runtime accepts and rejects exactly the same
topics.

## Patterns

Subscriptions take a topic or a **pattern** with wildcards:

| Wildcard | Matches                       | Allowed                  |
| -------- | ----------------------------- | ------------------------ |
| `*`      | Exactly one segment           | In any position          |
| `>`      | One or more trailing segments | Only as the last segment |

| Pattern            | Matches                                  | Does not match                    |
| ------------------ | ---------------------------------------- | --------------------------------- |
| `orders.42.status` | `orders.42.status`                       | `orders.42`, `orders.42.status.x` |
| `orders.*.status`  | `orders.42.status`, `orders.7.status`    | `orders.42.items.status`          |
| `orders.>`         | `orders.42`, `orders.42.status`          | `orders`                          |
| `*.42.status`      | `orders.42.status`, `invoices.42.status` | `orders.43.status`                |
| `tenants.acme.>`   | everything under `tenants.acme`          | `tenants.other.users`             |
| `>`                | every topic                              |                                   |

The hierarchy only exists in the names: a message published to
`orders.42.status` is **not** delivered to a subscription to `orders.42`.
Subscribe to `orders.42.>` to receive everything below it.

You always **publish to a concrete topic**: wildcards are only valid in
subscriptions.

## Values in topics

When a segment comes from data (a queue name, a user id, an email…), make
sure it only contains allowed characters. Numeric ids and UUIDs are fine as
they are. For anything else, percent-encode the value:

```typescript
/**
 * Encodes any value as a single topic segment: only A-Z a-z 0-9 _ - and %
 * are left, so the result never contains ".", "*" or ">".
 */
function topicSegment(value: string | number): string {
  return encodeURIComponent(String(value)).replace(
    /[.!'()*~]/g,
    char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

const topic = [
  'queues',
  topicSegment('emails.eu'),
  'jobs',
  job.id,
  'progress',
].join('.');
// 'queues.emails%2Eeu.jobs.42.progress'
```

`decodeURIComponent` reverses it.

{% hint style="warning" %}
Never put unencoded user input in a topic. Besides making the topic invalid,
a value containing `.` would create extra levels, and a subscription built
from it could observe more than you intended.
{% endhint %}

## Designing topics

- **Put the most general segment first.** Wildcards then select whole
  branches: `tenants.acme.>` is everything for one tenant,
  `tenants.*.invoices.>` is the invoices of every tenant.
- **Keep identifiers in their own segment**, never concatenated with other
  text, so `*` can match them.
- **Use one topic per resource** (`jobs.42.progress`, not `jobs.progress`
  with the id in the payload) when receivers care about specific resources.
  Topics cost nothing until someone subscribes, and the datastore then only
  delivers what each receiver needs.
- **Use namespaces, not topic prefixes, to isolate environments** (see
  [Getting started](getting-started.md#namespaces)).
