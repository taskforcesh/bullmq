---
description: How to rate-limit each group with a different limit per group.
---

# Local group rate limit

Sometimes it is required that different groups have different rate limits, this could be the case for example if a group represents a given user in the system, and depending on the user's quota or other factors we would like to have a different rate-limit for it.

You can use a local group rate limit, which would be used only for the specific group that have the rate-limit setup. For example:

```typescript
import { QueuePro } from '@taskforcesh/bullmq-pro';

const queue = new QueuePro('myQueue', { connection });
const groupId = 'my group';
const maxJobsPerDuration = 100;

const duration = 1000; // duration in ms.
await queue.setGroupRateLimit(groupId, maxJobsPerDuration, duration);

```

This code would set a specific rate limit on the group "my group" of max 100 jobs per second. Note that you can still have a ["default" rate-limit](rate-limiting.md) specified for the rest of the groups, the call to `setGroupRateLimit` will therefore allow you to override that rate-limit .

### Read more

* [ Local Rate Limit Group API Reference](https://api.bullmq.pro/classes/v7.QueuePro.html#setGroupRateLimit)

