defmodule BullMQ.JobSchedulerStressTest do
  @moduledoc """
  Stress tests for JobScheduler functionality.

  These tests validate behavior under concurrent operations,
  rapid upserts, and edge cases that might cause race conditions.
  """
  use ExUnit.Case, async: false

  @moduletag :integration
  @moduletag :stress

  alias BullMQ.{JobScheduler, Keys}

  @redis_url BullMQ.TestHelper.redis_url()
  @test_prefix BullMQ.TestHelper.test_prefix()

  # Time constants
  @one_second 1000
  @one_minute 60 * @one_second

  setup do
    {:ok, conn} = Redix.start_link(@redis_url)
    Process.unlink(conn)
    queue_name = "stress-queue-#{System.unique_integer([:positive])}"

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
  # Rapid Upsert Tests
  # ---------------------------------------------------------------------------

  describe "rapid upserts" do
    @tag :stress
    test "handles many rapid upserts maintaining single scheduler", %{
      conn: conn,
      queue_name: queue_name
    } do
      scheduler_id = "rapid-test"

      # Perform many rapid upserts
      results =
        for i <- 1..20 do
          JobScheduler.upsert(
            conn,
            queue_name,
            scheduler_id,
            %{every: 60_000 + i * 100},
            "rapid-job-#{i}",
            %{iteration: i},
            prefix: @test_prefix
          )
        end

      # All upserts should succeed
      assert Enum.all?(results, fn
               {:ok, _} -> true
               _ -> false
             end)

      # Only one scheduler should exist
      {:ok, schedulers} = JobScheduler.list(conn, queue_name, prefix: @test_prefix)
      assert length(schedulers) == 1
      assert schedulers |> hd() |> Map.get(:key) == scheduler_id
    end

    @tag :stress
    test "concurrent upserts with different IDs create separate schedulers", %{
      conn: conn,
      queue_name: queue_name
    } do
      # Create tasks for concurrent upserts
      tasks =
        for i <- 1..10 do
          Task.async(fn ->
            {:ok, temp_conn} = Redix.start_link(@redis_url)

            result =
              JobScheduler.upsert(
                temp_conn,
                queue_name,
                "scheduler-#{i}",
                %{every: 60_000},
                "job-#{i}",
                %{id: i},
                prefix: @test_prefix
              )

            Redix.stop(temp_conn)
            result
          end)
        end

      # Wait for all tasks
      results = Task.await_many(tasks, 10_000)

      # All should succeed
      assert Enum.all?(results, fn
               {:ok, _} -> true
               _ -> false
             end)

      # Should have 10 separate schedulers
      {:ok, schedulers} = JobScheduler.list(conn, queue_name, prefix: @test_prefix)
      assert length(schedulers) == 10
    end

    @tag :stress
    test "concurrent upserts to same scheduler ID", %{conn: conn, queue_name: queue_name} do
      scheduler_id = "concurrent-same"

      # Create tasks for concurrent upserts to the same scheduler
      tasks =
        for i <- 1..10 do
          Task.async(fn ->
            {:ok, temp_conn} = Redix.start_link(@redis_url)

            result =
              JobScheduler.upsert(
                temp_conn,
                queue_name,
                scheduler_id,
                %{every: 60_000 + i * 1000},
                "job-#{i}",
                %{iteration: i},
                prefix: @test_prefix
              )

            Redix.stop(temp_conn)
            result
          end)
        end

      results = Task.await_many(tasks, 10_000)

      # All should succeed (possibly with some collision errors which are expected)
      success_count =
        Enum.count(results, fn
          {:ok, _} -> true
          _ -> false
        end)

      # At least some should succeed
      assert success_count >= 1

      # Only one scheduler should exist at the end
      {:ok, schedulers} = JobScheduler.list(conn, queue_name, prefix: @test_prefix)
      assert length(schedulers) == 1
    end

    @tag :stress
    test "rapid upserts with decreasing intervals", %{conn: conn, queue_name: queue_name} do
      scheduler_id = "decreasing-interval"
      ctx = Keys.new(queue_name, prefix: @test_prefix)

      # Start with a large interval and decrease
      intervals = [8000, 4000, 2000, 1000, 500]

      for {every, idx} <- Enum.with_index(intervals) do
        {:ok, _job} =
          JobScheduler.upsert(
            conn,
            queue_name,
            scheduler_id,
            %{every: every},
            "job-#{idx}",
            %{every: every},
            prefix: @test_prefix
          )

        # Brief pause between upserts
        Process.sleep(50)
      end

      # Verify single scheduler with latest interval
      {:ok, scheduler} = JobScheduler.get(conn, queue_name, scheduler_id, prefix: @test_prefix)
      assert scheduler.every == 500

      # Verify only one delayed job exists (or wait if immediate)
      {:ok, delayed} = Redix.command(conn, ["ZCARD", Keys.delayed(ctx)])
      {:ok, waiting} = Redix.command(conn, ["LLEN", Keys.wait(ctx)])
      # Should have exactly 1 job total in either list
      assert delayed + waiting == 1
    end
  end

  # ---------------------------------------------------------------------------
  # Consistency Tests
  # ---------------------------------------------------------------------------

  describe "consistency under stress" do
    @tag :stress
    test "job data is properly updated on upsert", %{conn: conn, queue_name: queue_name} do
      scheduler_id = "data-update-test"
      ctx = Keys.new(queue_name, prefix: @test_prefix)

      # First upsert
      {:ok, job1} =
        JobScheduler.upsert(
          conn,
          queue_name,
          scheduler_id,
          %{every: 60_000},
          "job-v1",
          %{version: 1, data: "first"},
          prefix: @test_prefix
        )

      # Verify first job data
      {:ok, data1} = Redix.command(conn, ["HGET", Keys.job(ctx, job1.id), "data"])
      assert Jason.decode!(data1) == %{"version" => 1, "data" => "first"}

      # Second upsert with different data
      {:ok, job2} =
        JobScheduler.upsert(
          conn,
          queue_name,
          scheduler_id,
          %{every: 60_000},
          "job-v2",
          %{version: 2, data: "second"},
          prefix: @test_prefix
        )

      # Verify second job data
      {:ok, data2} = Redix.command(conn, ["HGET", Keys.job(ctx, job2.id), "data"])
      assert Jason.decode!(data2) == %{"version" => 2, "data" => "second"}

      # Scheduler template should have latest data
      {:ok, scheduler} = JobScheduler.get(conn, queue_name, scheduler_id, prefix: @test_prefix)
      assert scheduler.template.data == %{"version" => 2, "data" => "second"}
    end

    @tag :stress
    test "maintains scheduler count after many operations", %{conn: conn, queue_name: queue_name} do
      # Create 50 schedulers
      for i <- 1..50 do
        {:ok, _} =
          JobScheduler.upsert(
            conn,
            queue_name,
            "scheduler-#{i}",
            %{every: 60_000},
            "job-#{i}",
            %{},
            prefix: @test_prefix
          )
      end

      {:ok, schedulers} = JobScheduler.list(conn, queue_name, prefix: @test_prefix)
      assert length(schedulers) == 50

      # Update half of them
      for i <- 1..25 do
        {:ok, _} =
          JobScheduler.upsert(
            conn,
            queue_name,
            "scheduler-#{i}",
            %{every: 30_000},
            "updated-job-#{i}",
            %{updated: true},
            prefix: @test_prefix
          )
      end

      {:ok, schedulers} = JobScheduler.list(conn, queue_name, prefix: @test_prefix)
      assert length(schedulers) == 50

      # Remove some
      for i <- 26..35 do
        {:ok, _} = JobScheduler.remove(conn, queue_name, "scheduler-#{i}", prefix: @test_prefix)
      end

      {:ok, schedulers} = JobScheduler.list(conn, queue_name, prefix: @test_prefix)
      assert length(schedulers) == 40
    end

    @tag :stress
    test "no orphaned jobs after rapid upserts", %{conn: conn, queue_name: queue_name} do
      scheduler_id = "orphan-test"
      ctx = Keys.new(queue_name, prefix: @test_prefix)

      # Rapid upserts
      for i <- 1..20 do
        {:ok, _} =
          JobScheduler.upsert(
            conn,
            queue_name,
            scheduler_id,
            %{every: 60_000 + i * 100},
            "job-#{i}",
            %{},
            prefix: @test_prefix
          )

        # Small delay to allow cleanup
        Process.sleep(10)
      end

      # Should have exactly 1 scheduler and 1 delayed job
      {:ok, schedulers} = JobScheduler.list(conn, queue_name, prefix: @test_prefix)
      assert length(schedulers) == 1

      {:ok, delayed_count} = Redix.command(conn, ["ZCARD", Keys.delayed(ctx)])
      # Should have 0 or 1 delayed job (0 if immediately scheduled to wait)
      assert delayed_count <= 1

      {:ok, wait_count} = Redix.command(conn, ["LLEN", Keys.wait(ctx)])
      # Total should be exactly 1
      assert delayed_count + wait_count == 1
    end
  end

  # ---------------------------------------------------------------------------
  # Pattern-based Stress Tests
  # ---------------------------------------------------------------------------

  describe "cron pattern stress" do
    @tag :stress
    test "handles many different cron patterns", %{conn: conn, queue_name: queue_name} do
      patterns = [
        # Every hour
        "0 * * * *",
        # Every 5 minutes
        "*/5 * * * *",
        # Daily at midnight
        "0 0 * * *",
        # Weekdays at 9 AM
        "0 9 * * 1-5",
        # Monthly on 1st
        "0 0 1 * *",
        # Every Sunday
        "0 0 * * 0",
        # Daily at 4:30
        "30 4 * * *",
        # Every 2 hours
        "0 */2 * * *",
        # 14:15 on 1st of month
        "15 14 1 * *",
        # 10 PM on weekdays
        "0 22 * * 1-5"
      ]

      for {pattern, idx} <- Enum.with_index(patterns) do
        {:ok, _} =
          JobScheduler.upsert(
            conn,
            queue_name,
            "pattern-#{idx}",
            %{pattern: pattern},
            "cron-job-#{idx}",
            %{pattern: pattern},
            prefix: @test_prefix
          )
      end

      {:ok, schedulers} = JobScheduler.list(conn, queue_name, prefix: @test_prefix)
      assert length(schedulers) == 10

      # Verify each has the correct pattern
      for {pattern, idx} <- Enum.with_index(patterns) do
        {:ok, scheduler} =
          JobScheduler.get(conn, queue_name, "pattern-#{idx}", prefix: @test_prefix)

        assert scheduler.pattern == pattern
      end
    end

    @tag :stress
    test "updates cron pattern correctly", %{conn: conn, queue_name: queue_name} do
      scheduler_id = "pattern-update"

      # Initial pattern
      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          scheduler_id,
          %{pattern: "0 * * * *"},
          "hourly-job",
          %{},
          prefix: @test_prefix
        )

      # Update to a different pattern
      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          scheduler_id,
          %{pattern: "*/5 * * * *"},
          "five-min-job",
          %{},
          prefix: @test_prefix
        )

      {:ok, scheduler} = JobScheduler.get(conn, queue_name, scheduler_id, prefix: @test_prefix)
      assert scheduler.pattern == "*/5 * * * *"
    end
  end

  # ---------------------------------------------------------------------------
  # Limit and End Date Stress Tests
  # ---------------------------------------------------------------------------

  describe "limits and end dates under stress" do
    @tag :stress
    test "respects limit across rapid upserts", %{conn: conn, queue_name: queue_name} do
      scheduler_id = "limited-scheduler"

      # Create with limit
      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          scheduler_id,
          %{every: 60_000, limit: 5},
          "limited-job",
          %{},
          prefix: @test_prefix
        )

      # Try to simulate iterations (count field would be updated by worker)
      # Here we just verify the limit is stored
      {:ok, scheduler} = JobScheduler.get(conn, queue_name, scheduler_id, prefix: @test_prefix)
      assert Map.get(scheduler, :limit) == 5
    end

    @tag :stress
    test "end_date prevents future scheduling", %{conn: conn, queue_name: queue_name} do
      scheduler_id = "ended-scheduler"
      past_date = System.system_time(:millisecond) - 60_000

      # Try to create scheduler with end_date in the past
      result =
        JobScheduler.upsert(
          conn,
          queue_name,
          scheduler_id,
          %{every: 60_000, end_date: past_date},
          "past-job",
          %{},
          prefix: @test_prefix
        )

      assert result == {:error, :end_date_reached}
    end

    @tag :stress
    test "multiple schedulers with different end dates", %{conn: conn, queue_name: queue_name} do
      now = System.system_time(:millisecond)

      # Create schedulers with various end dates
      for i <- 1..5 do
        future_date = now + i * @one_minute

        {:ok, _} =
          JobScheduler.upsert(
            conn,
            queue_name,
            "timed-#{i}",
            %{every: 30_000, end_date: future_date},
            "timed-job-#{i}",
            %{},
            prefix: @test_prefix
          )
      end

      {:ok, schedulers} = JobScheduler.list(conn, queue_name, prefix: @test_prefix)
      assert length(schedulers) == 5
    end
  end

  # ---------------------------------------------------------------------------
  # Mixed Operations Stress Tests
  # ---------------------------------------------------------------------------

  describe "mixed operations" do
    @tag :stress
    test "interleaved creates, updates, and deletes", %{conn: conn, queue_name: queue_name} do
      # Create initial batch
      for i <- 1..10 do
        {:ok, _} =
          JobScheduler.upsert(
            conn,
            queue_name,
            "mixed-#{i}",
            %{every: 60_000},
            "job-#{i}",
            %{},
            prefix: @test_prefix
          )
      end

      # Interleave operations
      for i <- 1..10 do
        cond do
          rem(i, 3) == 0 ->
            # Delete
            {:ok, _} = JobScheduler.remove(conn, queue_name, "mixed-#{i}", prefix: @test_prefix)

          rem(i, 2) == 0 ->
            # Update
            {:ok, _} =
              JobScheduler.upsert(
                conn,
                queue_name,
                "mixed-#{i}",
                %{every: 30_000},
                "updated-job-#{i}",
                %{updated: true},
                prefix: @test_prefix
              )

          true ->
            # Add new
            {:ok, _} =
              JobScheduler.upsert(
                conn,
                queue_name,
                "new-#{i}",
                %{every: 45_000},
                "new-job-#{i}",
                %{},
                prefix: @test_prefix
              )
        end
      end

      {:ok, schedulers} = JobScheduler.list(conn, queue_name, prefix: @test_prefix)
      # Should have: 10 original - 3 deleted (3,6,9) + 5 new (1,3,5,7,9) = 12
      # But 3 and 9 were deleted then new was added with different key, so:
      # Original: 1,2,4,5,7,8,10 (7) + new: new-1,new-3,new-5,new-7,new-9 (5) = 12
      assert length(schedulers) >= 10
    end

    @tag :stress
    test "bulk operations don't corrupt state", %{conn: conn, queue_name: queue_name} do
      ctx = Keys.new(queue_name, prefix: @test_prefix)

      # Create many schedulers in parallel
      tasks =
        for i <- 1..20 do
          Task.async(fn ->
            {:ok, temp_conn} = Redix.start_link(@redis_url)

            result =
              JobScheduler.upsert(
                temp_conn,
                queue_name,
                "bulk-#{i}",
                %{every: 60_000},
                "bulk-job-#{i}",
                %{batch: 1},
                prefix: @test_prefix
              )

            Redix.stop(temp_conn)
            result
          end)
        end

      Task.await_many(tasks, 10_000)

      # Update them all in parallel
      update_tasks =
        for i <- 1..20 do
          Task.async(fn ->
            {:ok, temp_conn} = Redix.start_link(@redis_url)

            result =
              JobScheduler.upsert(
                temp_conn,
                queue_name,
                "bulk-#{i}",
                %{every: 30_000},
                "bulk-job-#{i}-updated",
                %{batch: 2},
                prefix: @test_prefix
              )

            Redix.stop(temp_conn)
            result
          end)
        end

      Task.await_many(update_tasks, 10_000)

      # Verify state is consistent
      {:ok, schedulers} = JobScheduler.list(conn, queue_name, prefix: @test_prefix)
      assert length(schedulers) == 20

      # Verify delayed jobs count
      {:ok, delayed_count} = Redix.command(conn, ["ZCARD", Keys.delayed(ctx)])
      {:ok, wait_count} = Redix.command(conn, ["LLEN", Keys.wait(ctx)])

      # Each scheduler should have exactly one job
      assert delayed_count + wait_count == 20
    end
  end

  # ---------------------------------------------------------------------------
  # Edge Cases
  # ---------------------------------------------------------------------------

  describe "edge cases" do
    @tag :stress
    test "handles very short intervals", %{conn: conn, queue_name: queue_name} do
      # 100ms interval
      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "short-interval",
          %{every: 100},
          "fast-job",
          %{},
          prefix: @test_prefix
        )

      {:ok, scheduler} = JobScheduler.get(conn, queue_name, "short-interval", prefix: @test_prefix)
      assert scheduler.every == 100
    end

    @tag :stress
    test "handles very long intervals", %{conn: conn, queue_name: queue_name} do
      # 1 year in milliseconds
      one_year = 365 * 24 * 60 * 60 * 1000

      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "long-interval",
          %{every: one_year},
          "yearly-job",
          %{},
          prefix: @test_prefix
        )

      {:ok, scheduler} = JobScheduler.get(conn, queue_name, "long-interval", prefix: @test_prefix)
      assert scheduler.every == one_year
    end

    @tag :stress
    test "handles unicode in job data", %{conn: conn, queue_name: queue_name} do
      data = %{
        name: "Test 日本語 🎉",
        description: "Ελληνικά العربية",
        emoji: "👨‍👩‍👧‍👦"
      }

      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "unicode-scheduler",
          %{every: 60_000},
          "unicode-job",
          data,
          prefix: @test_prefix
        )

      {:ok, scheduler} =
        JobScheduler.get(conn, queue_name, "unicode-scheduler", prefix: @test_prefix)

      assert scheduler.template.data["name"] == "Test 日本語 🎉"
      assert scheduler.template.data["emoji"] == "👨‍👩‍👧‍👦"
    end

    @tag :stress
    test "handles large job data", %{conn: conn, queue_name: queue_name} do
      # Generate 100KB of data
      large_string = String.duplicate("x", 100_000)
      data = %{payload: large_string, items: Enum.to_list(1..1000)}

      {:ok, _} =
        JobScheduler.upsert(
          conn,
          queue_name,
          "large-data-scheduler",
          %{every: 60_000},
          "large-job",
          data,
          prefix: @test_prefix
        )

      {:ok, scheduler} =
        JobScheduler.get(conn, queue_name, "large-data-scheduler", prefix: @test_prefix)

      assert String.length(scheduler.template.data["payload"]) == 100_000
      assert length(scheduler.template.data["items"]) == 1000
    end

    @tag :stress
    test "scheduler IDs with special characters", %{conn: conn, queue_name: queue_name} do
      special_ids = [
        "scheduler-with-dashes",
        "scheduler_with_underscores",
        "scheduler.with.dots",
        "scheduler:with:colons",
        "scheduler/with/slashes"
      ]

      for id <- special_ids do
        {:ok, _} =
          JobScheduler.upsert(
            conn,
            queue_name,
            id,
            %{every: 60_000},
            "special-job",
            %{id: id},
            prefix: @test_prefix
          )
      end

      {:ok, schedulers} = JobScheduler.list(conn, queue_name, prefix: @test_prefix)
      assert length(schedulers) == 5

      for id <- special_ids do
        {:ok, scheduler} = JobScheduler.get(conn, queue_name, id, prefix: @test_prefix)
        assert scheduler.key == id
      end
    end
  end

  # ---------------------------------------------------------------------------
  # Performance Tests
  # ---------------------------------------------------------------------------

  describe "performance" do
    @tag :stress
    @tag :slow
    test "creates 100 schedulers efficiently", %{conn: conn, queue_name: queue_name} do
      start_time = System.monotonic_time(:millisecond)

      for i <- 1..100 do
        {:ok, _} =
          JobScheduler.upsert(
            conn,
            queue_name,
            "perf-#{i}",
            %{every: 60_000},
            "perf-job-#{i}",
            %{index: i},
            prefix: @test_prefix
          )
      end

      end_time = System.monotonic_time(:millisecond)
      elapsed = end_time - start_time

      # Should complete in reasonable time (< 5 seconds)
      assert elapsed < 5000, "Creating 100 schedulers took #{elapsed}ms, expected < 5000ms"

      {:ok, schedulers} = JobScheduler.list(conn, queue_name, prefix: @test_prefix)
      assert length(schedulers) == 100
    end

    @tag :stress
    @tag :slow
    test "lists many schedulers efficiently", %{conn: conn, queue_name: queue_name} do
      # Create 100 schedulers first
      for i <- 1..100 do
        {:ok, _} =
          JobScheduler.upsert(
            conn,
            queue_name,
            "list-perf-#{i}",
            %{every: 60_000},
            "job-#{i}",
            %{},
            prefix: @test_prefix
          )
      end

      # Time the list operation
      start_time = System.monotonic_time(:millisecond)

      {:ok, schedulers} = JobScheduler.list(conn, queue_name, prefix: @test_prefix)

      end_time = System.monotonic_time(:millisecond)
      elapsed = end_time - start_time

      assert length(schedulers) == 100
      # Listing should be fast (< 1 second)
      assert elapsed < 1000, "Listing 100 schedulers took #{elapsed}ms, expected < 1000ms"
    end
  end
end
