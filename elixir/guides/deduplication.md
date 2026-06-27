# Deduplication

Deduplication in BullMQ prevents duplicate jobs from being added to the queue. When a job with a deduplication ID is added, any subsequent attempts to add a job with the same ID are ignored until the deduplication condition is cleared.

## Modes

BullMQ supports three deduplication modes:

### Simple Mode

In Simple Mode, deduplication lasts until the job completes or fails. This is useful for long-running jobs that should not be duplicated while in progress.

```elixir
# Add a job that will be deduplicated until completion or failure
BullMQ.Queue.add("tasks", "process-file", %{file: "report.csv"},
  connection: :redis,
  deduplication: %{id: "file-report.csv"}
)

# This will be ignored while the first job is still processing
BullMQ.Queue.add("tasks", "process-file", %{file: "report.csv"},
  connection: :redis,
  deduplication: %{id: "file-report.csv"}
)
```

### Throttle Mode

In Throttle Mode, deduplication lasts for a specified TTL (time-to-live). This is useful for preventing rapid duplicate requests.

```elixir
# Add a job that will be deduplicated for 5 seconds
BullMQ.Queue.add("notifications", "send-email", %{to: "user@example.com"},
  connection: :redis,
  deduplication: %{id: "email-user@example.com", ttl: 5_000}
)

# Ignored if added within 5 seconds
BullMQ.Queue.add("notifications", "send-email", %{to: "user@example.com"},
  connection: :redis,
  deduplication: %{id: "email-user@example.com", ttl: 5_000}
)

# After 5 seconds, a new job can be added
```

### Debounce Mode

In Debounce Mode, each new job with the same deduplication ID extends the TTL and optionally replaces the job data. This is useful when you want to keep only the most recent version of a job.

```elixir
# Add a job with debounce behavior
BullMQ.Queue.add("search", "update-index", %{query: "first"},
  connection: :redis,
  delay: 5_000,
  deduplication: %{
    id: "search-index",
    ttl: 5_000,
    extend: true,
    replace: true
  }
)

# This replaces the previous job and resets the TTL
BullMQ.Queue.add("search", "update-index", %{query: "updated"},
  connection: :redis,
  delay: 5_000,
  deduplication: %{
    id: "search-index",
    ttl: 5_000,
    extend: true,
    replace: true
  }
)

# Only one job will be processed, with data: %{query: "updated"}
```

## Managing Deduplication

### Get Deduplication Job ID

Find which job started the deduplication:

```elixir
{:ok, job_id} = BullMQ.Queue.get_deduplication_job_id("my-queue", "dedup-id",
  connection: :redis
)

case job_id do
  nil -> IO.puts("No active deduplication")
  id -> IO.puts("Deduplication started by job: #{id}")
end
```

### Remove Deduplication Key

Stop deduplication early, allowing new jobs to be added:

```elixir
# Remove deduplication before TTL expires or job completes
{:ok, 1} = BullMQ.Queue.remove_deduplication_key("my-queue", "dedup-id",
  connection: :redis
)

# Now a new job with the same ID can be added
BullMQ.Queue.add("my-queue", "job", %{},
  connection: :redis,
  deduplication: %{id: "dedup-id"}
)
```

### Removing Deduplication When Job Becomes Active

A common pattern is to stop deduplication as soon as a job starts processing, allowing a new job to be queued while the current one runs:

```elixir
defmodule MyWorker do
  def start_link(opts) do
    processor = fn job ->
      # Stop deduplication when job starts
      if job.opts[:deduplication] do
        dedup_id = job.opts[:deduplication][:id]
        BullMQ.Queue.remove_deduplication_key("my-queue", dedup_id,
          connection: Keyword.fetch!(opts, :connection)
        )
      end

      # Process the job
      process(job.data)
      :ok
    end

    BullMQ.Worker.start_link(
      Keyword.merge(opts, [
        queue: "my-queue",
        processor: processor
      ])
    )
  end
end
```

## Deduplication with Job Schedulers

Job schedulers don't directly support deduplication options, but you can achieve similar behavior by having the scheduler trigger a job that adds the deduplicated job:

```elixir
defmodule SchedulerWorker do
  def start_link(opts) do
    processor = fn job ->
      case job.name do
        "scheduler-trigger" ->
          # Add a deduplicated job
          BullMQ.Queue.add("tasks", "actual-task", %{},
            connection: Keyword.fetch!(opts, :connection),
            deduplication: %{id: "scheduled-task", ttl: 90_000}
          )
          :ok

        "actual-task" ->
          # Process the actual task
          do_work()
          :ok
      end
    end

    BullMQ.Worker.start_link(
      Keyword.merge(opts, [
        queue: "tasks",
        processor: processor
      ])
    )
  end
end

# Set up the scheduler
BullMQ.Queue.upsert_job_scheduler("tasks", "every-minute",
  connection: :redis,
  pattern: "* * * * *",
  template: %{name: "scheduler-trigger", data: %{}}
)
```

## Deduplication Options Reference

| Option    | Type    | Required | Description                         |
| --------- | ------- | -------- | ----------------------------------- |
| `id`      | string  | Yes      | Unique identifier for deduplication |
| `ttl`     | integer | No       | Time-to-live in milliseconds        |
| `extend`  | boolean | No       | Extend TTL on each duplicate        |
| `replace` | boolean | No       | Replace job data while delayed      |

## Best Practices

1. **Choose meaningful IDs**: Use IDs that represent the logical operation being deduplicated, not just random values.

   ```elixir
   # Good: ID represents the operation
   deduplication: %{id: "sync-user-#{user_id}"}

   # Bad: Generic ID
   deduplication: %{id: "job-123"}
   ```

2. **Use Simple Mode for critical operations**: When a job absolutely must not run twice simultaneously.

3. **Use Throttle Mode for rate limiting**: When you want to limit how often a job can be triggered.

4. **Use Debounce Mode for frequent updates**: When multiple rapid updates should be collapsed into one.

5. **Consider removing deduplication on active**: If you want to allow queuing the next job while the current one runs.

## See Also

- [Job Options](job_options.md) - All job configuration options
- [Job Schedulers](job_schedulers.md) - Creating recurring jobs
- [Queue Events](queue_events.md) - Listen for deduplicated events
