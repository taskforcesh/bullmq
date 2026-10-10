# Live configuration and feature flags

**Scenario:** an admin changes a feature flag or a setting (a rate limit, a
maintenance banner), and every running instance of every service must apply
it within moments, without a restart. Instances that start later must get
the current value too.

The configuration is published as a [retained message](../retained-messages.md):
subscribers to the exact topic get the current value as soon as they
subscribe, then every change.

## Every instance

```typescript
import { Relay } from 'bullmq';

const relay = new Relay({ connection: { host: 'redis.internal', port: 6379 } });

let flags: FeatureFlags = DEFAULT_FLAGS;

async function loadFlags() {
  let received = false;
  await relay.subscribe('config.feature-flags', message => {
    received = true;
    flags = message.data as FeatureFlags;
  });
  // The retained value, if any, is delivered before subscribe() resolves.
  if (!received) {
    flags = await db.settings.get('feature-flags');
  }
}

await loadFlags();

// Retained messages are not delivered again after a recovery.
relay.on('recovered', async () => {
  flags = await db.settings.get('feature-flags');
});

export const isEnabled = (flag: keyof FeatureFlags) => flags[flag];
```

## Admin service

```typescript
const MONTH = 30 * 24 * 60 * 60 * 1000;

export async function setFlags(next: FeatureFlags) {
  await db.settings.set('feature-flags', next); // source of truth
  await relay.publish('config.feature-flags', next, { retain: MONTH });
}
```

To keep the retained value from ever expiring, republish it periodically,
for example with a [job scheduler](../../job-schedulers/README.md):

```typescript
await queue.upsertJobScheduler('republish-flags', {
  every: 24 * 60 * 60 * 1000,
});

new Worker(
  queue.name,
  async () => {
    const current = await db.settings.get('feature-flags');
    await relay.publish('config.feature-flags', current, { retain: MONTH });
  },
  { connection },
);
```

## Why the Relay

- **New instances get the current configuration in the same call** that
  subscribes them to changes, atomically, so no change can be missed between
  reading and subscribing.
- **Changes reach every instance at once**, including instances that briefly
  lost their connection.

## Things to watch

- Keep the database as the source of truth, and the retained message as a
  fast, pushed copy of it.
- Use one topic per independent setting (`config.feature-flags`,
  `config.maintenance`) so services only receive what they use.
