# Retrying Jobs

BullMQ provides a `retry` method that allows you to programmatically retry jobs that have already completed or failed. This is different from the automatic retry mechanism (configured via the `attempts` option) - the `retry` method lets you manually move a job back to the waiting queue at any time.

## When to use Job.retry()

The `retry` method is useful in scenarios such as:

- **Manual intervention**: When a job failed due to a temporary external issue that has been resolved
- **Re-processing completed jobs**: When you need to run a completed job again with the same data
- **Workflow recovery**: When recovering from system failures or bugs that caused jobs to fail incorrectly

{% hint style="info" %}
Only jobs in the `completed` or `failed` state can be retried. Active, waiting, or delayed jobs cannot be retried.
{% endhint %}

## Basic Usage

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue, Job } from 'bullmq';

const queue = new Queue('my-queue');

// Get a failed job by ID
const job = await Job.fromId(queue, 'job-id');

// Retry a failed job (default state is 'failed')
await job.retry();

// Retry a completed job
await job.retry('completed');
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
# Get a job reference (must have connection set)
job = %Job{id: "job-id", queue_name: "my-queue", prefix: "bull", connection: conn}

# Retry a failed job (default state is :failed)
{:ok, updated_job} = Job.retry(job)

# Retry a completed job
{:ok, updated_job} = Job.retry(job, :completed)
```

{% endtab %}
{% endtabs %}

## Retry Options

The `retry` method accepts options to reset attempt counters. This is useful when you want the retried job to behave as if it's being processed for the first time.

### Reset Attempts Made

The `attemptsMade` counter tracks how many times a job has been processed. Resetting it allows the job to use its full retry allowance again.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
// Retry and reset the attempts counter
await job.retry('failed', { resetAttemptsMade: true });
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
# Retry and reset the attempts counter
{:ok, updated_job} = Job.retry(job, :failed, reset_attempts_made: true)
```

{% endtab %}
{% endtabs %}

### Reset Attempts Started

The `attemptsStarted` counter tracks how many times a job has been moved to the active state. This can be useful for tracking purposes.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
// Retry and reset both counters
await job.retry('failed', { 
  resetAttemptsMade: true,
  resetAttemptsStarted: true 
});
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
# Retry and reset both counters
{:ok, updated_job} = Job.retry(job, :failed, 
  reset_attempts_made: true,
  reset_attempts_started: true
)
```

{% endtab %}
{% endtabs %}

## What happens when you retry

When a job is retried, the following occurs:

1. **Job is moved to waiting queue**: The job is removed from the completed/failed set and added back to the waiting queue
2. **Properties are cleared**: The following job properties are reset:
   - `failedReason` / `failed_reason` → `null` / `nil`
   - `finishedOn` / `finished_on` → `null` / `nil`
   - `processedOn` / `processed_on` → `null` / `nil`
   - `returnvalue` / `return_value` → `null` / `nil`
3. **Events are emitted**: A `waiting` event is emitted when the job is successfully moved
4. **Parent dependencies restored**: If the job is a child in a flow, its dependency relationship with the parent is restored

{% hint style="warning" %}
If you retry a job without resetting `attemptsMade`, and the job has already exhausted its retry attempts, it will fail immediately when processed again.
{% endhint %}

## Error Handling

The `retry` method can fail in the following cases:

| Error Code | Description |
|------------|-------------|
| `-1` | Job does not exist |
| `-3` | Job was not found in the expected state |

{% tabs %}
{% tab title="TypeScript" %}

```typescript
try {
  await job.retry('failed');
} catch (error) {
  console.error('Failed to retry job:', error.message);
}
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
case Job.retry(job, :failed) do
  {:ok, updated_job} ->
    IO.puts("Job retried successfully")
    
  {:error, {:reprocess_failed, -1}} ->
    IO.puts("Job does not exist")
    
  {:error, {:reprocess_failed, -3}} ->
    IO.puts("Job was not in the expected state")
    
  {:error, reason} ->
    IO.puts("Failed to retry: #{inspect(reason)}")
end
```

{% endtab %}
{% endtabs %}

## Read More

- 💡 [Retrying Failing Jobs](../retrying-failing-jobs.md) - Automatic retry configuration with backoff strategies
- 💡 [Stop Retrying Jobs](../patterns/stop-retrying-jobs.md) - How to prevent further retries
