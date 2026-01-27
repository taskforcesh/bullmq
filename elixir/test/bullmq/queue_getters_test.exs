defmodule BullMQ.QueueGettersTest do
  @moduledoc """
  Integration tests for Queue getter functions.

  These tests verify that all getter methods work correctly with Redis,
  matching the behavior of the Node.js BullMQ queue-getters.ts implementation.
  """
  use ExUnit.Case, async: false

  alias BullMQ.{Queue, RedisConnection, Worker}

  @moduletag :integration

  @redis_url BullMQ.TestHelper.redis_url()
  @test_prefix BullMQ.TestHelper.test_prefix()

  setup do
    # Start a Redis connection pool for this test
    conn_name = :"getters_test_conn_#{System.unique_integer([:positive])}"
    queue_name = "test-queue-getters-#{System.unique_integer([:positive])}"

    {:ok, _} = RedisConnection.start_link(name: conn_name, redis_url: @redis_url)

    on_exit(fn ->
      # Cleanup queue data using a separate connection
      cleanup_queue_data(queue_name)

      # Stop the connection
      try do
        supervisor_name = :"#{conn_name}_supervisor"

        if Process.whereis(supervisor_name) do
          Supervisor.stop(supervisor_name)
        end
      catch
        :exit, _ -> :ok
      end
    end)

    {:ok, conn: conn_name, queue_name: queue_name, prefix: @test_prefix}
  end

  defp cleanup_queue_data(queue_name) do
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
  end

  # ---------------------------------------------------------------------------
  # Tests for get_waiting/2
  # ---------------------------------------------------------------------------

  describe "get_waiting/2" do
    test "returns empty list when no jobs", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, jobs} = Queue.get_waiting(queue_name, connection: conn, prefix: prefix)
      assert jobs == []
    end

    test "returns waiting jobs", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Add some jobs
      {:ok, job1} = Queue.add(queue_name, "job1", %{foo: 1}, connection: conn, prefix: prefix)
      {:ok, job2} = Queue.add(queue_name, "job2", %{foo: 2}, connection: conn, prefix: prefix)

      {:ok, jobs} = Queue.get_waiting(queue_name, connection: conn, prefix: prefix)

      assert length(jobs) == 2
      job_ids = Enum.map(jobs, & &1.id)
      assert job1.id in job_ids
      assert job2.id in job_ids
    end

    test "respects pagination options", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Add multiple jobs
      for i <- 1..5 do
        Queue.add(queue_name, "job#{i}", %{i: i}, connection: conn, prefix: prefix)
      end

      {:ok, jobs} =
        Queue.get_waiting(queue_name, connection: conn, prefix: prefix, start: 0, end: 2)

      assert length(jobs) == 3
    end
  end

  # ---------------------------------------------------------------------------
  # Tests for get_active/2
  # ---------------------------------------------------------------------------

  describe "get_active/2" do
    test "returns empty list when no active jobs", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      {:ok, jobs} = Queue.get_active(queue_name, connection: conn, prefix: prefix)
      assert jobs == []
    end
  end

  # ---------------------------------------------------------------------------
  # Tests for get_delayed/2
  # ---------------------------------------------------------------------------

  describe "get_delayed/2" do
    test "returns empty list when no delayed jobs", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      {:ok, jobs} = Queue.get_delayed(queue_name, connection: conn, prefix: prefix)
      assert jobs == []
    end

    test "returns delayed jobs", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, job} =
        Queue.add(queue_name, "delayed_job", %{}, connection: conn, prefix: prefix, delay: 60_000)

      {:ok, jobs} = Queue.get_delayed(queue_name, connection: conn, prefix: prefix)

      assert length(jobs) == 1
      assert hd(jobs).id == job.id
    end
  end

  # ---------------------------------------------------------------------------
  # Tests for get_prioritized/2
  # ---------------------------------------------------------------------------

  describe "get_prioritized/2" do
    test "returns empty list when no prioritized jobs", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      {:ok, jobs} = Queue.get_prioritized(queue_name, connection: conn, prefix: prefix)
      assert jobs == []
    end

    test "returns prioritized jobs", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, job} =
        Queue.add(queue_name, "priority_job", %{}, connection: conn, prefix: prefix, priority: 5)

      {:ok, jobs} = Queue.get_prioritized(queue_name, connection: conn, prefix: prefix)

      assert length(jobs) == 1
      assert hd(jobs).id == job.id
    end
  end

  # ---------------------------------------------------------------------------
  # Tests for get_completed/2
  # ---------------------------------------------------------------------------

  describe "get_completed/2" do
    test "returns empty list when no completed jobs", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      {:ok, jobs} = Queue.get_completed(queue_name, connection: conn, prefix: prefix)
      assert jobs == []
    end
  end

  # ---------------------------------------------------------------------------
  # Tests for get_failed/2
  # ---------------------------------------------------------------------------

  describe "get_failed/2" do
    test "returns empty list when no failed jobs", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      {:ok, jobs} = Queue.get_failed(queue_name, connection: conn, prefix: prefix)
      assert jobs == []
    end
  end

  # ---------------------------------------------------------------------------
  # Tests for count getters
  # ---------------------------------------------------------------------------

  describe "get_completed_count/2" do
    test "returns 0 when no completed jobs", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, count} = Queue.get_completed_count(queue_name, connection: conn, prefix: prefix)
      assert count == 0
    end
  end

  describe "get_failed_count/2" do
    test "returns 0 when no failed jobs", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, count} = Queue.get_failed_count(queue_name, connection: conn, prefix: prefix)
      assert count == 0
    end
  end

  describe "get_delayed_count/2" do
    test "returns 0 when no delayed jobs", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, count} = Queue.get_delayed_count(queue_name, connection: conn, prefix: prefix)
      assert count == 0
    end

    test "returns correct count for delayed jobs", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      Queue.add(queue_name, "delayed1", %{}, connection: conn, prefix: prefix, delay: 60_000)
      Queue.add(queue_name, "delayed2", %{}, connection: conn, prefix: prefix, delay: 60_000)

      {:ok, count} = Queue.get_delayed_count(queue_name, connection: conn, prefix: prefix)
      assert count == 2
    end
  end

  describe "get_active_count/2" do
    test "returns 0 when no active jobs", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, count} = Queue.get_active_count(queue_name, connection: conn, prefix: prefix)
      assert count == 0
    end
  end

  describe "get_prioritized_count/2" do
    test "returns 0 when no prioritized jobs", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, count} = Queue.get_prioritized_count(queue_name, connection: conn, prefix: prefix)
      assert count == 0
    end

    test "returns correct count for prioritized jobs", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      Queue.add(queue_name, "priority1", %{}, connection: conn, prefix: prefix, priority: 1)
      Queue.add(queue_name, "priority2", %{}, connection: conn, prefix: prefix, priority: 2)
      Queue.add(queue_name, "priority3", %{}, connection: conn, prefix: prefix, priority: 3)

      {:ok, count} = Queue.get_prioritized_count(queue_name, connection: conn, prefix: prefix)
      assert count == 3
    end
  end

  describe "get_waiting_count/2" do
    test "returns 0 when no waiting jobs", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, count} = Queue.get_waiting_count(queue_name, connection: conn, prefix: prefix)
      assert count == 0
    end

    test "returns correct count for waiting jobs", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      Queue.add(queue_name, "job1", %{}, connection: conn, prefix: prefix)
      Queue.add(queue_name, "job2", %{}, connection: conn, prefix: prefix)

      {:ok, count} = Queue.get_waiting_count(queue_name, connection: conn, prefix: prefix)
      assert count == 2
    end
  end

  describe "get_waiting_children_count/2" do
    test "returns 0 when no waiting-children jobs", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      {:ok, count} = Queue.get_waiting_children_count(queue_name, connection: conn, prefix: prefix)
      assert count == 0
    end
  end

  # ---------------------------------------------------------------------------
  # Tests for global configuration getters
  # ---------------------------------------------------------------------------

  describe "get_global_concurrency/2" do
    test "returns nil when not set", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, concurrency} =
        Queue.get_global_concurrency(queue_name, connection: conn, prefix: prefix)

      assert concurrency == nil
    end

    test "returns value when set", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Set concurrency manually
      ctx = BullMQ.Keys.new(queue_name, prefix: prefix)
      RedisConnection.command(conn, ["HSET", BullMQ.Keys.meta(ctx), "concurrency", "10"])

      {:ok, concurrency} =
        Queue.get_global_concurrency(queue_name, connection: conn, prefix: prefix)

      assert concurrency == 10
    end
  end

  describe "get_global_rate_limit/2" do
    test "returns nil when not set", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, rate_limit} = Queue.get_global_rate_limit(queue_name, connection: conn, prefix: prefix)
      assert rate_limit == nil
    end

    test "returns value when set", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Set rate limit manually
      ctx = BullMQ.Keys.new(queue_name, prefix: prefix)

      RedisConnection.command(conn, [
        "HSET",
        BullMQ.Keys.meta(ctx),
        "max",
        "100",
        "duration",
        "60000"
      ])

      {:ok, rate_limit} = Queue.get_global_rate_limit(queue_name, connection: conn, prefix: prefix)
      assert rate_limit == %{max: 100, duration: 60000}
    end
  end

  describe "get_rate_limit_ttl/2" do
    test "returns result when limiter is not active", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      {:ok, ttl} = Queue.get_rate_limit_ttl(queue_name, connection: conn, prefix: prefix)
      # Returns 0 when no rate limit is active, -2 if key doesn't exist with PTTL, or actual TTL
      assert is_integer(ttl)
    end
  end

  # ---------------------------------------------------------------------------
  # Tests for deduplication
  # ---------------------------------------------------------------------------

  describe "get_deduplication_job_id/3" do
    test "returns nil when no deduplication", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, job_id} =
        Queue.get_deduplication_job_id(queue_name, "nonexistent", connection: conn, prefix: prefix)

      assert job_id == nil
    end

    test "returns job_id when deduplication exists", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      # Set deduplication key manually
      ctx = BullMQ.Keys.new(queue_name, prefix: prefix)
      RedisConnection.command(conn, ["SET", "#{BullMQ.Keys.key(ctx)}:de:my-dedup-id", "job123"])

      {:ok, job_id} =
        Queue.get_deduplication_job_id(queue_name, "my-dedup-id", connection: conn, prefix: prefix)

      assert job_id == "job123"
    end
  end

  describe "remove_deduplication_key/3" do
    test "removes existing deduplication key", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Set deduplication key manually
      ctx = BullMQ.Keys.new(queue_name, prefix: prefix)
      RedisConnection.command(conn, ["SET", "#{BullMQ.Keys.key(ctx)}:de:remove-test", "job456"])

      # Verify it exists
      {:ok, job_id} =
        Queue.get_deduplication_job_id(queue_name, "remove-test", connection: conn, prefix: prefix)

      assert job_id == "job456"

      # Remove it
      {:ok, removed} =
        Queue.remove_deduplication_key(queue_name, "remove-test", connection: conn, prefix: prefix)

      assert removed == 1

      # Verify it's gone
      {:ok, job_id} =
        Queue.get_deduplication_job_id(queue_name, "remove-test", connection: conn, prefix: prefix)

      assert job_id == nil
    end

    test "returns 0 when key doesn't exist", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, removed} =
        Queue.remove_deduplication_key(queue_name, "nonexistent-key",
          connection: conn,
          prefix: prefix
        )

      assert removed == 0
    end
  end

  # ---------------------------------------------------------------------------
  # Tests for job logs
  # ---------------------------------------------------------------------------

  describe "get_job_logs/3" do
    test "returns empty logs for job without logs", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      {:ok, job} = Queue.add(queue_name, "test", %{}, connection: conn, prefix: prefix)

      {:ok, result} = Queue.get_job_logs(queue_name, job.id, connection: conn, prefix: prefix)
      assert result.logs == []
      assert result.count == 0
    end

    test "returns logs when they exist", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, job} = Queue.add(queue_name, "test", %{}, connection: conn, prefix: prefix)

      # Add logs manually
      ctx = BullMQ.Keys.new(queue_name, prefix: prefix)
      logs_key = BullMQ.Keys.logs(ctx, job.id)

      RedisConnection.command(conn, ["RPUSH", logs_key, "Log entry 1", "Log entry 2", "Log entry 3"])

      {:ok, result} = Queue.get_job_logs(queue_name, job.id, connection: conn, prefix: prefix)
      assert result.logs == ["Log entry 1", "Log entry 2", "Log entry 3"]
      assert result.count == 3
    end

    test "supports pagination", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, job} = Queue.add(queue_name, "test", %{}, connection: conn, prefix: prefix)

      # Add logs
      ctx = BullMQ.Keys.new(queue_name, prefix: prefix)
      logs_key = BullMQ.Keys.logs(ctx, job.id)

      RedisConnection.command(conn, ["RPUSH", logs_key, "Log 1", "Log 2", "Log 3", "Log 4", "Log 5"])

      {:ok, result} =
        Queue.get_job_logs(queue_name, job.id, connection: conn, prefix: prefix, start: 0, end: 2)

      assert result.logs == ["Log 1", "Log 2", "Log 3"]
      assert result.count == 5
    end

    test "supports descending order", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, job} = Queue.add(queue_name, "test", %{}, connection: conn, prefix: prefix)

      # Add logs
      ctx = BullMQ.Keys.new(queue_name, prefix: prefix)
      logs_key = BullMQ.Keys.logs(ctx, job.id)
      RedisConnection.command(conn, ["RPUSH", logs_key, "Log 1", "Log 2", "Log 3"])

      {:ok, result} =
        Queue.get_job_logs(queue_name, job.id, connection: conn, prefix: prefix, asc: false)

      assert result.logs == ["Log 3", "Log 2", "Log 1"]
    end
  end

  # ---------------------------------------------------------------------------
  # Tests for workers
  # ---------------------------------------------------------------------------

  describe "get_workers/2" do
    test "returns list (may be empty)", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, workers} = Queue.get_workers(queue_name, connection: conn, prefix: prefix)
      assert is_list(workers)
    end

    test "returns list when using cluster_connections", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      {:ok, workers} =
        Queue.get_workers(queue_name,
          connection: conn,
          cluster_connections: [conn],
          prefix: prefix
        )

      assert is_list(workers)
    end

    test "includes worker client name when worker is started", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      {:ok, worker} =
        Worker.start_link(
          name: :worker_list_test,
          queue: queue_name,
          connection: conn,
          prefix: prefix,
          processor: fn _job -> :ok end,
          autorun: true
        )

      # allow the blocking connection to set its client name
      Process.sleep(50)

      {:ok, workers} = Queue.get_workers(queue_name, connection: conn, prefix: prefix)

      expected = "#{prefix}:#{queue_name}:w:worker_list_test"

      assert Enum.any?(workers, fn worker_info ->
               (worker_info["name"] || "") == expected
             end)

      :ok = Worker.close(worker)
    end

    test "reapplies worker client name on reconnect", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      {:ok, worker} =
        Worker.start_link(
          name: :worker_reconnect_test,
          queue: queue_name,
          connection: conn,
          prefix: prefix,
          processor: fn _job -> :ok end,
          autorun: true
        )

      Process.sleep(50)

      state = :sys.get_state(worker)
      blocking_conn = state.blocking_conn

      expected = "#{prefix}:#{queue_name}:w:worker_reconnect_test"

      :telemetry.execute([:redix, :connection], %{}, %{connection: blocking_conn})

      {:ok, name} = Redix.command(blocking_conn, ["CLIENT", "GETNAME"])
      assert name == expected

      :ok = Worker.close(worker)
    end
  end

  describe "get_workers_count/2" do
    test "returns count", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, count} = Queue.get_workers_count(queue_name, connection: conn, prefix: prefix)
      assert is_integer(count)
      assert count >= 0
    end
  end

  # ---------------------------------------------------------------------------
  # Tests for Prometheus metrics
  # ---------------------------------------------------------------------------

  describe "export_prometheus_metrics/2" do
    test "exports metrics in Prometheus format", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      # Add some jobs
      Queue.add(queue_name, "job1", %{}, connection: conn, prefix: prefix)
      Queue.add(queue_name, "job2", %{}, connection: conn, prefix: prefix)
      Queue.add(queue_name, "delayed", %{}, connection: conn, prefix: prefix, delay: 60_000)

      {:ok, metrics} = Queue.export_prometheus_metrics(queue_name, connection: conn, prefix: prefix)

      assert is_binary(metrics)
      assert String.contains?(metrics, "# HELP bullmq_job_count")
      assert String.contains?(metrics, "# TYPE bullmq_job_count gauge")
      assert String.contains?(metrics, ~s(queue="#{queue_name}"))
    end

    test "includes global variables in metrics", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      Queue.add(queue_name, "job1", %{}, connection: conn, prefix: prefix)

      {:ok, metrics} =
        Queue.export_prometheus_metrics(queue_name,
          connection: conn,
          prefix: prefix,
          global_variables: %{"env" => "test", "region" => "us-west"}
        )

      assert String.contains?(metrics, ~s(env="test"))
      assert String.contains?(metrics, ~s(region="us-west"))
    end
  end

  # ---------------------------------------------------------------------------
  # Tests for metrics
  # ---------------------------------------------------------------------------

  describe "get_metrics/3" do
    test "returns metrics structure for completed", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      {:ok, metrics} = Queue.get_metrics(queue_name, :completed, connection: conn, prefix: prefix)

      assert is_map(metrics)
      assert Map.has_key?(metrics, :meta)
      assert Map.has_key?(metrics, :data)
      assert Map.has_key?(metrics, :count)

      assert is_map(metrics.meta)
      assert Map.has_key?(metrics.meta, :count)
      assert Map.has_key?(metrics.meta, :prev_ts)
      assert Map.has_key?(metrics.meta, :prev_count)
    end

    test "returns metrics structure for failed", %{
      conn: conn,
      queue_name: queue_name,
      prefix: prefix
    } do
      {:ok, metrics} = Queue.get_metrics(queue_name, :failed, connection: conn, prefix: prefix)

      assert is_map(metrics)
      assert Map.has_key?(metrics, :meta)
      assert Map.has_key?(metrics, :data)
      assert Map.has_key?(metrics, :count)
    end
  end

  # ---------------------------------------------------------------------------
  # Tests for get_meta/2
  # ---------------------------------------------------------------------------

  describe "get_meta/2" do
    test "returns metadata structure", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, meta} = Queue.get_meta(queue_name, connection: conn, prefix: prefix)

      assert is_map(meta)
      assert Map.has_key?(meta, :paused)
      assert meta.paused == false
    end

    test "reflects paused state", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      :ok = Queue.pause(queue_name, connection: conn, prefix: prefix)

      {:ok, meta} = Queue.get_meta(queue_name, connection: conn, prefix: prefix)
      assert meta.paused == true

      :ok = Queue.resume(queue_name, connection: conn, prefix: prefix)

      {:ok, meta} = Queue.get_meta(queue_name, connection: conn, prefix: prefix)
      assert meta.paused == false
    end
  end
end
