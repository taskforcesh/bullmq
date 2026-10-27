# Cancelling Jobs

The job cancellation feature allows you to gracefully cancel jobs that are currently being processed by a worker. This is implemented using the standard `AbortController` and `AbortSignal` APIs.

## How It Works

When a worker processes a job, it can receive an optional `AbortSignal` as the third parameter in the processor function. This signal can be used to detect when a job has been cancelled and perform cleanup operations.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Worker } from 'bullmq';

const worker = new Worker('myQueue', async (job, token, signal) => {
  // The signal parameter is optional and provides cancellation support
  // Your job processing logic here
});
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Worker

async def process(job, token, signal):
    # The signal parameter is optional and provides cancellation support
    # Your job processing logic here
    pass

worker = Worker("myQueue", process)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: "myQueue",
    connection: :my_redis,
    processor: fn job, cancel_token ->
      # The cancel_token parameter is optional and provides cancellation support
      # Your job processing logic here
      :ok
    end
  )
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::worker::CancellationToken;
use bullmq::{Job, Worker};

let worker = Worker::new("myQueue", |job: Job, token: CancellationToken| async move {
    // The token parameter provides cancellation support
    // Your job processing logic here
    Ok(serde_json::Value::Null)
})
.await?;
```

{% endtab %}
{% endtabs %}

## Cancelling Jobs

The `Worker` class provides methods to cancel jobs:

{% tabs %}
{% tab title="TypeScript" %}

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

{% endtab %}

{% tab title="Python" %}

```python
# Cancel a specific job by ID
cancelled = worker.cancelJob("job-id-123")
print("Job cancelled:", cancelled)  # True if job was active, False otherwise

# Cancel with a reason (useful for debugging)
worker.cancelJob("job-id-456", "User requested cancellation")

# Cancel all active jobs
worker.cancelAllJobs()

# Cancel all with a reason
worker.cancelAllJobs("System shutdown")

# Get list of active jobs from queue
active_jobs = await queue.getActive()
print("Active jobs:", [j.id for j in active_jobs])
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
# Cancel a specific job by ID
result = BullMQ.Worker.cancel_job(worker, "job-id-123")
IO.inspect(result, label: "Job cancelled") # :ok if job was active, {:error, :not_found} otherwise

# Cancel with a reason (useful for debugging)
BullMQ.Worker.cancel_job(worker, "job-id-456", "User requested cancellation")

# Cancel all active jobs
BullMQ.Worker.cancel_all_jobs(worker)

# Cancel all with a reason
BullMQ.Worker.cancel_all_jobs(worker, "System shutdown")

# Get list of active jobs from queue
{:ok, active_jobs} = BullMQ.Queue.get_active("myQueue", connection: :my_redis)
IO.inspect(Enum.map(active_jobs, & &1.id), label: "Active jobs")
```

{% endtab %}

{% tab title="Rust" %}

```rust
// Cancel a specific job by ID
let cancelled = worker.cancel_job("job-id-123").await;
println!("Job cancelled: {cancelled}"); // true if job was active, false otherwise

// Cancel all active jobs
worker.cancel_all_jobs().await;

// Get list of active jobs from queue
let active_jobs = queue.get_active(0, -1).await?;
let ids: Vec<&str> = active_jobs.iter().map(|j| j.id()).collect();
println!("Active jobs: {ids:?}");
```

{% endtab %}
{% endtabs %}

### Cancellation Reasons

When you provide a cancellation reason, it's passed to the `AbortController.abort(reason)` method and can be accessed via `signal.reason`:

{% tabs %}
{% tab title="TypeScript" %}

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

{% endtab %}

{% tab title="Python" %}

```python
import asyncio

async def process(job, token, signal):
    # Your processing logic
    work = asyncio.create_task(do_work(job))
    abort = asyncio.create_task(signal.wait())
    await asyncio.wait({work, abort}, return_when=asyncio.FIRST_COMPLETED)

    if signal.aborted:
        work.cancel()

        # Access the cancellation reason
        reason = signal.reason or "No reason provided"
        print(f"Job {job.id} cancelled: {reason}")

        raise Exception(f"Cancelled: {reason}")

    abort.cancel()
    return work.result()

worker = Worker("myQueue", process)

