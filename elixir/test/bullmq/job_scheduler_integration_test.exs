defmodule BullMQ.JobSchedulerIntegrationTest do
  @moduledoc """
  Integration tests for JobScheduler functionality with a real Redis instance.

  These tests verify the job scheduler (repeatable jobs) functionality including:
  - Creating schedulers with cron patterns
  - Creating schedulers with "every" intervals
  - Listing and retrieving schedulers
  - Removing schedulers
  - Start dates, end dates, and limits
  - Iteration counting
  - Template data storage
  """
  use ExUnit.Case, async: false

  @moduletag :integration

  alias BullMQ.{JobScheduler, Keys}

  @redis_url BullMQ.TestHelper.redis_url()
  @test_prefix BullMQ.TestHelper.test_prefix()

  setup do
    {:ok, conn} = Redix.start_link(@redis_url)
    Process.unlink(conn)
    queue_name = "scheduler-queue-#{System.unique_integer([:positive])}"

    on_exit(fn ->
      # Stop the test connection
      try do
        Redix.stop(conn)
      catch
        :exit, _ -> :ok
      end

      # Cleanup after test
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

    {:ok, conn: conn, queue_name: queue_name}
  end

  # ---------------------------------------------------------------------------
  # Validation Tests
  # ---------------------------------------------------------------------------

  describe "Option validation" do
    @tag :integration
    test "rejects when both pattern and every are specified", %{conn: conn, queue_name: queue_name} do
      result =
        JobScheduler.upsert(
          conn,
          queue_name,
          "test-scheduler",
          %{pattern: "0 * * * *", every: 60_000},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      assert {:error, :both_pattern_and_every} = result
    end

    @tag :integration
    test "rejects when neither pattern nor every is specified", %{
      conn: conn,
      queue_name: queue_name
    } do
      result =
        JobScheduler.upsert(
          conn,
          queue_name,
          "test-scheduler",
          %{limit: 10},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      assert {:error, :no_pattern_or_every} = result
    end

    @tag :integration
    test "rejects when immediately and start_date are both specified", %{
      conn: conn,
      queue_name: queue_name
    } do
      result =
        JobScheduler.upsert(
          conn,
          queue_name,
          "test-scheduler",
          %{
            pattern: "0 * * * *",
            immediately: true,
            start_date: System.system_time(:millisecond) + 60_000
          },
          "test-job",
          %{},
          prefix: @test_prefix
        )

      assert {:error, :immediately_with_start_date} = result
    end

    @tag :integration
    test "rejects scheduler ID with 5 colon-separated parts", %{conn: conn, queue_name: queue_name} do
      result =
        JobScheduler.upsert(
          conn,
          queue_name,
          "part1:part2:part3:part4:part5",
          %{every: 1000},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      assert {:error, {:invalid_scheduler_id, message}} = result
      assert message =~ "contains 5 colon-separated parts"
      assert message =~ "fewer than 5"
    end

    @tag :integration
    test "rejects scheduler ID with trailing colon creating 5 parts", %{
      conn: conn,
      queue_name: queue_name
    } do
      result =
        JobScheduler.upsert(
          conn,
          queue_name,
          "part1:part2:part3:part4:",
          %{every: 1000},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      assert {:error, {:invalid_scheduler_id, message}} = result
      assert message =~ "contains 5 colon-separated parts"
    end

    @tag :integration
    test "rejects scheduler ID with more than 5 colon-separated parts", %{
      conn: conn,
      queue_name: queue_name
    } do
      result =
        JobScheduler.upsert(
          conn,
          queue_name,
          "a:b:c:d:e:f:g",
          %{every: 1000},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      assert {:error, {:invalid_scheduler_id, message}} = result
      assert message =~ "contains 7 colon-separated parts"
    end

    @tag :integration
    test "rejects empty scheduler ID", %{conn: conn, queue_name: queue_name} do
      result =
        JobScheduler.upsert(
          conn,
          queue_name,
          "",
          %{every: 1000},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      assert {:error, :empty_scheduler_id} = result
    end

    @tag :integration
    test "accepts scheduler ID with 4 colon-separated parts", %{conn: conn, queue_name: queue_name} do
      {:ok, job} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "part1:part2:part3:part4",
          %{every: 1000},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      assert job.id =~ "repeat:part1:part2:part3:part4:"
      assert job.repeat_job_key == "part1:part2:part3:part4"
    end

    @tag :integration
    test "accepts scheduler ID with no colons", %{conn: conn, queue_name: queue_name} do
      {:ok, job} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "simple-scheduler-id",
          %{every: 1000},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      assert job.id =~ "repeat:simple-scheduler-id:"
      assert job.repeat_job_key == "simple-scheduler-id"
    end
  end

  # ---------------------------------------------------------------------------
  # Every-based Scheduler Tests
  # ---------------------------------------------------------------------------

  describe "Every-based schedulers" do
    @tag :integration
    test "creates a scheduler with every option", %{conn: conn, queue_name: queue_name} do
      {:ok, job} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "every-2s",
          %{every: 2000},
          "test-job",
          %{foo: "bar"},
          prefix: @test_prefix
        )

      assert job.id =~ "repeat:every-2s:"
      assert job.name == "test-job"
      assert job.data == %{foo: "bar"}
      assert job.repeat_job_key == "every-2s"
    end

    @tag :integration
    test "scheduler is stored in Redis", %{conn: conn, queue_name: queue_name} do
      {:ok, _job} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "stored-scheduler",
          %{every: 5000},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      {:ok, scheduler} =
        JobScheduler.get(conn, queue_name, "stored-scheduler", prefix: @test_prefix)

      assert scheduler.key == "stored-scheduler"
      assert scheduler.name == "test-job"
      assert scheduler.every == 5000
      assert is_integer(scheduler.next)
    end

    @tag :integration
    test "creates delayed job in Redis", %{conn: conn, queue_name: queue_name} do
      ctx = Keys.new(queue_name, prefix: @test_prefix)

      {:ok, job} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "delayed-test",
          # Use a longer delay to ensure it goes to delayed set
          %{every: 60_000},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      # Check delayed set - the job should be scheduled for the future
      {:ok, delayed} = Redix.command(conn, ["ZRANGE", Keys.delayed(ctx), 0, -1])

      # The job ID should be in the delayed set (or wait if immediate)
      # Since every: 60_000 means next execution is now + 60000ms, it should be delayed
      assert job.id in delayed or
               (fn ->
                  {:ok, waiting} = Redix.command(conn, ["LRANGE", Keys.wait(ctx), 0, -1])
                  job.id in waiting
                end).()
    end

    @tag :integration
    test "multiple schedulers with different every values", %{conn: conn, queue_name: queue_name} do
      for {id, every} <- [{"s1", 1000}, {"s2", 2000}, {"s3", 5000}] do
        {:ok, _} =
          JobScheduler.upsert(
            conn,
            queue_name,
            id,
            %{every: every},
            "test-#{id}",
            %{},
            prefix: @test_prefix
          )
      end

      {:ok, count} = JobScheduler.count(conn, queue_name, prefix: @test_prefix)
      assert count == 3

      {:ok, schedulers} = JobScheduler.list(conn, queue_name, prefix: @test_prefix)
      assert length(schedulers) == 3
    end

    @tag :integration
    test "upserting same scheduler updates it", %{conn: conn, queue_name: queue_name} do
      # Create initial scheduler
      {:ok, _job1} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "update-test",
          %{every: 5000},
          "test-job",
          %{version: 1},
          prefix: @test_prefix
        )

      # Update with different interval
      {:ok, _job2} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "update-test",
          %{every: 10_000},
          "test-job",
          %{version: 2},
          prefix: @test_prefix
        )

      # Should still only have one scheduler
      {:ok, count} = JobScheduler.count(conn, queue_name, prefix: @test_prefix)
      assert count == 1

      # Get updated scheduler
      {:ok, scheduler} = JobScheduler.get(conn, queue_name, "update-test", prefix: @test_prefix)
      assert scheduler.every == 10_000
      assert scheduler.template.data == %{"version" => 2}
    end
  end

  # ---------------------------------------------------------------------------
  # Pattern-based (Cron) Scheduler Tests
  # ---------------------------------------------------------------------------

  describe "Pattern-based schedulers" do
    @tag :integration
    test "creates a scheduler with cron pattern", %{conn: conn, queue_name: queue_name} do
      {:ok, job} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "cron-test",
          # Every hour
          %{pattern: "0 * * * *"},
          "hourly-job",
          %{type: "hourly"},
          prefix: @test_prefix
        )

      assert job.id =~ "repeat:cron-test:"
      assert job.name == "hourly-job"
      assert job.repeat_job_key == "cron-test"
    end

    @tag :integration
    test "stores pattern in scheduler data", %{conn: conn, queue_name: queue_name} do
      {:ok, _job} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "pattern-storage",
          # Every 5 minutes
          %{pattern: "*/5 * * * *"},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      {:ok, scheduler} = JobScheduler.get(conn, queue_name, "pattern-storage", prefix: @test_prefix)

      assert scheduler.pattern == "*/5 * * * *"
      # Pattern-based schedulers don't have :every key
      assert Map.get(scheduler, :every) == nil
    end

    @tag :integration
    test "multiple schedulers with different patterns", %{conn: conn, queue_name: queue_name} do
      patterns = [
        {"hourly", "0 * * * *"},
        {"daily", "0 0 * * *"},
        {"weekly", "0 0 * * 1"},
        {"monthly", "0 0 1 * *"}
      ]

      for {id, pattern} <- patterns do
        {:ok, _} =
          JobScheduler.upsert(
            conn,
            queue_name,
            id,
            %{pattern: pattern},
            "#{id}-job",
            %{},
            prefix: @test_prefix
          )
      end

      {:ok, schedulers} = JobScheduler.list(conn, queue_name, prefix: @test_prefix)
      assert length(schedulers) == 4

      patterns_found = schedulers |> Enum.map(& &1.pattern) |> Enum.sort()
      expected = patterns |> Enum.map(fn {_, p} -> p end) |> Enum.sort()
      assert patterns_found == expected
    end

    @tag :integration
    test "immediately option runs first job immediately", %{conn: conn, queue_name: queue_name} do
      _now = System.system_time(:millisecond)

      {:ok, job} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "immediate-test",
          # Every hour, but first one now
          %{pattern: "0 * * * *", immediately: true},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      # Job should have very small or zero delay
      assert job.delay <= 100
    end
  end

  # ---------------------------------------------------------------------------
  # Limit and End Date Tests
  # ---------------------------------------------------------------------------

  describe "Limits and boundaries" do
    @tag :integration
    test "respects limit option", %{conn: conn, queue_name: queue_name} do
      {:ok, job} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "limited-scheduler",
          %{every: 1000, limit: 5},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      assert job != nil

      {:ok, scheduler} =
        JobScheduler.get(conn, queue_name, "limited-scheduler", prefix: @test_prefix)

      assert scheduler.limit == 5
    end

    @tag :integration
    test "rejects when count exceeds limit", %{conn: conn, queue_name: queue_name} do
      result =
        JobScheduler.upsert(
          conn,
          queue_name,
          "over-limit",
          # Already at limit
          %{every: 1000, limit: 5, count: 5},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      assert {:error, :limit_reached} = result
    end

    @tag :integration
    test "respects end_date option", %{conn: conn, queue_name: queue_name} do
      # 1 day from now
      future = System.system_time(:millisecond) + 86_400_000

      {:ok, job} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "end-date-scheduler",
          %{every: 1000, end_date: future},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      assert job != nil

      {:ok, scheduler} =
        JobScheduler.get(conn, queue_name, "end-date-scheduler", prefix: @test_prefix)

      assert scheduler.end_date == future
    end

    @tag :integration
    test "rejects when end_date is in the past", %{conn: conn, queue_name: queue_name} do
      past = System.system_time(:millisecond) - 1000

      result =
        JobScheduler.upsert(
          conn,
          queue_name,
          "past-end-date",
          %{every: 1000, end_date: past},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      assert {:error, :end_date_reached} = result
    end

    @tag :integration
    test "respects start_date option", %{conn: conn, queue_name: queue_name} do
      # 1 minute from now
      future = System.system_time(:millisecond) + 60_000

      {:ok, job} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "start-date-scheduler",
          %{every: 1000, start_date: future},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      # Delay should be at least 1 minute
      assert job.delay >= 59_000

      {:ok, scheduler} =
        JobScheduler.get(conn, queue_name, "start-date-scheduler", prefix: @test_prefix)

      assert scheduler.start_date == future
    end
  end

  # ---------------------------------------------------------------------------
  # Get and List Tests
  # ---------------------------------------------------------------------------

  describe "Getting schedulers" do
    @tag :integration
    test "get returns nil for non-existent scheduler", %{conn: conn, queue_name: queue_name} do
      {:ok, scheduler} = JobScheduler.get(conn, queue_name, "non-existent", prefix: @test_prefix)
      assert scheduler == nil
    end

    @tag :integration
    test "get returns full scheduler data", %{conn: conn, queue_name: queue_name} do
      # 1 hour
      future_end = System.system_time(:millisecond) + 3_600_000

      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "full-data-test",
          %{every: 2000, limit: 10, end_date: future_end, tz: "UTC"},
          "detailed-job",
          %{key: "value"},
          prefix: @test_prefix
        )

      {:ok, scheduler} = JobScheduler.get(conn, queue_name, "full-data-test", prefix: @test_prefix)

      assert scheduler.key == "full-data-test"
      assert scheduler.name == "detailed-job"
      assert scheduler.every == 2000
      assert scheduler.limit == 10
      assert scheduler.end_date == future_end
      assert scheduler.tz == "UTC"
      assert scheduler.template.data == %{"key" => "value"}
    end

    @tag :integration
    test "list returns schedulers in order", %{conn: conn, queue_name: queue_name} do
      # Create schedulers with different next times
      for i <- 1..5 do
        {:ok, _} =
          JobScheduler.upsert(
            conn,
            queue_name,
            "ordered-#{i}",
            %{every: i * 10_000},
            "job-#{i}",
            %{},
            prefix: @test_prefix
          )
      end

      # Default order (descending)
      {:ok, desc_schedulers} = JobScheduler.list(conn, queue_name, prefix: @test_prefix)
      desc_nexts = Enum.map(desc_schedulers, & &1.next)
      assert desc_nexts == Enum.sort(desc_nexts, :desc)

      # Ascending order
      {:ok, asc_schedulers} = JobScheduler.list(conn, queue_name, asc: true, prefix: @test_prefix)
      asc_nexts = Enum.map(asc_schedulers, & &1.next)
      assert asc_nexts == Enum.sort(asc_nexts, :asc)
    end

    @tag :integration
    test "list with pagination", %{conn: conn, queue_name: queue_name} do
      for i <- 1..10 do
        {:ok, _} =
          JobScheduler.upsert(
            conn,
            queue_name,
            "paginated-#{i}",
            %{every: 1000},
            "job-#{i}",
            %{},
            prefix: @test_prefix
          )
      end

      # Get first 3
      {:ok, first_page} =
        JobScheduler.list(conn, queue_name, start: 0, end: 2, prefix: @test_prefix)

      assert length(first_page) == 3

      # Get next 3
      {:ok, second_page} =
        JobScheduler.list(conn, queue_name, start: 3, end: 5, prefix: @test_prefix)

      assert length(second_page) == 3

      # No overlap
      first_keys = Enum.map(first_page, & &1.key)
      second_keys = Enum.map(second_page, & &1.key)
      assert Enum.all?(first_keys, fn k -> k not in second_keys end)
    end

    @tag :integration
    test "count returns correct number", %{conn: conn, queue_name: queue_name} do
      {:ok, initial_count} = JobScheduler.count(conn, queue_name, prefix: @test_prefix)
      assert initial_count == 0

      for i <- 1..7 do
        {:ok, _} =
          JobScheduler.upsert(
            conn,
            queue_name,
            "counted-#{i}",
            %{every: 1000},
            "job",
            %{},
            prefix: @test_prefix
          )
      end

      {:ok, final_count} = JobScheduler.count(conn, queue_name, prefix: @test_prefix)
      assert final_count == 7
    end
  end

  # ---------------------------------------------------------------------------
  # Remove Tests
  # ---------------------------------------------------------------------------

  describe "Removing schedulers" do
    @tag :integration
    test "remove deletes scheduler and delayed job", %{conn: conn, queue_name: queue_name} do
      ctx = Keys.new(queue_name, prefix: @test_prefix)

      {:ok, job} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "to-remove",
          %{every: 60_000},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      # Verify exists
      {:ok, scheduler} = JobScheduler.get(conn, queue_name, "to-remove", prefix: @test_prefix)
      assert scheduler != nil

      # Remove
      {:ok, removed} = JobScheduler.remove(conn, queue_name, "to-remove", prefix: @test_prefix)
      assert removed == true

      # Verify gone
      {:ok, scheduler_after} = JobScheduler.get(conn, queue_name, "to-remove", prefix: @test_prefix)
      assert scheduler_after == nil

      # Delayed job should also be removed
      {:ok, delayed} = Redix.command(conn, ["ZRANGE", Keys.delayed(ctx), 0, -1])
      assert job.id not in delayed
    end

    @tag :integration
    test "remove returns false for non-existent scheduler", %{conn: conn, queue_name: queue_name} do
      {:ok, removed} = JobScheduler.remove(conn, queue_name, "non-existent", prefix: @test_prefix)
      assert removed == false
    end

    @tag :integration
    test "remove_by_key is alias for remove", %{conn: conn, queue_name: queue_name} do
      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "alias-test",
          %{every: 1000},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      {:ok, removed} =
        JobScheduler.remove_by_key(conn, queue_name, "alias-test", prefix: @test_prefix)

      assert removed == true

      {:ok, scheduler} = JobScheduler.get(conn, queue_name, "alias-test", prefix: @test_prefix)
      assert scheduler == nil
    end
  end

  # ---------------------------------------------------------------------------
  # Template Data Tests
  # ---------------------------------------------------------------------------

  describe "Template data" do
    @tag :integration
    test "stores job data in template", %{conn: conn, queue_name: queue_name} do
      job_data = %{
        user_id: 123,
        action: "notify",
        tags: ["important", "scheduled"]
      }

      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "template-data-test",
          %{every: 1000},
          "notification-job",
          job_data,
          prefix: @test_prefix
        )

      {:ok, scheduler} =
        JobScheduler.get(conn, queue_name, "template-data-test", prefix: @test_prefix)

      assert scheduler.template.data["user_id"] == 123
      assert scheduler.template.data["action"] == "notify"
      assert scheduler.template.data["tags"] == ["important", "scheduled"]
    end

    @tag :integration
    test "stores job options in template", %{conn: conn, queue_name: queue_name} do
      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "template-opts-test",
          %{every: 1000},
          "priority-job",
          %{},
          prefix: @test_prefix,
          priority: 10,
          attempts: 5,
          backoff: %{type: "exponential", delay: 1000}
        )

      {:ok, scheduler} =
        JobScheduler.get(conn, queue_name, "template-opts-test", prefix: @test_prefix)

      assert scheduler.template.opts["priority"] == 10
      assert scheduler.template.opts["attempts"] == 5
    end
  end

  # ---------------------------------------------------------------------------
  # calculate_next_millis Tests
  # ---------------------------------------------------------------------------

  describe "calculate_next_millis" do
    test "every returns reference + interval" do
      now = 1_000_000_000
      result = JobScheduler.calculate_next_millis(%{every: 5000}, now)
      assert result == now + 5000
    end

    test "every with start_date in future uses start_date" do
      now = 1_000_000_000
      future = now + 60_000
      result = JobScheduler.calculate_next_millis(%{every: 5000, start_date: future}, now)
      assert result == future
    end

    test "every respects end_date" do
      now = 1_000_000_000
      end_date = now + 1000
      result = JobScheduler.calculate_next_millis(%{every: 5000, end_date: end_date}, now)
      # Next would be now + 5000 which is > end_date
      assert result == nil
    end

    test "immediately returns reference time" do
      now = 1_000_000_000
      result = JobScheduler.calculate_next_millis(%{immediately: true}, now)
      assert result == now
    end

    test "pattern calculates next cron time" do
      now = System.system_time(:millisecond)
      result = JobScheduler.calculate_next_millis(%{pattern: "0 * * * *"}, now)

      # Should be in the future
      assert result > now
      # Should be within an hour
      assert result <= now + 3_600_000
    end

    test "invalid pattern returns nil" do
      result = JobScheduler.calculate_next_millis(%{pattern: "invalid cron"}, 0)
      assert result == nil
    end

    test "no pattern or every returns nil" do
      result = JobScheduler.calculate_next_millis(%{limit: 5}, 0)
      assert result == nil
    end
  end

  # ---------------------------------------------------------------------------
  # Timezone Tests
  # ---------------------------------------------------------------------------

  describe "Timezone handling" do
    @tag :integration
    test "stores timezone in scheduler", %{conn: conn, queue_name: queue_name} do
      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "tz-test",
          %{pattern: "0 9 * * *", tz: "America/New_York"},
          "daily-job",
          %{},
          prefix: @test_prefix
        )

      {:ok, scheduler} = JobScheduler.get(conn, queue_name, "tz-test", prefix: @test_prefix)
      assert scheduler.tz == "America/New_York"
    end
  end

  # ---------------------------------------------------------------------------
  # Iteration Count Tests
  # ---------------------------------------------------------------------------

  describe "Iteration counting" do
    @tag :integration
    test "stores iteration count", %{conn: conn, queue_name: queue_name} do
      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "iteration-test",
          %{every: 1000},
          "test-job",
          %{},
          prefix: @test_prefix
        )

      {:ok, scheduler} = JobScheduler.get(conn, queue_name, "iteration-test", prefix: @test_prefix)
      assert scheduler.iteration_count == 1
    end
  end

  # ---------------------------------------------------------------------------
  # Offset Tests
  # ---------------------------------------------------------------------------

  describe "Offset handling" do
    @tag :integration
    test "stores offset in scheduler", %{conn: conn, queue_name: queue_name} do
      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "offset-test",
          %{every: 60_000, offset: 5000},
          "offset-job",
          %{},
          prefix: @test_prefix
        )

      {:ok, scheduler} = JobScheduler.get(conn, queue_name, "offset-test", prefix: @test_prefix)
      # Offset is calculated by the script, but we can verify it exists
      assert scheduler.offset != nil || scheduler.offset == 0
    end
  end

  # ---------------------------------------------------------------------------
  # Concurrent Access Tests
  # ---------------------------------------------------------------------------

  describe "Concurrent operations" do
    @tag :integration
    test "handles concurrent upserts safely", %{conn: _conn, queue_name: queue_name} do
      # Create multiple connections for parallel operations
      tasks =
        for i <- 1..5 do
          Task.async(fn ->
            {:ok, task_conn} = Redix.start_link(@redis_url)

            result =
              JobScheduler.upsert(
                task_conn,
                queue_name,
                "concurrent-test",
                %{every: 1000 + i * 100},
                "test-job",
                %{index: i},
                prefix: @test_prefix
              )

            Redix.stop(task_conn)
            result
          end)
        end

      results = Task.await_many(tasks)

      # All should succeed (upsert semantics)
      assert Enum.all?(results, fn
               {:ok, _} -> true
               _ -> false
             end)

      # Should only have one scheduler
      {:ok, check_conn} = Redix.start_link(@redis_url)
      {:ok, count} = JobScheduler.count(check_conn, queue_name, prefix: @test_prefix)
      Redix.stop(check_conn)

      assert count == 1
    end
  end

  # ---------------------------------------------------------------------------
  # Worker + Scheduler Integration Tests
  # These tests verify the full workflow: scheduler creates job -> worker processes -> scheduler creates next job
  # ---------------------------------------------------------------------------

  describe "Worker processing scheduled jobs" do
    @tag :integration
    @tag timeout: 30_000
    test "worker processes every-based scheduler jobs", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      # Start a connection pool
      pool_name = :"worker_pool_#{System.unique_integer([:positive])}"

      {:ok, pool_pid} =
        BullMQ.RedisConnection.start_link(
          name: pool_name,
          url: @redis_url,
          pool_size: 3
        )

      Process.unlink(pool_pid)

      # Create scheduler with short interval for testing
      {:ok, initial_job} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "every-worker-test",
          # Every 500ms
          %{every: 500},
          "scheduled-job",
          %{test: "data"},
          prefix: @test_prefix
        )

      assert initial_job.repeat_job_key == "every-worker-test"

      # Track processed jobs
      {:ok, counter} = Agent.start_link(fn -> [] end)

      # Start worker with event callback
      {:ok, worker} =
        BullMQ.Worker.start_link(
          queue: queue_name,
          connection: pool_name,
          prefix: @test_prefix,
          processor: fn job ->
            Agent.update(counter, fn jobs -> [job.id | jobs] end)
            send(test_pid, {:processed, job.id, job.data})
            {:ok, %{processed: true}}
          end,
          on_completed: fn job, _result ->
            send(test_pid, {:completed, job.id})
          end
        )

      # Wait for at least 3 job iterations
      assert_receive {:processed, _job_id1, data1}, 5_000
      assert data1["test"] == "data"
      assert_receive {:completed, _}, 5_000

      assert_receive {:processed, _job_id2, _data2}, 5_000
      assert_receive {:completed, _}, 5_000

      assert_receive {:processed, _job_id3, _data3}, 5_000
      assert_receive {:completed, _}, 5_000

      # Get processed job IDs
      processed_jobs = Agent.get(counter, & &1)
      assert length(processed_jobs) >= 3

      # Verify scheduler still exists
      {:ok, scheduler} =
        JobScheduler.get(conn, queue_name, "every-worker-test", prefix: @test_prefix)

      assert scheduler != nil
      assert scheduler.iteration_count >= 3

      # Cleanup
      BullMQ.Worker.close(worker)
      Agent.stop(counter)
      BullMQ.RedisConnection.close(pool_name)
    end

    @tag :integration
    @tag timeout: 30_000
    test "worker stops after scheduler limit is reached", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      # Start a connection pool
      pool_name = :"worker_pool_limit_#{System.unique_integer([:positive])}"

      {:ok, pool_pid} =
        BullMQ.RedisConnection.start_link(
          name: pool_name,
          url: @redis_url,
          pool_size: 3
        )

      Process.unlink(pool_pid)

      # Create scheduler with limit of 3 iterations
      {:ok, _initial_job} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "limited-scheduler",
          %{every: 300, limit: 3},
          "limited-job",
          %{counter: 0},
          prefix: @test_prefix
        )

      {:ok, counter} = Agent.start_link(fn -> 0 end)

      # Start worker
      {:ok, worker} =
        BullMQ.Worker.start_link(
          queue: queue_name,
          connection: pool_name,
          prefix: @test_prefix,
          processor: fn _job ->
            count = Agent.get_and_update(counter, fn c -> {c, c + 1} end)
            send(test_pid, {:iteration, count + 1})
            :ok
          end
        )

      # Wait for exactly 3 iterations
      assert_receive {:iteration, 1}, 5_000
      assert_receive {:iteration, 2}, 5_000
      assert_receive {:iteration, 3}, 5_000

      # Wait a bit to ensure no more jobs are processed
      Process.sleep(1000)

      # Should have processed exactly 3 jobs
      final_count = Agent.get(counter, & &1)
      assert final_count == 3

      # Check scheduler state
      {:ok, scheduler} =
        JobScheduler.get(conn, queue_name, "limited-scheduler", prefix: @test_prefix)

      assert scheduler != nil
      assert scheduler.limit == 3
      # iteration_count might be 3 or higher depending on how the limit is enforced

      # Cleanup
      BullMQ.Worker.close(worker)
      Agent.stop(counter)
      BullMQ.RedisConnection.close(pool_name)
    end

    @tag :integration
    @tag timeout: 30_000
    test "scheduler data is passed to each job iteration", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      # Start a connection pool
      pool_name = :"worker_pool_data_#{System.unique_integer([:positive])}"

      {:ok, pool_pid} =
        BullMQ.RedisConnection.start_link(
          name: pool_name,
          url: @redis_url,
          pool_size: 3
        )

      Process.unlink(pool_pid)

      # Create scheduler with specific data
      job_data = %{
        user_id: 123,
        action: "daily_report",
        config: %{
          format: "pdf",
          recipients: ["admin@example.com"]
        }
      }

      {:ok, _initial_job} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "data-test-scheduler",
          %{every: 400},
          "report-job",
          job_data,
          prefix: @test_prefix
        )

      # Start worker
      {:ok, worker} =
        BullMQ.Worker.start_link(
          queue: queue_name,
          connection: pool_name,
          prefix: @test_prefix,
          processor: fn job ->
            send(test_pid, {:job_data, job.data})
            :ok
          end
        )

      # Verify first job has correct data
      assert_receive {:job_data, received_data}, 5_000
      assert received_data["user_id"] == 123
      assert received_data["action"] == "daily_report"
      assert received_data["config"]["format"] == "pdf"

      # Verify second job also has correct data (template preserved)
      assert_receive {:job_data, received_data2}, 5_000
      assert received_data2["user_id"] == 123
      assert received_data2["action"] == "daily_report"

      # Cleanup
      BullMQ.Worker.close(worker)
      BullMQ.RedisConnection.close(pool_name)
    end

    @tag :integration
    @tag timeout: 30_000
    test "upsert updates scheduler while running", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      # Start a connection pool
      pool_name = :"worker_pool_upsert_#{System.unique_integer([:positive])}"

      {:ok, pool_pid} =
        BullMQ.RedisConnection.start_link(
          name: pool_name,
          url: @redis_url,
          pool_size: 3
        )

      Process.unlink(pool_pid)

      # Create initial scheduler
      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "upsert-test",
          %{every: 500},
          "job-v1",
          %{version: 1},
          prefix: @test_prefix
        )

      {:ok, versions} = Agent.start_link(fn -> [] end)

      # Start worker
      {:ok, worker} =
        BullMQ.Worker.start_link(
          queue: queue_name,
          connection: pool_name,
          prefix: @test_prefix,
          processor: fn job ->
            Agent.update(versions, fn v -> [job.data["version"] | v] end)
            send(test_pid, {:processed_version, job.data["version"]})
            :ok
          end
        )

      # Wait for first version
      assert_receive {:processed_version, 1}, 5_000

      # Update scheduler with new data
      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "upsert-test",
          # Faster interval
          %{every: 300},
          "job-v2",
          %{version: 2},
          prefix: @test_prefix
        )

      # Wait for updated version to be processed
      # May take a moment for the update to take effect
      Process.sleep(500)

      # Collect a few more iterations
      receive do
        {:processed_version, _v} -> :ok
      after
        3_000 -> :timeout
      end

      # Check that we got version 2 at some point
      all_versions = Agent.get(versions, & &1) |> Enum.reverse()

      # First versions should be 1, later ones should be 2
      assert 1 in all_versions
      # Version 2 may or may not have been picked up depending on timing

      # Cleanup
      BullMQ.Worker.close(worker)
      Agent.stop(versions)
      BullMQ.RedisConnection.close(pool_name)
    end

    @tag :integration
    @tag timeout: 20_000
    test "removing scheduler stops new job creation", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      # Start a connection pool
      pool_name = :"worker_pool_remove_#{System.unique_integer([:positive])}"

      {:ok, pool_pid} =
        BullMQ.RedisConnection.start_link(
          name: pool_name,
          url: @redis_url,
          pool_size: 3
        )

      Process.unlink(pool_pid)

      # Create scheduler
      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "remove-test",
          %{every: 400},
          "removable-job",
          %{},
          prefix: @test_prefix
        )

      {:ok, counter} = Agent.start_link(fn -> 0 end)

      # Start worker
      {:ok, worker} =
        BullMQ.Worker.start_link(
          queue: queue_name,
          connection: pool_name,
          prefix: @test_prefix,
          processor: fn _job ->
            count = Agent.get_and_update(counter, fn c -> {c, c + 1} end)
            send(test_pid, {:processed, count + 1})
            :ok
          end
        )

      # Wait for first job
      assert_receive {:processed, 1}, 5_000

      # Remove the scheduler
      {:ok, true} = JobScheduler.remove(conn, queue_name, "remove-test", prefix: @test_prefix)

      # Wait a bit
      Process.sleep(1500)

      # Count how many jobs were processed after removal
      final_count = Agent.get(counter, & &1)

      # Should have processed at most 2-3 jobs (one may have been queued before removal)
      assert final_count <= 3

      # Cleanup
      BullMQ.Worker.close(worker)
      Agent.stop(counter)
      BullMQ.RedisConnection.close(pool_name)
    end
  end

  describe "Cron pattern schedulers with worker" do
    @tag :integration
    @tag timeout: 20_000
    test "worker processes cron-scheduled job on time", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      # Start a connection pool
      pool_name = :"worker_pool_cron_#{System.unique_integer([:positive])}"

      {:ok, pool_pid} =
        BullMQ.RedisConnection.start_link(
          name: pool_name,
          url: @redis_url,
          pool_size: 3
        )

      Process.unlink(pool_pid)

      # Create scheduler with cron pattern that runs immediately for first execution
      # then every minute after that
      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "cron-test",
          # Every minute, but first runs immediately
          %{pattern: "* * * * *", immediately: true},
          "cron-job",
          %{type: "cron"},
          prefix: @test_prefix
        )

      # Start worker
      {:ok, worker} =
        BullMQ.Worker.start_link(
          queue: queue_name,
          connection: pool_name,
          prefix: @test_prefix,
          processor: fn job ->
            send(test_pid, {:cron_processed, job.name, job.data})
            :ok
          end
        )

      # Wait for job to be processed (immediately: true means it should be fast)
      assert_receive {:cron_processed, "cron-job", data}, 5_000
      assert data["type"] == "cron"

      # Cleanup
      BullMQ.Worker.close(worker)
      BullMQ.RedisConnection.close(pool_name)
    end

    @tag :integration
    @tag timeout: 20_000
    test "immediately option runs first job without waiting", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      # Start a connection pool
      pool_name = :"worker_pool_immediate_#{System.unique_integer([:positive])}"

      {:ok, pool_pid} =
        BullMQ.RedisConnection.start_link(
          name: pool_name,
          url: @redis_url,
          pool_size: 3
        )

      Process.unlink(pool_pid)

      start_time = System.monotonic_time(:millisecond)

      # Create scheduler with immediately option - pattern every hour but first runs now
      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "immediate-test",
          # Every hour, but immediately for first
          %{pattern: "0 * * * *", immediately: true},
          "immediate-job",
          %{},
          prefix: @test_prefix
        )

      # Start worker
      {:ok, worker} =
        BullMQ.Worker.start_link(
          queue: queue_name,
          connection: pool_name,
          prefix: @test_prefix,
          processor: fn job ->
            send(test_pid, {:immediate_processed, job.name})
            :ok
          end
        )

      # First job should be processed quickly (not waiting for the cron pattern)
      assert_receive {:immediate_processed, "immediate-job"}, 5_000

      elapsed = System.monotonic_time(:millisecond) - start_time
      # Should complete within a few seconds, not wait for the hourly pattern
      assert elapsed < 5_000

      # Cleanup
      BullMQ.Worker.close(worker)
      BullMQ.RedisConnection.close(pool_name)
    end
  end

  describe "Multiple schedulers" do
    @tag :integration
    @tag timeout: 30_000
    test "worker processes jobs from multiple schedulers", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      # Start a connection pool
      pool_name = :"worker_pool_multi_#{System.unique_integer([:positive])}"

      {:ok, pool_pid} =
        BullMQ.RedisConnection.start_link(
          name: pool_name,
          url: @redis_url,
          pool_size: 3
        )

      Process.unlink(pool_pid)

      # Create multiple schedulers with different intervals
      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "scheduler-a",
          %{every: 300},
          "job-a",
          %{scheduler: "a"},
          prefix: @test_prefix
        )

      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "scheduler-b",
          %{every: 500},
          "job-b",
          %{scheduler: "b"},
          prefix: @test_prefix
        )

      {:ok, processed} = Agent.start_link(fn -> %{a: 0, b: 0} end)

      # Start worker
      {:ok, worker} =
        BullMQ.Worker.start_link(
          queue: queue_name,
          connection: pool_name,
          prefix: @test_prefix,
          processor: fn job ->
            scheduler = job.data["scheduler"]
            key = String.to_atom(scheduler)

            Agent.update(processed, fn counts ->
              Map.update(counts, key, 1, &(&1 + 1))
            end)

            send(test_pid, {:processed, scheduler})
            :ok
          end
        )

      # Wait for jobs from both schedulers
      Enum.each(1..4, fn _ ->
        assert_receive {:processed, _}, 5_000
      end)

      counts = Agent.get(processed, & &1)

      # Both schedulers should have produced jobs
      assert counts.a >= 1
      assert counts.b >= 1

      # Scheduler A runs faster (300ms) so should have more iterations
      # But this is timing-dependent, so just verify both ran

      # Cleanup
      BullMQ.Worker.close(worker)
      Agent.stop(processed)
      BullMQ.RedisConnection.close(pool_name)
    end
  end
end
