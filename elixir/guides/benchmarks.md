# BullMQ Elixir Benchmarks

This document describes the performance benchmarks for BullMQ Elixir and how to reproduce them.

## Test Environment

- **CPU**: Apple M2 Pro
- **Redis**: 7.4.0
- **Elixir**: 1.15+
- **Erlang/OTP**: 26+

## Overview

BullMQ Elixir leverages Erlang's lightweight process model to achieve high throughput job processing. Unlike Node.js which uses a single-threaded event loop, Elixir can utilize true parallelism with multiple workers processing jobs concurrently.

## Benchmark Results

### Single Worker Performance

Testing with a single worker at various concurrency levels (instant/no-op jobs):

| Concurrency | Jobs  | Time  | Throughput |
| ----------- | ----- | ----- | ---------- |
| 100         | 500   | 206ms | 2,427 j/s  |
| 200         | 1,000 | 357ms | 2,801 j/s  |
| 500         | 2,500 | 510ms | 4,901 j/s  |

**Key finding**: A single worker saturates at around ~500 concurrency due to sequential job fetching from Redis.

### Multi-Worker Performance

Testing with multiple workers, each with 500 concurrency:

| Workers | Conc/Worker | Total Conc | Jobs   | Time    | Throughput     |
| ------- | ----------- | ---------- | ------ | ------- | -------------- |
| 1       | 500         | 500        | 2,500  | 608ms   | 4,111 j/s      |
| 5       | 500         | 2,500      | 12,500 | 1,011ms | 12,363 j/s     |
| 10      | 500         | 5,000      | 25,000 | 1,515ms | **16,501 j/s** |

**Key finding**: Multiple workers scale nearly linearly, achieving **16,500+ jobs/second** with 10 workers.

### Scaling Efficiency

| Workers | Throughput | vs Single Worker | Efficiency |
| ------- | ---------- | ---------------- | ---------- |
| 1       | 4,111 j/s  | 1.0x             | 100%       |
| 5       | 12,363 j/s | 3.0x             | 60%        |
| 10      | 16,501 j/s | 4.0x             | 40%        |

The efficiency decrease at higher worker counts is due to Redis becoming the bottleneck - all workers compete for the same queue.

## Architecture

### LockManager

BullMQ Elixir uses a `LockManager` module (similar to Node.js) that maintains a **single timer per worker** for renewing locks on all active jobs, rather than creating individual timers per job. This significantly reduces overhead at high concurrency.

```
Without LockManager:  500 concurrent jobs = 500 timers
With LockManager:     500 concurrent jobs = 1 timer (per worker)
```

### Why Multiple Workers Help

Each worker:

- Has its own Redis connection for parallel job fetching
- Has its own LockManager (1 timer, not N timers)
- Processes jobs independently

This allows bypassing the sequential fetch bottleneck inherent in a single worker.

## Running Benchmarks

### Prerequisites

```bash
# Start Redis
docker run -d --name redis -p 6379:6379 redis:7

# Install dependencies
cd elixir
mix deps.get
```

### Single Worker Benchmark

```bash
mix run -e '
alias BullMQ.{Queue, Worker, RedisConnection}

configs = [
  {100, 500},    # {concurrency, job_count}
  {200, 1000},
  {500, 2500},
]

IO.puts("| Concurrency | Jobs   | Time    | Throughput |")
IO.puts("|-------------|--------|---------|------------|")

for {concurrency, job_count} <- configs do
  conn_name = :"bench_#{:erlang.unique_integer([:positive])}"
  {:ok, _} = RedisConnection.start_link(host: "localhost", port: 6379, name: conn_name)

  queue_name = "bench_#{:erlang.unique_integer([:positive])}"
  completed = :counters.new(1, [])

  processor = fn _job ->
    :counters.add(completed, 1, 1)
    :ok
  end

  jobs = for i <- 1..job_count, do: {"job-#{i}", %{}, []}
  {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn_name)

  start_time = System.monotonic_time(:millisecond)

  {:ok, worker} = Worker.start_link(
    queue: queue_name,
    connection: conn_name,
    concurrency: concurrency,
    processor: processor
  )

  # Wait for completion
  wait = fn wait_fn ->
    Process.sleep(50)
    if :counters.get(completed, 1) < job_count, do: wait_fn.(wait_fn)
  end
  wait.(wait)

  elapsed = System.monotonic_time(:millisecond) - start_time
  throughput = trunc(job_count / elapsed * 1000)

  IO.puts("| #{concurrency} | #{job_count} | #{elapsed}ms | #{throughput} j/s |")

  GenServer.stop(worker)
  {:ok, keys} = RedisConnection.command(conn_name, ["KEYS", "bull:#{queue_name}:*"])
  if length(keys) > 0, do: RedisConnection.command(conn_name, ["DEL" | keys])
end
'
```

