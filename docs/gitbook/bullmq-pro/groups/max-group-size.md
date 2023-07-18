# Max group size

It is possible to set a maximum group size. This can be useful if you want to keep the number of jobs within some limits and you can afford to discard new jobs.

When a group has reached the defined max size, adding new jobs to that group will result in an exception being thrown, that you can catch and ignore if you do not care about it.

You can use the "maxSize" option when adding jobs to a group like this:

```typescript
import { QueuePro, GroupMaxSizeExceededError } from '@taskforcesh/bullmq-pro';

const queue = new QueuePro('myQueue', { connection });

try {
  await queue.add('paint', { foo: 'bar' }, {
      group: {
        id: '1',
        maxSize: 7,
      },
    });
} catch (err) {
  if (err instanceof GroupMaxSizeExceededError){
    console.log(roup ${}`)
  } else {
    throw err;
  }
}

```
