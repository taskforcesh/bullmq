#!/usr/bin/env elixir

# BullMQ Elixir Benchmark Suite
#
# Run with: mix run benchmark/suite.exs
#
# Options (via environment variables):
#   REDIS_HOST - Redis host (default: localhost)
#   REDIS_PORT - Redis port (default: 6379)
#   QUICK      - Run quick benchmarks only (default: false)

alias BullMQ.{Queue, Worker, RedisConnection}

defmodule Benchmark do
  @moduledoc """
  BullMQ Elixir Benchmark Suite
  """

  def run do
    redis_host = System.get_env("REDIS_HOST", "localhost")
    redis_port = String.to_integer(System.get_env("REDIS_PORT", "6379"))
    quick = System.get_env("QUICK", "false") == "true"

    IO.puts("""

    ╔══════════════════════════════════════════════════════════════╗
    ║           BullMQ Elixir Benchmark Suite                      ║
    ╠══════════════════════════════════════════════════════════════╣
    ║  Redis: #{String.pad_trailing("#{redis_host}:#{redis_port}", 49)}║
    ║  Mode:  #{String.pad_trailing(if(quick, do: "Quick", else: "Full"), 49)}║
    ╚══════════════════════════════════════════════════════════════╝
    """)

    # Single worker benchmarks
    IO.puts("\n━━━ Single Worker Performance ━━━\n")
    single_worker_configs = if quick do
      [{100, 500}, {500, 2500}]
    else
      [{50, 250}, {100, 500}, {200, 1000}, {500, 2500}, {1000, 5000}]
    end

    single_results = run_single_worker_benchmarks(single_worker_configs, redis_host, redis_port)
    print_single_worker_results(single_results)

    # Multi-worker benchmarks
    IO.puts("\n━━━ Multi-Worker Performance ━━━\n")
    multi_worker_configs = if quick do
      [{1, 500, 2500}, {5, 500, 12500}]
    else
      [{1, 500, 2500}, {3, 500, 7500}, {5, 500, 12500}, {10, 500, 25000}]
    end

    multi_results = run_multi_worker_benchmarks(multi_worker_configs, redis_host, redis_port)
    print_multi_worker_results(multi_results)

    # Realistic workload
    IO.puts("\n━━━ Realistic Workload (10ms jobs) ━━━\n")
    realistic_results = run_realistic_benchmark(redis_host, redis_port, quick)
    print_realistic_results(realistic_results)

    # Summary
    IO.puts("\n━━━ Summary ━━━\n")
    print_summary(single_results, multi_results)
  end

  defp run_single_worker_benchmarks(configs, host, port) do
    for {concurrency, job_count} <- configs do
      conn_name = :"bench_#{:erlang.unique_integer([:positive])}"
      {:ok, _} = RedisConnection.start_link(host: host, port: port, name: conn_name)

      queue_name = "bench_single_#{:erlang.unique_integer([:positive])}"
      completed = :counters.new(1, [])

      processor = fn _job ->
        :counters.add(completed, 1, 1)
        :ok
      end

      jobs = for i <- 1..job_count, do: {"job-#{i}", %{}, []}
      {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn_name)

      start_time = System.monotonic_time(:millisecond)

      {:ok, worker} = Worker.start_link(
        queue: queue_name,
        connection: conn_name,
        concurrency: concurrency,
        processor: processor
      )

      wait_for_completion(completed, job_count)

      elapsed = System.monotonic_time(:millisecond) - start_time
      throughput = job_count / elapsed * 1000

      GenServer.stop(worker)
      cleanup_queue(conn_name, queue_name)

      %{
        concurrency: concurrency,
        jobs: job_count,
        elapsed_ms: elapsed,
        throughput: throughput
      }
    end
  end

  defp run_multi_worker_benchmarks(configs, host, port) do
    for {num_workers, concurrency, job_count} <- configs do
      conn_name = :"bench_#{:erlang.unique_integer([:positive])}"
      {:ok, _} = RedisConnection.start_link(host: host, port: port, name: conn_name)

      queue_name = "bench_multi_#{:erlang.unique_integer([:positive])}"
      completed = :counters.new(1, [])

      processor = fn _job ->
        :counters.add(completed, 1, 1)
        :ok
      end

      jobs = for i <- 1..job_count, do: {"job-#{i}", %{}, []}
      {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn_name)

      start_time = System.monotonic_time(:millisecond)

      workers = for _ <- 1..num_workers do
        {:ok, w} = Worker.start_link(
          queue: queue_name,
          connection: conn_name,
          concurrency: concurrency,
          processor: processor
        )
        w
      end

      wait_for_completion(completed, job_count)

      elapsed = System.monotonic_time(:millisecond) - start_time
      throughput = job_count / elapsed * 1000

      Enum.each(workers, &GenServer.stop/1)
      cleanup_queue(conn_name, queue_name)

      %{
        workers: num_workers,
        concurrency: concurrency,
        total_concurrency: num_workers * concurrency,
        jobs: job_count,
        elapsed_ms: elapsed,
        throughput: throughput
      }
    end
  end

  defp run_realistic_benchmark(host, port, quick) do
    job_duration_ms = 10
    {concurrency, job_count} = if quick, do: {200, 2000}, else: {500, 5000}

    conn_name = :"bench_#{:erlang.unique_integer([:positive])}"
    {:ok, _} = RedisConnection.start_link(host: host, port: port, name: conn_name)

    queue_name = "bench_realistic_#{:erlang.unique_integer([:positive])}"
    completed = :counters.new(1, [])

    processor = fn _job ->
      Process.sleep(job_duration_ms)
      :counters.add(completed, 1, 1)
      :ok
    end

    jobs = for i <- 1..job_count, do: {"job-#{i}", %{}, []}
    {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn_name)

    start_time = System.monotonic_time(:millisecond)

    {:ok, worker} = Worker.start_link(
      queue: queue_name,
      connection: conn_name,
      concurrency: concurrency,
      processor: processor
    )

    wait_for_completion(completed, job_count)

    elapsed = System.monotonic_time(:millisecond) - start_time
    throughput = job_count / elapsed * 1000
    theoretical_max = concurrency / job_duration_ms * 1000
    efficiency = throughput / theoretical_max * 100

    GenServer.stop(worker)
    cleanup_queue(conn_name, queue_name)

    %{
      job_duration_ms: job_duration_ms,
      concurrency: concurrency,
      jobs: job_count,
      elapsed_ms: elapsed,
      throughput: throughput,
      theoretical_max: theoretical_max,
      efficiency: efficiency
    }
  end

  defp wait_for_completion(counter, target) do
    wait_fn = fn wait_fn ->
      Process.sleep(50)
      if :counters.get(counter, 1) < target do
        wait_fn.(wait_fn)
      end
    end
    wait_fn.(wait_fn)
  end

  defp cleanup_queue(conn_name, queue_name) do
    {:ok, keys} = RedisConnection.command(conn_name, ["KEYS", "bull:#{queue_name}:*"])
    if length(keys) > 0, do: RedisConnection.command(conn_name, ["DEL" | keys])
  end

  defp print_single_worker_results(results) do
    IO.puts("┌─────────────┬────────┬──────────┬──────────────┐")
    IO.puts("│ Concurrency │  Jobs  │   Time   │  Throughput  │")
    IO.puts("├─────────────┼────────┼──────────┼──────────────┤")

    for r <- results do
      conc = String.pad_leading("#{r.concurrency}", 11)
      jobs = String.pad_leading("#{r.jobs}", 6)
      time = String.pad_leading("#{r.elapsed_ms}ms", 8)
      tput = String.pad_leading("#{trunc(r.throughput)} j/s", 12)
      IO.puts("│ #{conc} │ #{jobs} │ #{time} │ #{tput} │")
    end

    IO.puts("└─────────────┴────────┴──────────┴──────────────┘")
  end

  defp print_multi_worker_results(results) do
    IO.puts("┌─────────┬────────┬────────────┬────────┬──────────┬──────────────┐")
    IO.puts("│ Workers │ Conc/W │ Total Conc │  Jobs  │   Time   │  Throughput  │")
    IO.puts("├─────────┼────────┼────────────┼────────┼──────────┼──────────────┤")

    for r <- results do
      workers = String.pad_leading("#{r.workers}", 7)
      conc = String.pad_leading("#{r.concurrency}", 6)
      total = String.pad_leading("#{r.total_concurrency}", 10)
      jobs = String.pad_leading("#{r.jobs}", 6)
      time = String.pad_leading("#{r.elapsed_ms}ms", 8)
      tput = String.pad_leading("#{trunc(r.throughput)} j/s", 12)
      IO.puts("│ #{workers} │ #{conc} │ #{total} │ #{jobs} │ #{time} │ #{tput} │")
    end

    IO.puts("└─────────┴────────┴────────────┴────────┴──────────┴──────────────┘")
  end

  defp print_realistic_results(r) do
    IO.puts("Job duration: #{r.job_duration_ms}ms")
    IO.puts("Concurrency:  #{r.concurrency}")
    IO.puts("Jobs:         #{r.jobs}")
    IO.puts("Time:         #{r.elapsed_ms}ms")
    IO.puts("Throughput:   #{trunc(r.throughput)} j/s")
    IO.puts("Theoretical:  #{trunc(r.theoretical_max)} j/s")
    IO.puts("Efficiency:   #{Float.round(r.efficiency, 1)}%")
  end

  defp print_summary(single_results, multi_results) do
    best_single = Enum.max_by(single_results, & &1.throughput)
    best_multi = Enum.max_by(multi_results, & &1.throughput)

    IO.puts("┌────────────────────────────────────────────────────────────┐")
    IO.puts("│ Best single worker:  #{String.pad_trailing("#{trunc(best_single.throughput)} j/s @ #{best_single.concurrency} concurrency", 37)}│")
    IO.puts("│ Best multi-worker:   #{String.pad_trailing("#{trunc(best_multi.throughput)} j/s @ #{best_multi.workers}×#{best_multi.concurrency}", 37)}│")
    IO.puts("│ Scaling factor:      #{String.pad_trailing("#{Float.round(best_multi.throughput / best_single.throughput, 1)}x", 37)}│")
    IO.puts("└────────────────────────────────────────────────────────────┘")
  end
end

Benchmark.run()
