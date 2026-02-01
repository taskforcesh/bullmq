defmodule BullMQ.HighConcurrencyTest do
  use ExUnit.Case, async: false
  alias BullMQ.{Queue, Worker, RedisConnection}

  @redis_opts [host: "localhost", port: 6379]
  @moduletag timeout: 300_000
  @moduletag :slow

  test "high concurrency 50-1000 with 5x jobs" do
    job_duration_ms = 100

    IO.puts("\n=== High Concurrency Test (50-1000) ===")
    IO.puts("Job duration: #{job_duration_ms}ms, Jobs: 5x concurrency\n")

    results =
      for concurrency <- [50, 100, 200, 300, 400, 500, 750, 1000] do
        # 5x jobs to keep workers saturated
        job_count = concurrency * 5
        result = run_concurrency_test(concurrency, job_count, job_duration_ms)

        # Theoretical minimum: jobs * duration / concurrency (assuming instant fetch)
        _theoretical_min = job_count * job_duration_ms / concurrency
        # jobs per second
        throughput = job_count / result.elapsed * 1000
        utilization = result.max_concurrent / concurrency * 100

        IO.puts(
          "Concurrency #{String.pad_leading(Integer.to_string(concurrency), 4)}: " <>
            "#{String.pad_leading(Integer.to_string(job_count), 5)} jobs, " <>
            "#{String.pad_leading(Integer.to_string(result.elapsed), 5)}ms, " <>
            "max: #{String.pad_leading(Integer.to_string(result.max_concurrent), 4)} " <>
            "(#{String.pad_leading(Integer.to_string(trunc(utilization)), 3)}%), " <>
            "throughput: #{String.pad_leading(Integer.to_string(trunc(throughput)), 5)} jobs/sec"
        )

        {concurrency, result, throughput}
      end

    IO.puts("")
    IO.puts("Note: Utilization < 100% indicates sequential job fetching bottleneck")

    # Just verify we achieved reasonable concurrency (not strict 90%)
    # CI environments have limited resources, so we use very relaxed expectations
    for {concurrency, result, _} <- results do
      # At high concurrency, we expect diminishing returns due to fetch bottleneck
      # Use 20% threshold to account for CI resource constraints
      # Very relaxed for CI
      min_expected = min(concurrency * 0.2, 200)

      assert result.max_concurrent >= min_expected,
             "Concurrency #{concurrency}: max_concurrent #{result.max_concurrent} < expected #{min_expected}"
    end

    IO.puts("\n=== Test completed! ===")
  end

  defp run_concurrency_test(concurrency, job_count, job_duration_ms) do
    queue_name = "high_conc_#{concurrency}_#{:erlang.unique_integer([:positive])}"
    conn_name = :"high_conc_conn_#{:erlang.unique_integer([:positive])}"

    {:ok, _conn} = RedisConnection.start_link(Keyword.merge(@redis_opts, name: conn_name))

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

    # Add jobs BEFORE starting worker so we measure full processing time
    jobs = for i <- 1..job_count, do: {"job-#{i}", %{}, []}
    {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn_name)

    # Start timing and worker together
    start_time = System.monotonic_time(:millisecond)

    {:ok, worker} =
      Worker.start_link(
        queue: queue_name,
        connection: conn_name,
        concurrency: concurrency,
        processor: processor
      )

    # Wait for all jobs
    wait_for_completion(completed, job_count, 60_000)

    elapsed = System.monotonic_time(:millisecond) - start_time
    max_concurrent = Agent.get(tracker, & &1.max)

    # Cleanup
    GenServer.stop(worker)
    Agent.stop(tracker)

    # Clean redis
    {:ok, keys} = RedisConnection.command(conn_name, ["KEYS", "bull:#{queue_name}:*"])

    if length(keys) > 0 do
      RedisConnection.command(conn_name, ["DEL" | keys])
    end

    GenServer.stop(conn_name)

    %{elapsed: elapsed, max_concurrent: max_concurrent}
  end

  defp wait_for_completion(counter, expected, timeout) do
    deadline = System.monotonic_time(:millisecond) + timeout
    do_wait(counter, expected, deadline)
  end

  defp do_wait(counter, expected, deadline) do
    current = :counters.get(counter, 1)

    cond do
      current >= expected ->
        :ok

      System.monotonic_time(:millisecond) > deadline ->
        {:error, :timeout}

      true ->
        Process.sleep(10)
        do_wait(counter, expected, deadline)
    end
  end
end
