---
description: Cooperatively cancel an in-flight job from outside the processor.
---

# Job Cancellation

BullMQ Python ports the Node `AbortController` / `AbortSignal` pair as a minimal, `asyncio`-aware primitive that lets workers cancel an in-flight job from outside the processor. Cancellation is **cooperative**: the processor opts in by accepting a third `signal` parameter and observing it. Processors that don't accept the signal continue to run unchanged.

| Class             | Role                                                                       |
| ----------------- | -------------------------------------------------------------------------- |
| `AbortController` | Owner. `abort(reason)` flips the signal once; subsequent calls are no-ops. |
| `AbortSignal`     | Read-only view: `aborted`, `reason`, and an awaitable `wait()`.            |
| `AbortError`      | Conventional exception processors raise when they observe an abort.        |

Workers automatically allocate an `AbortController` for every job whose processor declares a 3rd positional parameter. The `AbortSignal` is then passed into the processor as that parameter; no extra plumbing is needed at the call site.

### Opting in

```python
from bullmq import Worker, AbortError

async def process(job, token, signal):
    # 1) Cheap cooperative check at the top.
    if signal.aborted:
        raise AbortError(signal.reason)

    # 2) Or race the abort against the actual work.
    work = asyncio.create_task(do_long_thing())
    wait = asyncio.create_task(signal.wait())
    done, pending = await asyncio.wait(
        {work, wait}, return_when=asyncio.FIRST_COMPLETED
    )
    for p in pending:
        p.cancel()
    if signal.aborted:
        raise AbortError(signal.reason)
    return work.result()

worker = Worker("paint", process)
```

The decision to pass a signal is made via signature inspection (`inspect.signature`). Processors that declare fewer than three positional parameters do **not** receive a signal, and `Worker.cancelJob` is a no-op for their jobs. `*args` is treated as opt-in; `**kwargs` is not — the signal is delivered positionally.

### Cancelling a single job

```python
ok = worker.cancelJob(job_id, reason="user requested cancel")
# ok == True if a controller was allocated for that job, False otherwise.
```

`cancelJob` returns immediately. The processor will see `signal.aborted == True` the next time it checks (or its `signal.wait()` task will resolve). It is the processor's responsibility to short-circuit; the worker does not interrupt the `asyncio.Task` for a cooperative cancel.

### Cancelling every in-flight job

```python
worker.cancelAllJobs(reason="maintenance")
```

Flips the signal on every tracked job at once. Use this when you need to drain a worker without forcibly killing its tasks.

### Forced shutdown propagation

`Worker.close(force=True)` follows the cooperative cancel with task cancellation so a non-cooperating processor cannot block shutdown:

1. `lockManager.cancel_all_jobs(reason="worker force-closed")` flips every signal.
2. Processing tasks are then cancelled (`task.cancel()`), so processors waiting on a non-signal-aware `await` still unwind.

A cooperative processor should handle the `CancelledError` and re-check `signal.aborted` so the abort reason is preserved:

```python
async def cooperative(job, token, signal):
    work = asyncio.create_task(asyncio.sleep(5))
    wait = asyncio.create_task(signal.wait())
    try:
        done, pending = await asyncio.wait(
            {work, wait}, return_when=asyncio.FIRST_COMPLETED
        )
        for p in pending:
            p.cancel()
    except asyncio.CancelledError:
        work.cancel()
        wait.cancel()
        if signal.aborted:
            raise AbortError(signal.reason)
        raise
    if signal.aborted:
        raise AbortError(signal.reason)
    return "done"
```

This pattern handles three cases at once:

- The cancel reaches the processor through the signal alone (cooperative cancel, no task cancellation).
- The cancel reaches the processor through a `CancelledError` injected by `force=True` shutdown.
- The processor was cancelled for a non-abort reason (the `CancelledError` is re-raised so the worker handles it as a generic cancellation).

### When `cancelJob` returns False

`cancelJob(job_id)` returns `False` in any of these cases:

- The job is not currently being processed by this worker.
- The processor did not opt in (no `signal` parameter).
- The lock manager has already been closed.

Callers can safely call `cancelJob` regardless and treat the return value as informational.

## Read more

- 💡 [AbortController source](https://github.com/taskforcesh/bullmq/blob/master/python/bullmq/abort_controller.py)
- 💡 [Worker source](https://github.com/taskforcesh/bullmq/blob/master/python/bullmq/worker.py)
- 💡 [Lock Manager](lock-manager.md) — how `cancel_job` propagates inside the worker.
