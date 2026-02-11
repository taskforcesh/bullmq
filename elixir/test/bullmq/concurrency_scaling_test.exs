defmodule BullMQ.ConcurrencyScalingTest do
  use ExUnit.Case, async: false
  alias BullMQ.{Queue, Worker, RedisConnection}

  @redis_opts [host: "localhost", port: 6379]
  @moduletag timeout: 300_000
  @moduletag :slow

  test "concurrency scaling from 5 to 100" do
    # Reduced job count and duration for faster testing
    job_count = 50
    job_duration_ms = 100

    IO.puts("\n=== Concurrency Scaling Test ===")
    IO.puts("Job duration: #{job_duration_ms}ms, Jobs per test: #{job_count}")
    IO.puts("")

    results =
      for concurrency <- [5, 10, 20, 50, 100] do
        result = run_concurrency_test(concurrency, job_count, job_duration_ms)

        # jobs × duration / concurrency
        expected_time = job_count * job_duration_ms / concurrency
        efficiency = expected_time / result.elapsed * 100

        IO.puts(
          "Concurrency #{String.pad_leading(Integer.to_string(concurrency), 3)}: " <>
            "#{String.pad_leading(Integer.to_string(result.elapsed), 6)}ms, " <>
            "max concurrent: #{String.pad_leading(Integer.to_string(result.max_concurrent), 3)}, " <>
            "efficiency: #{Float.round(efficiency, 1)}%"
        )

        {concurrency, result, efficiency}
      end

    IO.puts("")
    IO.puts("Expected times (ideal):")
    IO.puts("  Concurrency 5:   #{job_count * job_duration_ms / 5}ms")
    IO.puts("  Concurrency 10:  #{job_count * job_duration_ms / 10}ms")
    IO.puts("  Concurrency 20:  #{job_count * job_duration_ms / 20}ms")
    IO.puts("  Concurrency 50:  #{job_count * job_duration_ms / 50}ms")

    IO.puts(
      "  Concurrency 100: #{trunc(job_count * job_duration_ms / 100)}ms (capped by job count)"
    )

    # Verify all tests achieved reasonable max concurrent
    for {concurrency, result, _} <- results do
      # Allow 20% variance
      min_expected = min(concurrency, job_count) * 0.8

      assert result.max_concurrent >= min_expected,
             "Concurrency #{concurrency}: max_concurrent #{result.max_concurrent} < expected #{min_expected}"
    end

    IO.puts("\n=== All tests passed! ===")
  end

  defp run_concurrency_test(concurrency, job_count, job_duration_ms) do
    queue_name = "scale_test_#{concurrency}_#{:erlang.unique_integer([:positive])}"
    conn_name = :"scale_conn_#{:erlang.unique_integer([:positive])}"

    {:ok, _} = RedisConnection.start_link(Keyword.merge(@redis_opts, name: conn_name))

    # Track concurrent executions
    {:ok, tracker} = Agent.start_link(fn -> %{current: 0, max: 0} end)
    completed = :counters.new(1, [])

    processor = fn _job ->
      Agent.update(tracker, fn state ->
        new_current = state.current + 1
        %{state | current: new_current, max: max(state.max, new_current)}
      end)

      Process.sleep(job_duration_ms)

      Agent.update(tracker, fn state ->
        %{state | current: state.current - 1}
      end)

      :counters.add(completed, 1, 1)
      :ok
    end

    # Add all jobs FIRST
    jobs = for i <- 1..job_count, do: {"job", %{"i" => i}, []}
    {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn_name)

    start_time = System.monotonic_time(:millisecond)

    {:ok, worker} =
      Worker.start_link(
        queue: queue_name,
        connection: conn_name,
        concurrency: concurrency,
        processor: processor
      )

    wait_for_completion(completed, job_count, 120_000)

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
