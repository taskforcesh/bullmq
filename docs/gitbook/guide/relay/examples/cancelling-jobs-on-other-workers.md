# Cancelling jobs on other workers

**Scenario:** a user cancels a long-running export from your web app. The
request reaches one of your API servers, but the job may be waiting in the
queue, or already running on any worker of the fleet.

`worker.cancelJob(jobId)` aborts a job, but only from the process that runs
it. With the Relay, every worker subscribes to the cancellation topic of its
queue, and the API server publishes the request there. Jobs that aren't
running yet are simply removed.

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

## Requesting a cancellation

```typescript
import { Queue, Relay } from 'bullmq';

const queue = new Queue('exports', { connection });
const relay = new Relay({ connection });

type CancelResult =
  'not_found' | 'finished' | 'removed' | 'not_delivered' | 'signalled';

export async function cancelExport(
  jobId: string,
  reason = 'cancelled by user',
): Promise<CancelResult> {
  const job = await queue.getJob(jobId);
  if (!job) {
    return 'not_found';
  }

  const state = await job.getState();
  if (state === 'completed' || state === 'failed') {
    return 'finished';
  }

  if (state !== 'active') {
    try {
      // Waiting, delayed, prioritized…: remove it before a worker takes it.
      await job.remove();
      return 'removed';
    } catch {
      // A worker took it in the meantime (the job is locked): signal it.
    }
  }

  const { endpoints } = await relay.publish('jobs.exports.cancel', {
    jobId,
    reason,
  });
  return endpoints === 0 ? 'not_delivered' : 'signalled';
}
```

`'not_delivered'` means no subscribed endpoints matched the request.
`'signalled'` means the request was enqueued for at least one endpoint, not
that the worker owning the job received it or cancelled the job. If that
worker receives it and the processor observes the signal before finishing,
the job fails with your `UnrecoverableError`.

## Why the Relay

The documentation of earlier releases suggested broadcasting cancellations
with Redis pub/sub. The Relay improves on it:

- **A worker that is reconnecting doesn't miss the request.** It waits in
  the worker's inbox.
- **It works with every Redis client and with PostgreSQL**, not only with
  clients that support pub/sub.

## Limitations

This pattern covers the common case. Keep in mind:

- **Cancellation is cooperative.** A processor that ignores the signal runs
  to the end.
- **A job can finish first.** A request that arrives once the job is
  completed has no effect.
- **A job that is retried by a worker other than the one that received the
  request is not cancelled.** This can only happen if the processor throws a
  regular `Error` on abort, which is why it should throw an
  `UnrecoverableError`.
- **A worker that is removed** (frozen or disconnected for longer than the
  relay's `leaseDuration`) misses the request. Its job will most likely be
  moved back to the queue as stalled by then; call `cancelExport` again if
  you need to be sure.