# Later, cancel with a descriptive reason
worker.cancelJob(job.id, "Resource limit exceeded")
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: "myQueue",
    connection: :my_redis,
    processor: fn job, cancel_token ->
      # Your processing logic
      %Task{ref: ref} = task = Task.async(fn -> do_work(job) end)

      receive do
        {:cancel, ^cancel_token, reason} ->
          Task.shutdown(task, :brutal_kill)

          # Access the cancellation reason
          reason = reason || "No reason provided"
          IO.puts("Job #{job.id} cancelled: #{reason}")

          {:error, "Cancelled: #{reason}"}

        {^ref, result} ->
          Process.demonitor(ref, [:flush])
          {:ok, result}
      end
    end
  )

# Later, cancel with a descriptive reason
BullMQ.Worker.cancel_job(worker, job.id, "Resource limit exceeded")
```

{% endtab %}
{% endtabs %}

## Handling Cancellation (Recommended Pattern)

The **event-based approach** is the recommended pattern as it provides immediate response to cancellation:

{% tabs %}
{% tab title="TypeScript" %}

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

{% endtab %}

{% tab title="Python" %}

```python
import asyncio
from bullmq import Worker

async def process(job, token, signal):
    # Your processing logic
    async def work():
        while True:
            # Do work
            await process_next_item()
            await asyncio.sleep(0.1)

    work_task = asyncio.create_task(work())

    # Wait for the abort event
    await signal.wait()
    print(f"Job {job.id} cancellation requested")

    # Clean up resources
    work_task.cancel()

    # Raise an error
    raise Exception("Job was cancelled")

worker = Worker("myQueue", process)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
defmodule MyProcessor do
  def process(job, cancel_token) do
    receive do
      # Listen for the cancel message
      {:cancel, ^cancel_token, _reason} ->
        IO.puts("Job #{job.id} cancellation requested")

        # Return an error
        {:error, "Job was cancelled"}
    after
      100 ->
        # Do work
        process_next_item()
        process(job, cancel_token)
    end
  end
end

{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: "myQueue",
    connection: :my_redis,
    processor: &MyProcessor.process/2
  )
```

{% endtab %}

{% tab title="Rust" %}

```rust
use std::time::Duration;

use bullmq::worker::CancellationToken;
use bullmq::{Error, Job, Worker};

let worker = Worker::new("myQueue", |job: Job, token: CancellationToken| async move {
    // Your processing logic
    let mut interval = tokio::time::interval(Duration::from_millis(100));

    loop {
        tokio::select! {
            // Listen for cancellation
            _ = token.cancelled() => {
                println!("Job {} cancellation requested", job.id());

                // Return an error
                return Err(Error::ProcessingError("Job was cancelled".into()));
            }
            _ = interval.tick() => {
                // Do work
                process_next_item().await;
            }
        }
    }
})
.await?;
```

{% endtab %}
{% endtabs %}

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

{% tabs %}
{% tab title="TypeScript" %}

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

{% endtab %}

{% tab title="Python" %}

```python
async def process(job, token, signal):
    items = job.data["items"]
    results = []

    for i, item in enumerate(items):
        # Check if job has been cancelled
        if signal.aborted:
            raise Exception(f"Cancelled after processing {i} items")

        result = await process_item(item)
        results.append(result)

        # Update progress
        await job.updateProgress((i + 1) / len(items) * 100)

    return {"results": results, "total": len(results)}

worker = Worker("batchQueue", process)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
defmodule BatchProcessor do
  alias BullMQ.CancellationToken

  def process(job, cancel_token) do
    items = job.data["items"]

    items
    |> Enum.with_index()
    |> Enum.reduce_while({:ok, []}, fn {item, i}, {:ok, results} ->
      # Check if job has been cancelled
      case CancellationToken.check(cancel_token) do
        {:cancelled, _reason} ->
          {:halt, {:error, "Cancelled after processing #{i} items"}}

        :ok ->
          result = process_item(item)

          # Update progress
          BullMQ.Worker.update_progress(job, (i + 1) / length(items) * 100)

          {:cont, {:ok, [result | results]}}
      end
    end)
    |> case do
      {:ok, results} -> {:ok, %{results: Enum.reverse(results), total: length(results)}}
      error -> error
    end
  end
end

{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: "batchQueue",
    connection: :my_redis,
    processor: &BatchProcessor.process/2
  )
