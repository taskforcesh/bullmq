# Cancelling Jobs

The job cancellation feature allows you to gracefully cancel jobs that are currently being processed by a worker. This is implemented using the standard `AbortController` and `AbortSignal` APIs.

## How It Works

When a worker processes a job, it can receive an optional `AbortSignal` as the third parameter in the processor function. This signal can be used to detect when a job has been cancelled and perform cleanup operations.

```typescript
import { Worker } from 'bullmq';

const worker = new Worker('myQueue', async (job, token, signal) => {
  // The signal parameter is optional and provides cancellation support
  // Your job processing logic here
});
```

## Cancelling Jobs

The `Worker` class provides methods to cancel jobs:

```typescript
// Cancel a specific job by ID
const cancelled = worker.cancelJob('job-id-123');
console.log('Job cancelled:', cancelled); // true if job was active, false otherwise

// Cancel with a reason (useful for debugging)
worker.cancelJob('job-id-456', 'User requested cancellation');

// Cancel all active jobs
worker.cancelAllJobs();

// Cancel all with a reason
worker.cancelAllJobs('System shutdown');

// Get list of active jobs from queue
const activeJobs = await queue.getActive();
console.log(
  'Active jobs:',
  activeJobs.map(j => j.id),
);
```

### Cancellation Reasons

When you provide a cancellation reason, it's passed to the `AbortController.abort(reason)` method and can be accessed via `signal.reason`:

```typescript
const worker = new Worker('myQueue', async (job, token, signal) => {
  return new Promise((resolve, reject) => {
    signal?.addEventListener('abort', () => {
      // Access the cancellation reason
      const reason = signal.reason || 'No reason provided';
      console.log(`Job ${job.id} cancelled: ${reason}`);

      reject(new Error(`Cancelled: ${reason}`));
    });

    // Your processing logic
  });
});

// Later, cancel with a descriptive reason
worker.cancelJob(job.id, 'Resource limit exceeded');
```

## Handling Cancellation (Recommended Pattern)

The **event-based approach** is the recommended pattern as it provides immediate response to cancellation:

```typescript
import { Worker } from 'bullmq';

const worker = new Worker('myQueue', async (job, token, signal) => {
  return new Promise((resolve, reject) => {
    // Listen for abort event
    signal?.addEventListener('abort', () => {
      console.log(`Job ${job.id} cancellation requested`);

      // Clean up resources
      clearInterval(interval);

      // Reject with error
      reject(new Error('Job was cancelled'));
    });

    // Your processing logic
    const interval = setInterval(() => {
      // Do work
      processNextItem();
    }, 100);
  });
});
```

### Why Event-Based?

- ✅ **Immediate response** - No polling delay
- ✅ **More efficient** - No CPU wasted checking in loops
- ✅ **Cleaner code** - Separation of concerns
- ✅ **Standard pattern** - Matches Web APIs like `fetch()`

## Using with Native APIs (Recommended)

Many Web APIs natively support `AbortSignal`. The signal is **composable** - you can pass it to APIs and still listen to it yourself:

```typescript
const worker = new Worker('fetchQueue', async (job, token, signal) => {
  return new Promise(async (resolve, reject) => {
    // Set up abort listener - handles cancellation for the job
    signal?.addEventListener('abort', () => {
      reject(new Error('Job was cancelled'));
    });

    // Pass the SAME signal to fetch - it will abort the network request
    const response = await fetch(job.data.url, {
      signal, // ✅ Cancels the HTTP request at network level
      method: 'GET',
      headers: job.data.headers,
    });

    const data = await response.json();
    resolve(data);
  });
});
```

**Why this pattern is better:**

- ✅ **Simpler** - One abort listener handles everything
- ✅ **Composable** - Signal passed to `fetch()` AND listened to in job
- ✅ The HTTP request is **truly cancelled** at the network level
- ✅ The job is **properly marked as failed** when cancelled
- ✅ No complex error checking needed

### APIs That Support AbortSignal

Many modern APIs accept `signal` directly:

- `fetch(url, { signal })` - HTTP requests
- `addEventListener(event, handler, { signal })` - Auto-removes listener on abort
- Many database clients (Postgres, MongoDB drivers)
- File system operations in newer Node.js APIs

## Cancelling Custom Operations

For operations that don't natively support `AbortSignal`, implement proper cleanup:

```typescript
const worker = new Worker('customQueue', async (job, token, signal) => {
  // Start your operation
  const operation = startLongRunningOperation(job.data);

  // Set up cancellation handler that actually stops the operation
  signal?.addEventListener('abort', () => {
    operation.cancel(); // ✅ Actually stops the work
  });

  try {
    const result = await operation.promise;
    return result;
  } catch (error) {
    if (signal?.aborted) {
      throw new Error('Operation cancelled');
    }
    throw error;
  }
});
```

## Async Cleanup on Cancellation

Perform cleanup operations before rejecting the promise:

```typescript
const worker = new Worker('dbQueue', async (job, token, signal) => {
  // Acquire resources
  const db = await connectToDatabase();
  const cache = await connectToCache();

  return new Promise(async (resolve, reject) => {
    // Set up cleanup handler
    signal?.addEventListener('abort', async () => {
      try {
        console.log('Cleaning up resources...');

        // Close connections gracefully
        await db.close();
        await cache.disconnect();

        console.log('Cleanup complete');
        reject(new Error('Cancelled after cleanup'));
      } catch (cleanupError) {
        console.error('Cleanup failed:', cleanupError);
        reject(new Error('Cleanup failed during cancellation'));
      }
    });

    try {
      // Do your work
      const result = await processWithDatabase(db, job.data);
      await cache.set(`job:${job.id}`, result);
      resolve(result);
    } catch (error) {
      // Cleanup on error too
      await db.close();
      await cache.disconnect();
      throw error;
    }
  });
});
```

