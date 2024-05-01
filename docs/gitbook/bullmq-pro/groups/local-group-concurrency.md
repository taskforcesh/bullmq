# Local group concurrency

It is possible to set specific group concurrency. This can be useful if you want to differentiate your groups with different max councurrency rules.

You can use the `setGroupConcurrency` method like this:

```typescript
import { QueuePro } from '@taskforcesh/bullmq-pro';

const queue = new QueuePro('myQueue', { connection });
const groupId = 'my group';
await queue.setGroupConcurrency(groupId, 4);
```
