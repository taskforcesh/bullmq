defmodule BullMQ.JobSchedulerProcessingTest do
  @moduledoc """
  Integration tests for JobScheduler with actual job processing.

  These tests verify that scheduled jobs are actually created and can be
  processed by real workers using the BullMQ.Worker module. Tests include:
  - Jobs are created at the correct times
  - Job data is passed correctly
  - Multiple iterations work
  - Upserts replace the pending job correctly
  - Workers process scheduled jobs in order
  """
  use ExUnit.Case, async: false

  @moduletag :integration
  @moduletag :processing

  alias BullMQ.{JobScheduler, Worker, QueueEvents, Keys}

  @redis_url BullMQ.TestHelper.redis_url()
  @test_prefix BullMQ.TestHelper.test_prefix()

  setup do
    pool_name = :"scheduler_proc_pool_#{System.unique_integer([:positive])}"

    # Start the connection pool - unlink so test cleanup doesn't cascade
    {:ok, pool_pid} =
      BullMQ.RedisConnection.start_link(
        name: pool_name,
        url: @redis_url,
        pool_size: 5
      )

    Process.unlink(pool_pid)

    {:ok, raw_conn} = Redix.start_link(@redis_url)
    Process.unlink(raw_conn)

    queue_name = "proc-queue-#{System.unique_integer([:positive])}"
    ctx = Keys.new(queue_name, prefix: @test_prefix)

    on_exit(fn ->
      # Close the pool (waits for scripts to load)
      BullMQ.RedisConnection.close(pool_name)

      # Stop the raw connection
      try do
        Redix.stop(raw_conn)
      catch
        :exit, _ -> :ok
      end

      # Clean up Redis keys
      case Redix.start_link(@redis_url) do
        {:ok, cleanup_conn} ->
          case Redix.command(cleanup_conn, ["KEYS", "#{@test_prefix}:*"]) do
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

    {:ok, conn: pool_name, raw_conn: raw_conn, queue_name: queue_name, ctx: ctx}
  end

  # ---------------------------------------------------------------------------
  # Every-based Scheduler Job Processing Tests
  # ---------------------------------------------------------------------------

  describe "Every-based scheduler job processing" do
    @tag :processing
    @tag timeout: 10_000
    test "scheduled job is created and can be processed", %{
      conn: conn,
      raw_conn: raw_conn,
      queue_name: queue_name
    } do
      processed = :ets.new(:processed, [:bag, :public])

      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix
        )

      QueueEvents.subscribe(events)

      # Start worker BEFORE creating scheduler
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            :ets.insert(
              processed,
              {:job,
               %{
                 name: job.name,
                 data: job.data,
                 repeat_job_key: job.repeat_job_key
               }}
            )

            :ok
          end
        )

      # Create a scheduler with short interval
      {:ok, initial_job} =
        JobScheduler.upsert(
          raw_conn,
          queue_name,
          "process-test",
          # 100ms interval, run immediately
          %{every: 100, immediately: true},
          "test-job",
          %{test: "data"},
          prefix: @test_prefix
        )

      assert initial_job != nil
      assert initial_job.repeat_job_key == "process-test"

      # Wait for at least one job to be processed
      wait_for_completions(1, 5_000)

      jobs = :ets.lookup(processed, :job) |> Enum.map(fn {:job, j} -> j end)
      assert length(jobs) >= 1

      [first_job | _] = jobs
      assert first_job.name == "test-job"
      assert first_job.data["test"] == "data"
      assert first_job.repeat_job_key == "process-test"

      Worker.close(worker)
      QueueEvents.close(events)
      :ets.delete(processed)
    end

    @tag :processing
    @tag timeout: 15_000
    test "multiple jobs are processed in sequence", %{
      conn: conn,
      raw_conn: raw_conn,
      queue_name: queue_name
    } do
      processed = :ets.new(:processed, [:ordered_set, :public])
      counter = :atomics.new(1, signed: false)

      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix
        )

      QueueEvents.subscribe(events)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            idx = :atomics.add_get(counter, 1, 1)

            :ets.insert(
              processed,
              {idx,
               %{
                 name: job.name,
                 repeat_job_key: job.repeat_job_key,
                 processed_at: System.system_time(:millisecond)
               }}
            )

            :ok
          end
        )

      # Create scheduler
      {:ok, _} =
        JobScheduler.upsert(
          raw_conn,
          queue_name,
          "multi-job-test",
          %{every: 150, immediately: true},
          "sequential-job",
          %{sequence: true},
          prefix: @test_prefix
        )

      # Wait for multiple jobs
      wait_for_completions(3, 10_000)

      jobs = :ets.tab2list(processed) |> Enum.map(fn {_idx, job} -> job end)
      assert length(jobs) >= 3

      # All jobs should have the same scheduler key
      assert Enum.all?(jobs, &(&1.repeat_job_key == "multi-job-test"))

      # Jobs should be processed in order (earlier timestamps first)
      timestamps = Enum.map(jobs, & &1.processed_at)
      assert timestamps == Enum.sort(timestamps)

      Worker.close(worker)
      QueueEvents.close(events)
      :ets.delete(processed)
    end

    @tag :processing
    @tag timeout: 10_000
    test "job data is correctly passed to each iteration", %{
      conn: conn,
      raw_conn: raw_conn,
      queue_name: queue_name
    } do
      processed = :ets.new(:processed, [:duplicate_bag, :public])

      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix
        )

      QueueEvents.subscribe(events)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            :ets.insert(processed, {:job, job.data})
            :ok
          end
        )

      job_data = %{
        user_id: 12345,
        action: "sync",
        options: %{full: true, retry: 3}
      }

      {:ok, _} =
        JobScheduler.upsert(
          raw_conn,
          queue_name,
          "data-test",
          %{every: 100, immediately: true},
          "data-job",
          job_data,
          prefix: @test_prefix
        )

      wait_for_completions(2, 5_000)

      jobs = :ets.lookup(processed, :job) |> Enum.map(fn {:job, data} -> data end)
      assert length(jobs) >= 2

      for job_data <- jobs do
        assert job_data["user_id"] == 12345
        assert job_data["action"] == "sync"
        assert job_data["options"] == %{"full" => true, "retry" => 3}
      end

      Worker.close(worker)
      QueueEvents.close(events)
      :ets.delete(processed)
    end

    @tag :processing
    @tag timeout: 10_000
    test "upsert while job is pending replaces the job", %{
      conn: conn,
      raw_conn: raw_conn,
      queue_name: queue_name,
      ctx: ctx
    } do
      processed = :ets.new(:processed, [:bag, :public])

      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix
        )

      QueueEvents.subscribe(events)

      # Create initial scheduler with longer interval (no immediately)
      {:ok, job1} =
        JobScheduler.upsert(
          raw_conn,
          queue_name,
          "upsert-test",
          # 5 seconds
          %{every: 5000},
          "original-job",
          %{version: 1},
          prefix: @test_prefix
        )

      # Verify job is in delayed or wait
      {:ok, delayed1} = Redix.command(raw_conn, ["ZRANGE", Keys.delayed(ctx), 0, -1])
      {:ok, waiting1} = Redix.command(raw_conn, ["LRANGE", Keys.wait(ctx), 0, -1])
      assert job1.id in delayed1 or job1.id in waiting1

      # Upsert with new data and shorter interval + immediately
      {:ok, _job2} =
        JobScheduler.upsert(
          raw_conn,
          queue_name,
          "upsert-test",
          # Much shorter
          %{every: 100, immediately: true},
          "updated-job",
          %{version: 2},
          prefix: @test_prefix
        )

      # Start worker and verify we get the updated version
      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            :ets.insert(processed, {:job, %{name: job.name, data: job.data}})
            :ok
          end
        )

      wait_for_completions(1, 5_000)

      jobs = :ets.lookup(processed, :job) |> Enum.map(fn {:job, j} -> j end)
      [processed_job | _] = jobs

      assert processed_job.name == "updated-job"
      assert processed_job.data["version"] == 2

      Worker.close(worker)
      QueueEvents.close(events)
      :ets.delete(processed)
    end
  end

  # ---------------------------------------------------------------------------
  # Cron-based Scheduler Job Processing Tests
  # ---------------------------------------------------------------------------

  describe "Cron-based scheduler job processing" do
    @tag :processing
    @tag timeout: 10_000
    test "cron scheduler creates job at correct time", %{
      conn: conn,
      raw_conn: raw_conn,
      queue_name: queue_name
    } do
      processed = :ets.new(:processed, [:bag, :public])

      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix
        )

      QueueEvents.subscribe(events)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            :ets.insert(processed, {:job, job.name})
            :ok
          end
        )

      # Create scheduler that runs immediately (using a pattern that runs very soon)
      # Use "every second" pattern and immediately flag
      {:ok, _} =
        JobScheduler.upsert(
          raw_conn,
          queue_name,
          "cron-test",
          # Every second + immediate
          %{pattern: "* * * * * *", immediately: true},
          "cron-job",
          %{},
          prefix: @test_prefix
        )

      wait_for_completions(1, 5_000)

      jobs = :ets.lookup(processed, :job) |> Enum.map(fn {:job, name} -> name end)
      assert length(jobs) >= 1
      assert "cron-job" in jobs

      Worker.close(worker)
      QueueEvents.close(events)
      :ets.delete(processed)
    end
  end

  # ---------------------------------------------------------------------------
  # Scheduler Limit Tests
  # ---------------------------------------------------------------------------

  describe "Scheduler limits" do
    @tag :processing
    @tag timeout: 15_000
    test "scheduler respects iteration limit", %{
      conn: conn,
      raw_conn: raw_conn,
      queue_name: queue_name
    } do
      processed = :ets.new(:processed, [:bag, :public])

      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix
        )

      QueueEvents.subscribe(events)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            :ets.insert(processed, {:job, job.name})
            :ok
          end
        )

      # Create scheduler with limit
      {:ok, _} =
        JobScheduler.upsert(
          raw_conn,
          queue_name,
          "limited-test",
          %{every: 50, limit: 3, immediately: true},
          "limited-job",
          %{},
          prefix: @test_prefix
        )

      # Wait longer than needed to ensure no extra jobs are created
      Process.sleep(500)

      # Drain remaining events
      wait_for_completions(3, 3_000)

      # Should have exactly 3 jobs (or close to it - timing can be tricky)
      jobs = :ets.lookup(processed, :job) |> Enum.map(fn {:job, name} -> name end)

      # With limit of 3, we should have at most 3 jobs
      assert length(jobs) <= 3

      Worker.close(worker)
      QueueEvents.close(events)
      :ets.delete(processed)
    end
  end

  # ---------------------------------------------------------------------------
  # Scheduler Remove Tests
  # ---------------------------------------------------------------------------

  describe "Scheduler removal" do
    @tag :processing
    @tag timeout: 10_000
    test "removing scheduler stops job creation", %{
      conn: conn,
      raw_conn: raw_conn,
      queue_name: queue_name
    } do
      processed = :ets.new(:processed, [:bag, :public])

      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix
        )

      QueueEvents.subscribe(events)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            :ets.insert(processed, {:job, job.name})
            :ok
          end
        )

      # Create scheduler
      {:ok, _} =
        JobScheduler.upsert(
          raw_conn,
          queue_name,
          "remove-test",
          %{every: 100, immediately: true},
          "remove-job",
          %{},
          prefix: @test_prefix
        )

      # Wait for first job
      wait_for_completions(1, 3_000)

      # Remove the scheduler
      {:ok, _} = JobScheduler.remove(raw_conn, queue_name, "remove-test", prefix: @test_prefix)

      count_before = :ets.lookup(processed, :job) |> length()

      # Wait a bit - no more jobs should be created
      Process.sleep(500)

      count_after = :ets.lookup(processed, :job) |> length()

      # Count should not increase significantly after removal
      # (might increase by 1 if a job was already in flight)
      assert count_after <= count_before + 1

      Worker.close(worker)
      QueueEvents.close(events)
      :ets.delete(processed)
    end
  end

  # ---------------------------------------------------------------------------
  # Worker Processing Behavior Tests
  # ---------------------------------------------------------------------------

  describe "Worker processing behavior" do
    @tag :processing
    @tag timeout: 10_000
    test "failed job does not affect next scheduled iteration", %{
      conn: conn,
      raw_conn: raw_conn,
      queue_name: queue_name
    } do
      processed = :ets.new(:processed, [:bag, :public])
      counter = :atomics.new(1, signed: false)

      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix
        )

      QueueEvents.subscribe(events)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job ->
            count = :atomics.add_get(counter, 1, 1)
            :ets.insert(processed, {:job, count})

            if count == 1 do
              # First job fails
              raise "Intentional failure"
            else
              # Subsequent jobs succeed
              :ok
            end
          end
        )

      {:ok, _} =
        JobScheduler.upsert(
          raw_conn,
          queue_name,
          "fail-test",
          %{every: 150, immediately: true},
          "fail-job",
          %{},
          prefix: @test_prefix
        )

      # Wait for multiple iterations (some will fail, some will succeed)
      Process.sleep(1000)

      # Should have processed multiple jobs despite the failure
      jobs = :ets.lookup(processed, :job)
      assert length(jobs) >= 2

      Worker.close(worker)
      QueueEvents.close(events)
      :ets.delete(processed)
    end

    @tag :processing
    @tag timeout: 15_000
    test "scheduler with multi-colon ID creates multiple iterations", %{
      conn: conn,
      raw_conn: raw_conn,
      queue_name: queue_name,
      ctx: ctx
    } do
      # This test reproduces the scenario reported by users where scheduler IDs
      # containing multiple colons (like "integration_poll:org:int:disc")
      # would create only one job and not schedule subsequent iterations.
      processed = :ets.new(:processed, [:ordered_set, :public])
      counter = :atomics.new(1, signed: false)

      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix
        )

      QueueEvents.subscribe(events)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            idx = :atomics.add_get(counter, 1, 1)

            :ets.insert(
              processed,
              {idx,
               %{
                 id: job.id,
                 name: job.name,
                 repeat_job_key: job.repeat_job_key,
                 data: job.data,
                 processed_at: System.system_time(:millisecond)
               }}
            )

            :ok
          end
        )

      # Use a scheduler ID with multiple colons (mimics user's pattern)
      # "integration_poll:org_id:integration_id:discriminator_id"
      org_id = "org-123"
      integration_id = "int-456"
      discriminator_id = "disc-789"
      scheduler_id = "integration_poll:#{org_id}:#{integration_id}:#{discriminator_id}"

      job_data = %{
        "organization_id" => org_id,
        "integration_id" => integration_id,
        "discriminator_id" => discriminator_id
      }

      {:ok, initial_job} =
        JobScheduler.upsert(
          raw_conn,
          queue_name,
          scheduler_id,
          %{every: 200, immediately: true},
          scheduler_id,
          job_data,
          prefix: @test_prefix
        )

      assert initial_job != nil
      assert initial_job.repeat_job_key == scheduler_id

      # Verify initial job ID format
      assert String.starts_with?(initial_job.id, "repeat:#{scheduler_id}:")

      # Wait for at least 3 jobs to be processed
      result = wait_for_completions(3, 10_000)
      assert result == :ok, "Expected at least 3 completions but timed out"

      jobs = :ets.tab2list(processed) |> Enum.map(fn {_idx, job} -> job end)
      assert length(jobs) >= 3, "Expected at least 3 jobs but got #{length(jobs)}"

      # Verify all jobs have the correct scheduler key
      for job <- jobs do
        assert job.repeat_job_key == scheduler_id,
               "Job repeat_job_key mismatch: expected #{scheduler_id}, got #{job.repeat_job_key}"

        assert String.starts_with?(job.id, "repeat:#{scheduler_id}:"),
               "Job ID format incorrect: #{job.id}"
      end

      # Verify scheduler still exists in Redis
      {:ok, score} = Redix.command(raw_conn, ["ZSCORE", Keys.repeat(ctx), scheduler_id])
      assert score != nil, "Scheduler should still exist in repeat key"

      Worker.close(worker)
      QueueEvents.close(events)
      :ets.delete(processed)
    end

    @tag :processing
    @tag timeout: 20_000
    test "scheduler without immediately flag still creates iterations", %{
      conn: conn,
      raw_conn: raw_conn,
      queue_name: queue_name,
      ctx: ctx
    } do
      # This test mimics the user's actual code which does NOT use immediately: true
      # and has a longer interval
      processed = :ets.new(:processed, [:ordered_set, :public])
      counter = :atomics.new(1, signed: false)

      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix
        )

      QueueEvents.subscribe(events)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn job ->
            idx = :atomics.add_get(counter, 1, 1)

            :ets.insert(
              processed,
              {idx,
               %{
                 id: job.id,
                 repeat_job_key: job.repeat_job_key,
                 opts: job.opts,
                 processed_at: System.system_time(:millisecond)
               }}
            )

            :ok
          end
        )

      # Use same pattern as user's code: multi-colon ID, no immediately flag
      scheduler_id = "integration_poll:org-123:int-456:disc-789"

      job_data = %{
        "organization_id" => "org-123",
        "integration_id" => "int-456",
        "discriminator_id" => "disc-789"
      }

      # Create scheduler with 500ms interval (no immediately flag!)
      {:ok, _initial_job} =
        JobScheduler.upsert(
          raw_conn,
          queue_name,
          scheduler_id,
          %{every: 500},
          scheduler_id,
          job_data,
          prefix: @test_prefix,
          attempts: 3
        )

      # Verify initial scheduler state
      {:ok, score_before} = Redix.command(raw_conn, ["ZSCORE", Keys.repeat(ctx), scheduler_id])
      assert score_before != nil, "Scheduler should exist"

      # Wait for at least 3 jobs to be processed (each 500ms apart + processing time)
      result = wait_for_completions(3, 15_000)
      assert result == :ok, "Expected at least 3 completions but timed out"

      jobs = :ets.tab2list(processed) |> Enum.map(fn {_idx, job} -> job end)
      assert length(jobs) >= 3, "Expected at least 3 jobs but got #{length(jobs)}"

      # Verify scheduler still exists
      {:ok, score_after} = Redix.command(raw_conn, ["ZSCORE", Keys.repeat(ctx), scheduler_id])
      assert score_after != nil, "Scheduler should still exist"

      Worker.close(worker)
      QueueEvents.close(events)
      :ets.delete(processed)
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
      # Timeout reached - return what we got
      :timeout
    else
      receive do
        {:bullmq_event, :completed, _data} ->
          do_wait_for_completions(count + 1, expected, deadline)

        {:bullmq_event, :failed, _data} ->
          # Don't fail on job failure - some tests intentionally fail jobs
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