```

{% endtab %}

{% tab title="Rust" %}

```rust
let worker = Worker::new("batchQueue", |mut job: Job, token: CancellationToken| async move {
    let items = job.data()["items"].as_array().cloned().unwrap_or_default();
    let mut results = Vec::new();

    for (i, item) in items.iter().enumerate() {
        // Check if job has been cancelled
        if token.is_cancelled() {
            return Err(Error::ProcessingError(format!(
                "Cancelled after processing {i} items"
            )));
        }

        let result = process_item(item).await;
        results.push(result);

        // Update progress
        let progress = (i + 1) as f64 / items.len() as f64 * 100.0;
        job.update_progress(JobProgress::Number(progress)).await?;
    }

    Ok(serde_json::json!({ "results": results, "total": results.len() }))
})
.await?;
```

{% endtab %}
{% endtabs %}

## Job State After Cancellation

### With Regular Error (Will Retry)

When you throw a regular `Error` upon cancellation:

- **Job state**: Moves to `failed`
- **Retries**: Job WILL be retried if `attempts` remain
- **Use case**: When you want the job to be retried later

{% tabs %}
{% tab title="TypeScript" %}

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

{% endtab %}

{% tab title="Python" %}

```python
async def process(job, token, signal):
    # Your work...

    if signal.aborted:
        # Regular Exception - job will retry if attempts remain
        raise Exception("Cancelled, will retry")

worker = Worker("retryQueue", process)

# Set attempts when adding jobs
await queue.add("task", data, {"attempts": 3})
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: "retryQueue",
    connection: :my_redis,
    processor: fn job, cancel_token ->
      # Your work...

      case BullMQ.CancellationToken.check(cancel_token) do
        {:cancelled, _reason} ->
          # Regular error - job will retry if attempts remain
          {:error, "Cancelled, will retry"}

        :ok ->
          :ok
      end
    end
  )

# Set attempts when adding jobs
{:ok, _job} =
  BullMQ.Queue.add("retryQueue", "task", data, connection: :my_redis, attempts: 3)
```

{% endtab %}

{% tab title="Rust" %}

```rust
let worker = Worker::new("retryQueue", |job: Job, token: CancellationToken| async move {
    // Your work...

    if token.is_cancelled() {
        // Regular error - job will retry if attempts remain
        return Err(Error::ProcessingError("Cancelled, will retry".into()));
    }

    Ok(serde_json::Value::Null)
})
.await?;

// Set attempts when adding jobs
queue.add("task", data).attempts(3).await?;
```

{% endtab %}
{% endtabs %}

### With UnrecoverableError (No Retry)

When you throw an `UnrecoverableError`:

- **Job state**: Moves to `failed`
- **Retries**: Job will NOT be retried
- **Use case**: When cancellation should be permanent

{% tabs %}
{% tab title="TypeScript" %}

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

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Worker, UnrecoverableError

async def process(job, token, signal):
    # Your work...

    if signal.aborted:
        # UnrecoverableError - no retries
        raise UnrecoverableError("Cancelled permanently")

worker = Worker("noRetryQueue", process)
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::worker::CancellationToken;
use bullmq::{Error, Job, Worker};

let worker = Worker::new("noRetryQueue", |job: Job, token: CancellationToken| async move {
    // Your work...

    if token.is_cancelled() {
        // Error::Unrecoverable - no retries
        return Err(Error::Unrecoverable("Cancelled permanently".into()));
    }

    Ok(serde_json::Value::Null)
})
.await?;
```

{% endtab %}
{% endtabs %}

## Handling Lock Renewal Failures

When a worker loses its lock on a job (due to network issues, Redis problems, or long-running operations), you can gracefully handle this situation using the `lockRenewalFailed` event:

{% tabs %}
{% tab title="TypeScript" %}

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

{% endtab %}

{% tab title="Python" %}

```python
async def process(job, token, signal):
    # Your work...

    if signal.aborted:
        print("Job cancelled - cleaning up resources")
        await cleanup_resources()
        raise Exception("Job cancelled")

worker = Worker("myQueue", process, {"connection": connection})

# Cancel jobs when lock renewal fails
def on_lock_renewal_failed(job_ids):
    print("Lock renewal failed for jobs:", job_ids)
    for job_id in job_ids:
        worker.cancelJob(job_id)

worker.on("lockRenewalFailed", on_lock_renewal_failed)
```

{% endtab %}
{% endtabs %}

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

{% tabs %}
{% tab title="TypeScript" %}

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

{% endtab %}

{% tab title="Python" %}

