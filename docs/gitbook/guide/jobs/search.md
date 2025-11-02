# Job Search

The `Queue.search` method provides a powerful way to search for jobs using a Lucene-like query syntax. This allows
for complex, text-based searches on job data and metadata.

## Overview

The `search` method accepts a query string that is parsed and converted into a filter to be executed with Redis itself.
This provides an efficient way to find specific jobs without having to retrieve all jobs and filter them on the client side.

## Syntax

### Basic Usage

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

### Parameters

- **type** (`JobType`): The job state to search ('waiting', 'completed', 'failed', etc.)
- **query** (`string | object`): The search criteria (Lucene-style string or filter object)
- **count** (`number`, default: `10`): Maximum number of matching jobs to return per call
- **asc** (`boolean`, default: `false`): Sort order for results
- **cursorId** (`string`, default: `null`): Cursor identifier from previous call (for continuation)
- **batchSize** (`number`, default: `50`): Number of jobs to scan per iteration (affects performance vs. latency trade-off)

### Return Value

The search method returns an object with:

```typescript
{
  jobs: Job[];        // Array of matching jobs
  cursorId: string;   // Cursor ID for next iteration
  done: boolean;      // Whether search is complete
  progress: number;   // Number of jobs scanned so far
  total: number;      // Total number of jobs in the state
}
```

---

## Cursor-Based Iteration

When searching through large numbers of jobs, retrieving all results at once can be inefficient and may consume significant
memory. The `search` method supports cursor-based iteration, allowing you to retrieve results in smaller batches while
maintaining state between calls.

This technique is particularly useful for paginating through large result sets or performing partial processing.

### How It Works

The cursor mechanism stores intermediate search state on the Redis server, allowing you to:

- Retrieve results in manageable batches
- Resume searching from where you left off
- Avoid reprocessing already-scanned jobs
- Handle large result sets efficiently

The search maintains a cursor that tracks:

- **Progress**: How many jobs have been scanned
- **Total**: The total number of jobs in the specified state
- **Cursor ID**: A unique identifier for the iteration session
- **Done**: Whether all matching jobs have been found

### Example with Progress Tracking

```typescript
async function searchWithProgress(
  queue: Queue,
  jobType: string,
  query: object,
  onProgress?: (progress: number, total: number) => void,
) {
  const results = [];
  let cursorId: string | null = null;
  let done = false;
  let savedProgress = 0;

  while (!done) {
    const {
      jobs,
      cursorId: newCursorId,
      done: searchDone,
      progress,
      total,
    } = await queue.search(
      jobType,
      query,
      25, // retrieve 25 jobs per call
      true, // ascending order
      cursorId, // Cursor ID for continuation
      75, // batchSize: scan 75 jobs per iteration
    );

    results.push(...jobs);
    cursorId = newCursorId;
    done = searchDone;

    // Report progress
    if (onProgress && progress !== savedProgress) {
      let res = onProgress(progress, total);
      if (res === false) {
        break;
      }
    }

    savedProgress = progress;

    // Break if we've found enough results (optional)
    if (results.length >= 1000) {
      console.log('Reached result limit, stopping early');
      break;
    }
  }

  return results;
}

// Usage with progress callback
const query = 'name:upgrade AND data.tier:free AND priority:[3 TO *]';

const jobs = await searchWithProgress(
  queue,
  'completed',
  query,
  (progress, total) => {
    const percentage = ((progress / total) * 100).toFixed(1);
    console.log(`Scanning: ${percentage}% (${progress}/${total})`);
  },
);
```

#### Key Features of the Example

1. **Cursor Management**:
   - The `cursorId` is initially `null` and gets updated on the first iteration.
   - This ensures that the state of the iteration is preserved across calls.
   - Cursors expire after 30 seconds of inactivity to free up server resources.

2. **Progress Tracking**:
   - The retrieved jobs are accumulated in the `totalJobs` array.
   - `done` flag indicates when the iteration has processed all matching jobs.

3. **Batch Processing**:
   - Adjusting the `batchSize` enables control over the number of items processed per call based on memory or performance
     constraints.

### Performance Considerations

**Batch Size Trade-offs:**

- **Smaller `batchSize`**: Lower latency per call, but more round-trips to Redis
- **Larger `batchSize`**: Higher latency per call, but fewer round-trips needed

Use **smaller batch sizes** when the server or network resources are limited.
Add optional **delays** between iterations for heavy queries to avoid server overload.