### Multi-Worker Benchmark

```bash
mix run -e '
alias BullMQ.{Queue, Worker, RedisConnection}

configs = [
  {1, 500, 2500},      # {workers, concurrency, jobs}
  {5, 500, 12500},
  {10, 500, 25000},
]

IO.puts("| Workers | Conc/W | Total Conc | Jobs   | Time     | Throughput  |")
IO.puts("|---------|--------|------------|--------|----------|-------------|")

for {num_workers, concurrency, job_count} <- configs do
  conn_name = :"bench_#{:erlang.unique_integer([:positive])}"
  {:ok, _} = RedisConnection.start_link(host: "localhost", port: 6379, name: conn_name)

  queue_name = "bench_#{:erlang.unique_integer([:positive])}"
  completed = :counters.new(1, [])

  processor = fn _job ->
    :counters.add(completed, 1, 1)
    :ok
  end

  jobs = for i <- 1..job_count, do: {"job-#{i}", %{}, []}
  {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn_name)

  start_time = System.monotonic_time(:millisecond)

  workers = for _ <- 1..num_workers do
    {:ok, w} = Worker.start_link(
      queue: queue_name,
      connection: conn_name,
      concurrency: concurrency,
      processor: processor
    )
    w
  end

  # Wait for completion
  wait = fn wait_fn ->
    Process.sleep(100)
    if :counters.get(completed, 1) < job_count, do: wait_fn.(wait_fn)
  end
  wait.(wait)

  elapsed = System.monotonic_time(:millisecond) - start_time
  throughput = trunc(job_count / elapsed * 1000)

  IO.puts("| #{num_workers} | #{concurrency} | #{num_workers * concurrency} | #{job_count} | #{elapsed}ms | #{throughput} j/s |")

  Enum.each(workers, &GenServer.stop/1)
  {:ok, keys} = RedisConnection.command(conn_name, ["KEYS", "bull:#{queue_name}:*"])
  if length(keys) > 0, do: RedisConnection.command(conn_name, ["DEL" | keys])
end
'
```

### Realistic Workload Benchmark

For jobs with actual work (e.g., 10ms processing time):

```bash
mix run -e '
alias BullMQ.{Queue, Worker, RedisConnection}

job_duration_ms = 10
job_count = 5000
concurrency = 500

conn_name = :bench_conn
{:ok, _} = RedisConnection.start_link(host: "localhost", port: 6379, name: conn_name)

queue_name = "realistic_bench"
completed = :counters.new(1, [])

processor = fn _job ->
  Process.sleep(job_duration_ms)
  :counters.add(completed, 1, 1)
  :ok
end

jobs = for i <- 1..job_count, do: {"job-#{i}", %{}, []}
{:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn_name)

start_time = System.monotonic_time(:millisecond)

{:ok, worker} = Worker.start_link(
  queue: queue_name,
  connection: conn_name,
  concurrency: concurrency,
  processor: processor
)

# Wait
wait = fn wait_fn ->
  Process.sleep(100)
  if :counters.get(completed, 1) < job_count, do: wait_fn.(wait_fn)
end
wait.(wait)

elapsed = System.monotonic_time(:millisecond) - start_time
throughput = trunc(job_count / elapsed * 1000)

# Theoretical max: job_count / (job_duration_ms / concurrency)
theoretical_max = trunc(concurrency / job_duration_ms * 1000)

IO.puts("Jobs: #{job_count}, Concurrency: #{concurrency}, Job duration: #{job_duration_ms}ms")
IO.puts("Time: #{elapsed}ms, Throughput: #{throughput} j/s")
IO.puts("Theoretical max: #{theoretical_max} j/s, Efficiency: #{trunc(throughput / theoretical_max * 100)}%")

GenServer.stop(worker)
{:ok, keys} = RedisConnection.command(conn_name, ["KEYS", "bull:#{queue_name}:*"])
if length(keys) > 0, do: RedisConnection.command(conn_name, ["DEL" | keys])
'
```

## Optimization Tips

### 1. Use Multiple Workers

For maximum throughput, use multiple workers instead of one worker with very high concurrency:

```elixir
# Good: 10 workers × 500 concurrency = 16,500 j/s
for _ <- 1..10 do
  Worker.start_link(queue: "myqueue", connection: conn, concurrency: 500, processor: &process/1)
end

# Less optimal: 1 worker × 5000 concurrency = ~5,000 j/s
Worker.start_link(queue: "myqueue", connection: conn, concurrency: 5000, processor: &process/1)
```

### 2. Sweet Spot for Concurrency per Worker

Around 200-500 concurrency per worker provides the best balance. Above 500, you hit diminishing returns due to sequential job fetching.

### 3. Job Duration Matters

