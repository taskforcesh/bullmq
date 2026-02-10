defmodule BullMQ.WorkerIntegrationTest do
  @moduledoc """
  Integration tests for Worker functionality with a real Redis instance.

  These tests use the real BullMQ.Worker, BullMQ.Queue, and BullMQ.QueueEvents
  modules to verify worker behavior matches the Node.js implementation.

  Pattern: Uses Worker event callbacks (on_completed, on_failed, on_active)
  which mirror Node.js `worker.on('completed', ...)` pattern. The callbacks
  send messages to the test process, enabling `assert_receive` for clean
  Promise-like waiting.
  """
  use ExUnit.Case, async: false

  @moduletag :integration

  alias BullMQ.{Job, Queue, Worker, Keys, Scripts}

  @redis_url BullMQ.TestHelper.redis_url()
  @test_prefix BullMQ.TestHelper.test_prefix() <> "_worker"

  # Use setup_all to create a shared cleanup connection that persists across all tests
  # This avoids creating/destroying connections during on_exit which can cause connection storms
  setup_all do
    {:ok, cleanup_conn} = Redix.start_link(@redis_url)

    on_exit(fn ->
      Redix.stop(cleanup_conn)
    end)

    %{cleanup_conn: cleanup_conn}
  end

  setup %{cleanup_conn: cleanup_conn} do
    pool_name = :"worker_pool_#{System.unique_integer([:positive])}"

    # Start the connection pool - unlink so test cleanup doesn't cascade
    # Use pool_size: 1 for tests - minimal connections to avoid overwhelming Redis
    {:ok, pool_pid} =
      BullMQ.RedisConnection.start_link(
        name: pool_name,
        url: @redis_url,
        pool_size: 1
      )

    Process.unlink(pool_pid)

    queue_name = "worker-queue-#{System.unique_integer([:positive])}"

    on_exit(fn ->
      # Close the pool
      BullMQ.RedisConnection.close(pool_name)

      # Allow time for OS/Docker to release sockets - macOS/Docker needs this
      Process.sleep(50)

      # Clean up Redis keys using the shared cleanup connection
      # Note: We don't create new connections here to avoid connection storms
      # The cleanup_conn from setup_all handles this
      case Redix.command(cleanup_conn, ["KEYS", "#{@test_prefix}:*"]) do
        {:ok, keys} when keys != [] ->
          Redix.command(cleanup_conn, ["DEL" | keys])

        _ ->
          :ok
      end
    end)

    {:ok, conn: pool_name, queue_name: queue_name}
  end

  # ---------------------------------------------------------------------------
  # Basic Worker Tests - Using Worker event callbacks (like Node.js worker.on)
  # ---------------------------------------------------------------------------

  describe "Basic worker functionality" do
    @tag :integration
    @tag timeout: 10_000
    test "worker processes a job successfully", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            {:ok, %{value: job.data["value"] * 2}}
          end,
          # Event callback - like worker.on('completed', ...)
          on_completed: fn job, result ->
            send(test_pid, {:completed, job.id, result})
          end
        )

      # Add a job
      {:ok, job} =
        Queue.add(queue_name, "test-job", %{value: 42}, connection: conn, prefix: @test_prefix)

      # Wait for completion event (like awaiting a Promise)
      assert_receive {:completed, job_id, result}, 5_000
      assert job_id == job.id
      assert result == %{value: 84}

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "worker processes multiple jobs", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            {:ok, job.data["idx"]}
          end,
          on_completed: fn _job, result ->
            send(test_pid, {:completed, result})
          end
        )

      # Add multiple jobs
      jobs =
        Enum.map(1..5, fn i ->
          {"test-job", %{idx: i}, []}
        end)

      {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn, prefix: @test_prefix)

      # Wait for all completions
      results = for _ <- 1..5, do: receive_completion(5_000)
      assert Enum.sort(results) == [1, 2, 3, 4, 5]

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "worker handles concurrent jobs", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      {:ok, counter} = Agent.start_link(fn -> %{current: 0, max: 0} end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          concurrency: 3,
          processor: fn _job ->
            # Track concurrent execution
            Agent.update(counter, fn state ->
              new_current = state.current + 1
              %{current: new_current, max: max(state.max, new_current)}
            end)

            # Simulate work
            Process.sleep(100)

            Agent.update(counter, fn state ->
              %{state | current: state.current - 1}
            end)

            :ok
          end,
          on_completed: fn _job, _result ->
            send(test_pid, :completed)
          end
        )

      # Add jobs
      jobs =
        Enum.map(1..6, fn i ->
          {"test-job", %{idx: i}, []}
        end)

      {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn, prefix: @test_prefix)

      # Wait for all completions
      for _ <- 1..6, do: assert_receive(:completed, 10_000)

      # Verify concurrency was utilized
      %{max: max_concurrent} = Agent.get(counter, & &1)
      assert max_concurrent >= 2, "Expected concurrent execution, got max #{max_concurrent}"

      Worker.close(worker)
      Agent.stop(counter)
    end

    @tag :integration
    @tag timeout: 15_000
    test "worker removes completed jobs with age and limit options", %{
      conn: conn,
      queue_name: queue_name
    } do
      test_pid = self()

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            # Simulate some work
            Process.sleep(50)
            {:ok, job.data["value"]}
          end,
          remove_on_complete: %{age: 1, limit: 5},
          on_completed: fn _job, _result ->
            send(test_pid, :completed)
          end
        )

      # Add multiple jobs to test removal behavior
      jobs =
        Enum.map(1..10, fn i ->
          {"test-job", %{value: i}, []}
        end)

      {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn, prefix: @test_prefix)

      # Wait for all jobs to complete
      for _ <- 1..10, do: assert_receive(:completed, 5_000)

      # Check initial state
      {:ok, counts_before} = Queue.get_counts(queue_name, connection: conn, prefix: @test_prefix)
      IO.puts("Completed jobs before aging: #{counts_before.completed}")

      # Allow time for cleanup to happen (jobs older than 1 second)
      Process.sleep(1200)

      # Add one more job to trigger cleanup
      {:ok, _} =
        Queue.add(queue_name, "trigger-cleanup", %{value: 11},
          connection: conn,
          prefix: @test_prefix
        )

      assert_receive(:completed, 5_000)

      # Check that only some jobs remain (due to limit: 5 per cleanup iteration)
      {:ok, counts} = Queue.get_counts(queue_name, connection: conn, prefix: @test_prefix)
      IO.puts("Completed jobs after cleanup: #{counts.completed}")

      # Should have fewer than 11 completed jobs due to age-based cleanup with limit
      # With limit: 5, up to 5 jobs should be removed per cleanup iteration
      # Since all 10 original jobs are older than 1 second, cleanup should remove some jobs
      # Should have removed some jobs
      assert counts.completed < 11
      # Should have at least 1 job (the trigger job)
      assert counts.completed >= 1

      Worker.close(worker)
    end
  end

  # ---------------------------------------------------------------------------
  # Job Failure and Retry Tests
  # ---------------------------------------------------------------------------

  describe "Job failure and retry" do
    @tag :integration
    @tag timeout: 15_000
    test "worker retries failed job", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      {:ok, counter} = Agent.start_link(fn -> 0 end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job ->
            count = Agent.get_and_update(counter, fn c -> {c, c + 1} end)

            if count < 2 do
              raise "Temporary failure"
            else
              :ok
            end
          end,
          on_completed: fn job, _result ->
            attempts = Agent.get(counter, & &1)
            send(test_pid, {:completed, job.id, attempts})
          end
        )

      # Add a job with retries
      {:ok, job} =
        Queue.add(queue_name, "retry-test", %{},
          connection: conn,
          prefix: @test_prefix,
          attempts: 3
        )

      job_id = job.id

      # Wait for completion after retries
      assert_receive {:completed, ^job_id, attempts}, 15_000
      # Failed twice, succeeded on third
      assert attempts == 3

      Worker.close(worker)
      Agent.stop(counter)
    end

    @tag :integration
    @tag timeout: 10_000
    test "job moves to failed after max retries", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job ->
            raise "Always fails"
          end,
          on_failed: fn job, reason ->
            send(test_pid, {:failed, job.id, reason})
          end
        )

      # Add a job with limited retries
      {:ok, job} =
        Queue.add(queue_name, "fail-test", %{}, connection: conn, prefix: @test_prefix, attempts: 2)

      job_id = job.id

      # Wait for final failure (after exhausting retries)
      assert_receive {:failed, ^job_id, reason}, 10_000
      assert reason =~ "Always fails"

      # Check job is in failed state
      {:ok, counts} = Queue.get_counts(queue_name, connection: conn, prefix: @test_prefix)
      assert counts.failed == 1

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "failed job stores stacktrace in Redis", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job ->
            raise "Test error for stacktrace"
          end,
          on_failed: fn job, _reason ->
            send(test_pid, {:failed, job.id})
          end
        )

      # Add a job with no retries so it goes directly to failed
      {:ok, job} =
        Queue.add(queue_name, "stacktrace-test", %{},
          connection: conn,
          prefix: @test_prefix,
          attempts: 1
        )

      job_id = job.id

      # Wait for failure
      assert_receive {:failed, ^job_id}, 5_000

      # Check that stacktrace is stored in Redis
      ctx = Keys.context(@test_prefix, queue_name)
      job_key = Keys.job(ctx, job_id)

      # Use Scripts.command to properly route through the connection pool
      {:ok, job_data} = BullMQ.RedisConnection.command(conn, ["HGETALL", job_key])
      job_map = list_to_map(job_data)

      # Verify stacktrace field exists and contains the error
      stacktrace = Map.get(job_map, "stacktrace")
      assert stacktrace != nil
      assert stacktrace != "[]"
      # Stacktrace should contain file/line info
      assert stacktrace =~ "worker_integration_test.exs"

      # Verify failedReason is also stored
      failed_reason = Map.get(job_map, "failedReason")
      assert failed_reason =~ "Test error for stacktrace"

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "exit in processor is handled as job failure", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job ->
            exit(:processor_exit_reason)
          end,
          on_failed: fn job, reason ->
            send(test_pid, {:failed, job.id, reason})
          end
        )

      {:ok, job} =
        Queue.add(queue_name, "exit-test", %{}, connection: conn, prefix: @test_prefix, attempts: 1)

      job_id = job.id

      # Should receive failure with the exit reason
      assert_receive {:failed, ^job_id, reason}, 5_000
      assert reason =~ "processor_exit_reason"

      # Verify job is in failed state
      {:ok, state} = Queue.get_job_state(queue_name, job_id, connection: conn, prefix: @test_prefix)
      assert state == "failed"

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "throw in processor is handled as job failure", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job ->
            throw(:processor_throw_value)
          end,
          on_failed: fn job, reason ->
            send(test_pid, {:failed, job.id, reason})
          end
        )

      {:ok, job} =
        Queue.add(queue_name, "throw-test", %{},
          connection: conn,
          prefix: @test_prefix,
          attempts: 1
        )

      job_id = job.id

      # Should receive failure with the thrown value
      assert_receive {:failed, ^job_id, reason}, 5_000
      assert reason =~ "processor_throw_value"

      # Verify job is in failed state
      {:ok, state} = Queue.get_job_state(queue_name, job_id, connection: conn, prefix: @test_prefix)
      assert state == "failed"

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "exit in processor triggers retry", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      {:ok, counter} = Agent.start_link(fn -> 0 end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            count = Agent.get_and_update(counter, fn c -> {c, c + 1} end)

            if count == 0 do
              send(test_pid, {:first_attempt, job.attempts_made})
              exit(:temporary_exit)
            else
              send(test_pid, {:second_attempt, job.attempts_made})
              {:ok, :success}
            end
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job.id})
          end
        )

      {:ok, job} =
        Queue.add(queue_name, "exit-retry", %{},
          connection: conn,
          prefix: @test_prefix,
          attempts: 3,
          backoff: %{type: "fixed", delay: 100}
        )

      job_id = job.id

      # First attempt exits
      assert_receive {:first_attempt, 0}, 5_000
      # After retry, second attempt succeeds
      assert_receive {:second_attempt, 1}, 5_000
      assert_receive {:completed, ^job_id}, 5_000

      Agent.stop(counter)
      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "throw in processor triggers retry", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      {:ok, counter} = Agent.start_link(fn -> 0 end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            count = Agent.get_and_update(counter, fn c -> {c, c + 1} end)

            if count == 0 do
              send(test_pid, {:first_attempt, job.attempts_made})
              throw(:temporary_throw)
            else
              send(test_pid, {:second_attempt, job.attempts_made})
              {:ok, :success}
            end
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job.id})
          end
        )

      {:ok, job} =
        Queue.add(queue_name, "throw-retry", %{},
          connection: conn,
          prefix: @test_prefix,
          attempts: 3,
          backoff: %{type: "fixed", delay: 100}
        )

      job_id = job.id

      # First attempt throws
      assert_receive {:first_attempt, 0}, 5_000
      # After retry, second attempt succeeds
      assert_receive {:second_attempt, 1}, 5_000
      assert_receive {:completed, ^job_id}, 5_000

      Agent.stop(counter)
      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "error tuple triggers retry like exceptions", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      {:ok, counter} = Agent.start_link(fn -> 0 end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            count = Agent.get_and_update(counter, fn c -> {c, c + 1} end)

            if count == 0 do
              send(test_pid, {:first_attempt, job.attempts_made})
              {:error, "temporary failure"}
            else
              send(test_pid, {:second_attempt, job.attempts_made})
              {:ok, :success}
            end
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job.id})
          end
        )

      {:ok, job} =
        Queue.add(queue_name, "error-retry", %{},
          connection: conn,
          prefix: @test_prefix,
          attempts: 3,
          backoff: %{type: "fixed", delay: 100}
        )

      job_id = job.id

      # First attempt returns {:error, reason}
      assert_receive {:first_attempt, 0}, 5_000
      # After retry, second attempt succeeds
      assert_receive {:second_attempt, 1}, 5_000
      assert_receive {:completed, ^job_id}, 5_000

      Agent.stop(counter)
      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "error tuple moves job to failed after max retries", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job ->
            {:error, "always fails"}
          end,
          on_failed: fn job, reason ->
            send(test_pid, {:failed, job.id, reason})
          end
        )

      {:ok, job} =
        Queue.add(queue_name, "error-fail", %{},
          connection: conn,
          prefix: @test_prefix,
          attempts: 2,
          backoff: %{type: "fixed", delay: 50}
        )

      job_id = job.id

      # Should receive failure after exhausting retries
      assert_receive {:failed, ^job_id, reason}, 5_000
      assert reason =~ "always fails"

      # Verify job is in failed state
      {:ok, state} = Queue.get_job_state(queue_name, job_id, connection: conn, prefix: @test_prefix)
      assert state == "failed"

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "delay returns job to delayed queue without incrementing attempts", %{
      conn: conn,
      queue_name: queue_name
    } do
      test_pid = self()
      {:ok, counter} = Agent.start_link(fn -> 0 end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            count = Agent.get_and_update(counter, fn c -> {c, c + 1} end)

            if count == 0 do
              # First time: delay for 500ms
              send(test_pid, {:delayed, job.id, job.attempts_made})
              {:delay, 500}
            else
              # Second time: complete
              send(test_pid, {:processing, job.id, job.attempts_made})
              {:ok, %{processed_count: count}}
            end
          end,
          on_completed: fn job, result ->
            send(test_pid, {:completed, job.id, result})
          end
        )

      # Add a job
      {:ok, job} =
        Queue.add(queue_name, "delay-test", %{value: 42},
          connection: conn,
          prefix: @test_prefix,
          attempts: 3
        )

      job_id = job.id

      # Should receive delay first
      assert_receive {:delayed, ^job_id, attempts_on_delay}, 5_000
      assert attempts_on_delay == 0

      # Then should be processed after the delay
      assert_receive {:processing, ^job_id, attempts_after_delay}, 5_000
      # Delay should NOT increment attempts (skip_attempt: true)
      assert attempts_after_delay == 0

      # Finally completed
      assert_receive {:completed, ^job_id, result}, 5_000
      assert result == %{processed_count: 1}

      # Verify total processing count
      assert Agent.get(counter, & &1) == 2

      Worker.close(worker)
      Agent.stop(counter)
    end

    @tag :integration
    @tag timeout: 10_000
    test "delay can be used multiple times on same job", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      {:ok, counter} = Agent.start_link(fn -> 0 end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job ->
            count = Agent.get_and_update(counter, fn c -> {c, c + 1} end)

            cond do
              count < 3 ->
                # Delay 3 times
                send(test_pid, {:delay, count})
                {:delay, 100}

              true ->
                # Complete on 4th attempt
                {:ok, :done}
            end
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job.id})
          end
        )

      {:ok, job} = Queue.add(queue_name, "multi-delay", %{}, connection: conn, prefix: @test_prefix)
      job_id = job.id

      # Should delay 3 times
      assert_receive {:delay, 0}, 2_000
      assert_receive {:delay, 1}, 2_000
      assert_receive {:delay, 2}, 2_000

      # Then complete
      assert_receive {:completed, ^job_id}, 2_000

      assert Agent.get(counter, & &1) == 4

      Worker.close(worker)
      Agent.stop(counter)
    end

    @tag :integration
    @tag timeout: 10_000
    test "rate_limit return moves job back to delayed", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      {:ok, counter} = Agent.start_link(fn -> 0 end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            count = Agent.get_and_update(counter, fn c -> {c, c + 1} end)

            if count == 0 do
              # First time: simulate rate limiting
              send(test_pid, {:rate_limited, job.id})
              {:rate_limit, 500}
            else
              # Second time: complete
              send(test_pid, {:processing, job.id})
              {:ok, :done}
            end
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job.id})
          end
        )

      {:ok, job} =
        Queue.add(queue_name, "rate-limit-test", %{}, connection: conn, prefix: @test_prefix)

      job_id = job.id

      # Should receive rate limit first
      assert_receive {:rate_limited, ^job_id}, 5_000

      # Then should be processed after the delay
      assert_receive {:processing, ^job_id}, 5_000

      # Finally completed
      assert_receive {:completed, ^job_id}, 5_000

      Worker.close(worker)
      Agent.stop(counter)
    end

    @tag :integration
    @tag timeout: 10_000
    test "waiting return moves job back to waiting queue", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      {:ok, counter} = Agent.start_link(fn -> 0 end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            count = Agent.get_and_update(counter, fn c -> {c, c + 1} end)

            if count == 0 do
              # First time: move back to waiting
              send(test_pid, {:back_to_waiting, job.id})
              :waiting
            else
              # Second time: complete
              send(test_pid, {:processing, job.id})
              {:ok, :done}
            end
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job.id})
          end
        )

      {:ok, job} =
        Queue.add(queue_name, "waiting-test", %{}, connection: conn, prefix: @test_prefix)

      job_id = job.id

      # Should receive waiting first
      assert_receive {:back_to_waiting, ^job_id}, 5_000

      # Then should be processed again
      assert_receive {:processing, ^job_id}, 5_000

      # Finally completed
      assert_receive {:completed, ^job_id}, 5_000

      # Total processing count should be 2
      assert Agent.get(counter, & &1) == 2

      Worker.close(worker)
      Agent.stop(counter)
    end

    @tag :integration
    @tag timeout: 10_000
    test "waiting does not trigger on_completed callback", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      {:ok, counter} = Agent.start_link(fn -> 0 end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job ->
            count = Agent.get_and_update(counter, fn c -> {c, c + 1} end)

            if count < 2 do
              :waiting
            else
              {:ok, :done}
            end
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job.id})
          end
        )

      {:ok, job} =
        Queue.add(queue_name, "waiting-callback-test", %{}, connection: conn, prefix: @test_prefix)

      job_id = job.id

      # Should only receive ONE completion (not 3)
      assert_receive {:completed, ^job_id}, 5_000

      # Wait a bit to ensure no extra completions
      refute_receive {:completed, _}, 500

      # 3 processing calls: 2 waiting returns + 1 completion
      assert Agent.get(counter, & &1) == 3

      Worker.close(worker)
      Agent.stop(counter)
    end

    @tag :integration
    @tag timeout: 10_000
    test "rate_limit does not trigger on_completed callback", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      {:ok, counter} = Agent.start_link(fn -> 0 end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job ->
            count = Agent.get_and_update(counter, fn c -> {c, c + 1} end)

            if count < 2 do
              {:rate_limit, 100}
            else
              {:ok, :done}
            end
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job.id})
          end
        )

      {:ok, job} =
        Queue.add(queue_name, "rate-limit-callback-test", %{},
          connection: conn,
          prefix: @test_prefix
        )

      job_id = job.id

      # Should only receive ONE completion (not 3)
      assert_receive {:completed, ^job_id}, 5_000

      # Wait a bit to ensure no extra completions
      refute_receive {:completed, _}, 500

      # 3 processing calls: 2 rate_limit returns + 1 completion
      assert Agent.get(counter, & &1) == 3

      Worker.close(worker)
      Agent.stop(counter)
    end

    @tag :integration
    @tag timeout: 10_000
    test "delay does not trigger on_completed callback", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      {:ok, counter} = Agent.start_link(fn -> 0 end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job ->
            count = Agent.get_and_update(counter, fn c -> {c, c + 1} end)

            if count < 2 do
              {:delay, 100}
            else
              {:ok, :done}
            end
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job.id})
          end
        )

      {:ok, job} =
        Queue.add(queue_name, "delay-callback-test", %{}, connection: conn, prefix: @test_prefix)

      job_id = job.id

      # Should only receive ONE completion (not 3)
      assert_receive {:completed, ^job_id}, 5_000

      # Wait a bit to ensure no extra completions
      refute_receive {:completed, _}, 500

      # 3 processing calls: 2 delay returns + 1 completion
      assert Agent.get(counter, & &1) == 3

      Worker.close(worker)
      Agent.stop(counter)
    end

    @tag :integration
    @tag timeout: 15_000
    test "waiting does not increment attempt count", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      {:ok, counter} = Agent.start_link(fn -> 0 end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            count = Agent.get_and_update(counter, fn c -> {c, c + 1} end)
            # Send the attempts_made from the job
            send(test_pid, {:attempt, count, job.attempts_made})

            if count < 3 do
              :waiting
            else
              {:ok, :done}
            end
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job.id, job.attempts_made})
          end
        )

      {:ok, job} =
        Queue.add(queue_name, "waiting-attempts", %{},
          connection: conn,
          prefix: @test_prefix,
          attempts: 5
        )

      job_id = job.id

      # All processing attempts should have attempts_made == 0
      assert_receive {:attempt, 0, 0}, 5_000
      assert_receive {:attempt, 1, 0}, 5_000
      assert_receive {:attempt, 2, 0}, 5_000
      assert_receive {:attempt, 3, 0}, 5_000

      # Completed with attempts still at 1 (incremented after final moveToFinished)
      assert_receive {:completed, ^job_id, 1}, 5_000

      Worker.close(worker)
      Agent.stop(counter)
    end

    @tag :integration
    @tag timeout: 15_000
    test "waiting puts job back in waiting queue for immediate retry", %{
      conn: conn,
      queue_name: queue_name
    } do
      test_pid = self()
      {:ok, counter} = Agent.start_link(fn -> 0 end)
      {:ok, timestamps} = Agent.start_link(fn -> [] end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            count = Agent.get_and_update(counter, fn c -> {c, c + 1} end)
            now = System.system_time(:millisecond)
            Agent.update(timestamps, fn list -> list ++ [now] end)

            if count < 2 do
              :waiting
            else
              send(test_pid, {:completed, job.id})
              {:ok, :done}
            end
          end
        )

      {:ok, job} =
        Queue.add(queue_name, "waiting-immediate", %{}, connection: conn, prefix: @test_prefix)

      job_id = job.id

      assert_receive {:completed, ^job_id}, 5_000

      # Check that processing was fast (no artificial delay between attempts)
      all_timestamps = Agent.get(timestamps, & &1)
      assert length(all_timestamps) == 3

      # Time between first and last should be very short (< 1 second)
      # since :waiting doesn't add any delay
      total_time = List.last(all_timestamps) - hd(all_timestamps)
      assert total_time < 1000, "Expected fast processing, but took #{total_time}ms"

      Worker.close(worker)
      Agent.stop(counter)
      Agent.stop(timestamps)
    end
  end

  # ---------------------------------------------------------------------------
  # Job.retry method Tests
  # ---------------------------------------------------------------------------

  describe "Job.retry when job is in failed state" do
    @tag :integration
    @tag timeout: 15_000
    test "retries a job that fails", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      {:ok, failed_once} = Agent.start_link(fn -> false end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job ->
            if Agent.get(failed_once, & &1) do
              {:ok, :success}
            else
              raise "Not even!"
            end
          end,
          on_failed: fn job, reason ->
            send(test_pid, {:failed, job, reason})
          end,
          on_completed: fn job, result ->
            send(test_pid, {:completed, job, result})
          end
        )

      # Add a job
      {:ok, job} =
        Queue.add(queue_name, "test", %{"foo" => "bar"},
          connection: conn,
          prefix: @test_prefix
        )

      # Wait for failure
      assert_receive {:failed, failed_job, reason}, 5_000
      assert failed_job.id == job.id
      assert failed_job.data["foo"] == "bar"
      assert failed_job.attempts_started == 1
      assert failed_job.attempts_made == 1
      assert reason =~ "Not even!"

      # Mark as failed once and retry the job
      Agent.update(failed_once, fn _ -> true end)

      # Fetch the job with connection to call retry
      job_with_conn = %{failed_job | connection: conn}
      {:ok, _updated_job} = Job.retry(job_with_conn, :failed)

      # Wait for completion after retry
      assert_receive {:completed, completed_job, _result}, 5_000
      assert completed_job.id == job.id
      assert completed_job.attempts_started == 2
      assert completed_job.attempts_made == 2

      Worker.close(worker)
      Agent.stop(failed_once)
    end

    @tag :integration
    @tag timeout: 15_000
    test "retries a job with reset_attempts_made and reset_attempts_started options", %{
      conn: conn,
      queue_name: queue_name
    } do
      test_pid = self()
      {:ok, failed_once} = Agent.start_link(fn -> false end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job ->
            if Agent.get(failed_once, & &1) do
              {:ok, :success}
            else
              raise "Not even!"
            end
          end,
          on_failed: fn job, reason ->
            send(test_pid, {:failed, job, reason})
          end,
          on_completed: fn job, result ->
            send(test_pid, {:completed, job, result})
          end
        )

      # Add a job
      {:ok, job} =
        Queue.add(queue_name, "test", %{"foo" => "bar"},
          connection: conn,
          prefix: @test_prefix
        )

      # Wait for failure
      assert_receive {:failed, failed_job, _reason}, 5_000
      assert failed_job.attempts_started == 1
      assert failed_job.attempts_made == 1

      # Mark as failed once and retry with reset options
      Agent.update(failed_once, fn _ -> true end)

      job_with_conn = %{failed_job | connection: conn}

      {:ok, updated_job} =
        Job.retry(job_with_conn, :failed,
          reset_attempts_made: true,
          reset_attempts_started: true
        )

      # Verify the local job struct was updated
      assert updated_job.attempts_made == 0
      assert updated_job.attempts_started == 0

      # Wait for completion after retry - attempts should be 1 (reset + new attempt)
      assert_receive {:completed, completed_job, _result}, 5_000
      assert completed_job.id == job.id
      assert completed_job.attempts_started == 1
      assert completed_job.attempts_made == 1

      Worker.close(worker)
      Agent.stop(failed_once)
    end
  end

  describe "Job.retry when job is in completed state" do
    @tag :integration
    @tag timeout: 15_000
    test "retries a job that completes", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      {:ok, completed_once} = Agent.start_link(fn -> false end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job ->
            if Agent.get(completed_once, & &1) do
              {:ok, 2}
            else
              {:ok, 1}
            end
          end,
          on_completed: fn job, result ->
            send(test_pid, {:completed, job, result})
          end
        )

      # Add a job
      {:ok, job} =
        Queue.add(queue_name, "test", %{"foo" => "bar"},
          connection: conn,
          prefix: @test_prefix
        )

      # Wait for first completion
      assert_receive {:completed, completed_job, result}, 5_000
      assert completed_job.id == job.id
      assert completed_job.data["foo"] == "bar"
      assert completed_job.attempts_started == 1
      assert completed_job.attempts_made == 1
      assert result == 1

      # Mark as completed once and retry
      Agent.update(completed_once, fn _ -> true end)

      job_with_conn = %{completed_job | connection: conn}
      {:ok, _updated_job} = Job.retry(job_with_conn, :completed)

      # Wait for second completion after retry
      assert_receive {:completed, completed_job_2, result_2}, 5_000
      assert completed_job_2.id == job.id
      assert completed_job_2.attempts_started == 2
      assert completed_job_2.attempts_made == 2
      assert result_2 == 2

      Worker.close(worker)
      Agent.stop(completed_once)
    end

    @tag :integration
    @tag timeout: 15_000
    test "retries a completed job with reset_attempts_made and reset_attempts_started options", %{
      conn: conn,
      queue_name: queue_name
    } do
      test_pid = self()
      {:ok, completed_once} = Agent.start_link(fn -> false end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job ->
            if Agent.get(completed_once, & &1) do
              {:ok, 2}
            else
              {:ok, 1}
            end
          end,
          on_completed: fn job, result ->
            send(test_pid, {:completed, job, result})
          end
        )

      # Add a job
      {:ok, job} =
        Queue.add(queue_name, "test", %{"foo" => "bar"},
          connection: conn,
          prefix: @test_prefix
        )

      # Wait for first completion
      assert_receive {:completed, completed_job, result}, 5_000
      assert completed_job.attempts_started == 1
      assert completed_job.attempts_made == 1
      assert result == 1

      # Mark as completed once and retry with reset options
      Agent.update(completed_once, fn _ -> true end)

      job_with_conn = %{completed_job | connection: conn}

      {:ok, updated_job} =
        Job.retry(job_with_conn, :completed,
          reset_attempts_made: true,
          reset_attempts_started: true
        )

      # Verify the local job struct was updated
      assert updated_job.attempts_made == 0
      assert updated_job.attempts_started == 0

      # Wait for second completion - attempts should be 1 (reset + new attempt)
      assert_receive {:completed, completed_job_2, result_2}, 5_000
      assert completed_job_2.id == job.id
      assert completed_job_2.attempts_started == 1
      assert completed_job_2.attempts_made == 1
      assert result_2 == 2

      Worker.close(worker)
      Agent.stop(completed_once)
    end
  end

  describe "Job.retry error cases" do
    @tag :integration
    @tag timeout: 10_000
    test "returns error when job is not in expected state", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job ->
            {:ok, :success}
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job})
          end
        )

      # Add a job
      {:ok, _job} =
        Queue.add(queue_name, "test", %{"foo" => "bar"},
          connection: conn,
          prefix: @test_prefix
        )

      # Wait for completion
      assert_receive {:completed, completed_job}, 5_000

      # Try to retry from :failed state (but job is in :completed)
      job_with_conn = %{completed_job | connection: conn}
      result = Job.retry(job_with_conn, :failed)

      # Should return error because job is not in failed state
      assert {:error, {:reprocess_failed, _code}} = result

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "returns error when job does not exist", %{conn: conn, queue_name: queue_name} do
      # Create a fake job that doesn't exist in Redis
      fake_job = %Job{
        id: "non-existent-job-id",
        name: "test",
        data: %{},
        queue_name: queue_name,
        prefix: @test_prefix,
        connection: conn
      }

      result = Job.retry(fake_job, :failed)

      # Should return error because job doesn't exist
      assert {:error, {:reprocess_failed, _code}} = result
    end

    @tag :integration
    @tag timeout: 10_000
    test "clears job properties after retry", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job ->
            raise "Test error"
          end,
          on_failed: fn job, _reason ->
            send(test_pid, {:failed, job})
          end
        )

      # Add a job
      {:ok, _job} =
        Queue.add(queue_name, "test", %{"foo" => "bar"},
          connection: conn,
          prefix: @test_prefix
        )

      # Wait for failure
      assert_receive {:failed, failed_job}, 5_000
      assert failed_job.failed_reason != nil

      # Stop the worker so the job stays in wait after retry
      Worker.close(worker)

      # Retry the job
      job_with_conn = %{failed_job | connection: conn}
      {:ok, updated_job} = Job.retry(job_with_conn, :failed)

      # Verify job properties were cleared
      assert updated_job.failed_reason == nil
      assert updated_job.finished_on == nil
      assert updated_job.processed_on == nil
      assert updated_job.return_value == nil
    end
  end

  # ---------------------------------------------------------------------------
  # Waiting Children Tests
  # ---------------------------------------------------------------------------

  describe "processor :waiting_children return value" do
    @tag :integration
    @tag timeout: 20_000
    test "waiting_children moves job to waiting-children state (using FlowProducer)", %{
      conn: conn,
      queue_name: queue_name
    } do
      test_pid = self()

      alias BullMQ.FlowProducer

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            case job.name do
              "parent" ->
                send(test_pid, {:parent_processing, job.id})
                # Return waiting_children to move job to waiting-children state
                :waiting_children

              "child" ->
                send(test_pid, {:child_processing, job.id})
                {:ok, :child_done}
            end
          end,
          on_completed: fn job, result ->
            send(test_pid, {:completed, job.name, job.id, result})
          end
        )

      # Create a flow with parent and child
      flow = %{
        name: "parent",
        queue_name: queue_name,
        data: %{value: 1},
        children: [
          %{
            name: "child",
            queue_name: queue_name,
            data: %{parent_value: 1}
          }
        ]
      }

      {:ok, result} = FlowProducer.add(flow, connection: conn, prefix: @test_prefix)
      parent_id = result.job.id
      child_id = hd(result.children).job.id

      # Child should be processed first (parent is in waiting-children initially)
      assert_receive {:child_processing, ^child_id}, 10_000

      # Child should complete
      assert_receive {:completed, "child", ^child_id, :child_done}, 5_000

      # Parent should then be processed (moved from waiting-children to active after child completes)
      assert_receive {:parent_processing, ^parent_id}, 10_000

      # Parent returns :waiting_children - this should NOT trigger on_completed
      # (the job moves to waiting-children state instead of completing)
      refute_receive {:completed, "parent", _, _}, 2_000

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 20_000
    test "waiting_children does not trigger on_completed callback", %{
      conn: conn,
      queue_name: queue_name
    } do
      test_pid = self()

      alias BullMQ.FlowProducer

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            case job.name do
              "parent" ->
                send(test_pid, {:parent_processing, job.id})
                :waiting_children

              "child" ->
                send(test_pid, {:child_processing, job.id})
                {:ok, :child_done}
            end
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job.name})
          end
        )

      # Create a flow with parent and child
      flow = %{
        name: "parent",
        queue_name: queue_name,
        data: %{},
        children: [
          %{name: "child", queue_name: queue_name, data: %{}}
        ]
      }

      {:ok, _result} = FlowProducer.add(flow, connection: conn, prefix: @test_prefix)

      # Child processes and completes
      assert_receive {:child_processing, _}, 10_000
      assert_receive {:completed, "child"}, 5_000

      # Parent processes
      assert_receive {:parent_processing, _}, 10_000

      # Parent should NOT complete (returning :waiting_children)
      refute_receive {:completed, "parent"}, 2_000

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 15_000
    test "waiting_children does not increment attempt count", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      alias BullMQ.FlowProducer

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            case job.name do
              "parent" ->
                send(test_pid, {:parent_attempts, job.attempts_made})
                :waiting_children

              "child" ->
                {:ok, :done}
            end
          end
        )

      flow = %{
        name: "parent",
        queue_name: queue_name,
        data: %{},
        opts: %{attempts: 5},
        children: [
          %{name: "child", queue_name: queue_name, data: %{}}
        ]
      }

      {:ok, _result} = FlowProducer.add(flow, connection: conn, prefix: @test_prefix)

      # Parent attempts should be 0 (waiting_children doesn't increment)
      assert_receive {:parent_attempts, 0}, 10_000

      Worker.close(worker)
    end
  end

  # Worker Lifecycle Tests
  # ---------------------------------------------------------------------------

  describe "Worker lifecycle" do
    @tag :integration
    @tag timeout: 5_000
    test "worker can be paused and resumed", %{conn: conn, queue_name: queue_name} do
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job -> :ok end
        )

      # Pause worker
      :ok = Worker.pause(worker)
      assert Worker.paused?(worker) == true

      # Resume worker
      :ok = Worker.resume(worker)
      assert Worker.paused?(worker) == false

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 5_000
    test "worker closes gracefully when idle", %{conn: conn, queue_name: queue_name} do
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job -> :ok end
        )

      # Close should complete without error
      :ok = Worker.close(worker)

      # Give a moment for process to fully terminate
      Process.sleep(50)

      # Worker should no longer be alive
      refute Process.alive?(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "worker waits for active jobs to complete on close", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            send(test_pid, {:processing_started, job.id})
            # Simulate long-running job
            Process.sleep(500)
            send(test_pid, {:processing_finished, job.id})
            :ok
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job.id})
          end
        )

      # Add a job
      {:ok, job} = Queue.add(queue_name, "long-job", %{}, connection: conn, prefix: @test_prefix)
      job_id = job.id

      # Wait for job to start processing
      assert_receive {:processing_started, ^job_id}, 5_000

      # Now close the worker while job is still processing
      # This should block until the job completes
      close_task = Task.async(fn -> Worker.close(worker) end)

      # The job should still finish
      assert_receive {:processing_finished, ^job_id}, 2_000
      assert_receive {:completed, ^job_id}, 1_000

      # Close should complete successfully
      assert Task.await(close_task, 2_000) == :ok

      # Give process time to fully terminate
      Process.sleep(100)

      # Worker should be stopped
      refute Process.alive?(worker)
    end

    @tag :integration
    @tag timeout: 15_000
    test "worker waits for multiple concurrent jobs on close", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      {:ok, started_counter} = Agent.start_link(fn -> 0 end)
      {:ok, finished_counter} = Agent.start_link(fn -> 0 end)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          concurrency: 3,
          processor: fn job ->
            Agent.update(started_counter, &(&1 + 1))
            send(test_pid, {:processing_started, job.id})
            # Simulate work with varying durations
            Process.sleep(300 + job.data["idx"] * 100)
            Agent.update(finished_counter, &(&1 + 1))
            send(test_pid, {:processing_finished, job.id})
            :ok
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job.id})
          end
        )

      # Add multiple jobs
      jobs =
        Enum.map(1..3, fn i ->
          {"test-job", %{idx: i}, []}
        end)

      {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn, prefix: @test_prefix)

      # Wait for all jobs to start processing
      for _ <- 1..3, do: assert_receive({:processing_started, _}, 5_000)

      # Verify all jobs started
      assert Agent.get(started_counter, & &1) == 3

      # Close the worker while jobs are processing
      close_task = Task.async(fn -> Worker.close(worker) end)

      # All jobs should complete
      for _ <- 1..3, do: assert_receive({:processing_finished, _}, 5_000)
      for _ <- 1..3, do: assert_receive({:completed, _}, 1_000)

      # Verify all jobs finished
      assert Agent.get(finished_counter, & &1) == 3

      # Close should complete
      assert Task.await(close_task, 2_000) == :ok

      # Give process time to fully terminate
      Process.sleep(100)
      refute Process.alive?(worker)

      Agent.stop(started_counter)
      Agent.stop(finished_counter)
    end
  end

  # ---------------------------------------------------------------------------
  # Progress Update Tests
  # ---------------------------------------------------------------------------

  describe "Progress updates" do
    @tag :integration
    @tag timeout: 10_000
    test "worker can update job progress", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            Worker.update_progress(job, 25)
            Process.sleep(50)
            Worker.update_progress(job, 50)
            Process.sleep(50)
            Worker.update_progress(job, 75)
            Process.sleep(50)
            Worker.update_progress(job, 100)
            :ok
          end,
          on_completed: fn _job, _result ->
            send(test_pid, :completed)
          end
        )

      {:ok, _job} =
        Queue.add(queue_name, "progress-test", %{}, connection: conn, prefix: @test_prefix)

      # Wait for completion
      assert_receive :completed, 5_000

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "on_progress callback is called when progress is updated", %{
      conn: conn,
      queue_name: queue_name
    } do
      test_pid = self()

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            Worker.update_progress(job, 25)
            Process.sleep(50)
            Worker.update_progress(job, 50)
            Process.sleep(50)
            Worker.update_progress(job, 100)
            :ok
          end,
          on_progress: fn job, progress ->
            send(test_pid, {:progress, job.id, progress})
          end,
          on_completed: fn _job, _result ->
            send(test_pid, :completed)
          end
        )

      {:ok, job} =
        Queue.add(queue_name, "progress-callback-test", %{value: 42},
          connection: conn,
          prefix: @test_prefix
        )

      job_id = job.id

      # Should receive progress callbacks in order
      assert_receive {:progress, ^job_id, 25}, 5_000
      assert_receive {:progress, ^job_id, 50}, 5_000
      assert_receive {:progress, ^job_id, 100}, 5_000

      # Wait for completion
      assert_receive :completed, 5_000

      Worker.close(worker)
    end

    @tag :integration
    @tag timeout: 10_000
    test "on_progress callback receives correct job data", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            Worker.update_progress(job, %{step: 1, message: "Starting"})
            Process.sleep(50)
            Worker.update_progress(job, %{step: 2, message: "Processing"})
            :ok
          end,
          on_progress: fn job, progress ->
            send(test_pid, {:progress_data, job.name, job.data, progress})
          end,
          on_completed: fn _job, _result ->
            send(test_pid, :completed)
          end
        )

      {:ok, _job} =
        Queue.add(queue_name, "test-job", %{"input" => "test-value"},
          connection: conn,
          prefix: @test_prefix
        )

      # Verify job data and progress are passed correctly
      assert_receive {:progress_data, "test-job", %{"input" => "test-value"},
                      %{step: 1, message: "Starting"}},
                     5_000

      assert_receive {:progress_data, "test-job", %{"input" => "test-value"},
                      %{step: 2, message: "Processing"}},
                     5_000

      assert_receive :completed, 5_000

      Worker.close(worker)
    end
  end

  # ---------------------------------------------------------------------------
  # Job Logging Tests
  # ---------------------------------------------------------------------------

  describe "Job logging" do
    @tag :integration
    @tag timeout: 10_000
    test "Job.log adds log entries", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      {:ok, raw_conn} = Redix.start_link(@redis_url)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            {:ok, 1} = Job.log(job, "Starting work")
            Process.sleep(50)
            {:ok, 2} = Job.log(job, "Still working")
            Process.sleep(50)
            {:ok, 3} = Job.log(job, "Done!")
            :ok
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job.id})
          end
        )

      {:ok, job} = Queue.add(queue_name, "log-test", %{}, connection: conn, prefix: @test_prefix)

      assert_receive {:completed, _job_id}, 5_000

      # Verify logs are stored
      ctx = Keys.context(@test_prefix, queue_name)
      {:ok, logs} = Redix.command(raw_conn, ["LRANGE", Keys.logs(ctx, job.id), 0, -1])
      assert logs == ["Starting work", "Still working", "Done!"]

      Worker.close(worker)
      Redix.stop(raw_conn)
    end

    @tag :integration
    @tag timeout: 10_000
    test "Worker.log adds log entries", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      {:ok, raw_conn} = Redix.start_link(@redis_url)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            Worker.log(job, "Log via Worker module")
            :ok
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job.id})
          end
        )

      {:ok, job} =
        Queue.add(queue_name, "worker-log-test", %{}, connection: conn, prefix: @test_prefix)

      assert_receive {:completed, _job_id}, 5_000

      # Verify logs are stored
      ctx = Keys.context(@test_prefix, queue_name)
      {:ok, logs} = Redix.command(raw_conn, ["LRANGE", Keys.logs(ctx, job.id), 0, -1])
      assert logs == ["Log via Worker module"]

      Worker.close(worker)
      Redix.stop(raw_conn)
    end

    @tag :integration
    @tag timeout: 10_000
    test "Job.log respects keep_logs option", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      {:ok, raw_conn} = Redix.start_link(@redis_url)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            Job.log(job, "Log 1", keep_logs: 2)
            Job.log(job, "Log 2", keep_logs: 2)
            Job.log(job, "Log 3", keep_logs: 2)
            Job.log(job, "Log 4", keep_logs: 2)
            :ok
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job.id})
          end
        )

      {:ok, job} =
        Queue.add(queue_name, "keep-logs-test", %{}, connection: conn, prefix: @test_prefix)

      assert_receive {:completed, _job_id}, 5_000

      # Only last 2 logs should be kept
      ctx = Keys.context(@test_prefix, queue_name)
      {:ok, logs} = Redix.command(raw_conn, ["LRANGE", Keys.logs(ctx, job.id), 0, -1])
      assert logs == ["Log 3", "Log 4"]

      Worker.close(worker)
      Redix.stop(raw_conn)
    end
  end

  # ---------------------------------------------------------------------------
  # Low-Level Script Tests (these test the Lua scripts directly)
  # ---------------------------------------------------------------------------

  describe "Lua scripts" do
    @tag :integration
    test "extend_lock script works", %{conn: _conn, queue_name: queue_name} do
      {:ok, raw_conn} = Redix.start_link(@redis_url)
      ctx = Keys.context(@test_prefix, queue_name)
      token = "worker-token"
      job_id = "test-job-#{System.unique_integer([:positive])}"

      # Set up lock and stalled set
      {:ok, _} = Redix.command(raw_conn, ["SET", Keys.lock(ctx, job_id), token, "PX", 1000])
      {:ok, _} = Redix.command(raw_conn, ["SADD", Keys.stalled(ctx), job_id])

      # Use the actual extend_lock script
      {script, _} = Scripts.get(:extend_lock)

      keys = [Keys.lock(ctx, job_id), Keys.stalled(ctx)]
      args = [token, "30000", job_id]

      {:ok, result} = Redix.command(raw_conn, ["EVAL", script, length(keys)] ++ keys ++ args)

      assert result == 1

      Redix.stop(raw_conn)
    end

    @tag :integration
    test "extend_lock fails with wrong token", %{conn: _conn, queue_name: queue_name} do
      {:ok, raw_conn} = Redix.start_link(@redis_url)
      ctx = Keys.context(@test_prefix, queue_name)
      correct_token = "correct-token"
      wrong_token = "wrong-token"
      job_id = "test-job-#{System.unique_integer([:positive])}"

      {:ok, _} =
        Redix.command(raw_conn, ["SET", Keys.lock(ctx, job_id), correct_token, "PX", 30000])

      {:ok, _} = Redix.command(raw_conn, ["SADD", Keys.stalled(ctx), job_id])

      {script, _} = Scripts.get(:extend_lock)

      keys = [Keys.lock(ctx, job_id), Keys.stalled(ctx)]
      args = [wrong_token, "30000", job_id]

      {:ok, result} = Redix.command(raw_conn, ["EVAL", script, length(keys)] ++ keys ++ args)

      # Script returns 0 on failure
      assert result == 0

      Redix.stop(raw_conn)
    end

    @tag :integration
    test "add_log script works", %{conn: _conn, queue_name: queue_name} do
      {:ok, raw_conn} = Redix.start_link(@redis_url)
      ctx = Keys.context(@test_prefix, queue_name)
      job_id = "test-job-#{System.unique_integer([:positive])}"

      {:ok, _} = Redix.command(raw_conn, ["HSET", Keys.job(ctx, job_id), "name", "test"])

      {script, _} = Scripts.get(:add_log)

      keys = [Keys.job(ctx, job_id), Keys.logs(ctx, job_id)]
      args = [job_id, "Log message from script", ""]

      {:ok, result} = Redix.command(raw_conn, ["EVAL", script, length(keys)] ++ keys ++ args)

      # Returns log count
      assert result == 1

      {:ok, logs} = Redix.command(raw_conn, ["LRANGE", Keys.logs(ctx, job_id), 0, -1])
      assert logs == ["Log message from script"]

      Redix.stop(raw_conn)
    end
  end

  # ---------------------------------------------------------------------------
  # Concurrency Tests
  # ---------------------------------------------------------------------------

  describe "Concurrency" do
    @tag :integration
    @tag timeout: 10_000
    test "multiple workers process different jobs", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      # Start multiple workers - each with on_completed callback
      workers =
        for i <- 1..3 do
          worker_id = i

          {:ok, worker} =
            Worker.start_link(
              queue: queue_name,
              connection: conn,
              prefix: @test_prefix,
              processor: fn job ->
                Process.sleep(50)
                {:ok, job.data["idx"]}
              end,
              on_completed: fn _job, result ->
                send(test_pid, {:completed, result, worker_id})
              end
            )

          worker
        end

      # Add jobs
      jobs =
        Enum.map(1..9, fn i ->
          {"test-job", %{idx: i}, []}
        end)

      {:ok, _} = Queue.add_bulk(queue_name, jobs, connection: conn, prefix: @test_prefix)

      # Collect all completions
      results =
        for _ <- 1..9 do
          receive do
            {:completed, idx, _worker_id} -> idx
          after
            10_000 -> flunk("Timeout waiting for job completion")
          end
        end

      # Verify all jobs processed
      assert Enum.sort(results) == [1, 2, 3, 4, 5, 6, 7, 8, 9]

      Enum.each(workers, &Worker.close/1)
    end
  end

  # ---------------------------------------------------------------------------
  # Lock Lost / Cancellation Tests
  # ---------------------------------------------------------------------------

  describe "lock lost cancellation" do
    @tag :integration
    @tag timeout: 30_000
    test "processor receives cancellation when lock is lost", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      # Start worker with short lock duration so renewal happens quickly
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          # 1 second lock
          lock_duration: 1000,
          # Use arity-2 processor to receive cancellation token
          processor: fn job, cancel_token ->
            send(test_pid, {:processor_started, job.id, cancel_token})

            # Wait in a loop, checking for cancellation
            result = wait_for_cancellation_or_timeout(cancel_token, 10_000)
            send(test_pid, {:processor_result, result})
            result
          end,
          on_lock_renewal_failed: fn job_ids ->
            send(test_pid, {:lock_renewal_failed, job_ids})
          end,
          on_failed: fn job, reason ->
            send(test_pid, {:failed, job.id, reason})
          end
        )

      # Add a job
      {:ok, job} =
        Queue.add(queue_name, "test-job", %{value: 1}, connection: conn, prefix: @test_prefix)

      job_id = job.id

      # Wait for processor to start
      assert_receive {:processor_started, ^job_id, _token}, 5_000

      # Delete the lock from Redis to simulate lock expiry/theft
      # This will cause the next lock renewal to fail
      lock_key = "#{@test_prefix}:#{queue_name}:#{job_id}:lock"
      {:ok, _} = BullMQ.RedisConnection.command(conn, ["DEL", lock_key])

      # Wait for lock renewal to fail and cancellation to be sent
      assert_receive {:lock_renewal_failed, [^job_id]}, 5_000

      # The processor should receive the cancellation
      assert_receive {:processor_result, {:error, {:cancelled, {:lock_lost, ^job_id}}}}, 5_000

      Worker.close(worker, force: true)
    end

    @tag :integration
    @tag timeout: 30_000
    test "on_lock_renewal_failed callback is invoked when lock is lost", %{
      conn: conn,
      queue_name: queue_name
    } do
      test_pid = self()

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          lock_duration: 1000,
          processor: fn job, _cancel_token ->
            send(test_pid, {:processor_started, job.id})
            # Long-running job
            Process.sleep(15_000)
            {:ok, :done}
          end,
          on_lock_renewal_failed: fn job_ids ->
            send(test_pid, {:lock_renewal_failed, job_ids})
          end
        )

      {:ok, job} =
        Queue.add(queue_name, "test-job", %{value: 1}, connection: conn, prefix: @test_prefix)

      job_id = job.id

      assert_receive {:processor_started, ^job_id}, 5_000

      # Delete the lock
      lock_key = "#{@test_prefix}:#{queue_name}:#{job_id}:lock"
      {:ok, _} = BullMQ.RedisConnection.command(conn, ["DEL", lock_key])

      # Verify callback is called
      assert_receive {:lock_renewal_failed, [^job_id]}, 5_000

      Worker.close(worker, force: true)
    end
  end

  # ---------------------------------------------------------------------------
  # Helper Functions
  # ---------------------------------------------------------------------------

  # Wait for cancellation token to be triggered or timeout
  defp wait_for_cancellation_or_timeout(cancel_token, timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms

    do_wait_for_cancellation(cancel_token, deadline)
  end

  defp do_wait_for_cancellation(cancel_token, deadline) do
    case BullMQ.CancellationToken.check(cancel_token) do
      {:cancelled, reason} ->
        {:error, {:cancelled, reason}}

      :ok ->
        now = System.monotonic_time(:millisecond)

        if now >= deadline do
          {:ok, :timeout}
        else
          Process.sleep(50)
          do_wait_for_cancellation(cancel_token, deadline)
        end
    end
  end

  # Simple helper to receive a :completed message value
  defp receive_completion(timeout) do
    receive do
      {:completed, value} -> value
    after
      timeout -> flunk("Timeout waiting for completion")
    end
  end

  # Convert flat Redis HGETALL result [k1, v1, k2, v2, ...] to map
  defp list_to_map(list) when is_list(list) do
    list
    |> Enum.chunk_every(2)
    |> Enum.map(fn [k, v] -> {k, v} end)
    |> Map.new()
  end
end
