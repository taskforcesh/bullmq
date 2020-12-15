# Connections

In order to start working with a Queue, a connection to a Redis instance is necessary. BullMQ uses the node module [ioredis](https://github.com/luin/ioredis), and the options you pass to BullMQ are just passed to the constructor of ioredis. If you do not provide any options, it will default to port 6379 and localhost.

Every class will consume at least one Redis connection, but it is also possible to reuse connections in some situations. For example, the _Queue_ and _Worker_ classes can accept an existing ioredis instance, and by that reusing that connection, however _QueueScheduler_ and _QueueEvents_ cannot do that because they require blocking connections to Redis, which makes it impossible to reuse them.

Some examples:

```typescript
import { Queue, Worker } from 'bullmq'

// Create a new connection in every instance
const myQueue = new Queue('myqueue', { connection: {
  host: "myredis.taskforce.run",
  port: 32856
}});

const myWorker = new Worker('myworker', async (job)=>{}, { connection: {
  host: "myredis.taskforce.run",
  port: 32856
}});
```

```typescript
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis();

// Reuse the ioredis instance
const myQueue = new Queue('myqueue', { connection });
const myWorker = new Worker('myworker', async (job)=>{}, { connection });
```

Note that in the second example, even though the ioredis instance is being reused, the worker will create a duplicated connection that it needs internally to make blocking connections. Please read on the [ioredis](https://github.com/luin/ioredis/blob/master/API.md) documentation on how to properly create an instance of `IORedis.`

If you can afford many connections, by all means just use them. Redis connections have quite low overhead, so you should not need to care about reusing connections unless your service provider is imposing you hard limitations.

