# AWS MemoryDB

AWS provides a Redis™ 7 compatible managed database that is easy to use and is fully compatible with BullMQ.

There are some considerations to take care when using MemoryDB though.

- MemoryDB only works in Cluster mode. So you need to use "hash tags" so that the queues get attached to a given cluster node ([read more here](../../bull/patterns/redis-cluster.md)).
- MemoryDB can only be accessed within an AWS VPC, so you cannot access the Redis™ cluster outside of AWS.

The easiest way to use MemoryDB with BullMQ is to first instantiate a IORedis Cluster instance, and then use that connection as an option to your workers or queue instances, for example:

```typescript
import { Cluster } from '@sinianluoye/ioredis';
import { Worker } from 'bullmq';

const connection = new Cluster(
  [
    {
      host: 'clustercfg.xxx.amazonaws.com',
      port: 6379,
    },
  ],
  {
    tls: {},
  },
);

const worker = new Worker(
  'myqueue',
  async (job: Job) => {
    // Do some usefull stuff
  },
  { connection },
);

// ...

// Do not forget to close the connection as well as the worker when shutting down
await worker.close();
await connection.quit();
```
