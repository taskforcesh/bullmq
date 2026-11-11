---
description: BullMQ is available as a native Python package, running on Redis™ or PostgreSQL.
---

# Introduction

### Installation

BullMQ is delivered as a pip package and can thus be installed using pip:

```
$ pip install bullmq
```

BullMQ for Python requires Python 3.10 or newer, and Redis 6.2 or newer (or a compatible server such as Valkey or Dragonfly), or PostgreSQL 13 or newer when using the [PostgreSQL backend](#postgresql-backend).

Queues created with the Python package are fully interoperable with the other BullMQ SDKs (Node.js, Elixir, .NET, Rust and PHP), so you can, for example, add jobs from a Node.js service and process them with Python workers.

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

{% hint style="info" %}
Connections that BullMQ creates from the `connection` option identify themselves to the server through redis-py's client identification (`CLIENT SETINFO`), so they appear as `redis-py(bullmq_v<version>)` in `CLIENT LIST`. A client instance you pass in is left untouched, and a `lib_name` or `driver_info` you set in the connection options takes precedence.
{% endhint %}

## Redis Cluster

Pass a `redis.asyncio.cluster.RedisCluster` client as the `connection`, and put a hash tag in the prefix so every key of a queue lands in one slot (see [Redis Cluster](../patterns/redis-cluster.md)):

```python
from bullmq import Queue, Worker
from redis.asyncio.cluster import RedisCluster

connection = RedisCluster(host="<host>", port=6379, decode_responses=True)
queue = Queue("myQueue", {"connection": connection, "prefix": "{myprefix}"})
worker = Worker("myQueue", process, {"connection": connection, "prefix": "{myprefix}"})
```

## PostgreSQL backend

The `Queue`, `Worker` and `FlowProducer` APIs can run on PostgreSQL instead of Redis. Python `QueueEvents` remains Redis-only and cannot consume PostgreSQL events. Install the package with the `postgres` extra, which adds the [psycopg](https://www.psycopg.org) driver:

```
$ pip install "bullmq[postgres]"
```

Then set `backend` to `"postgres"` and pass a PostgreSQL connection string (or a dict with `host`, `port`, `dbname`, `user` and `password`) as the `connection`:

```python
from bullmq import Queue, Worker

opts = {
    "backend": "postgres",
    "connection": "postgresql://postgres:postgres@localhost:5432/mydb",
    # "schema": "bullmq",  # optional, this is the default
}

queue = Queue("myQueue", opts)
await queue.add("myJob", {"foo": "bar"})

worker = Worker("myQueue", process, opts)
```

All BullMQ objects live in a dedicated schema (`bullmq` by default), and the required tables and functions are migrated automatically on first use. Note that the `prefix` option is not supported on PostgreSQL, use `schema` to namespace your queues instead. Read more about this backend in the [PostgreSQL backend](../guide/postgresql.md) section of the guide.
