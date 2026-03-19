# Connections

Every BullMQ class requires a connection to a Redis instance. BullMQ Python uses [redis-py](https://github.com/redis/redis-py) (`redis.asyncio`) under the hood. If you do not provide any connection options, it will default to `localhost` on port `6379`.

Each `Queue`, `Worker`, and `FlowProducer` instance creates its own `RedisConnection` wrapper internally. There is no built-in connection pool or sharing mechanism between instances by default.

## Connection Options

You can configure the connection in several ways:

### Using a connection string

```python
from bullmq import Queue

queue = Queue("myQueue", {"connection": "redis://localhost:6379"})
```

### Using an options dict

```python
from bullmq import Queue

queue = Queue("myQueue", {
    "connection": {
        "host": "localhost",
        "port": 6379,
        "db": 0,
        "password": "my-password",
    }
})
```

### Default connection

If no connection option is provided, BullMQ connects to `localhost:6379`:

```python
from bullmq import Queue

queue = Queue("myQueue")
```

## Reusing Connections

By default, each `Queue` instance creates a new Redis client. If you need to share a single Redis connection across multiple instances, you can pass an existing `redis.asyncio.Redis` object:

```python
import redis.asyncio as redis
from bullmq import Queue

shared_client = redis.Redis(host="localhost", port=6379, decode_responses=True)

q1 = Queue("queue1", {"connection": shared_client})
q2 = Queue("queue2", {"connection": shared_client})
```

The same approach works for `Worker` and `FlowProducer` — any class that accepts a `connection` option can receive an existing `redis.asyncio.Redis` instance.

{% hint style="info" %}
Each instance still creates its own internal `RedisConnection` wrapper and registers Lua scripts on the shared client. The underlying Redis client itself is shared, but the wrapper objects are not.
{% endhint %}

{% hint style="danger" %}
Make sure that your Redis instance has the setting

`maxmemory-policy=noeviction`

in order to avoid automatic removal of keys which would cause unexpected errors in BullMQ.
{% endhint %}

{% hint style="warning" %}
If Redis responses are in binary format, you should pass the `decode_responses=True` option when creating the Redis client. See the [redis-py documentation](https://redis-py.readthedocs.io/en/latest/examples/connection_examples.html) for details.
{% endhint %}
