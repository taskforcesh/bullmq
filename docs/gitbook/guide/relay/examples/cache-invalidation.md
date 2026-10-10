# Cache invalidation

**Scenario:** each instance of a service keeps an in-memory cache (of users,
prices, permissions…) to avoid hitting the database on every request. When
an entry changes, every instance must drop it.

Every instance subscribes to the invalidation topics once, at startup. The
code that updates an entry publishes on its topic after the change is
committed.

## Every instance

```typescript
import { LRUCache } from 'lru-cache';
import { Relay } from 'bullmq';

const relay = new Relay({ connection: { host: 'redis.internal', port: 6379 } });
const users = new LRUCache<string, User>({ max: 10_000 });

await relay.subscribe('cache.users.*', message => {
  // topic: cache.users.<id>
  users.delete(message.topic.split('.')[2]);
});

// The node was swept (frozen or disconnected for longer than its lease):
// invalidations may have been missed, so start over.
relay.on('recovered', () => users.clear());

export async function getUser(id: string): Promise<User> {
  let user = users.get(id);
  if (!user) {
    user = await db.users.findById(id);
    users.set(id, user);
  }
  return user;
}
```

## When updating

```typescript
export async function updateUser(id: string, changes: Partial<User>) {
  await db.users.update(id, changes);
  // After the commit, so no instance reloads the old value.
  await relay.publish(`cache.users.${id}`, null);
}
```

The publishing instance has a matching subscription too, so it drops its own
entry the same way.

## Why the Relay

- **An instance that briefly loses its connection doesn't keep stale data**:
  the invalidations published meanwhile wait in its inbox.
- **An instance that was gone for too long knows it**, through the
  `'recovered'` event, and can clear its cache instead of serving stale data.
  With plain pub/sub, missed invalidations go unnoticed.

## Things to watch

- Publish after the transaction commits, never before.
- Use one topic segment per kind of entry (`cache.users.*`,
  `cache.prices.*`), so each service only subscribes to what it caches.
- For data that changes very often, an expiry on the cache entries is
  simpler than invalidating every change.
