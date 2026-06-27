defmodule BullMQ.MultiWorkerTest do
  @moduledoc """
  Test comparing single high-concurrency worker vs multiple workers.

  Hypothesis: Multiple workers can fetch jobs in parallel (using different
  connections from the pool), achieving higher throughput than a single
  worker that fetches sequentially.
  """
  use ExUnit.Case, async: false
  alias BullMQ.{Queue, Worker, RedisConnection}

  @redis_opts [host: "localhost", port: 6379]
  @moduletag timeout: 300_000
  @moduletag :slow

  test "multiple workers vs single worker at high concurrency" do
    job_duration_ms = 100
    total_concurrency = 500
    # 2500 jobs
    job_count = total_concurrency * 5

    IO.puts("\n=== Multiple Workers vs Single Worker ===")

    IO.puts(
      "Total concurrency: #{total_concurrency}, Jobs: #{job_count}, Duration: #{job_duration_ms}ms\n"
    )

    # Test 1: Single worker with concurrency 500
    result_single = run_single_worker_test(total_concurrency, job_count, job_duration_ms)
    IO.puts("Single worker (concurrency #{total_concurrency}):")
    IO.puts("  Time: #{result_single.elapsed}ms, Max concurrent: #{result_single.max_concurrent}")
    IO.puts("  Throughput: #{trunc(job_count / result_single.elapsed * 1000)} jobs/sec")

    # Test 2: 2 workers with concurrency 250 each
    result_2_workers =
      run_multi_worker_test(2, div(total_concurrency, 2), job_count, job_duration_ms)

    IO.puts("\n2 workers (concurrency #{div(total_concurrency, 2)} each):")

    IO.puts(
      "  Time: #{result_2_workers.elapsed}ms, Max concurrent: #{result_2_workers.max_concurrent}"
    )

    IO.puts("  Throughput: #{trunc(job_count / result_2_workers.elapsed * 1000)} jobs/sec")

    # Test 3: 5 workers with concurrency 100 each
    result_5_workers =
      run_multi_worker_test(5, div(total_concurrency, 5), job_count, job_duration_ms)

    IO.puts("\n5 workers (concurrency #{div(total_concurrency, 5)} each):")

    IO.puts(
      "  Time: #{result_5_workers.elapsed}ms, Max concurrent: #{result_5_workers.max_concurrent}"
    )

    IO.puts("  Throughput: #{trunc(job_count / result_5_workers.elapsed * 1000)} jobs/sec")

    # Test 4: 10 workers with concurrency 50 each
    result_10_workers =
      run_multi_worker_test(10, div(total_concurrency, 10), job_count, job_duration_ms)

    IO.puts("\n10 workers (concurrency #{div(total_concurrency, 10)} each):")

    IO.puts(
      "  Time: #{result_10_workers.elapsed}ms, Max concurrent: #{result_10_workers.max_concurrent}"
    )

    IO.puts("  Throughput: #{trunc(job_count / result_10_workers.elapsed * 1000)} jobs/sec")

    IO.puts("\n=== Summary ===")
    IO.puts("Config                    | Time    | Max Conc | Throughput")
    IO.puts("--------------------------|---------|----------|------------")

    IO.puts(
      "1 worker × 500 conc       | #{String.pad_leading(Integer.to_string(result_single.elapsed), 5)}ms | #{String.pad_leading(Integer.to_string(result_single.max_concurrent), 8)} | #{String.pad_leading(Integer.to_string(trunc(job_count / result_single.elapsed * 1000)), 6)} j/s"
    )

    IO.puts(
      "2 workers × 250 conc      | #{String.pad_leading(Integer.to_string(result_2_workers.elapsed), 5)}ms | #{String.pad_leading(Integer.to_string(result_2_workers.max_concurrent), 8)} | #{String.pad_leading(Integer.to_string(trunc(job_count / result_2_workers.elapsed * 1000)), 6)} j/s"
    )

    IO.puts(
      "5 workers × 100 conc      | #{String.pad_leading(Integer.to_string(result_5_workers.elapsed), 5)}ms | #{String.pad_leading(Integer.to_string(result_5_workers.max_concurrent), 8)} | #{String.pad_leading(Integer.to_string(trunc(job_count / result_5_workers.elapsed * 1000)), 6)} j/s"
    )

    IO.puts(
      "10 workers × 50 conc      | #{String.pad_leading(Integer.to_string(result_10_workers.elapsed), 5)}ms | #{String.pad_leading(Integer.to_string(result_10_workers.max_concurrent), 8)} | #{String.pad_leading(Integer.to_string(trunc(job_count / result_10_workers.elapsed * 1000)), 6)} j/s"
    )

    IO.puts("\n=== Test completed! ===")
  end

  defp run_single_worker_test(concurrency, job_count, job_duration_ms) do
    queue_name = "single_worker_#{:erlang.unique_integer([:positive])}"
    conn_name = :"single_conn_#{:erlang.unique_integer([:positive])}"

    {:ok, _} = RedisConnection.start_link(Keyword.merge(@redis_opts, name: conn_name))

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

    # Add jobs first
    jobs = for i <- 1..job_count, do: {"job-#{i}", %{}, []}
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
    max_concurrent = Agent.get(tracker, & &1.max)

    GenServer.stop(worker)
    Agent.stop(tracker)
    cleanup_queue(conn_name, queue_name)

    %{elapsed: elapsed, max_concurrent: max_concurrent}
  end

  defp run_multi_worker_test(num_workers, concurrency_per_worker, job_count, job_duration_ms) do
    queue_name = "multi_worker_#{num_workers}_#{:erlang.unique_integer([:positive])}"
    conn_name = :"multi_conn_#{:erlang.unique_integer([:positive])}"

    {:ok, _} = RedisConnection.start_link(Keyword.merge(@redis_opts, name: conn_name))

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

    # Add jobs first
    jobs = for i <- 1..job_count, do: {"job-#{i}", %{}, []}
    {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn_name)

    start_time = System.monotonic_time(:millisecond)

    # Start multiple workers
    workers =
      for _ <- 1..num_workers do
        {:ok, worker} =
          Worker.start_link(
            queue: queue_name,
            connection: conn_name,
            concurrency: concurrency_per_worker,
            processor: processor
          )

        worker
      end

    wait_for_completion(completed, job_count, 120_000)

    elapsed = System.monotonic_time(:millisecond) - start_time
    max_concurrent = Agent.get(tracker, & &1.max)

    Enum.each(workers, &GenServer.stop/1)
    Agent.stop(tracker)
    cleanup_queue(conn_name, queue_name)

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

  defp cleanup_queue(conn_name, queue_name) do
    {:ok, keys} = RedisConnection.command(conn_name, ["KEYS", "bull:#{queue_name}:*"])

    if length(keys) > 0 do
      RedisConnection.command(conn_name, ["DEL" | keys])
    end
  end
end
