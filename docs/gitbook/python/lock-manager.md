---
description: How workers renew job locks atomically and in batches.
---

# Lock Manager

`LockManager` is the component each `Worker` uses to renew the locks of jobs it is currently processing. Other workers consider a job stalled if its lock expires before it completes, so renewals must run on a steady cadence — and they must be batched so that long-tail jobs don't pay the cost of one round-trip per renewal.

Most users never instantiate `LockManager` directly: the `Worker` constructs one with the right cadence and starts it as part of `run()`. The class is documented here because it is part of the public surface and exposes hooks (notably `cancel_job` / `cancel_all_jobs`) that the [Job Cancellation](job-cancellation.md) feature relies on.

### What it does

- Keeps an in-memory registry of `{job_id → {token, ts, abort_controller}}` for every job currently being processed.
- Wakes every `lock_renew_time / 2` ms and calls the `extendJobLocks` Lua script with the subset of tracked jobs whose stored timestamp is older than the renewal threshold. One Lua call atomically renews many locks.
- Emits the worker's `error` event on failure so the worker/application can decide how to react.

### Construction

```python
from bullmq.lock_manager import LockManager

manager = LockManager(
    worker=my_worker,
    lock_renew_time=15_000,   # total renewal window (ms)
    lock_duration=30_000,     # PX value handed to the Lua script (ms)
    worker_id="worker-1",
    worker_name="paint-worker",
)
manager.start()
```

| Parameter         | Description                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `worker`          | The owning `Worker`. Used to access `scripts.extendJobLocks` and to emit events.          |
| `lock_renew_time` | Total renewal window in ms. The loop wakes every half-window; due jobs are renewed.       |
| `lock_duration`   | Passed straight to the Lua script as the new `PX` lifetime for each renewed lock.         |
| `worker_id`       | Unique id of the worker (also written into the lock value so renewals are owner-checked). |
| `worker_name`     | Optional human-readable name surfaced in diagnostics.                                     |

`start()` is idempotent and only spawns the renewal `asyncio.Task` when `lock_renew_time > 0`.

### Tracking jobs

```python
controller = manager.track_job(
    job_id=job.id,
    token=token,
    ts=int(time.time() * 1000),
    should_create_controller=True,
)
```

`track_job` registers the job for renewal and — when `should_create_controller=True` — allocates an [`AbortController`](job-cancellation.md). The controller is stored alongside the job so `cancel_job(job_id)` can later flip its signal, and is returned to the caller so the worker can pass the underlying `AbortSignal` into the processor as the third positional argument (`processor(job, token, signal)`).

`untrack_job(job_id)` removes the entry; the worker calls this when a job completes, fails, or is moved away from the active state.

### Per-job cancellation hooks

```python
# Flip a single job's AbortSignal.
manager.cancel_job(job.id, reason="user requested cancel")

# Flip every tracked job's signal in one shot (used by Worker.close(force=True)).
manager.cancel_all_jobs(reason="worker force-closed")
```

Both methods return immediately and do **not** cancel the underlying `asyncio.Task` — they only flip the cooperative signal. A non-cooperating processor will continue to run; that is intentional. The forced-shutdown path (`Worker.close(force=True)`) follows the cancel with a task cancellation so worker close cannot be blocked indefinitely. See [Job Cancellation](job-cancellation.md) for the full processor-side pattern.

### Introspection

```python
manager.get_active_job_count()  # number of jobs currently tracked
manager.get_tracked_job_ids()   # list[str] of those ids
manager.is_running()            # True while the renewal task is alive
```

### Shutting down

```python
await manager.close()
```

`close()` is idempotent. It cancels the renewal `asyncio.Task` (swallowing the resulting `CancelledError`), clears the tracked-jobs registry, and prevents further `track_job` calls from succeeding so late callers don't end up with an `AbortController` that can never be triggered.

## Read more

- 💡 [LockManager source](https://github.com/taskforcesh/bullmq/blob/master/python/bullmq/lock_manager.py)
- 💡 [extendJobLocks Lua script](https://github.com/taskforcesh/bullmq/blob/master/src/commands/extendLocks-1.lua)
