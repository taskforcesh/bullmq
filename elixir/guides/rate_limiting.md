# Rate Limiting

BullMQ provides built-in rate limiting to control job processing rates.

## Worker-Level Rate Limiting

Limit how many jobs are processed across all workers for a queue:

```elixir
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "api-calls",
  connection: :my_redis,
  processor: &MyApp.ApiCaller.process/1,
  concurrency: 10,
  limiter: %{
    max: 100,        # Maximum 100 jobs
    duration: 60_000 # Per minute (60 seconds)
  }
)
```

When the limit is reached, workers pause until the time window resets.

## How Rate Limiting Works

1. Each processed job increments a Redis counter
2. The counter has a TTL equal to `duration`
3. When counter reaches `max`, workers wait for TTL expiration
4. Counter resets automatically when TTL expires

```
Time 0:00 - Counter: 0/100 - Processing
Time 0:30 - Counter: 50/100 - Processing
Time 0:45 - Counter: 100/100 - Rate limited!
Time 1:00 - Counter expires - Processing resumes
```

## Distributed Rate Limiting

Since rate limits are stored in Redis, they work across multiple nodes:

```elixir
# Node A
{:ok, worker_a} = BullMQ.Worker.start_link(
  queue: "api-calls",
  connection: :my_redis,
  processor: &process/1,
  limiter: %{max: 100, duration: 60_000}
)

# Node B (different machine, same Redis)
{:ok, worker_b} = BullMQ.Worker.start_link(
  queue: "api-calls",
  connection: :my_redis,
  processor: &process/1,
  limiter: %{max: 100, duration: 60_000}
)

# Both workers share the same rate limit counter in Redis
# Combined throughput is limited to 100/minute
```

## Rate Limiting with Concurrency

Rate limiting works independently of concurrency:

```elixir
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "api-calls",
  connection: :my_redis,
  processor: &MyApp.ApiCaller.process/1,
  concurrency: 50,      # Can run 50 jobs at once
  limiter: %{
    max: 100,           # But only 100 per minute total
    duration: 60_000
  }
)
```

Even with 50 concurrent slots, only 100 jobs will complete per minute across all workers.

## Sliding Window vs Fixed Window

BullMQ uses a fixed window rate limiter:

```
Fixed Window:
|-------- Window 1 --------|-------- Window 2 --------|
     [100 requests]             [100 requests]

If 100 requests happen at the end of Window 1 and 100 at the
start of Window 2, you could see 200 requests in 1 minute.
```

For most use cases, this is sufficient. For stricter rate limiting, consider using shorter durations:

```elixir
# Stricter: 10 per 6 seconds instead of 100 per minute
limiter: %{max: 10, duration: 6_000}
```

## Multiple Queues with Different Limits

Each queue has its own rate limit:

```elixir
# API calls - 100 per minute
{:ok, api_worker} = BullMQ.Worker.start_link(
  queue: "api-calls",
  connection: :my_redis,
  processor: &process_api/1,
  limiter: %{max: 100, duration: 60_000}
)

# Email sending - 50 per minute
{:ok, email_worker} = BullMQ.Worker.start_link(
  queue: "emails",
  connection: :my_redis,
  processor: &process_email/1,
  limiter: %{max: 50, duration: 60_000}
)

# Internal processing - no limit
{:ok, internal_worker} = BullMQ.Worker.start_link(
  queue: "internal",
  connection: :my_redis,
  processor: &process_internal/1
  # No limiter option = unlimited
)
```

## Example: External API Integration

```elixir
defmodule MyApp.ApiWorker do
  def process(%BullMQ.Job{data: data}) do
    case MyApp.ExternalApi.call(data["endpoint"], data["params"]) do
      {:ok, response} ->
        {:ok, response}

      {:error, :rate_limited} ->
        # The external API rate limited us
        # Job will be retried after backoff
        {:error, "External API rate limited"}

      {:error, reason} ->
        {:error, reason}
    end
  end
end

# Configure worker to stay within external API limits
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "external-api",
  connection: :my_redis,
  processor: &MyApp.ApiWorker.process/1,
  concurrency: 5,
  limiter: %{
    max: 60,          # External API allows 60/minute
    duration: 60_000
  }
)
```

## Monitoring Rate Limits

Use worker callbacks to monitor when rate limiting occurs:

```elixir
{:ok, worker} = BullMQ.Worker.start_link(
  queue: "rate-limited-queue",
  connection: :my_redis,
  processor: &process/1,
  limiter: %{max: 100, duration: 60_000},
  on_error: fn error ->
    Logger.warning("Worker error: #{inspect(error)}")
  end
)
```

Or use QueueEvents to monitor the queue:

```elixir
{:ok, events} = BullMQ.QueueEvents.start_link(
  queue: "rate-limited-queue",
  connection: :my_redis
)

BullMQ.QueueEvents.subscribe(events)

# Monitor events in your process
```

## Best Practices

1. **Set limits below actual capacity** - Leave headroom for bursts
2. **Use shorter windows for stricter control** - `10/6s` instead of `100/60s`
3. **Monitor your limits** - Use telemetry to track when limits are hit
4. **Consider external limits** - Match your rate limit to external API limits
5. **Test your limits** - Ensure your system behaves correctly at capacity

## Next Steps

- Learn about [Workers](workers.md) for processing configuration
- Set up [Telemetry](telemetry.md) to monitor rate limiting
- Configure [Job Options](job_options.md) for retry behavior

## Best Practices

### 1. Match Rate Limits to External APIs

```elixir
# If API allows 1000 req/hour, use slightly less
limiter: %{max: 900, duration: 3_600_000}
```

### 2. Use Shorter Windows for Burst Protection

```elixir
# Instead of 1000/hour, use 17/minute
limiter: %{max: 17, duration: 60_000}
```

### 3. Combine with Backoff

```elixir
# If rate limited by external API, use exponential backoff
BullMQ.Queue.add(queue, "api-call", %{},
  attempts: 5,
  backoff: %{type: :exponential, delay: 5000}
)
```

### 4. Monitor Rate Limit Events

```elixir
:telemetry.attach(
  "rate-limit-monitor",
  [:bullmq, :rate_limit, :hit],
  fn _event, %{delay: delay}, %{queue: queue}, _config ->
    Logger.warning("Rate limit hit on #{queue}, pausing for #{delay}ms")
  end,
  nil
)
```

## Next Steps

- Learn about [Job Flows](flows.md)
- Set up [Telemetry](telemetry.md)
- Explore [Job Schedulers](job_schedulers.md)
