# Retrying Failing Jobs

As your queues process jobs, some will inevitably fail. In BullMQ, a job is considered failed when:

- The processor function raises an exception.
- The job has become [stalled](workers.md#stalled-jobs) and has exceeded the `maxStalledCount` setting.

BullMQ provides several mechanisms for retrying failed jobs, both automatic and manual.

## Automatic Retries

To enable automatic retries, set the `attempts` option to a value greater than 1 when adding a job. You can optionally specify a backoff strategy to control the delay between retries:

```python
from bullmq import Queue

queue = Queue("myQueue", {"connection": "redis://localhost:6379"})

await queue.add("my-job", {"key": "value"}, {
    "attempts": 3,
    "backoff": {"type": "exponential", "delay": 1000},
})
```

If no backoff strategy is specified, the job is retried immediately after each failure.

### Built-in Backoff Strategies

BullMQ includes two built-in backoff strategies: **fixed** and **exponential**.

#### Fixed

With a fixed backoff, the job is retried after a constant `delay` (in milliseconds) on every attempt:

```python
await queue.add("my-job", {"key": "value"}, {
    "attempts": 3,
    "backoff": {"type": "fixed", "delay": 1000},
})
```

#### Exponential

With exponential backoff, the delay increases with each attempt following the formula `2^(attempts - 1) * delay`. For example, with a delay of 1000ms, retries occur after 1s, 2s, 4s, 8s, and so on:

```python
await queue.add("my-job", {"key": "value"}, {
    "attempts": 5,
    "backoff": {"type": "exponential", "delay": 1000},
})
```

## Stalled Job Requeue

When a worker crashes or becomes unresponsive, its active jobs will eventually have their locks expire. The stalled-jobs check (configured on the worker) detects these jobs and moves them back to the waiting state.

A job can be requeued due to stalling up to `maxStalledCount` times. After that, it is permanently moved to `failed`.

```python
from bullmq import Worker

worker = Worker("myQueue", process, {
    "lockDuration": 30000,
    "stalledInterval": 30000,
    "maxStalledCount": 2,
})
```

See [Workers - Stalled Jobs](workers.md#stalled-jobs) for more details.

## Manual Retry

You can manually retry a single failed (or completed) job using the `Job.retry()` method. This moves the job back to the waiting state:

```python
await job.retry("failed")
```

To also reset the attempt counter:

```python
await job.retry("failed", {"resetAttemptsMade": True})
```

## Bulk Retry

To retry multiple failed jobs at once, use `Queue.retryJobs()`. This is a cursor-based operation that processes jobs in batches:

```python
await queue.retryJobs({"state": "failed", "count": 100})
```

| Option | Description |
|---|---|
| `state` | The job state to retry from (`"failed"` or `"completed"`). |
| `count` | Number of jobs to retry per iteration. |
| `timestamp` | Only retry jobs that failed before this timestamp. |
