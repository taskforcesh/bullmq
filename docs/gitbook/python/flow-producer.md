---
description: Atomically enqueue trees of parent and child jobs.
---

# Flow Producer

`FlowProducer` lets you enqueue a tree of jobs (a parent with any number of children, recursively) atomically. The entire flow is committed inside a single Redis `MULTI/EXEC`, so consumers never observe a partially-constructed flow: either every node lands or none do.

The Python port mirrors the Node `FlowProducer` semantics, with these guarantees made explicit:

- The root job's outcome is checked after `EXEC`. If the underlying Lua script returns a negative numeric code (for example, the supplied `parent` does not exist — see [GH #3264](https://github.com/taskforcesh/bullmq/issues/3264)), the call raises rather than silently returning a tree whose root never landed.
- If the script returns a string id (the deduplication path), it is reconciled onto `jobs_tree["job"].id` so callers always see the id that was actually persisted.
- `add()` is strict (it raises on root errors). `addBulk()` matches Node's lenient bulk semantics — per-root errors are not raised; only deduplicated ids are propagated.

### Basic usage

```python
from bullmq import FlowProducer

flow = FlowProducer()

tree = await flow.add({
    "name": "render-report",
    "queueName": "reports",
    "data": {"id": 42},
    "children": [
        {
            "name": "fetch-data",
            "queueName": "fetchers",
            "data": {"source": "users"},
        },
        {
            "name": "fetch-data",
            "queueName": "fetchers",
            "data": {"source": "orders"},
        },
    ],
})

await flow.close()
```

The returned `JobNode`-shaped dict mirrors Node:

```python
{
    "job": <Job 'render-report'>,
    "children": [
        {"job": <Job 'fetch-data'>},
        {"job": <Job 'fetch-data'>},
    ],
}
```

Each `Job.id` reflects the id that Redis actually assigned (deduplicated ids included).

### Per-queue defaults

You can pass per-queue default job options through the second argument to `add()`:

```python
tree = await flow.add(
    flow_spec,
    {
        "queuesOptions": {
            "reports":  {"defaultJobOptions": {"attempts": 3}},
            "fetchers": {"defaultJobOptions": {"attempts": 5, "backoff": {"type": "fixed", "delay": 1000}}},
        },
    },
)
```

Defaults are merged per node and never mutated, so the same `queuesOptions` dict can be reused across calls without leaking node-level keys (`parent`, `jobId`, ...) between invocations.

### Bulk

`addBulk(flows)` enqueues multiple roots in a single `MULTI/EXEC`. Per-flow errors are intentionally non-fatal — if you need strict error propagation, call `add()` for each flow:

```python
trees = await flow.addBulk([flow_a, flow_b, flow_c])
```

The returned list aligns positionally with the input list.

### Closing

```python
await flow.close()
```

Releases the underlying Redis connection. After `close()` further `add` / `addBulk` calls return `None` rather than raising, matching the Node API's "best-effort shutdown" contract.

## Read more

- 💡 [FlowProducer source](https://github.com/taskforcesh/bullmq/blob/master/python/bullmq/flow_producer.py)
- 💡 [Node Flow Producer guide](../guide/flows/)
