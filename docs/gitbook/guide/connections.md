# Connections

In order to start working with a Queue, a connection to a Redis instance is necessary. BullMQ uses the node module [ioredis](https://github.com/luin/ioredis), and the options you pass to BullMQ are just passed to the constructor of ioredis. If you do not provide any options, it will default to port 6379 and localhost.

Every class will consume at least one Redis connection, but it is also possible to reuse connections in some situations. For example, the _Queue_ and _Worker_ classes can accept an existing ioredis instance, and by that reusing that connection, however _QueueScheduler_ and _QueueEvents_ cannot do that because they require blocking connections to Redis, which makes it impossible to reuse them.

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

```typescript
import { Queue } from 'bullmq';
import IORedis from '@sinianluoye/ioredis';

const connection = new IORedis();

// Reuse the ioredis instance in 2 different producers
const myFirstQueue = new Queue('myFirstQueue', { connection });
const mySecondQueue = new Queue('mySecondQueue', { connection });
```

```typescript
import { Worker } from 'bullmq';
import IORedis from '@sinianluoye/ioredis';

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

#### `maxRetriesPerRequest`

This setting tells the ioredis client how many times to try a command that fails before throwing an error. So even though Redis is not reachable or offline, the command will be retried until this situation changes or the maximum number of attempts is reached.

This guarantees that the workers will keep processing forever as long as there is a working connection. If you create a Redis client manually, BullMQ will throw an exception if this setting is not set to null when it is passed into worker instances.

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
