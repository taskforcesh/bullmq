#!/usr/bin/env elixir
# Test raw Redis throughput to identify bottlenecks

alias BullMQ.RedisConnection

IO.puts("""

╔═══════════════════════════════════════════════════════════════╗
║           Redis Baseline Throughput Test                      ║
╚═══════════════════════════════════════════════════════════════╝
""")

num_connections = 8
count = 10_000

# Start connections
IO.puts("Starting #{num_connections} Redis connections...")
conns = for i <- 1..num_connections do
  name = :"bench_conn_#{i}"
  {:ok, _} = RedisConnection.start_link(host: "localhost", port: 6379, name: name)
  name
end
IO.puts("Connections ready.\n")

# Test 1: Simple PING throughput (baseline)
IO.puts("=== Test 1: PING throughput (#{num_connections} connections, parallel) ===")
start = System.monotonic_time(:microsecond)

tasks = for conn <- conns do
  Task.async(fn ->
    for _ <- 1..div(count, num_connections) do
      {:ok, "PONG"} = RedisConnection.command(conn, ["PING"])
    end
  end)
end
Task.await_many(tasks, 30_000)

elapsed = System.monotonic_time(:microsecond) - start
ping_rate = count / (elapsed / 1_000_000)
IO.puts("#{count} PINGs in #{Float.round(elapsed/1000, 1)}ms = #{Float.round(ping_rate, 0)} ops/sec\n")

# Test 2: Simple SET throughput
IO.puts("=== Test 2: SET throughput (#{num_connections} connections, parallel) ===")
start = System.monotonic_time(:microsecond)

tasks = for {conn, idx} <- Enum.with_index(conns) do
  Task.async(fn ->
    for i <- 1..div(count, num_connections) do
      {:ok, "OK"} = RedisConnection.command(conn, ["SET", "bench:#{idx}:#{i}", "value"])
    end
  end)
end
Task.await_many(tasks, 30_000)

elapsed = System.monotonic_time(:microsecond) - start
set_rate = count / (elapsed / 1_000_000)
IO.puts("#{count} SETs in #{Float.round(elapsed/1000, 1)}ms = #{Float.round(set_rate, 0)} ops/sec\n")

# Test 3: Pipeline throughput (batched commands)
IO.puts("=== Test 3: SET with PIPELINE (#{num_connections} connections, 100 cmds/pipeline) ===")
pipeline_size = 100
start = System.monotonic_time(:microsecond)

tasks = for {conn, idx} <- Enum.with_index(conns) do
  Task.async(fn ->
    per_conn = div(count, num_connections)
    for batch_start <- 0..div(per_conn, pipeline_size)-1 do
      commands = for i <- 1..pipeline_size do
        ["SET", "bench:pipe:#{idx}:#{batch_start * pipeline_size + i}", "value"]
      end
      {:ok, _} = RedisConnection.pipeline(conn, commands)
    end
  end)
end
Task.await_many(tasks, 30_000)

elapsed = System.monotonic_time(:microsecond) - start
pipeline_rate = count / (elapsed / 1_000_000)
IO.puts("#{count} SETs (pipelined) in #{Float.round(elapsed/1000, 1)}ms = #{Float.round(pipeline_rate, 0)} ops/sec\n")

# Test 4: Simple Lua script
IO.puts("=== Test 4: Simple Lua EVAL throughput (#{num_connections} connections, parallel) ===")
script = "return redis.call('SET', KEYS[1], ARGV[1])"
start = System.monotonic_time(:microsecond)

tasks = for {conn, idx} <- Enum.with_index(conns) do
  Task.async(fn ->
    for i <- 1..div(count, num_connections) do
      {:ok, "OK"} = RedisConnection.command(conn, ["EVAL", script, "1", "bench:lua:#{idx}:#{i}", "value"])
    end
  end)
end
Task.await_many(tasks, 30_000)

elapsed = System.monotonic_time(:microsecond) - start
lua_rate = count / (elapsed / 1_000_000)
IO.puts("#{count} Lua EVALs in #{Float.round(elapsed/1000, 1)}ms = #{Float.round(lua_rate, 0)} ops/sec\n")

# Summary
IO.puts("""
════════════════════════════════════════════════════════════════════
                              SUMMARY
════════════════════════════════════════════════════════════════════

Operation          | Throughput
-------------------|------------------
PING               | #{Float.round(ping_rate, 0)} ops/sec
SET (individual)   | #{Float.round(set_rate, 0)} ops/sec
SET (pipelined)    | #{Float.round(pipeline_rate, 0)} ops/sec
Lua EVAL (simple)  | #{Float.round(lua_rate, 0)} ops/sec
-------------------|------------------
BullMQ job ceiling | ~12,400 jobs/sec

If BullMQ ceiling is significantly lower than Lua EVAL rate,
the bottleneck is in our moveToActive script complexity.
If similar to Lua EVAL rate, Redis is the bottleneck.
""")

# Cleanup
IO.puts("Cleaning up...")
{:ok, keys} = RedisConnection.command(hd(conns), ["KEYS", "bench:*"])
if length(keys) > 0 do
  RedisConnection.command(hd(conns), ["DEL" | keys])
end
Enum.each(conns, &GenServer.stop/1)

IO.puts("Done!")
