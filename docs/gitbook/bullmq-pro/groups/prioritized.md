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

## Get Counts per Priority for Group

If you want to get the `count` of jobs in `prioritized` status (priorities higher than 0) or in `waiting` status (priority 0) for specific group, use the **`getCountsPerPriorityForGroup`** method. For example, let's say that you want to get counts for `priority` `1` and `0`:

```typescript
const counts = await queue.getCountsPerPriorityForGroup('groupId', [1, 0]);
/*
{
  '1': 11,
  '0': 10
}
*/
```

## Read more:

* 💡 [Add Job API Reference](https://api.bullmq.pro/classes/v7.QueuePro.html#add)
* 💡 [Get Counts per Priority for Group API Reference](https://api.bullmq.pro/classes/v7.QueuePro.html#getcountsperpriorityforgroup)

