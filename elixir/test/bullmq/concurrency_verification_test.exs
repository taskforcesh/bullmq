defmodule BullMQ.ConcurrencyVerificationTest do
  use ExUnit.Case, async: false
  alias BullMQ.{Queue, Worker, RedisConnection}

  @redis_opts [host: "localhost", port: 6379]
  @moduletag timeout: 60_000

  # Using 100ms jobs instead of 500ms - still validates concurrency, 5x faster
  @job_duration 100

  test "concurrency 1 with 100ms jobs - should take ~1 second for 10 jobs" do
    result = run_concurrency_test(1, 10, @job_duration)

    # With concurrency 1: 10 jobs × 100ms = ~1000ms minimum
    assert result.elapsed >= 900, "Should take at least 0.9s, took #{result.elapsed}ms"
    assert result.elapsed < 2000, "Should take less than 2s, took #{result.elapsed}ms"
    assert result.max_concurrent == 1, "Max concurrent should be 1, was #{result.max_concurrent}"
  end

  test "concurrency 5 with 100ms jobs - should take ~200ms for 10 jobs" do
    result = run_concurrency_test(5, 10, @job_duration)

    # With concurrency 5: 10 jobs / 5 concurrent × 100ms = ~200ms minimum (2 batches)
    assert result.elapsed >= 180, "Should take at least 0.18s, took #{result.elapsed}ms"
    assert result.elapsed < 500, "Should take less than 0.5s, took #{result.elapsed}ms"
    assert result.max_concurrent >= 4, "Max concurrent should be ~5, was #{result.max_concurrent}"
  end

  test "concurrency 10 with 100ms jobs - should take ~100ms for 10 jobs" do
    result = run_concurrency_test(10, 10, @job_duration)

    # With concurrency 10: all 10 jobs run in parallel = ~100ms minimum
    assert result.elapsed >= 90, "Should take at least 0.09s, took #{result.elapsed}ms"
    assert result.elapsed < 400, "Should take less than 0.4s, took #{result.elapsed}ms"
    assert result.max_concurrent >= 8, "Max concurrent should be ~10, was #{result.max_concurrent}"
  end

  test "concurrency scaling comparison" do
    IO.puts("\n=== Concurrency Scaling Test (#{@job_duration}ms jobs, 10 jobs each) ===")

    results =
      for concurrency <- [1, 2, 5, 10] do
        result = run_concurrency_test(concurrency, 10, @job_duration)

        IO.puts(
          "Concurrency #{concurrency}: #{result.elapsed}ms, max concurrent: #{result.max_concurrent}"
        )

        {concurrency, result}
      end

    # Verify scaling is roughly linear
    [{_, r1}, {_, r2}, {_, r5}, {_, r10}] = results

    IO.puts("\nExpected vs Actual:")
    IO.puts("  Concurrency 1:  expected ~#{10 * @job_duration}ms, actual #{r1.elapsed}ms")
    IO.puts("  Concurrency 2:  expected ~#{5 * @job_duration}ms, actual #{r2.elapsed}ms")
    IO.puts("  Concurrency 5:  expected ~#{2 * @job_duration}ms, actual #{r5.elapsed}ms")
    IO.puts("  Concurrency 10: expected ~#{@job_duration}ms,  actual #{r10.elapsed}ms")

    # Concurrency 10 should be ~10x faster than concurrency 1
    speedup = r1.elapsed / r10.elapsed
    IO.puts("\nSpeedup (1 → 10): #{Float.round(speedup, 1)}x (expected ~10x)")

    assert speedup > 7, "Speedup should be at least 7x, was #{Float.round(speedup, 1)}x"
  end

  defp run_concurrency_test(concurrency, job_count, job_duration_ms) do
    queue_name = "conc_test_#{concurrency}_#{:erlang.unique_integer([:positive])}"
    conn_name = :"conc_conn_#{:erlang.unique_integer([:positive])}"

    {:ok, pool_pid} = RedisConnection.start_link(Keyword.merge(@redis_opts, name: conn_name))

    Process.unlink(pool_pid)

    # Track concurrent executions
    {:ok, tracker} = Agent.start_link(fn -> %{current: 0, max: 0} end)
    completed = :counters.new(1, [])

    processor = fn _job ->
      # Increment current count
      Agent.update(tracker, fn state ->
        new_current = state.current + 1
        %{state | current: new_current, max: max(state.max, new_current)}
      end)

      # Do "work"
      Process.sleep(job_duration_ms)

      # Decrement current count
      Agent.update(tracker, fn state ->
        %{state | current: state.current - 1}
      end)

      :counters.add(completed, 1, 1)
      :ok
    end

    # Add all jobs FIRST
    jobs = for i <- 1..job_count, do: {"job", %{"i" => i}, []}
    {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn_name)

    # Start timing when worker starts
    start_time = System.monotonic_time(:millisecond)

    {:ok, worker} =
      Worker.start_link(
        queue: queue_name,
        connection: conn_name,
        concurrency: concurrency,
        processor: processor
      )

    # Wait for all jobs to complete
    wait_for_completion(completed, job_count, 30_000)

    elapsed = System.monotonic_time(:millisecond) - start_time
    stats = Agent.get(tracker, & &1)

    # Cleanup Redis keys BEFORE closing worker (connection still alive)
    {:ok, keys} = RedisConnection.command(conn_name, ["KEYS", "bull:#{queue_name}*"])
    if length(keys) > 0, do: RedisConnection.command(conn_name, ["DEL" | keys])

    Worker.close(worker, timeout: 5000)
    Agent.stop(tracker)

    # Close the Redis connection pool (waits for scripts to load)
    RedisConnection.close(conn_name)

    %{elapsed: elapsed, max_concurrent: stats.max}
  end

  defp wait_for_completion(counter, target, timeout) do
    start = System.monotonic_time(:millisecond)
    do_wait(counter, target, start, timeout)
  end

  defp do_wait(counter, target, start, timeout) do
    count = :counters.get(counter, 1)
    elapsed = System.monotonic_time(:millisecond) - start

    cond do
      count >= target ->
        :ok

      elapsed > timeout ->
        :timeout

      true ->
        Process.sleep(10)
        do_wait(counter, target, start, timeout)
    end
  end
end
