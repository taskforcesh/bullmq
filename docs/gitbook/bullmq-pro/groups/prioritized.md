# Prioritized intra-groups

BullMQ Pro supports priorities per group. A job is prioritized in a group when group and priority options are provided together.

```typescript
await myQueue.add('paint', { foo: 'bar' }, {
    group: {
        id: 'groupId',
        priority: 10
    }
});
```

{% hint style="info" %}
Standard prioritized jobs get more priority than grouped prioritized jobs
{% endhint %}
