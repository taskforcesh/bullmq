# Prioritized intra-groups

BullMQ Pro supports priorities per group. A job is prioritized in a group when group and priority options are provided _together_.

```typescript
await myQueue.add(
  'paint',
  { foo: 'bar' },
  {
    group: {
      id: 'groupId',
      priority: 10,
    },
  },
);
```

{% hint style="info" %}
The priorities go from 0 to 2097151, where a higher number means lower priority (as in Unix [processes](https://en.wikipedia.org/wiki/Nice\_\(Unix\))). Thus, jobs without any explicit priority will have the highest priority.
{% endhint %}

## Read more:

* 💡 [Add Job API Reference](https://api.bullmq.pro/classes/v7.Queue.html#add)
