defmodule BullMQ.StressTest do
  @moduledoc """
  Stress tests for BullMQ to verify system stability under high load.

  Run with:
    mix test test/bullmq/stress_test.exs --include stress
  """
  use ExUnit.Case, async: false

  alias BullMQ.{Queue, Worker, RedisConnection}

  @moduletag :stress
  # 5 minutes max
  @moduletag timeout: 300_000
  @moduletag :slow

  @redis_opts [host: "localhost", port: 6379]

  setup do
    queue_name = "stress_test_#{:erlang.unique_integer([:positive])}"
    conn_name = :"stress_conn_#{:erlang.unique_integer([:positive])}"

    {:ok, _pid} = RedisConnection.start_link(Keyword.merge(@redis_opts, name: conn_name))

    # Clean up
    {:ok, keys} = RedisConnection.command(conn_name, ["KEYS", "bull:#{queue_name}*"])
    if length(keys) > 0, do: RedisConnection.command(conn_name, ["DEL" | keys])

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

  describe "high volume processing" do
    @tag timeout: 120_000
    test "processes 1000 jobs with concurrency 10", %{queue_name: queue_name, conn: conn} do
      run_stress_test(queue_name, conn, job_count: 1000, concurrency: 10)
    end

    @tag timeout: 120_000
    test "processes 1000 jobs with concurrency 50", %{queue_name: queue_name, conn: conn} do
      run_stress_test(queue_name, conn, job_count: 1000, concurrency: 50)
    end

    @tag timeout: 180_000
    test "processes 5000 jobs with concurrency 100", %{queue_name: queue_name, conn: conn} do
      run_stress_test(queue_name, conn, job_count: 5000, concurrency: 100)
    end

    @tag timeout: 300_000
    test "processes 10000 jobs with concurrency 200", %{queue_name: queue_name, conn: conn} do
      run_stress_test(queue_name, conn, job_count: 10_000, concurrency: 200)
    end
  end

  describe "bulk operations" do
    @tag timeout: 60_000
    test "adds 1000 jobs in bulk", %{queue_name: queue_name, conn: conn} do
      jobs =
        for i <- 1..1000 do
          {"bulk_job_#{i}", %{index: i}, []}
        end

      start_time = System.monotonic_time(:millisecond)
      {:ok, added} = Queue.add_bulk(queue_name, jobs, connection: conn)
      elapsed = System.monotonic_time(:millisecond) - start_time

      assert length(added) == 1000

      IO.puts(
        "\n  Bulk add 1000 jobs: #{elapsed}ms (#{Float.round(1000 / elapsed * 1000, 1)} jobs/sec)"
      )
    end

    @tag timeout: 120_000
    test "adds 5000 jobs in bulk and processes them", %{queue_name: queue_name, conn: conn} do
      job_count = 5000
      processed = :counters.new(1, [:atomics])

      # Add jobs in bulk
      jobs =
        for i <- 1..job_count do
          {"bulk_job", %{index: i}, []}
        end

      add_start = System.monotonic_time(:millisecond)
      {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn)
      add_elapsed = System.monotonic_time(:millisecond) - add_start

      IO.puts("\n  Bulk add #{job_count} jobs: #{add_elapsed}ms")

      # Process all jobs
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          concurrency: 100,
          processor: fn _job ->
            :counters.add(processed, 1, 1)
            {:ok, nil}
          end
        )

      process_start = System.monotonic_time(:millisecond)

      # Wait for all jobs to be processed
      wait_for_processed(processed, job_count, 60_000)

      process_elapsed = System.monotonic_time(:millisecond) - process_start
      final_count = :counters.get(processed, 1)

      Worker.close(worker)
      Process.sleep(100)

      assert final_count == job_count

      throughput = Float.round(job_count / process_elapsed * 1000, 1)
      IO.puts("  Process #{job_count} jobs: #{process_elapsed}ms (#{throughput} jobs/sec)")
    end
  end

  describe "sustained throughput" do
    @tag timeout: 120_000
    test "maintains throughput over time", %{queue_name: queue_name, conn: conn} do
      # Add jobs in batches while processing
      total_jobs = 3000
      batch_size = 500
      processed = :counters.new(1, [:atomics])

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          concurrency: 50,
          processor: fn _job ->
            :counters.add(processed, 1, 1)
            {:ok, nil}
          end
        )

      start_time = System.monotonic_time(:millisecond)

      # Add jobs in batches
      for batch <- 1..div(total_jobs, batch_size) do
        jobs =
          for i <- 1..batch_size do
            {"sustained_job", %{batch: batch, index: i}, []}
          end

        {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn)

        # Small delay between batches to simulate real-world usage
        Process.sleep(100)
      end

      # Wait for all to complete
      wait_for_processed(processed, total_jobs, 90_000)

      elapsed = System.monotonic_time(:millisecond) - start_time
      final_count = :counters.get(processed, 1)

      Worker.close(worker)

      assert final_count == total_jobs

      throughput = Float.round(total_jobs / elapsed * 1000, 1)
      IO.puts("\n  Sustained throughput: #{throughput} jobs/sec over #{elapsed}ms")
    end
  end

  describe "error resilience" do
    @tag timeout: 120_000
    test "recovers from intermittent failures", %{queue_name: queue_name, conn: conn} do
      job_count = 500
      processed = :counters.new(1, [:atomics])
      failures = :counters.new(1, [:atomics])

      # Add jobs
      jobs =
        for i <- 1..job_count do
          {"resilience_job", %{index: i}, [attempts: 3]}
        end

      {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          concurrency: 20,
          processor: fn _job ->
            # 10% chance of failure
            if :rand.uniform(10) == 1 do
              :counters.add(failures, 1, 1)
              {:error, "Random failure"}
            else
              :counters.add(processed, 1, 1)
              {:ok, nil}
            end
          end
        )

      # Wait for completion (with retries, may take longer)
      Process.sleep(30_000)

      Worker.close(worker)
      Process.sleep(100)

      final_processed = :counters.get(processed, 1)
      final_failures = :counters.get(failures, 1)

      IO.puts("\n  Processed: #{final_processed}, Failure attempts: #{final_failures}")

      # Should have processed most jobs (some may still be retrying)
      assert final_processed >= job_count * 0.8,
             "Expected at least 80% processed, got #{final_processed}/#{job_count}"
    end
  end

  # Helper functions

  defp run_stress_test(queue_name, conn, opts) do
    job_count = Keyword.fetch!(opts, :job_count)
    concurrency = Keyword.fetch!(opts, :concurrency)
    processed = :counters.new(1, [:atomics])

    # Add all jobs first
    IO.puts("\n  Adding #{job_count} jobs...")
    add_start = System.monotonic_time(:millisecond)

    # Add in batches of 1000 for efficiency
    jobs =
      for i <- 1..job_count do
        {"stress_job_#{i}", %{index: i, timestamp: System.system_time()}, []}
      end

    Enum.chunk_every(jobs, 1000)
    |> Enum.each(fn batch ->
      {:ok, _} = Queue.add_bulk(queue_name, batch, connection: conn)
    end)

    add_elapsed = System.monotonic_time(:millisecond) - add_start
    IO.puts("  Jobs added in #{add_elapsed}ms")

    # Start worker
    {:ok, worker} =
      Worker.start_link(
        queue: queue_name,
        connection: conn,
        concurrency: concurrency,
        processor: fn _job ->
          :counters.add(processed, 1, 1)
          {:ok, nil}
        end
      )

    # Wait for processing
    IO.puts("  Processing with concurrency #{concurrency}...")
    process_start = System.monotonic_time(:millisecond)

    # At least 60s, or 10ms per job
    timeout = max(60_000, job_count * 10)
    wait_for_processed(processed, job_count, timeout)

    process_elapsed = System.monotonic_time(:millisecond) - process_start
    final_count = :counters.get(processed, 1)

    Worker.close(worker)
    Process.sleep(100)

    # Calculate stats
    throughput = Float.round(job_count / process_elapsed * 1000, 1)

    IO.puts("  Results:")
    IO.puts("    Jobs: #{job_count}")
    IO.puts("    Concurrency: #{concurrency}")
    IO.puts("    Time: #{process_elapsed}ms")
    IO.puts("    Throughput: #{throughput} jobs/sec")
    IO.puts("    Processed: #{final_count}/#{job_count}")

    # Verify all jobs processed
    assert final_count == job_count,
           "Expected #{job_count} jobs processed, got #{final_count}"
  end

  defp wait_for_processed(counter, target, timeout) do
    deadline = System.monotonic_time(:millisecond) + timeout
    do_wait_for_processed(counter, target, deadline)
  end

  defp do_wait_for_processed(counter, target, deadline) do
    current = :counters.get(counter, 1)
    now = System.monotonic_time(:millisecond)

    cond do
      current >= target ->
        :ok

      now >= deadline ->
        :timeout

      true ->
        Process.sleep(50)
        do_wait_for_processed(counter, target, deadline)
    end
  end
end
