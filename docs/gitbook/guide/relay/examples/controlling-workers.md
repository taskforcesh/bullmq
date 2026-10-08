# Controlling workers

**Scenario:** a queue is processed by many workers on many machines, and you
want to change how they run without redeploying: lower their concurrency
while a downstream API is struggling, pause them during a maintenance
window, and have workers started later follow the same settings.

Each worker subscribes to a settings topic for its queue. The settings are
published as a [retained message](../retained-messages.md), so every worker,
including those started later, applies the current settings when it starts.

## Every worker

```typescript
import { Relay, Worker } from 'bullmq';

interface WorkerSettings {
  concurrency: number;
  paused: boolean;
}

const connection = { host: 'redis.internal', port: 6379 };
const relay = new Relay({ connection });

const worker = new Worker('emails', processEmail, {
  connection,
  concurrency: 10,
});

async function apply(settings: WorkerSettings) {
  worker.concurrency = settings.concurrency;
  if (settings.paused && !worker.isPaused()) {
    await worker.pause(); // waits for the active jobs to finish
  } else if (!settings.paused && worker.isPaused()) {
    await worker.resume();
  }
}

await relay.subscribe('workers.emails.settings', message => {
  apply(message.data as WorkerSettings).catch(err =>
    logger.error(err, 'could not apply worker settings'),
  );
});
```

## Changing the settings

From an admin tool, a script, or an API endpoint:

```typescript
const result = await relay.publish(
  'workers.emails.settings',
  { concurrency: 2, paused: false },
  { retain: 7 * 24 * 60 * 60 * 1000 },
);
console.log(`applied by ${result.endpoints} workers`);
```

## Targeting some workers

Add levels to the topic to address groups of workers, and have each worker
subscribe to the levels that apply to it:

```typescript
const region = process.env.REGION; // e.g. 'eu-west-1'

await relay.subscribe('workers.emails.settings', onSettings); // all workers
await relay.subscribe(`workers.emails.regions.${region}.settings`, onSettings);
```

## Why the Relay

- **Workers started later apply the current settings** at once, from the
  retained message.
- **The publish result tells you how many workers received the change.**
- **A worker that briefly lost its connection still receives the change**
  from its inbox.

## Things to watch

- These are live settings: a retained message expires. Keep the defaults in
  the worker's code (or your database), and republish if you want a setting
  to last.
- `worker.pause()` waits for the active jobs to finish. Use
  `worker.pause(true)` to stop fetching new jobs without waiting.
- To stop specific running jobs rather than whole workers, see
  [Cancelling jobs on other workers](cancelling-jobs-on-other-workers.md).
