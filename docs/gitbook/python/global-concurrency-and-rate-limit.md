---
description: Cap throughput across every worker attached to a queue.
---

# Global Concurrency and Rate Limit

Two settings on `Queue` cap throughput at the **queue level** — they apply across every worker attached to the queue, not per-worker. Both are stored in the queue's `meta` hash and read by the Lua scripts that hand jobs to workers, so the limit holds even when workers come and go.

| Setting            | Method                                      | Semantics                                                                |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------------ |
| Global concurrency | `setGlobalConcurrency(n)`                   | At most `n` jobs are `active` across all workers at any instant.         |
| Global rate limit  | `setGlobalRateLimit(max_jobs, duration_ms)` | At most `max_jobs` are dispatched within a rolling `duration_ms` window. |

Both settings persist in Redis. Workers see them the next time they fetch a job, so updates take effect without restarting workers.

### Global concurrency

```python
from bullmq import Queue

queue = Queue("orders")

await queue.setGlobalConcurrency(4)   # at most 4 jobs in flight queue-wide
current = await queue.getGlobalConcurrency()  # -> 4
await queue.removeGlobalConcurrency()  # remove the cap
```

`setGlobalConcurrency(1)` effectively serializes the queue.

| Method                      | Returns      | Description                                       |
| --------------------------- | ------------ | ------------------------------------------------- |
| `setGlobalConcurrency(n)`   | `int`        | Number of fields written (`HSET` reply).          |
| `getGlobalConcurrency()`    | `int`/`None` | Configured cap, or `None` if unset.               |
| `removeGlobalConcurrency()` | `int`        | Number of fields removed (`0` if no cap was set). |

### Global rate limit

```python
await queue.setGlobalRateLimit(max_jobs=10, duration_ms=1000)  # 10 jobs/sec
limit = await queue.getGlobalRateLimit()  # -> {"max": 10, "duration": 1000}
await queue.removeGlobalRateLimit()       # clear both fields
```

When the limit is exceeded, jobs become `delayed` for the remainder of the window. Once the window rolls forward, workers resume picking them up automatically.

| Method                                      | Returns       | Description                                             |
| ------------------------------------------- | ------------- | ------------------------------------------------------- |
| `setGlobalRateLimit(max_jobs, duration_ms)` | `int`         | Number of fields written (`HSET` reply, typically `2`). |
| `getGlobalRateLimit()`                      | `dict`/`None` | `{"max": ..., "duration": ...}`, or `None` if unset.    |
| `removeGlobalRateLimit()`                   | `int`         | Number of fields actually removed (`0`, `1`, or `2`).   |

### Combining the two

Concurrency and rate limit are independent — you can set both, and the more restrictive of the two binds. Setting global concurrency `= 4` with a rate limit of `10/sec` means: at most 4 concurrent jobs **and** no more than 10 starts per second.

## Read more

- 💡 [Queue source](https://github.com/taskforcesh/bullmq/blob/master/python/bullmq/queue.py)
- 💡 [Node global concurrency](../guide/workers/global-concurrency.md)
- 💡 [Node rate limit](../guide/rate-limiting.md)
