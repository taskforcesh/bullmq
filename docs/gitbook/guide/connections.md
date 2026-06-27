# Connections

In order to start working with a Queue, a connection to a Redis instance is necessary. By default, BullMQ creates connections with [ioredis](https://github.com/luin/ioredis), and the options you pass to BullMQ are passed to the ioredis constructor. If you do not provide any options, it will default to port 6379 and localhost.

BullMQ can also use other Redis clients through its Redis client adapter interface. The package includes adapters for ioredis, node-redis, and Bun's built-in Redis client. You can also provide your own adapter by implementing the `IRedisClient` interface.

Every class will consume at least one Redis connection, but it is also possible to reuse connections in some situations. For example, the _Queue_ and _Worker_ classes can accept an existing adapted Redis client. Classes that need blocking Redis commands, such as _Worker_ and _QueueEvents_, will create duplicated connections internally, so the client or adapter must support `duplicate()`.

Some examples:

```typescript
import { Queue, Worker } from 'bullmq';

// Create a new connection in every instance
const myQueue = new Queue('myqueue', {
  connection: {
    host: 'myredis.taskforce.run',
    port: 32856,
  },
});

const myWorker = new Worker('myqueue', async job => {}, {
  connection: {
    host: 'myredis.taskforce.run',
    port: 32856,
  },
});
```

### Reusing an ioredis connection

```typescript
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis();

// Reuse the ioredis instance in 2 different producers
const myFirstQueue = new Queue('myFirstQueue', { connection });
const mySecondQueue = new Queue('mySecondQueue', { connection });
```

```typescript
import { Worker } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis({ maxRetriesPerRequest: null });

// Reuse the ioredis instance in 2 different consumers
const myFirstWorker = new Worker('myFirstWorker', async job => {}, {
  connection,
});
const mySecondWorker = new Worker('mySecondWorker', async job => {}, {
  connection,
});
```

Note that in the third example, even though the ioredis instance is being reused, the worker will create a duplicated connection that it needs internally to make blocking connections. Consult the [ioredis](https://github.com/luin/ioredis/blob/master/API.md) documentation to learn how to properly create an instance of `IORedis`.

{% hint style="info" %}
For backwards compatibility, BullMQ continues to accept a raw `IORedis` instance via the `connection` option even though internally it now relies on the `IRedisClient` adapter interface. To bridge the two, the instance is wrapped in a transparent proxy that exposes `IRedisClient`: it adds `runCommand` for Lua script dispatch and structured-options forms of `hset`, `set`, `zrange`, `zrevrange`, `xadd`, `xread`, `xtrim`, and `scan` (the native ioredis varargs forms keep working). `pipeline()` and `multi()` return augmented transactions, and `duplicate()` returns another wrapped proxy rather than the raw duplicated client. Every other property — events, options, ioredis-specific methods — is forwarded straight to your underlying instance, which is never mutated.
{% endhint %}

### Using node-redis

BullMQ does not create node-redis clients directly. Create the raw client in your application and wrap it with `createNodeRedisClient` before passing it to BullMQ.

{% hint style="info" %}
When using BullMQ's node-redis adapter, install `redis` v5 or newer. BullMQ declares `redis >= 5.0.0` as a peer dependency for this adapter.
{% endhint %}

```typescript
import { Queue, Worker, createNodeRedisClient } from 'bullmq';
import { createClient } from 'redis';

const rawClient = createClient({
  url: 'redis://localhost:6379',
});

const connection = createNodeRedisClient(rawClient);

const myQueue = new Queue('myqueue', { connection });
const myWorker = new Worker('myqueue', async job => {}, { connection });
```

### Using Bun's Redis client

Bun has a built-in Redis client. Wrap it with `createBunRedisClient` before passing it to BullMQ.

```typescript
import { RedisClient } from 'bun';
import { Queue, Worker, createBunRedisClient } from 'bullmq';

const rawClient = new RedisClient('redis://localhost:6379');
const connection = createBunRedisClient(rawClient);

const myQueue = new Queue('myqueue', { connection });
const myWorker = new Worker('myqueue', async job => {}, { connection });
```

BullMQ does not instantiate Bun's client for you. Create the raw Bun client in your application and wrap it with `createBunRedisClient`.

{% hint style="info" %}
The `RedisClient` class is provided by Bun runtime. Run this code in Bun (`bun run ...`), not plain Node.js.
{% endhint %}

### Creating clients globally

If you want BullMQ to create a non-ioredis client whenever it needs a new Redis connection, set `RedisConnection.clientFactory` during application startup. The factory receives the merged connection options and must return an `IRedisClient`.

```typescript
import { Queue, RedisConnection, createNodeRedisClient } from 'bullmq';
import { createClient } from 'redis';

RedisConnection.clientFactory = opts => {
  const rawClient = createClient({
    socket: {
      host: opts.host,
      port: opts.port,
    },
    username: opts.username,
    password: opts.password,
    database: opts.db,
  });

  return createNodeRedisClient(rawClient);
};

const myQueue = new Queue('myqueue', {
  connection: {
    host: 'myredis.taskforce.run',
    port: 32856,
  },
});
```

You can do the same with Bun's Redis client:

```typescript
import { RedisClient } from 'bun';
import { Queue, RedisConnection, createBunRedisClient } from 'bullmq';

RedisConnection.clientFactory = opts => {
  const host = opts?.host ?? 'localhost';
  const port = opts?.port ?? 6379;
  const rawClient = new RedisClient(`redis://${host}:${port}`);

  return createBunRedisClient(rawClient);
};

const myQueue = new Queue('myqueue', {
  connection: {
    host: 'myredis.taskforce.run',
    port: 32856,
  },
});
```

### Custom Redis clients

Any Redis client can be used if it is adapted to BullMQ's `IRedisClient` interface. The adapter is responsible for exposing the Redis commands BullMQ uses, connection lifecycle methods, events, `duplicate()`, Lua script registration through `defineCommand()`, and pipelines or transactions through `multi()` and `pipeline()`.

For most applications, prefer one of the built-in adapters:

- `createIORedisClient` for ioredis `Redis` and `Cluster` instances.
- `createNodeRedisClient` for node-redis clients.
- `createBunRedisClient` for Bun's built-in Redis client.

#### `maxRetriesPerRequest`

This setting tells the ioredis client how many times to try a command that fails before throwing an error. So even though Redis is not reachable or offline, the command will be retried until this situation changes or the maximum number of attempts is reached.

This guarantees that the workers will keep processing forever as long as there is a working connection. If you create an ioredis client manually, BullMQ will throw an exception if this setting is not set to null when it is passed into worker instances. When using another Redis client through an adapter, configure that client's retry and reconnect behavior according to its own documentation so that worker connections can keep retrying.

### The queue backend

While the `IRedisClient` adapter described above abstracts the low-level _driver_ (ioredis, node-redis, Bun), the high-level classes (`Queue`, `Worker`, `FlowProducer`, `QueueEvents`, …) sit one level higher: they are **datastore-agnostic** and talk to a _backend_ that implements the [`IQueueBackend`](https://api.docs.bullmq.io) contract. The backend owns the connection(s) and implements every queue operation ("add job", "move to active", "extend lock", the blocking "wait for next job", …).

The default backend is the Redis one (`RedisQueueBackend`), so you normally never interact with this layer directly — you just pass a `connection` as shown throughout this page and BullMQ wires up the Redis backend for you.

#### Accessing the underlying Redis client

The high-level classes no longer expose a `client` getter. When you need the raw Redis client — for example to run a custom command, or to inspect the connection in tests — reach it through `getBackend()`:

```typescript
import { Queue, RedisClient } from 'bullmq';

const queue = new Queue('myqueue', {
  connection: { host: 'localhost', port: 6379 },
});

// getBackend() returns the concrete Redis backend by default, so the
// Redis-specific escape hatches are available without casting.
const client: RedisClient = await queue.getBackend().client;

await client.set('some-key', 'some-value');
```

The Redis backend also exposes other Redis-specific details, such as `redisVersion`, `databaseType` and the underlying `connection`. For a `Worker`, `getBackend().blockingClient` returns the dedicated blocking connection's client used by the blocking _wait-for-job_ primitive.

{% hint style="warning" %}
These are escape hatches into the Redis adapter. Prefer the high-level `Queue`/`Worker`/`FlowProducer` API whenever possible — anything you reach through `getBackend()` is specific to the Redis backend and is not part of the datastore-agnostic contract.
{% endhint %}

#### Providing a custom backend

All high-level classes depend only on the `IQueueBackend` interface and receive a **backend factory** that builds it. By default this factory is `createRedisBackend`, but you can inject your own as the last constructor argument to back BullMQ with a different datastore or with a mock in tests:

```typescript
import { Queue, BackendFactory } from 'bullmq';

const myBackendFactory: BackendFactory = (name, opts, options) => {
  // return an object implementing IQueueBackend
};

const queue = new Queue('myqueue', { connection: {} }, myBackendFactory);
```

The classes are generic over the backend type, so `getBackend()` returns the concrete type produced by whatever factory you provide (the default being `RedisQueueBackend`). A non-Redis user would, for example, write `new Queue<MyData, MyResult, string, MyBackend>(name, opts, createMyBackend)`.

### Queue

Also note that simple Queue instance used for managing the queue such as adding jobs, pausing, using getters, etc. usually has different requirements from the worker.

For example, say that you are adding jobs to a queue as the result of a call to an HTTP endpoint - producer service. The caller of this endpoint cannot wait forever if the connection to Redis happens to be down when this call is made. Therefore the `maxRetriesPerRequest` setting should either be left at its default (which currently is 20) or set it to another value, maybe 1 so that the user gets an error quickly and can retry later.

On the other hand, if you are adding jobs inside a Worker processor, this process is expected to happen in the background - consumer service. In this case you can share the same connection.

For more details, refer to the [persistent connections](https://docs.bullmq.io/bull/patterns/persistent-connections) page.

{% hint style="danger" %}
When using ioredis connections, be careful not to use the "keyPrefix" option in [ioredis](https://redis.github.io/ioredis/interfaces/CommonRedisOptions.html#keyPrefix) as this option is not compatible with BullMQ, which provides its own key prefixing mechanism by using [prefix](https://api.docs.bullmq.io/interfaces/v5.QueueOptions.html#prefix) option.
{% endhint %}

If you can afford many connections, by all means just use them. Redis connections have quite low overhead, so you should not need to care about reusing connections unless your service provider imposes hard limitations.

{% hint style="danger" %}
Make sure that your redis instance has the setting

`maxmemory-policy=noeviction`

in order to avoid automatic removal of keys which would cause unexpected errors in BullMQ
{% endhint %}