## Alternative: Polling Pattern

You can also check `signal.aborted` periodically (less efficient but simpler for some use cases):

```typescript
const worker = new Worker('batchQueue', async (job, token, signal) => {
  const items = job.data.items;
  const results = [];

  for (let i = 0; i < items.length; i++) {
    // Check if job has been cancelled
    if (signal?.aborted) {
      throw new Error(`Cancelled after processing ${i} items`);
    }

    const result = await processItem(items[i]);
    results.push(result);

    // Update progress
    await job.updateProgress(((i + 1) / items.length) * 100);
  }

  return { results, total: results.length };
});
```

## Job State After Cancellation

### With Regular Error (Will Retry)

When you throw a regular `Error` upon cancellation:

- **Job state**: Moves to `failed`
- **Retries**: Job WILL be retried if `attempts` remain
- **Use case**: When you want the job to be retried later

```typescript
const worker = new Worker('retryQueue', async (job, token, signal) => {
  return new Promise((resolve, reject) => {
    signal?.addEventListener('abort', () => {
      // Regular Error - job will retry if attempts remain
      reject(new Error('Cancelled, will retry'));
    });

    // Your work...
  });
});

// Set attempts when adding jobs
await queue.add('task', data, { attempts: 3 });
```

### With UnrecoverableError (No Retry)

When you throw an `UnrecoverableError`:

- **Job state**: Moves to `failed`
- **Retries**: Job will NOT be retried
- **Use case**: When cancellation should be permanent

```typescript
import { Worker, UnrecoverableError } from 'bullmq';

const worker = new Worker('noRetryQueue', async (job, token, signal) => {
  return new Promise((resolve, reject) => {
    signal?.addEventListener('abort', () => {
      // UnrecoverableError - no retries
      reject(new UnrecoverableError('Cancelled permanently'));
    });

    // Your work...
  });
});
```

## Handling Lock Renewal Failures

When a worker loses its lock on a job (due to network issues, Redis problems, or long-running operations), you can gracefully handle this situation using the `lockRenewalFailed` event:

```typescript
const worker = new Worker(
  'myQueue',
  async (job, token, signal) => {
    return new Promise(async (resolve, reject) => {
      signal?.addEventListener('abort', async () => {
        console.log('Job cancelled - cleaning up resources');
        await cleanupResources();
        reject(new Error('Job cancelled'));
      });

      // Your work...
    });
  },
  { connection },
);

// Cancel jobs when lock renewal fails
worker.on('lockRenewalFailed', (jobIds: string[]) => {
  console.log('Lock renewal failed for jobs:', jobIds);
  jobIds.forEach(jobId => worker.cancelJob(jobId));
});
```

{% hint style="warning" %}
**Important:** When a worker loses the lock on a job, it cannot move that job to the `failed` state (as it no longer owns the lock). Instead:

1. The `cancelJob()` aborts the signal, allowing the processor to clean up resources
2. The job remains in `active` state temporarily
3. BullMQ's **stalled job checker** will detect the job and move it back to `waiting`
4. Another worker (or the same worker) will pick it up and retry

This is the correct and intended behavior - trust BullMQ's stalled job mechanism to handle lost locks.
{% endhint %}

### Why This Pattern Works

- ✅ **Immediate cleanup**: The processor detects `signal.aborted` and can release resources
- ✅ **No wasted work**: The processor stops processing when it loses the lock
- ✅ **Automatic recovery**: The stalled job checker moves the job back to waiting
- ✅ **No data loss**: The job will be retried according to its `attempts` setting
- ✅ **Works with existing infrastructure**: Uses BullMQ's built-in stalled job handling

## Multi-Phase Work with Cancellation

Check cancellation at strategic points in multi-phase operations:

```typescript
const worker = new Worker('multiPhaseQueue', async (job, token, signal) => {
  return new Promise(async (resolve, reject) => {
    signal?.addEventListener('abort', () => {
      reject(new Error('Cancelled'));
    });

    try {
      // Phase 1: Download
      if (signal?.aborted) throw new Error('Cancelled before download');
      const data = await downloadData(job.data.url);
      await job.updateProgress(33);

      // Phase 2: Process
      if (signal?.aborted) throw new Error('Cancelled before processing');
      const processed = await processData(data);
      await job.updateProgress(66);

      // Phase 3: Upload
      if (signal?.aborted) throw new Error('Cancelled before upload');
      const result = await uploadResults(processed);
      await job.updateProgress(100);

      resolve(result);
    } catch (error) {
      reject(error);
    }
  });
});
```

## Backward Compatibility

The `signal` parameter is optional. Existing processors that don't use it will continue to work normally:

```typescript
// Old processor - still works
const worker = new Worker('myQueue', async job => {
  return await processJob(job);
});

// New processor - with cancellation support
const worker = new Worker('myQueue', async (job, token, signal) => {
  // Can now handle cancellation
});
```

{% hint style="info" %}
The cancellation feature is fully backward compatible. You only need to add signal handling when you want cancellation support.
{% endhint %}

## Best Practices

1. **Use event-based cancellation** for immediate response
2. **Clean up resources** in the abort handler
3. **Use UnrecoverableError** when cancellation should be permanent
4. **Combine with timeouts** for better control
5. **Check `signal.aborted` at strategic points** in long operations
6. **Handle cleanup errors** gracefully to avoid leaving resources open

## Read more:

- 💡 [Worker API Reference](https://api.docs.bullmq.io/classes/v5.Worker.html)
- 💡 [AbortController MDN](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- 💡 [AbortSignal MDN](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)
