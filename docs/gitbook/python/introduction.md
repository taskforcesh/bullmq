---
description: BullMQ is also available as a Python package.
---

# Introduction

BullMQ for Python provides the same core functionality as the Node.js version — backed by the same Redis structures and Lua scripts — making it fully interoperable. A Python worker can process jobs added by a Node.js producer and vice versa.

### Installation

BullMQ is delivered as a pip package and can thus be installed using pip:

```
pip install bullmq
```

### Get Started

BullMQ uses [asyncio](https://docs.python.org/3/library/asyncio.html) in order to implement concurrency and provide efficient processing of jobs. All public methods are async and must be called within an async context.

You can add jobs to a queue like this, assuming you have a Redis host running locally:

```python
from bullmq import Queue

queue = Queue("myQueue")

# Add a job with data {"foo": "bar"} to the queue
await queue.add("myJob", {"foo": "bar"})

# Close when done adding jobs
await queue.close()
```

See [Queues](queues.md) for the full list of job options and bulk operations.

In order to consume the jobs from the queue you need to use the `Worker` class, providing a "processor" function that will consume the jobs. As soon as the worker is instantiated it will start consuming jobs:

```python
from bullmq import Worker
import asyncio
import signal

async def process(job, token):
    # job.data contains the payload added to the queue
    # job.name contains the job name
    # job.id contains the job ID
    return await do_something(job)

async def main():
    shutdown_event = asyncio.Event()

    loop = asyncio.get_running_loop()
    loop.add_signal_handler(signal.SIGTERM, shutdown_event.set)
    loop.add_signal_handler(signal.SIGINT, shutdown_event.set)

    # Feel free to remove the connection parameter if your Redis runs on localhost
    worker = Worker("myQueue", process, {
        "connection": "rediss://<user>:<password>@<host>:<port>",
    })

    # Wait until a shutdown signal is received
    await shutdown_event.wait()

    # Gracefully close the worker (waits for active jobs to finish)
    await worker.close()

if __name__ == "__main__":
    asyncio.run(main())
```

See [Workers](workers.md) for details on concurrency, events, stalled jobs, and graceful shutdown.

{% hint style="warning" %}
If Redis responses are in binary format, you should pass the [`decode_responses`](https://redis-py.readthedocs.io/en/latest/examples/connection_examples.html) option as `True`. See [Connections](connections.md) for more details.
{% endhint %}
