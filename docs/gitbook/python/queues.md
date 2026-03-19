# Queues

A Queue is the fundamental structure in BullMQ used to store and manage jobs. Queues are backed by Redis and can be shared across multiple producers and consumers.

## Adding Jobs

Use `queue.add()` to add a job to the queue. The method accepts a job name, a data payload, and an optional options dictionary:

```python
from bullmq import Queue

queue = Queue("myQueue", {"connection": "redis://localhost:6379"})

job = await queue.add("my-job", {"key": "value"})
print(f"Job added with id: {job.id}")

await queue.close()
```

### Job Options

You can pass a variety of options when adding a job:

```python
job = await queue.add("my-job", {"key": "value"}, {
    "attempts": 3,
    "backoff": {"type": "exponential", "delay": 1000},
    "delay": 5000,
    "removeOnComplete": True,
    "removeOnFail": False,
})
```

| Option | Description |
|---|---|
| `attempts` | Number of times to retry the job if it fails. |
| `backoff` | Backoff strategy for retries. See [Retrying Failing Jobs](retrying-failing-jobs.md). |
| `delay` | Delay in milliseconds before the job becomes available for processing. |
| `jobId` | Custom job ID. Must be unique within the queue. |
| `priority` | Job priority. Lower values are processed first. |
| `removeOnComplete` | If `True`, removes the job from Redis upon successful completion. Can also be a number specifying how many completed jobs to keep. |
| `removeOnFail` | If `True`, removes the job from Redis upon failure. Can also be a number specifying how many failed jobs to keep. |
| `deduplication` | Deduplication options to prevent duplicate jobs. |
| `failParentOnFailure` | If `True`, the parent job will fail when this child job fails. Used with [Flows](https://docs.bullmq.io/guide/flows). |
| `ignoreDependencyOnFailure` | If `True`, parent processing continues even if this child fails. |

## Adding Jobs in Bulk

For better performance when adding multiple jobs, use `queue.addBulk()` which runs all additions in a single Redis pipeline:

```python
jobs = await queue.addBulk([
    {"name": "job-1", "data": {"key": "value1"}},
    {"name": "job-2", "data": {"key": "value2"}},
    {"name": "job-3", "data": {"key": "value3"}, "opts": {"priority": 1}},
])
```

## Queue Prefix

By default, all Redis keys are prefixed with `bull`. You can customise this with the `prefix` option:

```python
queue = Queue("myQueue", {"prefix": "myapp"})
```

This results in Redis keys like `myapp:myQueue:wait`, `myapp:myQueue:active`, etc.