For instant jobs (no-op), Redis becomes the bottleneck at ~5,000 j/s per worker.
For jobs with actual work, you'll likely be CPU/IO bound before hitting Redis limits.

### 4. Supervision Tree

In production, add workers to your supervision tree:

```elixir
children = [
  {BullMQ.RedisConnection, name: :redis, host: "localhost"},
  # Multiple workers for the same queue
  Supervisor.child_spec(
    {BullMQ.Worker, queue: "jobs", connection: :redis, concurrency: 500, processor: &MyApp.process/1},
    id: :worker_1
  ),
  Supervisor.child_spec(
    {BullMQ.Worker, queue: "jobs", connection: :redis, concurrency: 500, processor: &MyApp.process/1},
    id: :worker_2
  ),
  # ... more workers
]

Supervisor.start_link(children, strategy: :one_for_one)
```

## Test Environment

Benchmarks were run on:

- **Hardware**: MacBook Pro (Apple Silicon)
- **Redis**: 7.x running in Docker
- **Elixir**: 1.18.x
- **Erlang/OTP**: 27.x

Results may vary based on:

- Network latency to Redis
- CPU cores available
- Redis configuration
- Job complexity

## Bulk Job Addition Performance

BullMQ Elixir's `add_bulk/3` function uses Redis MULTI/EXEC transactions for atomicity and parallel processing to achieve high job addition rates. Each batch of jobs is added atomically (all or nothing).

### Benchmark Results

Testing with 100,000 jobs:

| Method     | Connections | Throughput     | Speedup   |
| ---------- | ----------- | -------------- | --------- |
| Sequential | 1           | 5,700 j/s      | 1.0x      |
| Atomic     | 1           | 24,000 j/s     | 4.2x      |
| Atomic     | 2           | 39,000 j/s     | 6.8x      |
| Atomic     | 4           | 54,000 j/s     | 9.5x      |
| **Atomic** | **8**       | **58,000 j/s** | **10.2x** |
| Atomic     | 16          | 56,000 j/s     | 9.8x      |

**Key findings:**

1. **Transactions give 4x speedup** - Batching Redis commands into atomic MULTI/EXEC transactions
2. **Atomic guarantees** - Each batch of jobs is added atomically (all or nothing)
3. **Saturation at 4-8 connections** - Beyond 8 connections, throughput plateaus
4. **Default settings are optimal** - `atomic: true` and `max_pipeline_size: 10_000` hit peak performance

### How It Works

```
Sequential (5,700 j/s):
  Job1 → Redis → Response → Job2 → Redis → Response → ...

Atomic (24,000 j/s):
  MULTI → [Job1, Job2, ..., JobN] → EXEC → [Response1, ..., ResponseN]
  (all jobs in batch added atomically)

Parallel Atomic (58,000 j/s):
  Conn1: MULTI [Jobs batch 1] EXEC   → Redis →
  Conn2: MULTI [Jobs batch 2] EXEC   → Redis →  All in parallel
  Conn3: MULTI [Jobs batch 3] EXEC   → Redis →
  ...
  (each connection's batch is atomic)
```

### Using Connection Pools

For maximum performance when adding large batches:

```elixir
# Create a connection pool
pool = for i <- 1..8 do
  name = :"redis_pool_#{i}"
  {:ok, _} = BullMQ.RedisConnection.start_link(name: name, host: "localhost")
  name
end

# Add jobs with parallel processing
# Each batch is added atomically (default: atomic: true)
jobs = for i <- 1..100_000, do: {"job", %{index: i}, []}

{:ok, added} = BullMQ.Queue.add_bulk("my-queue", jobs,
  connection: :redis,
  connection_pool: pool
)
```

### Options Reference

| Option              | Default  | Description                                                                                                       |
| ------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `pipeline`          | `true`   | Use pipelining for efficiency                                                                                     |
| `atomic`            | `true`   | Wrap batches in MULTI/EXEC transactions. With `connection_pool`, each connection's batch is atomic independently. |
| `connection_pool`   | `nil`    | List of connections for parallel processing                                                                       |
| `max_pipeline_size` | `10_000` | Maximum jobs per pipeline batch                                                                                   |

### Running the Benchmark

```bash
cd elixir
mix run benchmark/add_job_benchmark.exs
```

## Comparison Notes

These benchmarks measure raw throughput with no-op jobs to establish baseline performance. Real-world throughput will depend on:

1. **Job processing time** - The actual work done in each job
2. **Redis latency** - Network distance to Redis server
3. **Job data size** - Larger payloads take longer to serialize/deserialize
4. **Dependencies** - External API calls, database queries, etc.

For I/O-bound workloads, Elixir's lightweight processes shine, allowing thousands of concurrent jobs waiting on external resources without blocking others.
