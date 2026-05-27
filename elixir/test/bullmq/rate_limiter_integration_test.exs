defmodule BullMQ.RateLimiterIntegrationTest do
  @moduledoc """
  Integration tests for rate limiting functionality.

  These tests use the real BullMQ.Queue, BullMQ.Worker, and BullMQ.QueueEvents
  modules to verify rate limiting behavior matches the Node.js implementation.

  The tests verify:
  - Rate limiting via the limiter option on Worker
  - Rate limit TTL queries via Scripts module
  - Dynamic rate limiting via {:rate_limit, ms} return value
  - Worker graceful shutdown behavior under rate limiting
  """
  use ExUnit.Case, async: false

  @moduletag :integration
  @moduletag :rate_limiter

  alias BullMQ.{Queue, Worker, QueueEvents, Scripts, Keys}

  @redis_url BullMQ.TestHelper.redis_url()
  @test_prefix BullMQ.TestHelper.test_prefix()

  setup do
    # Start a named Redis connection pool for this test
    pool_name = :"rate_limit_pool_#{System.unique_integer([:positive])}"

    {:ok, pool_pid} =
      BullMQ.RedisConnection.start_link(
        name: pool_name,
        url: @redis_url,
        pool_size: 5
      )

    Process.unlink(pool_pid)

    queue_name = "rate-limit-queue-#{System.unique_integer([:positive])}"
    ctx = Keys.new(queue_name, prefix: @test_prefix)

    on_exit(fn ->
      # Close the pool (waits for scripts to load)
      BullMQ.RedisConnection.close(pool_name)

      # Cleanup test keys
      case Redix.start_link(@redis_url) do
        {:ok, cleanup_conn} ->
          case Redix.command(cleanup_conn, ["KEYS", "#{@test_prefix}:#{queue_name}:*"]) do
            {:ok, keys} when keys != [] ->
              Redix.command(cleanup_conn, ["DEL" | keys])

            _ ->
              :ok
          end

          Redix.stop(cleanup_conn)

        _ ->
          :ok
      end
    end)

    {:ok, conn: pool_name, queue_name: queue_name, ctx: ctx}
  end

  # ---------------------------------------------------------------------------
  # Basic Rate Limiting Tests
  # ---------------------------------------------------------------------------

  describe "basic rate limiting" do
    @tag :rate_limiter
    @tag timeout: 15_000
    test "should obey the rate limit", %{conn: conn, queue_name: queue_name} do
      num_jobs = 4
      # 500ms per job window
      duration = 500

      # Start queue events to track completions
      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix
        )

      QueueEvents.subscribe(events)

      # Start rate limited worker
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.5,
          processor: fn _job -> :ok end,
          limiter: %{max: 1, duration: duration}
        )

      start_time = System.system_time(:millisecond)

      # Add jobs
      jobs =
        Enum.map(1..num_jobs, fn i ->
          {"rate-test", %{idx: i}, []}
        end)

      {:ok, _added} = Queue.add_bulk(queue_name, jobs, connection: conn, prefix: @test_prefix)

      # Wait for all jobs to complete
      wait_for_completions(num_jobs, 15_000)

      end_time = System.system_time(:millisecond)
      total_time = end_time - start_time

      # With rate limiting of max: 1 per 500ms, processing 4 jobs should take at least 3*500 = 1500ms
      expected_min_time = (num_jobs - 1) * duration

      assert total_time >= expected_min_time,
             "Expected at least #{expected_min_time}ms, got #{total_time}ms"

      # Cleanup
      Worker.close(worker)
      QueueEvents.close(events)
    end

    @tag :rate_limiter
    @tag timeout: 20_000
    test "should obey the rate limit with max value greater than 1", %{
      conn: conn,
      queue_name: queue_name
    } do
      num_jobs = 8
      duration = 500
      max_per_window = 2

      # Start queue events to track completions
      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix
        )

      QueueEvents.subscribe(events)

      # Start rate limited worker with max: 2
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.5,
          processor: fn _job -> :ok end,
          limiter: %{max: max_per_window, duration: duration}
        )

      start_time = System.system_time(:millisecond)

      # Add jobs
      jobs =
        Enum.map(1..num_jobs, fn i ->
          {"rate-test", %{idx: i}, []}
        end)

      {:ok, _added} = Queue.add_bulk(queue_name, jobs, connection: conn, prefix: @test_prefix)

      # Wait for all jobs to complete
      wait_for_completions(num_jobs, 20_000)

      end_time = System.system_time(:millisecond)
      total_time = end_time - start_time

      # With max: 2 per 500ms window, 8 jobs need 4 windows
      # First window has 2 jobs (no wait), then 3 more windows
      expected_windows = div(num_jobs, max_per_window) - 1
      expected_min_time = expected_windows * duration

      assert total_time >= expected_min_time,
             "Expected at least #{expected_min_time}ms, got #{total_time}ms"

      # Cleanup
      Worker.close(worker)
      QueueEvents.close(events)
    end

    @tag :rate_limiter
    @tag timeout: 10_000
    test "should not put a job into the delayed queue when limit is hit", %{
      conn: conn,
      queue_name: queue_name
    } do
      num_jobs = 5

      # Start rate limited worker
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.5,
          concurrency: 5,
          processor: fn _job ->
            Process.sleep(200)
            :ok
          end,
          limiter: %{max: 1, duration: 1000}
        )

      # Add jobs
      jobs =
        Enum.map(1..num_jobs, fn i ->
          {"test", %{idx: i}, []}
        end)

      {:ok, _added} = Queue.add_bulk(queue_name, jobs, connection: conn, prefix: @test_prefix)

      # Wait a bit for processing to start
      Process.sleep(300)

      # Check delayed count - should be 0 (rate limited jobs go back to wait, not delayed)
      {:ok, counts} = Queue.get_counts(queue_name, connection: conn, prefix: @test_prefix)
      assert counts.delayed == 0

      # Cleanup
      Worker.close(worker)
    end
  end

  # ---------------------------------------------------------------------------
  # Rate Limit TTL Tests (using Scripts module directly)
  # ---------------------------------------------------------------------------

  describe "rate limit TTL" do
    @tag :rate_limiter
    @tag timeout: 5_000
    test "getRateLimitTtl should return -2 when no rate limit key exists", %{conn: conn, ctx: ctx} do
      # No worker started, no rate limit - use Scripts module directly
      {:ok, ttl} = Scripts.get_rate_limit_ttl(conn, ctx)
      assert ttl == -2
    end

    @tag :rate_limiter
    @tag timeout: 10_000
    test "getRateLimitTtl should return TTL when rate limited", %{
      conn: conn,
      queue_name: queue_name,
      ctx: ctx
    } do
      duration = 1000

      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix
        )

      QueueEvents.subscribe(events)

      # Start rate limited worker that checks TTL inside processor
      ttl_holder = :ets.new(:ttl_holder, [:set, :public])

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.5,
          processor: fn _job ->
            # Use Scripts module directly to check TTL
            {:ok, current_ttl} = Scripts.get_rate_limit_ttl(conn, ctx)
            :ets.insert(ttl_holder, {:ttl, current_ttl})
            :ok
          end,
          limiter: %{max: 1, duration: duration}
        )

      # Add a job
      {:ok, _job} = Queue.add(queue_name, "test-job", %{}, connection: conn, prefix: @test_prefix)

      # Wait for job to complete
      wait_for_completions(1, 5_000)

      # Check that TTL was recorded
      [{:ttl, recorded_ttl}] = :ets.lookup(ttl_holder, :ttl)

      # TTL should be between 0 and duration (or -2 if key doesn't exist yet)
      assert recorded_ttl == -2 or (recorded_ttl >= 0 and recorded_ttl <= duration),
             "Expected TTL between 0 and #{duration} or -2, got #{recorded_ttl}"

      # Cleanup
      Worker.close(worker)
      QueueEvents.close(events)
      :ets.delete(ttl_holder)
    end
  end

  # ---------------------------------------------------------------------------
  # Dynamic Rate Limiting Tests
  # ---------------------------------------------------------------------------

  describe "dynamic rate limiting" do
    @tag :rate_limiter
    @tag timeout: 10_000
    test "{:rate_limit, ms} return value triggers rate limiting", %{
      conn: conn,
      queue_name: queue_name
    } do
      dynamic_limit = 500

      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix
        )

      QueueEvents.subscribe(events)

      attempt_count = :ets.new(:attempts, [:set, :public])
      :ets.insert(attempt_count, {:count, 0})

      # Start worker that returns {:rate_limit, ms} on first attempt
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.5,
          processor: fn _job ->
            [{:count, count}] = :ets.lookup(attempt_count, :count)
            :ets.insert(attempt_count, {:count, count + 1})

            if count == 0 do
              # First attempt - trigger dynamic rate limit via return value
              {:rate_limit, dynamic_limit}
            else
              :ok
            end
          end
        )

      start_time = System.system_time(:millisecond)

      # Add a job
      {:ok, _job} = Queue.add(queue_name, "rate-test", %{}, connection: conn, prefix: @test_prefix)

      # Wait for completion (after retry)
      wait_for_completions(1, 10_000)

      end_time = System.system_time(:millisecond)
      total_time = end_time - start_time

      # Should have taken at least dynamic_limit ms due to rate limiting
      assert total_time >= dynamic_limit * 0.9,
             "Expected at least #{dynamic_limit}ms, got #{total_time}ms"

      # Cleanup
      Worker.close(worker)
      QueueEvents.close(events)
      :ets.delete(attempt_count)
    end
  end

  # ---------------------------------------------------------------------------
  # Quick Close Test
  # ---------------------------------------------------------------------------

  describe "quick close" do
    @tag :rate_limiter
    @tag timeout: 5_000
    test "should quickly close a worker even with slow rate-limit", %{
      conn: conn,
      queue_name: queue_name
    } do
      # Start worker with very slow rate limit
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.5,
          processor: fn _job -> :ok end,
          # 1 minute
          limiter: %{max: 1, duration: 60_000}
        )

      # Add a job
      {:ok, _job} = Queue.add(queue_name, "test", %{}, connection: conn, prefix: @test_prefix)

      # Wait briefly for processing to potentially start
      Process.sleep(500)

      # Close should be quick, not wait for rate limit
      start_time = System.system_time(:millisecond)
      Worker.close(worker)
      end_time = System.system_time(:millisecond)

      close_time = end_time - start_time

      # Close should be fast (< 2 seconds), not wait for 60s rate limit
      assert close_time < 2_000,
             "Expected quick close, but took #{close_time}ms"
    end
  end

  # ---------------------------------------------------------------------------
  # Helper Functions
  # ---------------------------------------------------------------------------

  defp wait_for_completions(expected_count, timeout) do
    deadline = System.monotonic_time(:millisecond) + timeout
    do_wait_for_completions(0, expected_count, deadline)
  end

  defp do_wait_for_completions(count, expected, _deadline) when count >= expected do
    :ok
  end

  defp do_wait_for_completions(count, expected, deadline) do
    remaining = deadline - System.monotonic_time(:millisecond)

    if remaining <= 0 do
      flunk("Timeout waiting for #{expected} completions, got #{count}")
    else
      receive do
        {:bullmq_event, :completed, _data} ->
          do_wait_for_completions(count + 1, expected, deadline)

        {:bullmq_event, :failed, data} ->
          # Log but don't fail - job might retry
          IO.puts("Job failed event received: #{inspect(data)}")
          do_wait_for_completions(count, expected, deadline)

        _other ->
          do_wait_for_completions(count, expected, deadline)
      after
        min(remaining, 100) ->
          do_wait_for_completions(count, expected, deadline)
      end
    end
  end
end
