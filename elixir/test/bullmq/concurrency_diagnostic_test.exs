defmodule BullMQ.ConcurrencyDiagnosticTest do
  use ExUnit.Case, async: false
  alias BullMQ.{Worker, Queue, RedisConnection}

  @moduletag timeout: 120_000
  @moduletag :slow
  @redis_opts [host: "localhost", port: 6379]

  setup do
    queue_name = "concurrency_diag_#{:erlang.unique_integer([:positive])}"
    conn_name = :"diag_conn_#{:erlang.unique_integer([:positive])}"

    {:ok, _pid} = RedisConnection.start_link(Keyword.merge(@redis_opts, name: conn_name))

    on_exit(fn ->
      try do
        {:ok, keys} = RedisConnection.command(conn_name, ["KEYS", "bull:#{queue_name}*"])
        if length(keys) > 0, do: RedisConnection.command(conn_name, ["DEL" | keys])
      rescue
        _ -> :ok
      catch
        :exit, _ -> :ok
      end
    end)

    {:ok, %{queue_name: queue_name, conn: conn_name}}
  end

  test "verify concurrency with slow jobs", %{queue_name: queue_name, conn: conn} do
    # Use an Agent to track concurrent executions
    {:ok, tracker} =
      Agent.start_link(fn ->
        %{
          current_concurrent: 0,
          max_concurrent: 0,
          job_starts: []
        }
      end)

    # Processor that tracks when it starts/ends
    processor = fn _job ->
      # Record start
      Agent.update(tracker, fn state ->
        new_concurrent = state.current_concurrent + 1

        %{
          state
          | current_concurrent: new_concurrent,
            max_concurrent: max(state.max_concurrent, new_concurrent),
            job_starts: [System.monotonic_time(:millisecond) | state.job_starts]
        }
      end)

      # Simulate slow work
      Process.sleep(100)

      # Record end
      Agent.update(tracker, fn state ->
        %{state | current_concurrent: state.current_concurrent - 1}
      end)

      :ok
    end

    concurrency = 10

    {:ok, worker} =
      Worker.start_link(
        queue: queue_name,
        connection: conn,
        concurrency: concurrency,
        processor: processor
      )

    # Add 20 jobs
    jobs =
      for i <- 1..20 do
        {"job", %{"i" => i}, []}
      end

    {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn)

    # Wait for all jobs to complete
    Process.sleep(1000)

    stats = Agent.get(tracker, & &1)

    IO.puts("\n=== Concurrency Diagnostic ===")
    IO.puts("Configured concurrency: #{concurrency}")
    IO.puts("Max concurrent observed: #{stats.max_concurrent}")
    IO.puts("Total jobs processed: #{length(stats.job_starts)}")

    # Check the timing of job starts
    job_starts = stats.job_starts |> Enum.reverse()

    if length(job_starts) >= concurrency do
      first_starts = job_starts |> Enum.take(concurrency)
      time_spread = Enum.max(first_starts) - Enum.min(first_starts)
      IO.puts("Time spread for first #{concurrency} jobs: #{time_spread}ms")
      IO.puts("(< 50ms indicates parallel start)")
    end

    # Cleanup
    Agent.stop(tracker)
    Worker.close(worker)

    # Assertions
    assert stats.max_concurrent > 1,
           "Jobs should run in parallel, but max_concurrent was #{stats.max_concurrent}"

    assert stats.max_concurrent <= concurrency, "Should not exceed concurrency limit"

    IO.puts("=== Test Passed ===\n")
  end

  test "compare throughput with different concurrency levels", %{queue_name: queue_name, conn: conn} do
    # Simple fast processor
    processed = :counters.new(1, [])

    processor = fn _job ->
      :counters.add(processed, 1, 1)
      :ok
    end

    results =
      for concurrency <- [1, 5, 10, 20] do
        :counters.put(processed, 1, 0)

        {:ok, worker} =
          Worker.start_link(
            queue: queue_name,
            connection: conn,
            concurrency: concurrency,
            processor: processor
          )

        # Add 100 jobs
        jobs = for i <- 1..100, do: {"job", %{"i" => i}, []}
        {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn)

        # Wait for completion
        start_time = System.monotonic_time(:millisecond)

        # Wait until all processed or timeout
        wait_until = fn wait_until ->
          count = :counters.get(processed, 1)
          elapsed = System.monotonic_time(:millisecond) - start_time

          if count >= 100 or elapsed > 10000 do
            {count, elapsed}
          else
            Process.sleep(10)
            wait_until.(wait_until)
          end
        end

        {count, elapsed} = wait_until.(wait_until)

        throughput = if elapsed > 0, do: Float.round(count / (elapsed / 1000), 1), else: 0

        IO.puts(
          "Concurrency #{concurrency}: #{count} jobs in #{elapsed}ms = #{throughput} jobs/sec"
        )

        Worker.close(worker)

        # Small pause between tests
        Process.sleep(200)

        {concurrency, throughput}
      end

    IO.puts("\n=== Results Summary ===")

    for {c, t} <- results do
      IO.puts("Concurrency #{c}: #{t} jobs/sec")
    end

    # We expect throughput to increase with concurrency (for fast jobs)
    # But the key is to see if there's ANY difference
    throughputs = Enum.map(results, fn {_, t} -> t end)
    max_throughput = Enum.max(throughputs)
    min_throughput = Enum.min(throughputs)

    IO.puts(
      "\nVariation: #{Float.round((max_throughput - min_throughput) / min_throughput * 100, 1)}%"
    )

    IO.puts("=========================\n")
  end
end
