defmodule BullMQ.RedisBaselineTest do
  use ExUnit.Case, async: false
  alias BullMQ.RedisConnection

  @redis_opts [host: "localhost", port: 6379]

  test "raw Redix throughput (direct, no pool)" do
    {:ok, conn} = Redix.start_link(@redis_opts)

    # Warm up
    for _ <- 1..100, do: Redix.command!(conn, ["PING"])

    iterations = 5000
    start = System.monotonic_time(:microsecond)

    for _ <- 1..iterations do
      Redix.command!(conn, ["PING"])
    end

    elapsed = System.monotonic_time(:microsecond) - start

    IO.puts("\n=== Raw Redix (direct connection) ===")
    IO.puts("#{iterations} PING: #{Float.round(elapsed / 1000, 1)}ms")
    IO.puts("Throughput: #{Float.round(iterations * 1_000_000 / elapsed, 0)} ops/sec")
    IO.puts("Avg latency: #{Float.round(elapsed / iterations, 1)}μs")

    Redix.stop(conn)
  end

  test "RedisConnection pool throughput" do
    conn_name = :"baseline_conn_#{:erlang.unique_integer([:positive])}"
    {:ok, pool_pid} = RedisConnection.start_link(Keyword.merge(@redis_opts, name: conn_name))

    Process.unlink(pool_pid)

    # Warm up
    for _ <- 1..100, do: RedisConnection.command(conn_name, ["PING"])

    iterations = 5000
    start = System.monotonic_time(:microsecond)

    for _ <- 1..iterations do
      {:ok, _} = RedisConnection.command(conn_name, ["PING"])
    end

    elapsed = System.monotonic_time(:microsecond) - start

    IO.puts("\n=== RedisConnection (pool) ===")
    IO.puts("#{iterations} PING: #{Float.round(elapsed / 1000, 1)}ms")
    IO.puts("Throughput: #{Float.round(iterations * 1_000_000 / elapsed, 0)} ops/sec")
    IO.puts("Avg latency: #{Float.round(elapsed / iterations, 1)}μs")

    RedisConnection.close(conn_name)
  end

  test "Lua script execution throughput" do
    {:ok, conn} = Redix.start_link(@redis_opts)

    # Simple Lua script similar to what moveToActive does
    script = "return redis.call('GET', KEYS[1])"

    # Warm up
    for _ <- 1..100, do: Redix.command!(conn, ["EVAL", script, 1, "test:key"])

    iterations = 5000
    start = System.monotonic_time(:microsecond)

    for _ <- 1..iterations do
      Redix.command!(conn, ["EVAL", script, 1, "test:key"])
    end

    elapsed = System.monotonic_time(:microsecond) - start

    IO.puts("\n=== Lua Script Execution ===")
    IO.puts("#{iterations} EVAL: #{Float.round(elapsed / 1000, 1)}ms")
    IO.puts("Throughput: #{Float.round(iterations * 1_000_000 / elapsed, 0)} ops/sec")
    IO.puts("Avg latency: #{Float.round(elapsed / iterations, 1)}μs")

    Redix.stop(conn)
  end
end
