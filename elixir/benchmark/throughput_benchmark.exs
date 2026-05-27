#!/usr/bin/env elixir

# BullMQ Elixir Benchmark
#
# This script benchmarks BullMQ throughput at different concurrency levels.
#
# Usage:
#   cd elixir
#   mix run benchmark/throughput_benchmark.exs
#
# Or with options:
#   mix run benchmark/throughput_benchmark.exs --jobs 5000 --concurrencies "10,50,100,200,300,400"
#

defmodule BullMQ.Benchmark do
  @moduledoc """
  Benchmark BullMQ throughput at various concurrency levels.
  Produces tabular data suitable for articles and comparisons.
  """

  alias BullMQ.{Queue, Worker, RedisConnection, Keys}

  @default_jobs 1000
  @default_concurrencies [1, 5, 10, 25, 50, 100, 150, 200]
  @default_job_duration 100  # milliseconds
  @warmup_jobs 50
  @redis_opts [host: "localhost", port: 6379]

  def run(opts \\ []) do
    job_count = Keyword.get(opts, :jobs, @default_jobs)
    concurrencies = Keyword.get(opts, :concurrencies, @default_concurrencies)
    job_duration = Keyword.get(opts, :job_duration, @default_job_duration)
    worker_count = Keyword.get(opts, :workers, 1)

    IO.puts("""

    ╔═══════════════════════════════════════════════════════════════╗
    ║           BullMQ Elixir Throughput Benchmark                  ║
    ╚═══════════════════════════════════════════════════════════════╝

    Configuration:
      Jobs per test: #{job_count}
      Job duration: #{job_duration}ms
      Worker instances: #{worker_count}
      Concurrency levels: #{inspect(concurrencies)}
      Total parallelism: #{worker_count} workers × concurrency
      Warmup jobs: #{@warmup_jobs}

    Starting benchmark...
    """)

    # Setup
    conn_name = :benchmark_conn
    {:ok, _} = RedisConnection.start_link(Keyword.merge(@redis_opts, name: conn_name))

    # Run warmup
    IO.puts("Running warmup...")
    run_warmup(conn_name, job_duration)
    IO.puts("Warmup complete.\n")

    # Run benchmarks
    results = Enum.map(concurrencies, fn concurrency ->
      result = run_single_benchmark(conn_name, job_count, concurrency, job_duration, worker_count)
      total_parallelism = worker_count * concurrency
      IO.puts("  #{worker_count}×#{concurrency} (#{total_parallelism} total): #{format_result(result)}")
      {concurrency, result}
    end)

    # Print results
    print_results(results, job_count, job_duration, worker_count)
    print_csv(results, job_duration, worker_count)
    print_markdown_table(results, job_duration, worker_count)

    # Cleanup
    try do
      GenServer.stop(conn_name)
    catch
      :exit, _ -> :ok
    end

    results
  end

  defp run_warmup(conn, job_duration) do
    queue_name = "benchmark_warmup_#{:erlang.unique_integer([:positive])}"
    cleanup_queue(conn, queue_name)

    processed = :counters.new(1, [:atomics])

    # Add warmup jobs
    jobs = for i <- 1..@warmup_jobs, do: {"warmup", %{i: i}, []}
    {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn)

    {:ok, worker} = Worker.start_link(
      queue: queue_name,
      connection: conn,
      concurrency: 10,
      processor: fn _job ->
        Process.sleep(job_duration)
        :counters.add(processed, 1, 1)
        {:ok, nil}
      end
    )

    # Allow generous timeout for warmup with job duration
    timeout = @warmup_jobs * job_duration + 30_000
    wait_for_completion(processed, @warmup_jobs, timeout)
    Worker.close(worker)
    Process.sleep(100)
    cleanup_queue(conn, queue_name)
  end

  defp run_single_benchmark(conn, job_count, concurrency, job_duration, worker_count) do
    queue_name = "benchmark_c#{concurrency}_w#{worker_count}_#{:erlang.unique_integer([:positive])}"
    cleanup_queue(conn, queue_name)

    processed = :counters.new(1, [:atomics])

    # Add all jobs first
    jobs = for i <- 1..job_count do
      {"bench_job", %{index: i}, []}
    end

    add_start = System.monotonic_time(:microsecond)

    # Add in batches for efficiency
    Enum.chunk_every(jobs, 1000)
    |> Enum.each(fn batch ->
      {:ok, _} = Queue.add_bulk(queue_name, batch, connection: conn)
    end)

    add_time = System.monotonic_time(:microsecond) - add_start

    # Start multiple worker instances, each with its own Redis connection
    workers = for i <- 1..worker_count do
      worker_conn = :"benchmark_worker_conn_#{i}_#{:erlang.unique_integer([:positive])}"
      {:ok, _} = RedisConnection.start_link(Keyword.merge(@redis_opts, name: worker_conn))

      {:ok, worker} = Worker.start_link(
        queue: queue_name,
        connection: worker_conn,
        concurrency: concurrency,
        processor: fn _job ->
          # Simulate work with the configured duration
          Process.sleep(job_duration)
          :counters.add(processed, 1, 1)
          {:ok, nil}
        end
      )
      {worker, worker_conn}
    end

    process_start = System.monotonic_time(:microsecond)
    # Theoretical minimum time + generous buffer
    total_parallelism = worker_count * concurrency
    theoretical_min = div(job_count * job_duration, max(total_parallelism, 1))
    timeout = max(theoretical_min * 3, 60_000)
    wait_for_completion_with_progress(processed, job_count, timeout, total_parallelism)
    process_time = System.monotonic_time(:microsecond) - process_start

    final_count = :counters.get(processed, 1)

    # Cleanup all workers and their connections
    Enum.each(workers, fn {worker, worker_conn} ->
      Worker.close(worker)
      Process.sleep(50)
      try do
        GenServer.stop(worker_conn)
      catch
        :exit, _ -> :ok
      end
    end)

    Process.sleep(100)
    cleanup_queue(conn, queue_name)

    %{
      concurrency: concurrency,
      worker_count: worker_count,
      total_parallelism: total_parallelism,
      job_count: job_count,
      processed: final_count,
      add_time_ms: add_time / 1000,
      process_time_ms: process_time / 1000,
      throughput: final_count / (process_time / 1_000_000),
      add_rate: job_count / (add_time / 1_000_000)
    }
  end

  defp wait_for_completion(counter, target, timeout) do
    deadline = System.monotonic_time(:millisecond) + timeout
    do_wait(counter, target, deadline)
  end

  defp do_wait(counter, target, deadline) do
    current = :counters.get(counter, 1)
    now = System.monotonic_time(:millisecond)

    cond do
      current >= target -> :ok
      now >= deadline -> :timeout
      true ->
        Process.sleep(10)
        do_wait(counter, target, deadline)
    end
  end

  defp wait_for_completion_with_progress(counter, target, timeout, concurrency) do
    deadline = System.monotonic_time(:millisecond) + timeout
    start_time = System.monotonic_time(:millisecond)
    do_wait_with_progress(counter, target, deadline, start_time, concurrency, -1)
  end

  defp do_wait_with_progress(counter, target, deadline, start_time, concurrency, last_reported) do
    current = :counters.get(counter, 1)
    now = System.monotonic_time(:millisecond)
    elapsed_sec = (now - start_time) / 1000

    # Calculate progress percentage (report every 10%)
    progress = div(current * 100, target)
    progress_bucket = div(progress, 10) * 10

    # Report progress if we've moved to a new bucket
    last_reported = if progress_bucket > last_reported and current > 0 do
      rate = if elapsed_sec > 0, do: Float.round(current / elapsed_sec, 1), else: 0.0
      IO.write("\r    [C=#{concurrency}] Progress: #{current}/#{target} (#{progress}%) - #{rate} jobs/sec")
      progress_bucket
    else
      last_reported
    end

    cond do
      current >= target ->
        IO.write("\r" <> String.duplicate(" ", 80) <> "\r")  # Clear progress line
        :ok
      now >= deadline ->
        IO.puts("")
        :timeout
      true ->
        Process.sleep(100)
        do_wait_with_progress(counter, target, deadline, start_time, concurrency, last_reported)
    end
  end

  defp cleanup_queue(conn, queue_name) do
    case RedisConnection.command(conn, ["KEYS", "bull:#{queue_name}*"]) do
      {:ok, keys} when length(keys) > 0 ->
        RedisConnection.command(conn, ["DEL" | keys])
      _ -> :ok
    end
  end

  defp format_result(result) do
    throughput = Float.round(result.throughput, 1)
    time = Float.round(result.process_time_ms, 0)
    "#{throughput} jobs/sec (#{time}ms)"
  end

  defp print_results(results, job_count, job_duration, worker_count) do
    # Calculate theoretical maximum throughput
    # With W workers, N concurrency and D ms job duration: max = W * N * (1000/D) jobs/sec

    IO.puts("""

    ════════════════════════════════════════════════════════════════════
                              BENCHMARK RESULTS
    ════════════════════════════════════════════════════════════════════

    Jobs per test: #{job_count}
    Job duration: #{job_duration}ms
    Worker instances: #{worker_count}
    Theoretical max at total parallelism P: P × #{Float.round(1000 / job_duration, 1)} jobs/sec

    ┌────────────┬────────────┬──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
    │  Workers×  │   Total    │  Throughput  │ Theoretical  │  Efficiency  │  Process Time│   Add Time   │
    │ Concurrency│ Parallelism│  (jobs/sec)  │  Max (j/s)   │      (%)     │     (ms)     │     (ms)     │
    ├────────────┼────────────┼──────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
    """)

    Enum.each(results, fn {_c, r} ->
      total_parallelism = r.total_parallelism
      theoretical_max = total_parallelism * (1000 / job_duration)
      efficiency = min(100.0, r.throughput / theoretical_max * 100)
      config_str = "#{r.worker_count}×#{r.concurrency}"

      IO.puts(
        "│ #{pad(config_str, 10)} │ #{pad(total_parallelism, 10)} │ #{pad(Float.round(r.throughput, 1), 12)} │ " <>
        "#{pad(Float.round(theoretical_max, 1), 12)} │ #{pad(Float.round(efficiency, 1), 12)} │ " <>
        "#{pad(Float.round(r.process_time_ms, 0), 12)} │ #{pad(Float.round(r.add_time_ms, 0), 12)} │"
      )
    end)

    IO.puts("└────────────┴────────────┴──────────────┴──────────────┴──────────────┴──────────────┴──────────────┘")

    # Find optimal concurrency
    {best_c, best_r} = Enum.max_by(results, fn {_, r} -> r.throughput end)
    theoretical_max_best = best_r.total_parallelism * (1000 / job_duration)
    efficiency_best = min(100.0, best_r.throughput / theoretical_max_best * 100)

    IO.puts("""

    Peak Performance:
      Configuration: #{best_r.worker_count}×#{best_c} (#{best_r.total_parallelism} total parallelism)
      Throughput:  #{Float.round(best_r.throughput, 1)} jobs/sec
      Efficiency:  #{Float.round(efficiency_best, 1)}% of theoretical max

    """)
  end

  defp print_csv(results, job_duration, worker_count) do
    IO.puts("""

    ════════════════════════════════════════════════════════════════════
                              CSV OUTPUT
    ════════════════════════════════════════════════════════════════════

    workers,concurrency,total_parallelism,throughput_jobs_per_sec,theoretical_max,efficiency_pct,process_time_ms,add_time_ms,add_rate_jobs_per_sec
    """)

    Enum.each(results, fn {_, r} ->
      theoretical_max = r.total_parallelism * (1000 / job_duration)
      efficiency = min(100.0, r.throughput / theoretical_max * 100)
      IO.puts("#{worker_count},#{r.concurrency},#{r.total_parallelism},#{Float.round(r.throughput, 2)},#{Float.round(theoretical_max, 2)},#{Float.round(efficiency, 2)},#{Float.round(r.process_time_ms, 2)},#{Float.round(r.add_time_ms, 2)},#{Float.round(r.add_rate, 2)}")
    end)
  end

  defp print_markdown_table(results, job_duration, _worker_count) do
    IO.puts("""

    ════════════════════════════════════════════════════════════════════
                          MARKDOWN TABLE
    ════════════════════════════════════════════════════════════════════

    | Workers×Concurrency | Total Parallelism | Throughput (jobs/sec) | Theoretical Max | Efficiency % | Process Time (ms) |
    |---------------------|------------------:|----------------------:|----------------:|-------------:|------------------:|
    """)

    Enum.each(results, fn {_, r} ->
      theoretical_max = r.total_parallelism * (1000 / job_duration)
      efficiency = min(100.0, r.throughput / theoretical_max * 100)
      config_str = "#{r.worker_count}×#{r.concurrency}"
      IO.puts("| #{config_str} | #{r.total_parallelism} | #{Float.round(r.throughput, 1)} | #{Float.round(theoretical_max, 1)} | #{Float.round(efficiency, 1)} | #{Float.round(r.process_time_ms, 0)} |")
    end)
  end

  defp pad(value, width) when is_binary(value) do
    String.pad_leading(value, width)
  end

  defp pad(value, width) when is_integer(value) do
    String.pad_leading("#{value}", width)
  end

  defp pad(value, width) when is_float(value) do
    String.pad_leading("#{value}", width)
  end
end

# Parse command line arguments
{opts, _, _} = OptionParser.parse(System.argv(),
  strict: [jobs: :integer, concurrencies: :string, job_duration: :integer, workers: :integer]
)

jobs = Keyword.get(opts, :jobs, 5000)
job_duration = Keyword.get(opts, :job_duration, 500)
workers = Keyword.get(opts, :workers, 1)
concurrencies = case Keyword.get(opts, :concurrencies) do
  nil -> [1, 5, 10, 25, 50, 100, 150, 200, 250, 300, 400, 500]
  str ->
    str
    |> String.split(",")
    |> Enum.map(&String.trim/1)
    |> Enum.map(&String.to_integer/1)
end

BullMQ.Benchmark.run(jobs: jobs, concurrencies: concurrencies, job_duration: job_duration, workers: workers)
