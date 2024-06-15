# Getters

#### Job Counts

It is often necessary to know how many jobs are in a given group:

```typescript
import { QueuePro } from '@taskforcesh/bullmq-pro';

const queue = new QueuePro('myQueue', { connection });
const groupId = 'my group';
const count = await queue.getGroupsJobsCount(1000); // 1000 groups in each iteration
```

{% hint style="info" %}
This count value includes prioritized and non-prioritized jobs included groups.
{% endhint %}

#### Get Jobs

It is also possible to retrieve the jobs with pagination style semantics in a given group. For example:

```typescript
const jobs = await queue.getGroupJobs(groupId, 0, 100);
```

## Read more:

* 💡 [Get Groups Jobs Count API Reference](https://api.bullmq.pro/classes/v7.Queue.html#getGroupsJobsCount)
* 💡 [Get Group Jobs API Reference](https://api.bullmq.pro/classes/v7.Queue.html#getGroupJobs)
