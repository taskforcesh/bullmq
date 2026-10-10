---
description: BullMQ is now also available as an experimental python package.
---

# Introduction

### Installation

BullMQ is delivered as a pip package and can thus be installed using pip:

```
$ pip install bullmq
```

### Get started

BullMQ uses [asyncio](https://docs.python.org/3/library/asyncio.html) in order to implement concurrency and provide efficient processing of jobs.

You can add jobs to a queue like this, assuming you have a Redis host running locally:

```python
from bullmq import Queue

queue = Queue("myQueue")

# Add a job with data { "foo": "bar" } to the queue
await queue.add("myJob", { "foo": "bar" })

...

# Close when done adding jobs
await queue.close()

```

In order to consume the jobs from the queue you need to use the `Worker` class, providing a "processor" function that will consume the jobs. As soon as the worker is instantiated it will start consuming jobs:

```python
from bullmq import Worker
import asyncio
import signal

async def process(job, job_token):
    # job.data will include the data added to the queue
    return doSomethingAsync(job)

async def main():

    # Create an event that will be triggered for shutdown
    shutdown_event = asyncio.Event()

    def signal_handler(signal, frame):
        print("Signal received, shutting down.")
        shutdown_event.set()

    # Assign signal handlers to SIGTERM and SIGINT
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    # Feel free to remove the connection parameter, if your redis runs on localhost
    worker = Worker("myQueue", process, {"connection": "rediss://<user>:<password>@<host>:<port>"})

    # Wait until the shutdown event is set
    await shutdown_event.wait()

    # close the worker
    print("Cleaning up worker...")
    await worker.close()
    print("Worker shut down successfully.")

if __name__ == "__main__":
    asyncio.run(main())
```

{% hint style="warning" %}
If Redis responses are in binary format, you should pass [decode_responses](https://redis.readthedocs.io/en/latest/examples/connection_examples.html#By-default-Redis-return-binary-responses,-to-decode-them-use-decode_responses=True) option as _True_.
{% endhint %}

## Redis Cluster

Pass a `redis.asyncio.cluster.RedisCluster` client as the `connection`, and put a hash tag in the prefix so every key of a queue lands in one slot (see [Redis Cluster](../patterns/redis-cluster.md)):

```python
from redis.asyncio.cluster import RedisCluster

connection = RedisCluster(host="<host>", port=6379, decode_responses=True)
queue = Queue("myQueue", {"connection": connection, "prefix": "{myprefix}"})
worker = Worker("myQueue", process, {"connection": connection, "prefix": "{myprefix}"})
```
