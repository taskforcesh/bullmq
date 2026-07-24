---
description: Subscribe to a queue's lifecycle events via the Redis stream.
---

# Queue Events

`QueueEvents` consumes the Redis stream that the queue and its workers write to (`<prefix>:<queue>:events`) and re-emits each entry through a standard `EventEmitter`. This is the recommended way to observe a queue from outside its workers — listeners see every job that flows through the queue, not just the ones a particular `Worker` happened to process.

The class mirrors the [Node `QueueEvents`](https://api.docs.bullmq.io/classes/v5.QueueEvents.html) surface and is backed by [Redis Streams](https://redis.io/topics/streams-intro), so it carries the same guarantees: events are not lost across disconnects, and a slow consumer can replay from a known id.

{% hint style="info" %}
`QueueEvents` requires Redis ≥ 5.0 (the version that introduced Streams). Pass `skipVersionCheck=True` if you have already validated your server elsewhere and want to skip the `INFO` round-trip on construction.
{% endhint %}

### Basic usage

```python
import asyncio
from bullmq import Queue, Worker, QueueEvents


async def main():
    queue = Queue("Paint")
    events = QueueEvents("Paint")

    def on_completed(args, event_id):
        # args["returnvalue"] is JSON-decoded back to a native Python value.
        print(f"job {args['jobId']} -> {args['returnvalue']}")

    def on_failed(args, event_id):
        print(f"job {args['jobId']} failed: {args.get('failedReason')}")

    events.on("completed", on_completed)
    events.on("failed", on_failed)

    async def processor(job, token):
        return job.data["a"] + job.data["b"]

    worker = Worker("Paint", processor)
    await queue.add("sum", {"a": 1, "b": 2})

    await asyncio.sleep(1)
    await worker.close()
    await events.close()
    await queue.close()


asyncio.run(main())
```

Every listener receives two positional arguments:

| Argument   | Description                                                           |
| ---------- | --------------------------------------------------------------------- |
| `args`     | The dict payload of the event (e.g. `{"jobId": "1", "name": "sum"}`). |
| `event_id` | The stream entry id assigned by Redis. Useful as a resume cursor.     |

The `drained` event is emitted with the entry id only (`(event_id,)`), matching the Node listener contract: it carries no job-scoped payload.

### Per-job event channel

In addition to the generic channel (e.g. `"completed"`), every event is also re-emitted on a per-job channel `"<event>:<jobId>"`. This is the primitive that powers `waitUntilFinished` in the Node API and lets callers wait on a specific job without filtering inside their listener:

```python
events.on(f"completed:{job.id}", lambda args, event_id: print(args["returnvalue"]))
events.on(f"failed:{job.id}",    lambda args, event_id: print(args["failedReason"]))
```

### JSON-decoded fields

Two fields are JSON-encoded by the Lua scripts that publish the events, so arbitrary payloads can survive the stream. `QueueEvents` decodes them before dispatching to listeners so the listener-side contract matches the Node API:

| Event       | Decoded field         |
| ----------- | --------------------- |
| `progress`  | `args["data"]`        |
| `completed` | `args["returnvalue"]` |

If a payload cannot be decoded (i.e. it was not valid JSON), the raw string is left in place rather than failing the consumer.

### Options

`QueueEvents(name, opts=None)` accepts the following keys in `opts`:

| Option             | Default  | Description                                                                                                                                       |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection`       | `{}`     | Redis connection — a URL string, an options dict, or an existing `redis.asyncio.Redis` instance.                                                  |
| `prefix`           | `"bull"` | Redis key prefix. Must match the prefix used by the `Queue`.                                                                                      |
| `lastEventId`      | `"$"`    | Stream cursor for the first `XREAD`. `"$"` skips events published before the consumer attached; `"0"` replays from the beginning.                 |
| `blockingTimeout`  | `10000`  | Blocking timeout for `XREAD BLOCK`, in milliseconds. The consumer wakes on every interval to re-check `closing`.                                  |
| `autorun`          | `True`   | If `True`, the consumer task is spawned on construction. Set `False` to attach listeners deterministically before consumption starts (see below). |
| `skipVersionCheck` | `False`  | Skip the Redis version check on the underlying connection.                                                                                        |

`QueueEvents` owns a dedicated Redis connection because the underlying `XREAD BLOCK` ties up the socket for the duration of the call; reusing it for other commands would deadlock.

### Deterministic startup with `autorun=False`

Constructing `QueueEvents` with `autorun=False` defers consumption until the caller invokes `run()`. Combined with `lastEventId="0"`, this is the recommended pattern for tests and integration code that needs to be sure no event is missed between construction and listener attachment:

```python
events = QueueEvents("Paint", {"lastEventId": "0", "autorun": False})

# Attach listeners first…
events.on("completed", on_completed)

# …then start consuming.
asyncio.ensure_future(events.run())
```

### Publishing custom events

`QueueEventsProducer` writes application-level events to the same stream so subscribers see them through the same `QueueEvents` listener wiring as the framework-emitted lifecycle events:

```python
from bullmq import QueueEventsProducer

producer = QueueEventsProducer("Paint")
await producer.publishEvent({
    "eventName": "deployment",
    "app": "api",
    "version": "1.2.3",
})
await producer.close()
```

A subscriber listening with `events.on("deployment", on_deployment)` will receive the payload with `eventName` stripped (it became the channel name):

```python
def on_deployment(args, event_id):
    # args == {"app": "api", "version": "1.2.3"}
    ...
```

`publishEvent(args, maxEvents=1000)` writes with `XADD MAXLEN ~`, so the stream is approximately capped at `maxEvents` entries. Unlike `QueueEvents`, the producer reuses a shared (non-dedicated) connection because `XADD` is non-blocking.

### Closing

Call `await events.close()` to stop the consumer task and release the dedicated connection. The method is idempotent — subsequent calls are no-ops — and tolerates being invoked from inside a listener (the consumer flag short-circuits the next iteration instead of trying to cancel the current task).

```python
await events.close()
await events.close()  # safe no-op
```

## Read more

- 💡 [QueueEvents source](https://github.com/taskforcesh/bullmq/blob/master/python/bullmq/queue_events.py)
- 💡 [QueueEventsProducer source](https://github.com/taskforcesh/bullmq/blob/master/python/bullmq/queue_events_producer.py)
- 💡 [Node QueueEvents API Reference](https://api.docs.bullmq.io/classes/v5.QueueEvents.html)
