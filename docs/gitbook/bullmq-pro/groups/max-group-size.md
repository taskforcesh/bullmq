# Max group size

It is possible to set a maximum group size. This can be useful if you want to keep the number of jobs within some limits and you can afford to discard new jobs.

When a group has reached the defined max size, adding new jobs to that group will result in an exception being thrown, that you can catch and ignore if you do not care about it.

You can use the "maxSize" option when adding jobs to a group like this:

```typescript
import { QueuePro, GroupMaxSizeExceededError } from '@taskforcesh/bullmq-pro';

const queue = new QueuePro('myQueue', { connection });
const groupId = 'my group';
try {
  await queue.add('paint', { foo: 'bar' }, {
      group: {
        id: groupId,
        maxSize: 7,
      },
    });
} catch (err) {
  if (err instanceof GroupMaxSizeExceededError){
    console.log(`Job discarded for group ${groupId}`)
  } else {
    throw err;
  }
}

```



{% hint style="info" %}
The maxSize option is not yet available for "addBulk".
{% endhint %}
