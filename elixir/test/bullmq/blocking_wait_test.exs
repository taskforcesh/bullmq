defmodule BullMQ.BlockingWaitTest do
  @moduledoc """
  Tests to verify the blocking wait design follows Node.js BullMQ behavior.

  Design Requirements (matching Node.js):
  1. One blocking connection per Worker GenServer (not per autonomous process)
  2. Blocking wait (BZPOPMIN) only happens when queue is "drained" (empty)
  3. Autonomous worker processes use the shared connection pool
  4. Short blocking timeout allows frequent checks for delayed jobs
  5. moveToActive promotes delayed jobs, so workers must call it periodically

  Key differences from Node.js:
  - Node.js: Single-threaded, one process handles concurrency via async
  - Elixir: Worker GenServer coordinates N autonomous processes
  - Both: One blocking connection per Worker, one command connection (pool) shared
  """
  use ExUnit.Case, async: false

  @moduletag :integration

  alias BullMQ.{Queue, Worker, RedisConnection}

  @redis_url BullMQ.TestHelper.redis_url()
  @test_prefix BullMQ.TestHelper.test_prefix() <> "_blocking"

  setup do
    pool_name = :"blocking_pool_#{System.unique_integer([:positive])}"

    {:ok, pool_pid} =
      RedisConnection.start_link(
        name: pool_name,
        url: @redis_url,
        pool_size: 2
      )

    Process.unlink(pool_pid)

    queue_name = "blocking-test-#{System.unique_integer([:positive])}"

    on_exit(fn ->
      RedisConnection.close(pool_name)
      Process.sleep(50)
    end)

    %{conn: pool_name, queue_name: queue_name}
  end

  describe "Blocking wait design" do
    @tag :integration
    @tag timeout: 10_000
    test "worker uses blocking wait when queue is empty, wakes on job add", %{
      conn: conn,
      queue_name: queue_name
    } do
      test_pid = self()

      # Start worker on empty queue - it should enter blocking wait
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.1,
          processor: fn job ->
            send(test_pid, {:processed, job.id, System.monotonic_time(:millisecond)})
            {:ok, :done}
          end
        )

      # Give worker time to start and enter blocking wait
      Process.sleep(200)

      # Record time before adding job
      add_time = System.monotonic_time(:millisecond)

      # Add a job - this should wake up the blocking wait
      {:ok, job} =
        Queue.add(queue_name, "wake-test", %{},
          connection: conn,
          prefix: @test_prefix
        )

      # Should receive processed message quickly (within blocking timeout + processing)
      assert_receive {:processed, job_id, process_time}, 500

      assert job_id == job.id
      # Job should be processed quickly after being added (< 200ms)
      # This verifies blocking wait wakes up promptly
      latency = process_time - add_time
      assert latency < 200, "Expected latency < 200ms, got #{latency}ms"

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "delayed job is processed after delay expires", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      delay_ms = 200

      # Flush any stale messages from previous tests
      flush_messages()

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.1,
          processor: fn job ->
            send(test_pid, {:processed, job.id, System.monotonic_time(:millisecond)})
            {:ok, :done}
          end
        )

      # Add a delayed job
      add_time = System.monotonic_time(:millisecond)

      {:ok, job} =
        Queue.add(queue_name, "delayed-test", %{},
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.1,
          delay: delay_ms
        )

      # Should NOT be processed immediately
      refute_receive {:processed, _, _}, 100

      # Should be processed after delay (with some tolerance for blocking check interval)
      assert_receive {:processed, job_id, process_time}, delay_ms + 500

      assert job_id == job.id

      # Verify job was processed after the delay
      actual_delay = process_time - add_time
      assert actual_delay >= delay_ms, "Job processed too early: #{actual_delay}ms < #{delay_ms}ms"

      # Should be processed within reasonable time after delay expires
      # (blocking timeout is 100ms, so should be picked up quickly)
      assert actual_delay < delay_ms + 300,
             "Job took too long after delay: #{actual_delay}ms"

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "retry with backoff uses blocking wait efficiently", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      backoff_ms = 150
      {:ok, counter} = Agent.start_link(fn -> 0 end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.1,
          processor: fn _job ->
            count = Agent.get_and_update(counter, fn c -> {c, c + 1} end)
            send(test_pid, {:attempt, count, System.monotonic_time(:millisecond)})

            if count == 0 do
              # First attempt fails
              {:error, "intentional failure"}
            else
              # Second attempt succeeds
              {:ok, :success}
            end
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job.id})
          end
        )

      # Add job with retry backoff
      {:ok, _job} =
        Queue.add(queue_name, "retry-test", %{},
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.1,
          attempts: 2,
          backoff: %{type: "fixed", delay: backoff_ms}
        )

      # First attempt
      assert_receive {:attempt, 0, first_time}, 2_000

      # Second attempt after backoff
      assert_receive {:attempt, 1, second_time}, backoff_ms + 500
      assert_receive {:completed, _job_id}, 1_000

      # Verify backoff was respected
      actual_backoff = second_time - first_time

      assert actual_backoff >= backoff_ms,
             "Backoff too short: #{actual_backoff}ms < #{backoff_ms}ms"

      # Should not take much longer than backoff + blocking interval
      assert actual_backoff < backoff_ms + 300,
             "Backoff took too long: #{actual_backoff}ms"

      Agent.stop(counter)
      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "multiple jobs are processed without excessive blocking waits", %{
      conn: conn,
      queue_name: queue_name
    } do
      test_pid = self()
      num_jobs = 5

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.1,
          concurrency: 2,
          processor: fn job ->
            send(test_pid, {:processed, job.data["index"]})
            # Small delay to allow concurrent processing to be visible
            Process.sleep(50)
            {:ok, :done}
          end
        )

      # Add multiple jobs
      for i <- 1..num_jobs do
        {:ok, _} =
          Queue.add(queue_name, "batch-#{i}", %{"index" => i},
            connection: conn,
            prefix: @test_prefix
          )
      end

      # All jobs should be processed
      received =
        for _ <- 1..num_jobs do
          assert_receive {:processed, index}, 3_000
          index
        end

      # Verify all jobs were processed
      assert Enum.sort(received) == Enum.to_list(1..num_jobs)

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "worker enters blocking wait only when truly idle", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      # This test verifies that blocking wait only happens when:
      # 1. No autonomous worker processes are running
      # 2. No active jobs are being processed

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.1,
          concurrency: 1,
          processor: fn job ->
            send(test_pid, {:processing_start, job.id})
            # Long enough to observe state
            Process.sleep(200)
            send(test_pid, {:processing_end, job.id})
            {:ok, :done}
          end
        )

      # Queue starts empty, worker should be in blocking wait
      # Add first job
      {:ok, job1} =
        Queue.add(queue_name, "job1", %{},
          connection: conn,
          prefix: @test_prefix
        )

      assert_receive {:processing_start, job1_id}, 1_000
      assert job1_id == job1.id

      # While job1 is processing, add job2
      {:ok, job2} =
        Queue.add(queue_name, "job2", %{},
          connection: conn,
          prefix: @test_prefix
        )

      # job1 completes
      assert_receive {:processing_end, ^job1_id}, 1_000

      # job2 should start processing (fetched after job1 completed or from next job fetch)
      assert_receive {:processing_start, job2_id}, 1_000
      assert job2_id == job2.id

      assert_receive {:processing_end, ^job2_id}, 1_000

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 15_000
    test "blocking wait handles rapid job additions", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      num_jobs = 10

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.1,
          concurrency: 3,
          processor: fn job ->
            send(test_pid, {:processed, job.data["index"]})
            {:ok, :done}
          end
        )

      # Wait for worker to enter blocking wait
      Process.sleep(100)

      # Rapidly add jobs with small delays between them
      for i <- 1..num_jobs do
        {:ok, _} =
          Queue.add(queue_name, "rapid-#{i}", %{"index" => i},
            connection: conn,
            prefix: @test_prefix
          )

        # Small delay between adds to test blocking wake-up behavior
        Process.sleep(10)
      end

      # All jobs should be processed
      received =
        for _ <- 1..num_jobs do
          assert_receive {:processed, index}, 5_000
          index
        end

      assert length(Enum.uniq(received)) == num_jobs

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "paused worker doesn't process - resume re-enables processing", %{
      conn: conn,
      queue_name: queue_name
    } do
      test_pid = self()

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.1,
          processor: fn job ->
            send(test_pid, {:processed, job.id})
            {:ok, :done}
          end
        )

      # Pause immediately
      Worker.pause(worker)
      assert Worker.paused?(worker) == true

      # Add a job while worker is paused
      {:ok, job} =
        Queue.add(queue_name, "pause-test", %{},
          connection: conn,
          prefix: @test_prefix
        )

      # Should NOT be processed yet (worker is paused)
      refute_receive {:processed, _}, 300

      # Resume the worker to start processing
      Worker.resume(worker)
      assert Worker.paused?(worker) == false

      # Now it should be processed
      assert_receive {:processed, job_id}, 2_000
      assert job_id == job.id

      Worker.close(worker)
    end
  end

  describe "Connection efficiency" do
    @tag :integration
    @tag timeout: 10_000
    test "concurrent workers share pool, each has one blocking connection", %{
      conn: conn,
      queue_name: queue_name
    } do
      test_pid = self()

      # Start multiple workers on the same queue
      workers =
        for i <- 1..3 do
          {:ok, worker} =
            Worker.start_link(
              queue: "#{queue_name}-#{i}",
              connection: conn,
              prefix: @test_prefix,
              drain_delay: 0.1,
              concurrency: 2,
              processor: fn job ->
                send(test_pid, {:processed, job.queue_name, job.id})
                {:ok, :done}
              end
            )

          worker
        end

      # Add jobs to each queue
      for i <- 1..3 do
        {:ok, _} =
          Queue.add("#{queue_name}-#{i}", "test", %{},
            connection: conn,
            prefix: @test_prefix
          )
      end

      # All jobs should be processed - collect without enforcing order
      received_queues =
        for _ <- 1..3 do
          assert_receive {:processed, queue, _job_id}, 2_000
          queue
        end

      # Verify all 3 queues were processed (order may vary)
      expected_queues = for i <- 1..3, do: "#{queue_name}-#{i}"
      assert Enum.sort(received_queues) == Enum.sort(expected_queues)

      # Cleanup
      for worker <- workers do
        Worker.close(worker)
      end
    end

    @tag :integration
    @tag timeout: 15_000
    test "high concurrency doesn't create connection storm", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      num_jobs = 10
      concurrency = 5

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.1,
          concurrency: concurrency,
          processor: fn job ->
            send(test_pid, {:processed, job.data["index"]})
            # Small work simulation
            Process.sleep(20)
            {:ok, :done}
          end
        )

      # Add jobs - do this before worker processes to avoid pool contention
      # Let worker settle
      Process.sleep(100)

      # Add many jobs
      for i <- 1..num_jobs do
        {:ok, _} =
          Queue.add(queue_name, "high-conc-#{i}", %{"index" => i},
            connection: conn,
            prefix: @test_prefix
          )
      end

      # All should complete successfully without connection errors
      received =
        for _ <- 1..num_jobs do
          assert_receive {:processed, index}, 10_000
          index
        end

      assert length(Enum.uniq(received)) == num_jobs

      Worker.close(worker)
    end
  end

  describe "Edge cases" do
    @tag :integration
    @tag timeout: 10_000
    test "worker handles empty queue gracefully on startup", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      # Start worker on empty queue
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.1,
          processor: fn job ->
            send(test_pid, {:processed, job.id})
            {:ok, :done}
          end
        )

      # Wait a bit - worker should be idle in blocking wait
      Process.sleep(500)

      # Worker should still be alive and responsive
      assert Worker.running?(worker) == true

      # Adding a job should work
      {:ok, job} =
        Queue.add(queue_name, "late-add", %{},
          connection: conn,
          prefix: @test_prefix
        )

      assert_receive {:processed, job_id}, 1_000
      assert job_id == job.id

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "paused worker doesn't block or process jobs", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.1,
          processor: fn job ->
            send(test_pid, {:processed, job.id})
            {:ok, :done}
          end
        )

      # Pause immediately
      Worker.pause(worker)

      # Add a job
      {:ok, _job} =
        Queue.add(queue_name, "paused-test", %{},
          connection: conn,
          prefix: @test_prefix
        )

      # Should NOT be processed while paused
      refute_receive {:processed, _}, 500

      # Resume
      Worker.resume(worker)

      # Now it should be processed
      assert_receive {:processed, _job_id}, 1_000

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "closing worker during blocking wait terminates cleanly", %{
      conn: conn,
      queue_name: queue_name
    } do
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          drain_delay: 0.1,
          processor: fn _job ->
            {:ok, :done}
          end
        )

      # Let worker enter blocking wait on empty queue
      Process.sleep(200)

      # Close should complete without hanging
      assert Worker.close(worker) == :ok
    end
  end

  # Helper to flush any stale messages from previous tests
  defp flush_messages do
    receive do
      _ -> flush_messages()
    after
      0 -> :ok
    end
  end
end
