# Important Notes

The queue aims for an "at least once" working strategy. This means that in some situations, a job could be processed more than once. This mostly happens when a worker fails to keep a lock for a given job during the total duration of the processing.

When a worker is processing a job it will keep the job "locked" so other workers can't process it.

It's important to understand how locking works to prevent your jobs from losing their lock - becoming _stalled_ - and being restarted as a result. Locking is implemented internally by creating a lock for `lockDuration` on interval `lockRenewTime` (which is usually half `lockDuration`). If `lockDuration` elapses before the lock can be renewed, the job will be considered stalled and is automatically restarted; it will be **double processed**. This can happen when:

1. The Node process running your job processor unexpectedly terminates.
2. Your job processor was too CPU-intensive and stalled the Node event loop, and as a result, Bull couldn't renew the job lock (see [#488](https://github.com/OptimalBits/bull/issues/488) for how we might better detect this). You can fix this by breaking your job processor into smaller parts so that no single part can block the Node event loop. Alternatively, you can pass a larger value for the `lockDuration` setting (with the tradeoff being that it will take longer to recognize a real stalled job).

As such, you should always listen for the `stalled` event and log this to your error monitoring system, as this means your jobs are likely getting double-processed.

As a safeguard so problematic jobs won't get restarted indefinitely (e.g. if the job processor always crashes its Node process), jobs will be recovered from a stalled state a maximum of `maxStalledCount` times (default: `1`).
