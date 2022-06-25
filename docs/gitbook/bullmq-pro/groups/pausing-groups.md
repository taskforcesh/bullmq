# Pausing groups

BullMQ Pro  supports pausing groups globally. A group is paused when no workers will pick up any jobs that belongs to the paused group. When you pause a group, the workers that are currently busy processing a job from that group, will continue working on that job until it completes (or failed), and then will just keep idling until the group has been resumed.

Pausing a group is performed by calling the _**pauseGroup**_ method on a [queue](https://api.bullmq.pro/classes/Queue.html#pauseGroup) instance:

```typescript
await myQueue.pauseGroup('groupId');
```

{% hint style="info" %}
Even if the groupId does not exist at that time, the groupId will be added in our paused list as a group could be ephemeral
{% endhint %}

{% hint style="warning" %}
It will throw an error if the group is already paused.
{% endhint %}

Resuming a group is performed by calling the _**resumeGroup**_ method on a [queue](https://api.bullmq.pro/classes/Queue.html#resumeGroup) instance:

```typescript
await myQueue.resumeGroup('groupId');
```

{% hint style="warning" %}
It will throw an error if the group does not exist or when the group is already resumed.
{% endhint %}