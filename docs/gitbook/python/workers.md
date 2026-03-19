# Workers

Workers are the instances that consume and process jobs from a queue. A worker receives jobs one at a time (or concurrently, depending on settings) and executes a processor function for each job. If the processor succeeds, the job moves to the `completed` state. If it throws an exception, the job moves to `failed`.

{% hint style="info" %}
Failed jobs can be automatically retried. See [Retrying Failing Jobs](retrying-failing-jobs.md).
{% endhint %}

## Basic Usage

Create a worker by providing a queue name, an async processor function, and optional configuration:

```python
from bullmq import Worker

async def process(job, token):
    # job.data contains the payload added to the queue
    # job.name contains the job name
    # job.id contains the job ID
    await job.updateProgress(50)
    return {"result": "done"}  # stored as job.returnvalue

worker = Worker("myQueue", process, {"connection": "redis://localhost:6379"})
```

The worker auto-starts by default (`autorun=True`) and begins consuming jobs immediately upon instantiation.

## Concurrency

By default, a worker processes one job at a time. To process multiple jobs concurrently, set the `concurrency` option:

```python
worker = Worker("myQueue", process, {
    "concurrency": 5,
    "connection": "redis://localhost:6379",
})
```

## Events

Workers emit events that you can listen to for monitoring and logging:

```python
worker.on("completed", lambda job, result: print(f"Job {job.id} completed"))
worker.on("failed", lambda job, err: print(f"Job {job.id} failed: {err}"))
worker.on("active", lambda job, prev: print(f"Job {job.id} is now active"))
worker.on("stalled", lambda job_id: print(f"Job {job_id} has stalled"))
worker.on("error", lambda err: print(f"Worker error: {err}"))
```

## Stalled Jobs

When a worker picks up a job, BullMQ places a lock on it. The worker must periodically renew this lock to signal that it is still actively processing. If the lock expires (e.g., because the worker crashed or is unresponsive), the job is considered **stalled** and will be automatically moved back to the waiting state for reprocessing.

The relevant settings are:

| Option | Default | Description |
|---|---|---|
| `lockDuration` | `30000` (30s) | How long the job lock lasts, in milliseconds. |
| `stalledInterval` | `30000` (30s) | How often the stalled-jobs check runs, in milliseconds. |
| `maxStalledCount` | `1` | Maximum number of times a job can be requeued due to stalling before it is permanently moved to `failed`. |

The worker automatically renews all active job locks every `lockDuration / 2` milliseconds. A separate stalled-jobs check runs every `stalledInterval` milliseconds; if it finds a job with an expired lock, it requeues the job.

```python
worker = Worker("myQueue", process, {
    "lockDuration": 60000,
    "stalledInterval": 15000,
    "maxStalledCount": 3,
})
```

{% hint style="warning" %}
If your processor performs long-running CPU-intensive work, consider increasing `lockDuration` to avoid jobs being incorrectly marked as stalled.
{% endhint %}

## Graceful Shutdown

The worker does **not** register signal handlers automatically. You must handle `SIGTERM` and `SIGINT` yourself and call `worker.close()` for a graceful shutdown:

```python
import asyncio
import signal
from bullmq import Worker

async def process(job, token):
    return await do_work(job.data)

async def main():
    worker = Worker("myQueue", process, {
        "connection": "redis://localhost:6379",
        "concurrency": 5,
    })

    loop = asyncio.get_running_loop()
    shutdown_event = asyncio.Event()

    loop.add_signal_handler(signal.SIGTERM, shutdown_event.set)
    loop.add_signal_handler(signal.SIGINT, shutdown_event.set)

    await shutdown_event.wait()

    # Graceful: waits for active jobs to finish
    await worker.close()

if __name__ == "__main__":
    asyncio.run(main())
```

{% hint style="info" %}
Use `loop.add_signal_handler()` instead of `signal.signal()` for proper asyncio-safe signal registration.
{% endhint %}

Calling `worker.close()` waits for all currently active jobs to complete before shutting down. To force an immediate shutdown (cancels in-flight jobs; stalled-check will requeue them later), use:

```python
await worker.close(force=True)
```
