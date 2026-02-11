defmodule BullMQ.ManualProcessingTest do
  @moduledoc """
  Tests for manual job processing - fetching jobs without automatic processing.

  This tests the pattern where users call Worker.get_next_job() and then
  manually call Job.move_to_completed/move_to_failed.
  """

  use ExUnit.Case, async: false

  alias BullMQ.{Job, Queue, Worker}

  @moduletag :integration
  @redis_url BullMQ.TestHelper.redis_url()
  @test_prefix BullMQ.TestHelper.test_prefix() <> "_manual"

  setup do
    pool_name = :"manual_pool_#{System.unique_integer([:positive])}"
    queue_name = "test-manual-#{System.unique_integer([:positive])}"

    # Start the connection pool - unlink so test cleanup doesn't cascade
    {:ok, pool_pid} =
      BullMQ.RedisConnection.start_link(
        name: pool_name,
        url: @redis_url,
        pool_size: 5
      )

    Process.unlink(pool_pid)

    on_exit(fn ->
      # Close the pool (waits for scripts to load)
      BullMQ.RedisConnection.close(pool_name)

      # Clean up Redis keys
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

    {:ok, conn: pool_name, queue_name: queue_name}
  end

  describe "get_next_job/3" do
    @tag timeout: 10_000
    test "fetches a job from the queue", %{conn: conn, queue_name: queue_name} do
      # Create a worker without a processor (manual mode)
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job -> {:ok, "unused"} end,
          autorun: false
        )

      # Add a job to the queue
      {:ok, job} =
        Queue.add(queue_name, "test-job", %{value: 123}, connection: conn, prefix: @test_prefix)

      # Fetch the job manually
      token = generate_token()
      {:ok, fetched_job} = Worker.get_next_job(worker, token)

      assert fetched_job != nil
      assert fetched_job.id == job.id
      assert fetched_job.name == "test-job"
      assert fetched_job.data == %{"value" => 123}
      assert fetched_job.token == token

      Worker.close(worker)
    end

    @tag timeout: 10_000
    test "returns nil when no jobs available", %{conn: conn, queue_name: queue_name} do
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job -> {:ok, "unused"} end,
          autorun: false
        )

      token = generate_token()
      {:ok, job} = Worker.get_next_job(worker, token, block: false)

      assert job == nil

      Worker.close(worker)
    end

    @tag timeout: 10_000
    test "blocks and waits for job when block: true", %{conn: conn, queue_name: queue_name} do
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job -> {:ok, "unused"} end,
          autorun: false
        )

      test_pid = self()

      # Start a task that will wait for a job
      task =
        Task.async(fn ->
          token = generate_token()
          start_time = System.monotonic_time(:millisecond)
          result = Worker.get_next_job(worker, token, timeout: 5)
          end_time = System.monotonic_time(:millisecond)
          send(test_pid, {:got_result, result, end_time - start_time})
        end)

      # Wait a bit, then add a job
      Process.sleep(500)

      {:ok, job} =
        Queue.add(queue_name, "delayed-job", %{value: "test"},
          connection: conn,
          prefix: @test_prefix
        )

      # Wait for the task to complete
      Task.await(task, 10_000)

      # Should have received the job
      assert_receive {:got_result, {:ok, fetched_job}, wait_time}, 5_000
      assert fetched_job != nil
      assert fetched_job.id == job.id
      # Wait time should be around 500ms (the delay we added)
      assert wait_time >= 400 and wait_time < 2000

      Worker.close(worker)
    end

    @tag timeout: 10_000
    test "times out when no job arrives within timeout", %{conn: conn, queue_name: queue_name} do
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job -> {:ok, "unused"} end,
          autorun: false
        )

      token = generate_token()

      # Use a short timeout
      start_time = System.monotonic_time(:millisecond)
      {:ok, job} = Worker.get_next_job(worker, token, timeout: 1)
      end_time = System.monotonic_time(:millisecond)

      assert job == nil
      # Should have waited approximately 1 second
      wait_time = end_time - start_time
      assert wait_time >= 900 and wait_time < 2000

      Worker.close(worker)
    end

    @tag timeout: 10_000
    test "returns nil when worker is paused", %{conn: conn, queue_name: queue_name} do
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job -> {:ok, "unused"} end,
          autorun: false
        )

      # Pause the worker
      Worker.pause(worker)

      # Add a job
      {:ok, _job} = Queue.add(queue_name, "test-job", %{}, connection: conn, prefix: @test_prefix)

      # Should return nil when paused
      token = generate_token()
      {:ok, job} = Worker.get_next_job(worker, token)

      assert job == nil

      Worker.close(worker)
    end
  end

  describe "Job.move_to_completed/4" do
    @tag timeout: 10_000
    test "moves job to completed state", %{conn: conn, queue_name: queue_name} do
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job -> {:ok, "unused"} end,
          autorun: false
        )

      # Add a job
      {:ok, _job} =
        Queue.add(queue_name, "test-job", %{value: 456}, connection: conn, prefix: @test_prefix)

      # Fetch and complete the job
      token = generate_token()
      {:ok, job} = Worker.get_next_job(worker, token)

      assert job != nil

      # Complete the job
      {:ok, _next} = Job.move_to_completed(job, %{result: "done"}, token, fetch_next: false)

      # Verify job is completed
      {:ok, state} = Queue.get_job_state(queue_name, job.id, connection: conn, prefix: @test_prefix)
      assert state == "completed"

      Worker.close(worker)
    end

    @tag timeout: 10_000
    test "returns next job when fetch_next: true", %{conn: conn, queue_name: queue_name} do
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job -> {:ok, "unused"} end,
          autorun: false
        )

      # Add two jobs
      {:ok, job1} = Queue.add(queue_name, "job-1", %{}, connection: conn, prefix: @test_prefix)
      {:ok, job2} = Queue.add(queue_name, "job-2", %{}, connection: conn, prefix: @test_prefix)

      # Fetch first job
      token = generate_token()
      {:ok, fetched1} = Worker.get_next_job(worker, token)
      assert fetched1.id == job1.id

      # Complete and get next job
      {:ok, next_data} = Job.move_to_completed(fetched1, "done", token, fetch_next: true)

      # Should return the next job data
      assert next_data != nil
      {job_data, next_id} = next_data
      assert next_id == job2.id
      assert is_list(job_data)

      Worker.close(worker)
    end
  end

  describe "Job.move_to_failed/4" do
    @tag timeout: 10_000
    test "moves job to failed state", %{conn: conn, queue_name: queue_name} do
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job -> {:ok, "unused"} end,
          autorun: false
        )

      # Add a job (with no retries)
      {:ok, _job} =
        Queue.add(queue_name, "test-job", %{}, connection: conn, prefix: @test_prefix, attempts: 1)

      # Fetch and fail the job
      token = generate_token()
      {:ok, job} = Worker.get_next_job(worker, token)

      assert job != nil

      # Fail the job
      {:ok, _} = Job.move_to_failed(job, "Something went wrong", token)

      # Verify job is failed
      {:ok, state} = Queue.get_job_state(queue_name, job.id, connection: conn, prefix: @test_prefix)
      assert state == "failed"

      Worker.close(worker)
    end

    @tag timeout: 10_000
    test "accepts exception as error", %{conn: conn, queue_name: queue_name} do
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job -> {:ok, "unused"} end,
          autorun: false
        )

      # Add a job
      {:ok, _job} =
        Queue.add(queue_name, "test-job", %{}, connection: conn, prefix: @test_prefix, attempts: 1)

      # Fetch and fail with exception
      token = generate_token()
      {:ok, job} = Worker.get_next_job(worker, token)

      error = %RuntimeError{message: "Test error"}
      {:ok, _} = Job.move_to_failed(job, error, token)

      # Verify job is failed
      {:ok, state} = Queue.get_job_state(queue_name, job.id, connection: conn, prefix: @test_prefix)
      assert state == "failed"

      Worker.close(worker)
    end
  end

  describe "Job.extend_lock/3" do
    @tag timeout: 10_000
    test "extends the lock on a job", %{conn: conn, queue_name: queue_name} do
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job -> {:ok, "unused"} end,
          autorun: false,
          # Short lock for testing
          lock_duration: 5_000
        )

      # Add a job
      {:ok, _job} = Queue.add(queue_name, "test-job", %{}, connection: conn, prefix: @test_prefix)

      # Fetch the job
      token = generate_token()
      {:ok, job} = Worker.get_next_job(worker, token)

      assert job != nil

      # Extend the lock
      {:ok, _} = Job.extend_lock(job, token, 30_000)

      # Job should still be active
      {:ok, state} = Queue.get_job_state(queue_name, job.id, connection: conn, prefix: @test_prefix)
      assert state == "active"

      # Complete the job
      {:ok, _} = Job.move_to_completed(job, "done", token, fetch_next: false)

      Worker.close(worker)
    end
  end

  describe "Job.move_to_wait/2" do
    @tag timeout: 10_000
    test "moves job back to waiting state", %{conn: conn, queue_name: queue_name} do
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job -> {:ok, "unused"} end,
          autorun: false
        )

      # Add a job
      {:ok, original_job} =
        Queue.add(queue_name, "test-job", %{value: 789}, connection: conn, prefix: @test_prefix)

      # Fetch the job
      token = generate_token()
      {:ok, job} = Worker.get_next_job(worker, token)

      assert job != nil
      assert job.id == original_job.id

      # Move back to wait (simulating rate limiting)
      {:ok, _pttl} = Job.move_to_wait(job, token)

      # Verify job is back in waiting
      {:ok, state} = Queue.get_job_state(queue_name, job.id, connection: conn, prefix: @test_prefix)
      assert state == "waiting"

      # Job should be fetchable again
      new_token = generate_token()
      {:ok, refetched_job} = Worker.get_next_job(worker, new_token)

      assert refetched_job != nil
      assert refetched_job.id == original_job.id

      # Complete it this time
      {:ok, _} = Job.move_to_completed(refetched_job, "done", new_token, fetch_next: false)

      Worker.close(worker)
    end
  end

  describe "start_stalled_check_timer/1" do
    @tag timeout: 10_000
    test "starts and stops the stalled check timer", %{conn: conn, queue_name: queue_name} do
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job -> {:ok, "unused"} end,
          autorun: false,
          stalled_interval: 1_000
        )

      # Start the timer
      :ok = Worker.start_stalled_check_timer(worker)

      # Timer should be running (we can't directly check, but it shouldn't error)

      # Stop the timer
      :ok = Worker.stop_stalled_check_timer(worker)

      Worker.close(worker)
    end
  end

  describe "complete manual processing loop" do
    @tag timeout: 15_000
    test "processes multiple jobs in a loop", %{conn: conn, queue_name: queue_name} do
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job -> {:ok, "unused"} end,
          autorun: false
        )

      # Start stalled check timer
      :ok = Worker.start_stalled_check_timer(worker)

      # Add multiple jobs
      jobs =
        for i <- 1..5 do
          {:ok, job} =
            Queue.add(queue_name, "job-#{i}", %{index: i}, connection: conn, prefix: @test_prefix)

          job
        end

      # Process all jobs manually
      token = generate_token()

      processed_ids =
        Enum.reduce_while(1..10, [], fn _, acc ->
          case Worker.get_next_job(worker, token, block: false) do
            {:ok, nil} ->
              {:halt, acc}

            {:ok, job} ->
              # Simulate processing
              result = %{processed: job.data["index"]}
              {:ok, _} = Job.move_to_completed(job, result, token, fetch_next: false)
              {:cont, [job.id | acc]}
          end
        end)

      # Should have processed all 5 jobs
      assert length(processed_ids) == 5
      assert Enum.all?(jobs, fn job -> job.id in processed_ids end)

      # All jobs should be completed
      for job <- jobs do
        {:ok, state} =
          Queue.get_job_state(queue_name, job.id, connection: conn, prefix: @test_prefix)

        assert state == "completed"
      end

      Worker.close(worker)
    end
  end

  # Helper to generate unique tokens
  defp generate_token do
    Base.encode16(:crypto.strong_rand_bytes(16), case: :lower)
  end
end