```python
async def process(job, token, signal):
    # Phase 1: Download
    if signal.aborted:
        raise Exception("Cancelled before download")
    data = await download_data(job.data["url"])
    await job.updateProgress(33)

    # Phase 2: Process
    if signal.aborted:
        raise Exception("Cancelled before processing")
    processed = await process_data(data)
    await job.updateProgress(66)

    # Phase 3: Upload
    if signal.aborted:
        raise Exception("Cancelled before upload")
    result = await upload_results(processed)
    await job.updateProgress(100)

    return result

worker = Worker("multiPhaseQueue", process)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
defmodule MultiPhaseProcessor do
  alias BullMQ.{CancellationToken, Worker}

  def process(job, cancel_token) do
    # Phase 1: Download
    with :ok <- check(cancel_token, "Cancelled before download"),
         data = download_data(job.data["url"]),
         :ok <- Worker.update_progress(job, 33),
         # Phase 2: Process
         :ok <- check(cancel_token, "Cancelled before processing"),
         processed = process_data(data),
         :ok <- Worker.update_progress(job, 66),
         # Phase 3: Upload
         :ok <- check(cancel_token, "Cancelled before upload"),
         result = upload_results(processed),
         :ok <- Worker.update_progress(job, 100) do
      {:ok, result}
    end
  end

  defp check(cancel_token, message) do
    case CancellationToken.check(cancel_token) do
      :ok -> :ok
      {:cancelled, _reason} -> {:error, message}
    end
  end
end

{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: "multiPhaseQueue",
    connection: :my_redis,
    processor: &MultiPhaseProcessor.process/2
  )
```

{% endtab %}

{% tab title="Rust" %}

```rust
let worker = Worker::new("multiPhaseQueue", |mut job: Job, token: CancellationToken| async move {
    // Phase 1: Download
    if token.is_cancelled() {
        return Err(Error::ProcessingError("Cancelled before download".into()));
    }
    let data = download_data(&job.data()["url"]).await;
    job.update_progress(JobProgress::Number(33.0)).await?;

    // Phase 2: Process
    if token.is_cancelled() {
        return Err(Error::ProcessingError("Cancelled before processing".into()));
    }
    let processed = process_data(data).await;
    job.update_progress(JobProgress::Number(66.0)).await?;

    // Phase 3: Upload
    if token.is_cancelled() {
        return Err(Error::ProcessingError("Cancelled before upload".into()));
    }
    let result = upload_results(processed).await;
    job.update_progress(JobProgress::Number(100.0)).await?;

    Ok(result)
})
.await?;
```

{% endtab %}
{% endtabs %}

## Backward Compatibility

The `signal` parameter is optional. Existing processors that don't use it will continue to work normally:

{% tabs %}
{% tab title="TypeScript" %}

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

{% endtab %}

{% tab title="Python" %}

```python
# Old processor - still works
async def process(job, token):
    return await process_job(job)

worker = Worker("myQueue", process)

# New processor - with cancellation support
async def process_with_signal(job, token, signal):
    # Can now handle cancellation
    pass

worker = Worker("myQueue", process_with_signal)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
# Old processor - still works
{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: "myQueue",
    connection: :my_redis,
    processor: fn job -> {:ok, process_job(job)} end
  )

# New processor - with cancellation support
{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: "myQueue",
    connection: :my_redis,
    processor: fn job, cancel_token ->
      # Can now handle cancellation
      :ok
    end
  )
```

{% endtab %}
{% endtabs %}

{% hint style="info" %}
The cancellation feature is fully backward compatible. You only need to add signal handling when you want cancellation support.
{% endhint %}

## Cancelling jobs from another process

`worker.cancelJob()` only reaches the jobs run by that `Worker` instance. To
cancel a job from another process (typically the API server where a user
clicked "cancel"), whichever worker runs it, use the
[Relay](../relay/README.md): see
[Cancelling jobs on other workers](../relay/examples/cancelling-jobs-on-other-workers.md).

## Best Practices

1. **Use event-based cancellation** for immediate response
2. **Clean up resources** in the abort handler
3. **Use UnrecoverableError** when cancellation should be permanent
4. **Combine with timeouts** for better control
5. **Check `signal.aborted` at strategic points** in long operations
6. **Handle cleanup errors** gracefully to avoid leaving resources open

## Read more:

- 💡 [Worker API Reference](https://docs.bullmq.io/api/classes/v6.Worker.html)
- 💡 [AbortController MDN](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- 💡 [AbortSignal MDN](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)
