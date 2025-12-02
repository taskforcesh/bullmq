defmodule BullMQ.ConcurrencyVerificationTest do
  use ExUnit.Case, async: false
  alias BullMQ.{Queue, Worker, RedisConnection}

  @redis_opts [host: "localhost", port: 6379]
  @moduletag timeout: 120_000

  test "concurrency 1 with 500ms jobs - should take ~5 seconds for 10 jobs" do
    result = run_concurrency_test(1, 10, 500)
    
    # With concurrency 1: 10 jobs × 500ms = ~5000ms minimum
    assert result.elapsed >= 4500, "Should take at least 4.5s, took #{result.elapsed}ms"
    assert result.elapsed < 7000, "Should take less than 7s, took #{result.elapsed}ms"
    assert result.max_concurrent == 1, "Max concurrent should be 1, was #{result.max_concurrent}"
  end

  test "concurrency 5 with 500ms jobs - should take ~1 second for 10 jobs" do
    result = run_concurrency_test(5, 10, 500)
    
    # With concurrency 5: 10 jobs / 5 concurrent × 500ms = ~1000ms minimum (2 batches)
    assert result.elapsed >= 900, "Should take at least 0.9s, took #{result.elapsed}ms"
    assert result.elapsed < 2000, "Should take less than 2s, took #{result.elapsed}ms"
    assert result.max_concurrent >= 4, "Max concurrent should be ~5, was #{result.max_concurrent}"
  end

  test "concurrency 10 with 500ms jobs - should take ~500ms for 10 jobs" do
    result = run_concurrency_test(10, 10, 500)
    
    # With concurrency 10: all 10 jobs run in parallel = ~500ms minimum
    assert result.elapsed >= 450, "Should take at least 0.45s, took #{result.elapsed}ms"
    assert result.elapsed < 1500, "Should take less than 1.5s, took #{result.elapsed}ms"
    assert result.max_concurrent >= 8, "Max concurrent should be ~10, was #{result.max_concurrent}"
  end

  test "concurrency scaling comparison" do
    IO.puts("\n=== Concurrency Scaling Test (500ms jobs, 10 jobs each) ===")
    
    results = for concurrency <- [1, 2, 5, 10] do
      result = run_concurrency_test(concurrency, 10, 500)
      IO.puts("Concurrency #{concurrency}: #{result.elapsed}ms, max concurrent: #{result.max_concurrent}")
      {concurrency, result}
    end
    
    # Verify scaling is roughly linear
    [{_, r1}, {_, r2}, {_, r5}, {_, r10}] = results
    
    IO.puts("\nExpected vs Actual:")
    IO.puts("  Concurrency 1:  expected ~5000ms, actual #{r1.elapsed}ms")
    IO.puts("  Concurrency 2:  expected ~2500ms, actual #{r2.elapsed}ms")
    IO.puts("  Concurrency 5:  expected ~1000ms, actual #{r5.elapsed}ms")
    IO.puts("  Concurrency 10: expected ~500ms,  actual #{r10.elapsed}ms")
    
    # Concurrency 10 should be ~10x faster than concurrency 1
    speedup = r1.elapsed / r10.elapsed
    IO.puts("\nSpeedup (1 → 10): #{Float.round(speedup, 1)}x (expected ~10x)")
    
    assert speedup > 7, "Speedup should be at least 7x, was #{Float.round(speedup, 1)}x"
  end

  defp run_concurrency_test(concurrency, job_count, job_duration_ms) do
    queue_name = "conc_test_#{concurrency}_#{:erlang.unique_integer([:positive])}"
    conn_name = :"conc_conn_#{:erlang.unique_integer([:positive])}"

    {:ok, _} = RedisConnection.start_link(Keyword.merge(@redis_opts, name: conn_name))
    
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
    
    {:ok, worker} = Worker.start_link(
      queue: queue_name,
      connection: conn_name,
      concurrency: concurrency,
      processor: processor
    )

    # Wait for all jobs to complete
    wait_for_completion(completed, job_count, 30_000)
    
    elapsed = System.monotonic_time(:millisecond) - start_time
    stats = Agent.get(tracker, & &1)
    
    Worker.close(worker)
    Agent.stop(tracker)
    
    # Cleanup
    {:ok, keys} = RedisConnection.command(conn_name, ["KEYS", "bull:#{queue_name}*"])
    if length(keys) > 0, do: RedisConnection.command(conn_name, ["DEL" | keys])
    
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
      count >= target -> :ok
      elapsed > timeout -> :timeout
      true ->
        Process.sleep(10)
        do_wait(counter, target, start, timeout)
    end
  end
end
