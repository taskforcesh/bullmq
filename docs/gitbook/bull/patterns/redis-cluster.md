# Redis cluster

Bull internals require atomic operations that span different keys. This behavior breaks Redis's rules for cluster configurations. However, it is still possible to use a cluster environment by using the proper bull prefix option as a cluster "hash tag". Hash tags are used to guarantee that certain keys are placed in the same hash slot, read more about hash tags in the [redis cluster tutorial](https://redis.io/topics/cluster-tutorial). A hash tag is defined with brackets. I.e. a key that has a substring inside brackets will use that substring to determine in which hash slot the key will be placed.

In summary, to make bull compatible with Redis cluster, use a queue prefix inside brackets. For example:

You can use two approaches in order to make the Queues compatible with Cluster. Either define a queue prefix:

```typescript
const queue = new Queue('cluster', {
  prefix: '{myprefix}'
});
```

or wrap the queue name itself:

```typescript
const queue = new Queue('{cluster}');
```

Note that If you use several queues in the same cluster, you should use different prefixes so that the queues are evenly placed in the cluster nodes, potentially increasing performance and memory usage.
