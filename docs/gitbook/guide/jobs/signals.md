---
description: Make a job wait for an event, such as an approval or a webhook, without holding a worker.
---

# Signals

A job often has to wait for something that happens outside the queue: a
person approving a report, a webhook from a payment provider, a reply to an
email. With signals, the job waits in the delayed state, without holding a
worker or using up an attempt, and continues as soon as the event arrives.

{% hint style="warning" %}
Signals are new and only available in the Node.js library for now, on both
Redis and PostgreSQL.
{% endhint %}

## Waiting for a signal

In the processor, call `job.waitForSignal` with the name of the signal, the
worker's token and a timeout:

```typescript
import { Worker } from 'bullmq';

const worker = new Worker(
  'reports',
  async (job, token) => {
    const report = await writeReport(job.data);

    const approval = await job.waitForSignal<{ by: string }>(
      'approval',
      token,
      { timeout: 7 * 24 * 60 * 60 * 1000 }, // one week
    );

    await publish(report, approval.by);
  },
  { connection },
);
```

If the signal has not arrived yet, `waitForSignal` moves the job to the
delayed state and throws a `DelayedError`, so the processor stops and the
worker can take other jobs. When the signal arrives, the job is moved back to
wait and the processor **runs again from the start**. This time
`waitForSignal` returns the signal's data.

Because the processor runs again, the work before the wait is done again too.
Keep it cheap or safe to repeat, or save its result on the job (for example
with `job.updateData`) and skip it when it is already there.

{% hint style="info" %}
Don't catch the `DelayedError` thrown by `waitForSignal`. If your processor
catches all errors, rethrow it, as with
[`moveToDelayed`](../../patterns/process-step-jobs.md).
{% endhint %}

## Sending a signal

Send the signal from anywhere, for example the API endpoint behind an
"Approve" button:

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('reports', { connection });

const result = await queue.signal(jobId, 'approval', { by: 'ana' });
// 'woken': the job was waiting for this signal and continues now.
// 'stored': the signal was stored, and the job reads it when it waits for it.
```

The data can be any JSON-serializable value.

## How it works

- **A signal is never missed.** Storing a signal and waking the job happen in
  one atomic operation, and so do checking for the signal and moving the job
  to delayed. A signal that arrives while the job is still running, just
  before it calls `waitForSignal`, is found by that call.
- **Signals are stored on the job.** A signal sent before the job waits for
  it is returned right away. A newer signal with the same name replaces the
  older one.
- **Signals are not consumed.** If the job runs again later (it failed and is
  retried, or it stalled), `waitForSignal` returns the same data, so the
  processor takes the same path.
- **Only a job waiting for that signal is woken.** A job that is delayed for
  another reason (a backoff, a delayed start, or a wait for another signal)
  keeps its schedule; it reads the signal when it asks for it.
- **The signals are removed with the job**, for example by `removeOnComplete`.
- `queue.signal` throws if the job does not exist or has already finished.
- Every signal emits a `signaled` event with `{ jobId, name }` on
  [`QueueEvents`](../events/README.md).

## Timeouts

The timeout is counted from the first time the job waits for that signal. If
the job runs again before the signal arrives (for example, because you
promoted it), it goes back to waiting until the same deadline.

When the deadline passes, `waitForSignal` throws a `SignalTimeoutError`.
Catch it to decide what to do, or let it fail the job:

```typescript
import { SignalTimeoutError, Worker } from 'bullmq';

const worker = new Worker(
  'reports',
  async (job, token) => {
    try {
      await job.waitForSignal('approval', token, { timeout: 48 * 3600_000 });
    } catch (err) {
      if (err instanceof SignalTimeoutError) {
        await notifyManager(job.data);
        return 'expired';
      }
      throw err;
    }
    return 'approved';
  },
  { connection },
);
```

## Things to keep in mind

- Each time the job waits and is woken, it starts again, so `attemptsStarted`
  grows. If you use the worker option `maxStartedAttempts`, allow for it.
- `waitForSignal` is not available in sandboxed processors yet.
