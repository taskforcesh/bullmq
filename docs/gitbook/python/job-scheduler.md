---
description: Schedule repeatable jobs by cron expression or fixed interval.
---

# Job Scheduler

`JobScheduler` registers a server-side record (`<prefix>:<queue>:repeat:<id>`) that owns a single in-flight delayed job representing its next iteration. When that job completes, the worker materializes the following one — so iteration math runs in Redis, not in Python, and exactly one delayed job exists per scheduler at a time.

Two scheduling strategies are supported:

| Strategy | Field     | Description                                                         |
| -------- | --------- | ------------------------------------------------------------------- |
| Interval | `every`   | Fires every `N` milliseconds. Iteration math lives entirely in Lua. |
| Cron     | `pattern` | Cron expression evaluated by `croniter`. Optional `tz` honoured.    |

### Basic usage

`JobScheduler` is composed onto a `Queue` and reuses its connection and Lua scripts — there is no separate connection to open or close.

```python
from bullmq import Queue, JobScheduler

queue = Queue("emails")
scheduler = JobScheduler(queue)

# Run every minute.
await scheduler.upsertJobScheduler(
    "daily-digest",
    {"pattern": "* * * * *"},
    "send-digest",
    {"audience": "all"},
)

# Or run every 2 seconds.
await scheduler.upsertJobScheduler(
    "ping",
    {"every": 2000},
    "ping-self",
    {"name": "heartbeat"},
)
```

`upsertJobScheduler` returns the `Job` representing the next iteration, or `None` if no iteration was produced (limit reached or end date passed). It validates the repeat options up front and raises `ValueError` on misconfiguration — `pattern` and `every` are mutually exclusive, and `immediately` cannot be combined with `startDate`. Invalid cron expressions/timezones are raised by the repeat strategy (for example `CroniterBadCronError`/`ZoneInfoNotFoundError`).

### Repeat options

`RepeatOptions` (see `python/bullmq/types/repeat_options.py`):

| Option        | Type                | Description                                                                |
| ------------- | ------------------- | -------------------------------------------------------------------------- |
| `pattern`     | `str`               | Cron expression. Mutually exclusive with `every`.                          |
| `every`       | `int`               | Interval in milliseconds. Mutually exclusive with `pattern`.               |
| `limit`       | `int`               | Maximum number of iterations to produce.                                   |
| `startDate`   | `int`/`str`/`float` | Epoch millis or ISO 8601 timestamp before which no iteration fires.        |
| `endDate`     | `int`/`str`/`float` | Epoch millis or ISO 8601 timestamp after which no further iteration fires. |
| `tz`          | `str`               | IANA timezone for `pattern` evaluation (e.g. `"Europe/Stockholm"`).        |
| `offset`      | `int`               | For `every`-based schedules, a millisecond offset applied to each slot.    |
| `immediately` | `bool`              | Fire a first iteration at `now` (only meaningful for `pattern`).           |

### Introspection

```python
# Test whether an id is a registered scheduler (vs a legacy repeatable-job id).
is_sched = await scheduler.isJobScheduler("daily-digest")

# Fetch one scheduler's JSON record.
record = await scheduler.getScheduler("daily-digest")
# {
#   "key": "daily-digest", "name": "send-digest",
#   "next": 1731_..., "pattern": "* * * * *",
#   "iterationCount": 1, "template": {"data": {...}, "opts": {...}}, ...
# }

# Page through all registered schedulers (next-fire-first by default).
records = await scheduler.getJobSchedulers(0, -1, asc=True)
count = await scheduler.getSchedulersCount()
```

`getJobSchedulers` fans out the per-scheduler `HGETALL` calls concurrently via `asyncio.gather`, so listing N schedulers stays one ZRANGE plus one parallel HGETALL batch — no N+1 sequential round-trip.

### Removing a scheduler

```python
await scheduler.removeJobScheduler("daily-digest")
```

Returns `0` on success, `1` if the id was not registered. This also cancels the in-flight delayed job for that scheduler if one exists.

### Custom repeat strategy

By default cron expressions are resolved with `croniter`. Pass a custom callable if you need a different evaluator:

```python
def next_quarter_hour(millis, opts):
    # Return next epoch-ms slot, or None to stop iterating.
    return ((millis // 900_000) + 1) * 900_000

scheduler = JobScheduler(queue, repeat_strategy=next_quarter_hour)
```

The callable receives the current iteration's reference millis and the `RepeatOptions` dict and must return the next iteration's absolute epoch millis (or `None`).

## Read more

- 💡 [JobScheduler source](https://github.com/taskforcesh/bullmq/blob/master/python/bullmq/job_scheduler.py)
- 💡 [Node Job Scheduler guide](../guide/job-schedulers/)
