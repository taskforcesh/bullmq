# Job Search

The `Queue.search` method provides a powerful way to search for jobs using a Lucene-like query syntax. This allows
for complex, text-based searches on job data and metadata.

## Overview

The `search` method accepts a query string that is parsed and converted into a filter to be executed with Redis itself.
This provides an efficient way to find specific jobs without having to retrieve all jobs and filter them on the client side.

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
