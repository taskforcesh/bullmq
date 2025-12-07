#!/usr/bin/env elixir
# Benchmark for job addition: Finding saturation point

alias BullMQ.{Queue, RedisConnection}

IO.puts("""

╔═══════════════════════════════════════════════════════════════╗
║      Job Addition Benchmark: Concurrency Saturation Test       ║
╚═══════════════════════════════════════════════════════════════╝
""")

# Configuration
batch_size = 100_000
chunk_size = 100
pool_sizes = [1, 2, 4, 8, 16, 32, 64]

# Setup main connection
IO.puts("Setting up connections...")
main_conn = :bench_main_conn
{:ok, _} = RedisConnection.start_link(host: "localhost", port: 6379, name: main_conn)

# Create max pool size connections
max_pool = 64
all_conns = for i <- 1..max_pool do
  name = :"bench_pool_conn_#{i}"
  {:ok, _} = RedisConnection.start_link(host: "localhost", port: 6379, name: name)
  name
end

IO.puts("Testing with #{batch_size} jobs, chunk_size=#{chunk_size}\n")

# Helper to cleanup
cleanup = fn queue_name ->
  case RedisConnection.command(main_conn, ["KEYS", "bull:#{queue_name}*"]) do
    {:ok, [_ | _] = keys} -> RedisConnection.command(main_conn, ["DEL" | keys])
    _ -> :ok
  end
end

# Prepare jobs
jobs = for i <- 1..batch_size, do: {"test_job", %{index: i}, []}

# Sequential baseline
queue_name = "bench_seq_#{:erlang.unique_integer([:positive])}"
cleanup.(queue_name)
IO.write("Sequential baseline... ")
start = System.monotonic_time(:microsecond)
{:ok, _} = Queue.add_bulk(queue_name, jobs, connection: main_conn, pipeline: false)
seq_time = System.monotonic_time(:microsecond) - start
seq_rate = batch_size / (seq_time / 1_000_000)
IO.puts("#{Float.round(seq_rate, 0)} j/s")
cleanup.(queue_name)

IO.puts("\nConcurrency scaling test:\n")

results = Enum.map(pool_sizes, fn pool_size ->
  # Take subset of connections
  conn_pool = Enum.take(all_conns, pool_size)

  queue_name = "bench_pool#{pool_size}_#{:erlang.unique_integer([:positive])}"
  cleanup.(queue_name)

  IO.write("  #{String.pad_leading("#{pool_size}", 2)} connections... ")
  start = System.monotonic_time(:microsecond)
  {:ok, _} = Queue.add_bulk(queue_name, jobs,
    connection: main_conn,
    connection_pool: conn_pool,
    chunk_size: chunk_size
  )
  time = System.monotonic_time(:microsecond) - start
  rate = batch_size / (time / 1_000_000)
  speedup = rate / seq_rate

  IO.puts("#{String.pad_leading("#{Float.round(time/1000, 0)}", 6)}ms | #{String.pad_leading("#{Float.round(rate, 0)}", 6)} j/s | #{Float.round(speedup, 1)}x")
  cleanup.(queue_name)

  {pool_size, rate, time, speedup}
end)

# Find best and saturation point
{best_pool, best_rate, _, _} = Enum.max_by(results, fn {_, rate, _, _} -> rate end)

# Find where we get diminishing returns (< 10% improvement)
saturation = results
|> Enum.chunk_every(2, 1, :discard)
|> Enum.find(fn [{_, rate1, _, _}, {_, rate2, _, _}] ->
  improvement = (rate2 - rate1) / rate1
  improvement < 0.10
end)

saturation_point = case saturation do
  [{pool1, _, _, _}, _] -> pool1
  nil -> best_pool
end

IO.puts("""

════════════════════════════════════════════════════════════════════
                              RESULTS
════════════════════════════════════════════════════════════════════

┌─────────────┬──────────────┬──────────────┬─────────────┐
│ Connections │  Time (ms)   │ Throughput   │   Speedup   │
├─────────────┼──────────────┼──────────────┼─────────────┤
│ Sequential  │ #{String.pad_leading("#{Float.round(seq_time/1000, 0)}", 12)} │ #{String.pad_leading("#{Float.round(seq_rate, 0)}", 10)} │       1.0x  │
""")

for {pool_size, rate, time, speedup} <- results do
  marker = cond do
    pool_size == best_pool -> " ◀ BEST"
    pool_size == saturation_point -> " ◀ SATURATES"
    true -> ""
  end
  IO.puts("│ #{String.pad_leading("#{pool_size}", 11)} │ #{String.pad_leading("#{Float.round(time/1000, 0)}", 12)} │ #{String.pad_leading("#{Float.round(rate, 0)}", 10)} │ #{String.pad_leading("#{Float.round(speedup, 1)}x", 11)} │#{marker}")
end

IO.puts("""
└─────────────┴──────────────┴──────────────┴─────────────┘

Peak: #{best_pool} connections at #{Float.round(best_rate, 0)} jobs/sec
Saturation begins around: #{saturation_point} connections

""")

# Cleanup
Enum.each([main_conn | all_conns], fn conn ->
  try do
    GenServer.stop(conn)
  catch
    :exit, _ -> :ok
  end
end)

IO.puts("Done!")
