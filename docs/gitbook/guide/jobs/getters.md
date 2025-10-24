# Getters

When jobs are added to a queue, they will be in different statuses during their lifetime. BullMQ provides methods to retrieve information and jobs from the different statuses.

![Lifecycle of a job](<../../.gitbook/assets/architecture (1).png>)

#### Job Counts

It is often necessary to know how many jobs are in a given status:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('Paint');

const counts = await myQueue.getJobCounts('wait', 'completed', 'failed');

// Returns an object like this { wait: number, completed: number, failed: number }
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Queue

myQueue = Queue('Paint')

counts = await myQueue.getJobCounts('wait', 'completed', 'failed')

# Returns an object like this { wait: number, completed: number, failed: number }
```

{% endtab %}
{% endtabs %}

The available status are:

- _completed_,
- _failed_,
- _delayed_,
- _active_,
- _wait_,
- _waiting-children_,
- _prioritized_,
- _paused_, and
- _repeat_.

#### Get Jobs

It is also possible to retrieve the jobs with pagination style semantics. For example:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const completed = await myQueue.getJobs(['completed'], 0, 100, true);

// returns the oldest 100 jobs
```

{% endtab %}

{% tab title="Python" %}

```python
completed = await myQueue.getJobs(['completed'], 0, 100, True)

# returns the oldest 100 jobs
```

{% endtab %}
{% endtabs %}

#### Search For Jobs

The `Queue.search` method provides a powerful way to search for jobs using a Lucene-like query syntax. This allows
for complex, text-based searches on job data and metadata.

{% tabs %}

{% tab title="TypeScript" %}

```typescript
const { jobs } = await queue.search(
  'completed',
  'data.user.id:123 AND priority:2',
);
```

{% endtab %}

{% tab title="Python" %}

```python
result = await queue.get_jobs_by_filter('completed', 'data.user.id:123 AND priority:2')
jobs = result['jobs']
```

{% endtab %}
{% endtabs %}

In this example, we are searching for completed jobs where the user ID in the job data is `123` and the job priority is `2`.

## Read more:

- 💡 [Get Job Counts API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#getjobcounts)
- 💡 [Get Jobs API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#getjobs)
