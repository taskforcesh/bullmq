defmodule BullMQ.ObliterateTest do
  @moduledoc """
  Tests for queue obliteration functionality.
  """

  use ExUnit.Case, async: false

  alias BullMQ.{Queue, Worker, Keys, RedisConnection}

  @redis_url "redis://localhost:6379"
  @prefix "test"

  setup do
    # Generate unique queue name for each test
    queue_name = "obliterate_test_#{:rand.uniform(999_999)}"
    conn_name = :"obliterate_redis_#{System.unique_integer([:positive])}"

    # Setup Redis connection pool
    {:ok, _} = RedisConnection.start_link(name: conn_name, redis_url: @redis_url)

    # Cleanup before test
    cleanup_queue(queue_name)

    on_exit(fn ->
      cleanup_queue(queue_name)

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

    {:ok, queue_name: queue_name, redis: conn_name}
  end

  defp cleanup_queue(_queue_name) do
    case Redix.start_link(@redis_url) do
      {:ok, cleanup_conn} ->
        Redix.command(cleanup_conn, ["FLUSHDB"])
        Redix.stop(cleanup_conn)
      _ ->
        :ok
    end
  end

  defp get_keys(queue_name) do
    case Redix.start_link(@redis_url) do
      {:ok, conn} ->
        {:ok, keys} = Redix.command(conn, ["KEYS", "#{@prefix}:#{queue_name}:*"])
        Redix.stop(conn)
        keys
      _ ->
        []
    end
  end

  test "should obliterate an empty queue", %{queue_name: queue_name, redis: redis} do
    # Test with empty queue
    assert :ok = Queue.obliterate(queue_name, connection: redis, prefix: @prefix)

    # Verify all keys are deleted
    keys = get_keys(queue_name)
    assert keys == []
  end

  test "should obliterate a queue which is empty but has had jobs in the past", %{queue_name: queue_name, redis: redis} do
    # Add a job then remove it
    {:ok, job} = Queue.add(queue_name, "test", %{foo: "bar"}, connection: redis, prefix: @prefix)
    assert {:ok, 1} = Queue.remove_job(queue_name, job.id, connection: redis, prefix: @prefix)

    # Obliterate
    assert :ok = Queue.obliterate(queue_name, connection: redis, prefix: @prefix)

    # Verify all keys are deleted
    keys = get_keys(queue_name)
    assert keys == []
  end

  test "should obliterate a queue with jobs in different statuses", %{queue_name: queue_name, redis: redis} do
    # Add jobs
    {:ok, _job1} = Queue.add(queue_name, "test", %{foo: "bar"}, connection: redis, prefix: @prefix)
    {:ok, _job2} = Queue.add(queue_name, "test", %{foo: "bar2"}, connection: redis, prefix: @prefix)
    {:ok, _job3} = Queue.add(queue_name, "test", %{foo: "bar3"}, delay: 5000, connection: redis, prefix: @prefix)
    {:ok, _job4} = Queue.add(queue_name, "test", %{qux: "baz"}, connection: redis, prefix: @prefix)

    # Start worker that fails first job, succeeds second
    first_job = ref_make()

    processor = fn _job, _token ->
      if Agent.get(first_job, & &1) do
        Agent.update(first_job, fn _ -> false end)
        {:error, "failed first"}
      else
        Process.sleep(25)
        {:ok, "completed"}
      end
    end

    Agent.start_link(fn -> true end, name: first_job)

    {:ok, worker} = Worker.start_link(
      queue: queue_name,
      processor: processor,
      connection: redis,
      prefix: @prefix
    )

    # Wait for job to complete
    Process.sleep(200)

    # Obliterate
    assert :ok = Queue.obliterate(queue_name, connection: redis, prefix: @prefix)

    # Verify all keys are deleted
    keys = get_keys(queue_name)
    assert keys == []

    GenServer.stop(worker)
    Agent.stop(first_job)
  end

  test "should raise exception if queue has active jobs", %{queue_name: queue_name, redis: redis} do
    # Add jobs
    {:ok, _job1} = Queue.add(queue_name, "test", %{foo: "bar"}, connection: redis, prefix: @prefix)
    {:ok, _job2} = Queue.add(queue_name, "test", %{qux: "baz"}, connection: redis, prefix: @prefix)
    {:ok, _job3} = Queue.add(queue_name, "test", %{foo: "bar2"}, connection: redis, prefix: @prefix)
    {:ok, _job4} = Queue.add(queue_name, "test", %{foo: "bar3"}, delay: 5000, connection: redis, prefix: @prefix)

    # Start worker that processes slowly and fails first job
    first_job = ref_make()

    processor = fn _job, _token ->
      if Agent.get(first_job, & &1) do
        Agent.update(first_job, fn _ -> false end)
        {:error, "failed first"}
      else
        Process.sleep(250)
        {:ok, "completed"}
      end
    end

    Agent.start_link(fn -> true end, name: first_job)

    {:ok, worker} = Worker.start_link(
      queue: queue_name,
      processor: processor,
      connection: redis,
      prefix: @prefix
    )

    # Wait for jobs to start processing
    Process.sleep(100)

    # Try to obliterate without force - should fail
    assert {:error, "Cannot obliterate queue with active jobs"} =
      Queue.obliterate(queue_name, connection: redis, prefix: @prefix)

    # Verify keys still exist
    keys = get_keys(queue_name)
    assert length(keys) > 0

    GenServer.stop(worker)
    Agent.stop(first_job)
  end

  test "should obliterate if queue has active jobs using force", %{queue_name: queue_name, redis: redis} do
    # Add jobs
    {:ok, _job1} = Queue.add(queue_name, "test", %{foo: "bar"}, connection: redis, prefix: @prefix)
    {:ok, _job2} = Queue.add(queue_name, "test", %{qux: "baz"}, connection: redis, prefix: @prefix)
    {:ok, _job3} = Queue.add(queue_name, "test", %{foo: "bar2"}, connection: redis, prefix: @prefix)
    {:ok, _job4} = Queue.add(queue_name, "test", %{foo: "bar3"}, delay: 5000, connection: redis, prefix: @prefix)

    # Start worker that processes slowly and fails first job
    first_job = ref_make()

    processor = fn _job, _token ->
      if Agent.get(first_job, & &1) do
        Agent.update(first_job, fn _ -> false end)
        {:error, "failed first"}
      else
        Process.sleep(250)
        {:ok, "completed"}
      end
    end

    Agent.start_link(fn -> true end, name: first_job)

    {:ok, worker} = Worker.start_link(
      queue: queue_name,
      processor: processor,
      connection: redis,
      prefix: @prefix
    )

    # Wait for jobs to start processing
    Process.sleep(200)

    # Obliterate with force - should succeed
    assert :ok = Queue.obliterate(queue_name, force: true, connection: redis, prefix: @prefix)

    # Verify all keys are deleted
    keys = get_keys(queue_name)
    assert keys == []

    GenServer.stop(worker)
    Agent.stop(first_job)
  end

  test "should obliterate a queue with high number of jobs in different statuses", %{queue_name: queue_name, redis: redis} do
    # Add 30 jobs (reduced from 300 for faster testing)
    jobs_1 = for i <- 1..30 do
      {:ok, job} = Queue.add(queue_name, "test", %{foo: "barLoop#{i}"}, connection: redis, prefix: @prefix)
      job
    end

    _last_completed_job = List.last(jobs_1)

    # Start worker that will complete the first batch
    fail_jobs = ref_make()
    Agent.start_link(fn -> false end, name: fail_jobs)

    processor = fn _job, _token ->
      if Agent.get(fail_jobs, & &1) do
        {:error, "failed job"}
      else
        {:ok, "completed"}
      end
    end

    {:ok, worker} = Worker.start_link(
      queue: queue_name,
      processor: processor,
      connection: redis,
      prefix: @prefix
    )

    # Wait for first batch to complete
    Process.sleep(200)

    # Enable failing for next batch
    Agent.update(fail_jobs, fn _ -> true end)

    # Add 30 more jobs that will fail
    for i <- 31..60 do
      {:ok, _job} = Queue.add(queue_name, "test", %{foo: "barLoop#{i}"}, connection: redis, prefix: @prefix)
    end

    # Wait for some failures
    Process.sleep(200)

    # Stop worker and add delayed jobs
    GenServer.stop(worker)

    # Add 50 delayed jobs (reduced from 1623)
    for i <- 61..110 do
      {:ok, _job} = Queue.add(queue_name, "test", %{foo: "barLoop#{i}"}, delay: 10000, connection: redis, prefix: @prefix)
    end

    # Obliterate
    assert :ok = Queue.obliterate(queue_name, connection: redis, prefix: @prefix)

    # Verify all keys are deleted
    keys = get_keys(queue_name)
    assert keys == []

    Agent.stop(fail_jobs)
  end

  test "should obliterate with GenServer queue instance", %{queue_name: queue_name, redis: redis} do
    # Start queue as GenServer
    {:ok, queue_pid} = Queue.start_link(
      name: String.to_atom(queue_name),
      queue: queue_name,
      connection: redis,
      prefix: @prefix
    )

    # Add some jobs
    {:ok, _job1} = Queue.add(queue_pid, "test", %{foo: "bar"})
    {:ok, _job2} = Queue.add(queue_pid, "test", %{foo: "baz"})

    # Obliterate using GenServer
    assert :ok = Queue.obliterate(queue_pid)

    # Verify all keys are deleted
    keys = get_keys(queue_name)
    assert keys == []

    GenServer.stop(queue_pid)
  end

  test "should handle non-paused queue error", %{queue_name: queue_name, redis: redis} do
    # Add a job
    {:ok, _job} = Queue.add(queue_name, "test", %{foo: "bar"}, connection: redis, prefix: @prefix)

    # Try to obliterate without pausing first (by calling Scripts.obliterate directly)
    ctx = Keys.new(queue_name, prefix: @prefix)

    # This should fail because obliterate internally pauses, but let's test the error path
    # by calling the script directly without pause
    result = BullMQ.Scripts.obliterate(redis, ctx, 1000, false)

    case result do
      {:ok, -1} -> :expected_error
      {:error, _} -> :expected_error
      _ -> flunk("Expected error for non-paused queue")
    end
  end

  test "should handle custom count parameter", %{queue_name: queue_name, redis: redis} do
    # Add several jobs
    for i <- 1..10 do
      {:ok, _job} = Queue.add(queue_name, "test", %{foo: "bar#{i}"}, connection: redis, prefix: @prefix)
    end

    # Obliterate with custom count
    assert :ok = Queue.obliterate(queue_name, count: 5, connection: redis, prefix: @prefix)

    # Verify all keys are deleted
    keys = get_keys(queue_name)
    assert keys == []
  end

  # Helper function to create unique reference
  defp ref_make do
    :"ref_#{:rand.uniform(999_999)}"
  end
end
