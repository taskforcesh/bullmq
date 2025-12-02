defmodule BullMQ.QueueIntegrationTest do
  @moduledoc """
  Integration tests for the Queue module with a real Redis instance.

  These tests use the Queue module methods rather than raw Redis commands,
  following the patterns from the Node.js BullMQ test suite.
  """
  use ExUnit.Case, async: false

  @moduletag :integration

  alias BullMQ.{Queue, Job, RedisConnection}

  @redis_url BullMQ.TestHelper.redis_url()
  @test_prefix BullMQ.TestHelper.test_prefix()

  setup do
    # Start a Redis connection pool for this test
    conn_name = :"queue_test_conn_#{System.unique_integer([:positive])}"
    queue_name = "test-queue-#{System.unique_integer([:positive])}"

    {:ok, _} = RedisConnection.start_link(name: conn_name, redis_url: @redis_url)

    on_exit(fn ->
      # Cleanup queue data
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

  describe "Queue.add/4" do
    @tag :integration
    test "adds a job to the queue", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, job} = Queue.add(queue_name, "test-job", %{user_id: 123},
        connection: conn,
        prefix: prefix
      )

      assert job.id != nil
      assert job.name == "test-job"
      assert job.data == %{user_id: 123}
    end

    @tag :integration
    test "retrieves added job via get_job", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, added_job} = Queue.add(queue_name, "fetch-test", %{foo: "bar", num: 123},
        connection: conn,
        prefix: prefix
      )

      {:ok, fetched_job} = Queue.get_job(queue_name, added_job.id,
        connection: conn,
        prefix: prefix
      )

      assert fetched_job.id == added_job.id
      assert fetched_job.name == "fetch-test"
      assert fetched_job.data["foo"] == "bar"
      assert fetched_job.data["num"] == 123
    end

    @tag :integration
    test "job appears in waiting jobs", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, job} = Queue.add(queue_name, "state-test", %{},
        connection: conn,
        prefix: prefix
      )

      {:ok, waiting_jobs} = Queue.get_jobs(queue_name, [:waiting],
        connection: conn,
        prefix: prefix
      )

      assert length(waiting_jobs) == 1
      assert hd(waiting_jobs).id == job.id
    end

    @tag :integration
    test "delayed job appears in delayed jobs", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, job} = Queue.add(queue_name, "delayed-job", %{},
        connection: conn,
        prefix: prefix,
        delay: 60_000  # 1 minute delay
      )

      {:ok, delayed_jobs} = Queue.get_jobs(queue_name, [:delayed],
        connection: conn,
        prefix: prefix
      )

      assert length(delayed_jobs) == 1
      assert hd(delayed_jobs).id == job.id
    end

    @tag :integration
    test "prioritized job appears in prioritized jobs", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      {:ok, job} = Queue.add(queue_name, "priority-job", %{},
        connection: conn,
        prefix: prefix,
        priority: 5
      )

      {:ok, prioritized_jobs} = Queue.get_jobs(queue_name, [:prioritized],
        connection: conn,
        prefix: prefix
      )

      assert length(prioritized_jobs) == 1
      assert hd(prioritized_jobs).id == job.id
    end
  end

  describe "Queue.add_bulk/3" do
    @tag :integration
    test "adds multiple jobs in single operation", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      jobs = [
        {"email", %{to: "user1@example.com"}, []},
        {"email", %{to: "user2@example.com"}, []},
        {"email", %{to: "user3@example.com"}, []}
      ]

      {:ok, added_jobs} = Queue.add_bulk(queue_name, jobs,
        connection: conn,
        prefix: prefix
      )

      assert length(added_jobs) == 3
      assert Enum.all?(added_jobs, &(&1.name == "email"))
    end

    @tag :integration
    test "pipelining is enabled by default", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Create 500 jobs to test pipelining
      jobs = for i <- 1..500, do: {"job", %{index: i}, []}

      {:ok, added_jobs} = Queue.add_bulk(queue_name, jobs,
        connection: conn,
        prefix: prefix
      )

      assert length(added_jobs) == 500
      # All jobs should have unique IDs
      ids = Enum.map(added_jobs, & &1.id)
      assert length(Enum.uniq(ids)) == 500
    end

    @tag :integration
    test "respects chunk_size option", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      jobs = for i <- 1..250, do: {"job", %{index: i}, []}

      {:ok, added_jobs} = Queue.add_bulk(queue_name, jobs,
        connection: conn,
        prefix: prefix,
        chunk_size: 50
      )

      assert length(added_jobs) == 250
    end

    @tag :integration
    test "works with connection pool for parallel processing", %{queue_name: queue_name, prefix: prefix} do
      # Create a pool of connections using RedisConnection
      pool = for i <- 1..4 do
        name = :"test_pool_conn_#{i}_#{:erlang.unique_integer([:positive])}"
        {:ok, _} = RedisConnection.start_link(name: name, redis_url: @redis_url)
        name
      end

      jobs = for i <- 1..1000, do: {"job", %{index: i}, []}

      {:ok, added_jobs} = Queue.add_bulk(queue_name, jobs,
        connection: hd(pool),
        connection_pool: pool,
        prefix: prefix,
        chunk_size: 100
      )

      assert length(added_jobs) == 1000

      # Cleanup pool connections
      Enum.each(pool, fn name ->
        supervisor_name = :"#{name}_supervisor"
        if Process.whereis(supervisor_name), do: Supervisor.stop(supervisor_name)
      end)
    end

    @tag :integration
    test "sequential mode (pipeline: false) works", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      jobs = for i <- 1..10, do: {"job", %{index: i}, []}

      {:ok, added_jobs} = Queue.add_bulk(queue_name, jobs,
        connection: conn,
        prefix: prefix,
        pipeline: false
      )

      assert length(added_jobs) == 10
    end

    @tag :integration
    test "handles mixed job types (standard, delayed, prioritized)", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      jobs = [
        # Standard jobs (pipelined)
        {"standard1", %{type: "standard"}, []},
        {"standard2", %{type: "standard"}, []},
        # Delayed job (sequential)
        {"delayed", %{type: "delayed"}, [delay: 60_000]},
        # Prioritized job (sequential)
        {"priority", %{type: "priority"}, [priority: 1]}
      ]

      {:ok, added_jobs} = Queue.add_bulk(queue_name, jobs,
        connection: conn,
        prefix: prefix
      )

      assert length(added_jobs) == 4

      # Verify each job type was added correctly
      names = Enum.map(added_jobs, & &1.name)
      assert "standard1" in names
      assert "standard2" in names
      assert "delayed" in names
      assert "priority" in names
    end

    @tag :integration
    test "preserves job data and options", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      jobs = [
        {"job1", %{key: "value1", nested: %{a: 1}}, [attempts: 3]},
        {"job2", %{key: "value2", list: [1, 2, 3]}, [attempts: 5]}
      ]

      {:ok, [job1, job2]} = Queue.add_bulk(queue_name, jobs,
        connection: conn,
        prefix: prefix
      )

      assert job1.name == "job1"
      assert job1.data == %{key: "value1", nested: %{a: 1}}

      assert job2.name == "job2"
      assert job2.data == %{key: "value2", list: [1, 2, 3]}
    end

    @tag :integration
    test "large batch performance (10000 jobs)", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      jobs = for i <- 1..10_000, do: {"job", %{index: i}, []}

      {time, {:ok, added_jobs}} = :timer.tc(fn ->
        Queue.add_bulk(queue_name, jobs,
          connection: conn,
          prefix: prefix,
          chunk_size: 100
        )
      end)

      assert length(added_jobs) == 10_000

      # Should complete in reasonable time (< 5 seconds with pipelining)
      time_sec = time / 1_000_000
      assert time_sec < 5, "Bulk add took too long: #{time_sec}s"

      # Calculate throughput
      rate = 10_000 / time_sec
      # With pipelining, should achieve at least 5000 jobs/sec
      assert rate > 5000, "Throughput too low: #{round(rate)} jobs/sec"
    end
  end

  describe "Queue.count/2" do
    @tag :integration
    test "returns count of jobs waiting to be processed", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Add regular waiting jobs
      for i <- 1..5 do
        {:ok, _} = Queue.add(queue_name, "job-#{i}", %{index: i},
          connection: conn,
          prefix: prefix
        )
      end

      # Add delayed jobs
      for i <- 1..3 do
        {:ok, _} = Queue.add(queue_name, "delayed-#{i}", %{index: i},
          connection: conn,
          prefix: prefix,
          delay: 60_000
        )
      end

      # Add prioritized jobs
      for i <- 1..2 do
        {:ok, _} = Queue.add(queue_name, "priority-#{i}", %{index: i},
          connection: conn,
          prefix: prefix,
          priority: i
        )
      end

      {:ok, count} = Queue.count(queue_name,
        connection: conn,
        prefix: prefix
      )

      # count should include waiting (5) + delayed (3) + prioritized (2)
      assert count == 10
    end
  end

  describe "Queue.get_job_counts/3" do
    @tag :integration
    test "returns counts for specific job types", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Add jobs of different types
      for i <- 1..5 do
        {:ok, _} = Queue.add(queue_name, "waiting-#{i}", %{},
          connection: conn,
          prefix: prefix
        )
      end

      for i <- 1..3 do
        {:ok, _} = Queue.add(queue_name, "delayed-#{i}", %{},
          connection: conn,
          prefix: prefix,
          delay: 60_000
        )
      end

      {:ok, counts} = Queue.get_job_counts(queue_name, [:waiting, :delayed],
        connection: conn,
        prefix: prefix
      )

      assert counts[:waiting] == 5
      assert counts[:delayed] == 3
    end
  end

  describe "Queue.get_job_count_by_types/3" do
    @tag :integration
    test "returns total count for specified types", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Add jobs
      for i <- 1..4 do
        {:ok, _} = Queue.add(queue_name, "job-#{i}", %{},
          connection: conn,
          prefix: prefix
        )
      end

      for i <- 1..6 do
        {:ok, _} = Queue.add(queue_name, "delayed-#{i}", %{},
          connection: conn,
          prefix: prefix,
          delay: 60_000
        )
      end

      {:ok, total} = Queue.get_job_count_by_types(queue_name, [:waiting, :delayed],
        connection: conn,
        prefix: prefix
      )

      assert total == 10
    end
  end

  describe "Queue.get_jobs/3" do
    @tag :integration
    test "retrieves jobs from multiple states", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Add waiting jobs
      for i <- 1..3 do
        {:ok, _} = Queue.add(queue_name, "waiting-#{i}", %{index: i},
          connection: conn,
          prefix: prefix
        )
      end

      # Add delayed jobs
      for i <- 1..2 do
        {:ok, _} = Queue.add(queue_name, "delayed-#{i}", %{index: i},
          connection: conn,
          prefix: prefix,
          delay: 60_000
        )
      end

      # Get all jobs from waiting and delayed
      {:ok, all_jobs} = Queue.get_jobs(queue_name, [:waiting, :delayed],
        connection: conn,
        prefix: prefix
      )

      assert length(all_jobs) == 5
      assert Enum.all?(all_jobs, &is_struct(&1, Job))
    end

    @tag :integration
    test "retrieves jobs with pagination", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Add 10 jobs
      for i <- 1..10 do
        {:ok, _} = Queue.add(queue_name, "job-#{i}", %{index: i},
          connection: conn,
          prefix: prefix
        )
      end

      # Get first 3 jobs
      {:ok, first_page} = Queue.get_jobs(queue_name, [:waiting],
        connection: conn,
        prefix: prefix,
        start: 0,
        end: 2
      )

      assert length(first_page) == 3
    end
  end

  describe "Queue.get_meta/2" do
    @tag :integration
    test "returns queue metadata", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Add a job to initialize the queue
      {:ok, _} = Queue.add(queue_name, "test", %{},
        connection: conn,
        prefix: prefix
      )

      {:ok, meta} = Queue.get_meta(queue_name,
        connection: conn,
        prefix: prefix
      )

      assert is_map(meta)
      assert Map.has_key?(meta, :paused)
      assert meta.paused == false
    end

    @tag :integration
    test "reflects paused state", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Add a job first
      {:ok, _} = Queue.add(queue_name, "test", %{},
        connection: conn,
        prefix: prefix
      )

      # Pause the queue
      :ok = Queue.pause(queue_name,
        connection: conn,
        prefix: prefix
      )

      {:ok, meta} = Queue.get_meta(queue_name,
        connection: conn,
        prefix: prefix
      )

      assert meta.paused == true
    end
  end

  describe "Queue.pause/2 and Queue.resume/2" do
    @tag :integration
    test "pauses and resumes queue", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Add a job
      {:ok, _} = Queue.add(queue_name, "test", %{},
        connection: conn,
        prefix: prefix
      )

      # Verify not paused
      assert Queue.paused?(queue_name, connection: conn, prefix: prefix) == false

      # Pause
      :ok = Queue.pause(queue_name, connection: conn, prefix: prefix)
      assert Queue.paused?(queue_name, connection: conn, prefix: prefix) == true

      # Resume
      :ok = Queue.resume(queue_name, connection: conn, prefix: prefix)
      assert Queue.paused?(queue_name, connection: conn, prefix: prefix) == false
    end

    @tag :integration
    test "paused queue shows jobs in paused count", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Pause first
      :ok = Queue.pause(queue_name, connection: conn, prefix: prefix)

      # Add jobs while paused
      for i <- 1..3 do
        {:ok, _} = Queue.add(queue_name, "job-#{i}", %{},
          connection: conn,
          prefix: prefix
        )
      end

      {:ok, counts} = Queue.get_job_counts(queue_name, [:paused],
        connection: conn,
        prefix: prefix
      )

      assert counts[:paused] == 3
    end
  end

  describe "Queue.drain/2" do
    @tag :integration
    test "removes all waiting jobs", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Add jobs
      for i <- 1..5 do
        {:ok, _} = Queue.add(queue_name, "job-#{i}", %{},
          connection: conn,
          prefix: prefix
        )
      end

      {:ok, count_before} = Queue.count(queue_name,
        connection: conn,
        prefix: prefix
      )
      assert count_before == 5

      # Drain
      :ok = Queue.drain(queue_name,
        connection: conn,
        prefix: prefix
      )

      {:ok, count_after} = Queue.count(queue_name,
        connection: conn,
        prefix: prefix
      )
      assert count_after == 0
    end

    @tag :integration
    test "drain without delayed option keeps delayed jobs", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Add regular jobs
      for i <- 1..3 do
        {:ok, _} = Queue.add(queue_name, "job-#{i}", %{},
          connection: conn,
          prefix: prefix
        )
      end

      # Add delayed jobs
      for i <- 1..2 do
        {:ok, _} = Queue.add(queue_name, "delayed-#{i}", %{},
          connection: conn,
          prefix: prefix,
          delay: 60_000
        )
      end

      # Drain without delayed flag
      :ok = Queue.drain(queue_name,
        connection: conn,
        prefix: prefix,
        delayed: false
      )

      {:ok, counts} = Queue.get_job_counts(queue_name, [:waiting, :delayed],
        connection: conn,
        prefix: prefix
      )

      # Waiting jobs should be gone, delayed should remain
      assert counts[:waiting] == 0
      assert counts[:delayed] == 2
    end

    @tag :integration
    test "drain with delayed option removes all jobs", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Add regular jobs
      for i <- 1..3 do
        {:ok, _} = Queue.add(queue_name, "job-#{i}", %{},
          connection: conn,
          prefix: prefix
        )
      end

      # Add delayed jobs
      for i <- 1..2 do
        {:ok, _} = Queue.add(queue_name, "delayed-#{i}", %{},
          connection: conn,
          prefix: prefix,
          delay: 60_000
        )
      end

      # Drain with delayed flag
      :ok = Queue.drain(queue_name,
        connection: conn,
        prefix: prefix,
        delayed: true
      )

      {:ok, counts} = Queue.get_job_counts(queue_name, [:waiting, :delayed],
        connection: conn,
        prefix: prefix
      )

      assert counts[:waiting] == 0
      assert counts[:delayed] == 0
    end
  end

  describe "Queue.remove_job/3" do
    @tag :integration
    test "removes a specific job", %{conn: conn, queue_name: queue_name, prefix: prefix} do
      # Add jobs
      {:ok, _job1} = Queue.add(queue_name, "keep", %{},
        connection: conn,
        prefix: prefix
      )
      {:ok, job_to_remove} = Queue.add(queue_name, "remove", %{},
        connection: conn,
        prefix: prefix
      )
      {:ok, _job2} = Queue.add(queue_name, "keep", %{},
        connection: conn,
        prefix: prefix
      )

      # Remove specific job
      {:ok, removed} = Queue.remove_job(queue_name, job_to_remove.id,
        connection: conn,
        prefix: prefix
      )

      assert removed == 1

      # Verify job is gone
      {:ok, fetched} = Queue.get_job(queue_name, job_to_remove.id,
        connection: conn,
        prefix: prefix
      )
      assert fetched == nil

      # Verify other jobs remain
      {:ok, count} = Queue.count(queue_name,
        connection: conn,
        prefix: prefix
      )
      assert count == 2
    end
  end
end
