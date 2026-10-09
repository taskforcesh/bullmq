# Cancelling jobs on other workers

**Scenario:** a user cancels a long-running export from your web app. The
request reaches one of your API servers, while the job runs on any worker of
the fleet.

`worker.cancelJob(jobId)` aborts a running job, but only from the process
that runs it. With the Relay, every worker subscribes to the cancellation
topic of its queue, and the API server publishes the request there. The
worker running the job aborts it; for every other worker, and for jobs that
are not running, the request is a no-op, as `worker.cancelJob()` is.

## Every worker

The processor must observe the `AbortSignal` (its third argument), and
throw an `UnrecoverableError` so the cancelled job is not retried:

```typescript
import { Relay, UnrecoverableError, Worker } from 'bullmq';

const connection = { host: 'redis.internal', port: 6379 };
const relay = new Relay({ connection });

const worker = new Worker(
  'exports',
  async (job, token, signal) => {
    for (const page of await listPages(job.data)) {
      if (signal?.aborted) {
        throw new UnrecoverableError(`cancelled: ${signal.reason}`);
      }
      await exportPage(page, { signal }); // pass it to fetch, streams, etc.
    }
  },
  { connection },
);

await relay.subscribe('jobs.exports.cancel', message => {
  const { jobId, reason } = message.data as { jobId: string; reason: string };
  // Only the worker running the job finds it; the others return false.
  worker.cancelJob(jobId, reason);
});
```

See [Cancelling jobs](../../workers/cancelling-jobs.md) for more ways to
react to the signal.

## Several queues in one process

When a process runs workers for several queues, one subscription with a
wildcard can serve all of them. Every message carries the concrete topic it
was published on, so the handler reads the queue name from it:

```typescript
const workers = new Map<string, Worker>([
  ['exports', exportsWorker],
  ['reports', reportsWorker],
]);

await relay.subscribe('jobs.*.cancel', message => {
  // message.topic is e.g. 'jobs.exports.cancel'
  const queueName = decodeURIComponent(message.topic.split('.')[1]);
  const { jobId, reason } = message.data as { jobId: string; reason: string };
  workers.get(queueName)?.cancelJob(jobId, reason);
});
```

Publishers keep publishing to `jobs.<queue>.cancel`. `decodeURIComponent`
reverses the encoding of queue names that need it (see
[Values in topics](../topics-and-patterns.md#values-in-topics)). The process
also receives the requests of queues it doesn't run, and ignores them; use
one subscription per queue if that traffic matters.

## Requesting a cancellation

From any process, for example the API server:

```typescript
import { Relay } from 'bullmq';

const relay = new Relay({ connection });

export async function cancelExport(
  jobId: string,
  reason = 'cancelled by user',
): Promise<boolean> {
  const { endpoints } = await relay.publish('jobs.exports.cancel', {
    jobId,
    reason,
  });
  return endpoints > 0;
}
```

`false` means that no worker is subscribed, so nobody received the request.
`true` means the request was delivered to at least one worker's inbox, not
that the worker running the job received it or cancelled the job. If that
worker receives it and the processor observes the signal before finishing,
the job fails with your `UnrecoverableError`.

## Why the Relay

A common way to reach every worker is broadcasting with Redis pub/sub. The
Relay improves on it:

- **A worker that is reconnecting doesn't miss the request.** It waits in
  the worker's inbox.
- **It works with every Redis client and with PostgreSQL**, not only with
  clients that support pub/sub.

## Limitations

- **Only running jobs are cancelled.** A request for a job that is not
  running when the workers receive it has no effect, even if the job starts
  right after.
- **Cancellation is cooperative.** A processor that ignores the signal runs
  to the end.
- **A job can finish first.** A request that arrives once the job is
  completed has no effect.
- **No confirmation.** `publish()` tells you how many workers received the
  request, not whether one of them was running the job.
- **A worker that is removed** (frozen or disconnected for longer than the
  relay's `leaseDuration`) misses the request. By then its job has most
  likely been moved back to the queue as stalled.
