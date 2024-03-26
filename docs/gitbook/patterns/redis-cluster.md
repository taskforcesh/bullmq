---
description: Important considerations when using Redis™ Cluster mode.
---

# Redis Cluster

Bull internals require atomic operations that span different keys. This behavior breaks Redis's rules for cluster configurations. However, it is still possible to use a cluster environment by using the proper bull prefix option as a cluster "hash tag". Hash tags are used to guarantee that certain keys are placed in the same hash slot, read more about hash tags in the [redis cluster tutorial](https://redis.io/topics/cluster-tutorial). A hash tag is defined with brackets. I.e. a key that has a substring inside brackets will use that substring to determine in which hash slot the key will be placed.

To make bull compatible with Redis cluster there are two approaches:

Defining a queue prefix, wrapping it inside brackets:

```typescript
const queue = new Queue('cluster', {
  prefix: '{myprefix}',
});

const worker = new Worker(
  'cluster',
  async () => {
    return null;
  },
  {
    prefix: '{myprefix}',
  },
);
```

or wrap the queue name itself:

```typescript
const queue = new Queue('{cluster}');

const worker = new Worker('{cluster}', async () => {
  return null;
});
```

Note that If you use several queues in the same cluster, you should use different prefixes so that the queues are evenly placed in the cluster nodes, potentially increasing performance and memory usage. This does not apply to [flows](https://docs.bullmq.io/guide/flows) because bull needs all queues in the same flow to be in the same node:

```typescript
const queue1 = new Queue('queue 1', {
  prefix: '{myprefix}',
});

const queue2 = new Queue('queue 2', {
  prefix: '{myprefix}',
});

const flow = new FlowProducer({
  prefix: '{myprefix}',
});

await flow.add({
  name: 'job 1',
  queueName: 'queue 1',
  data: {},
  children: [
    {
      name: 'job 2',
      queueName: 'queue 2',
      data: {},
    },
  ],
});
```

You can span different flows in different nodes using different prefixes.
