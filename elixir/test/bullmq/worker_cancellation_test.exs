defmodule BullMQ.WorkerCancellationTest do
  @moduledoc """
  Integration tests for job cancellation functionality.
  """
  use ExUnit.Case, async: false

  @moduletag :integration

  alias BullMQ.{Queue, Worker, CancellationToken}

  @redis_url BullMQ.TestHelper.redis_url()
  @test_prefix BullMQ.TestHelper.test_prefix() <> "_cancel"

  setup do
    pool_name = :"cancel_pool_#{System.unique_integer([:positive])}"
    queue_name = "test-cancellation-#{System.unique_integer([:positive])}"

    # Start the connection pool - unlink so test cleanup doesn't cascade
    {:ok, pool_pid} =
      BullMQ.RedisConnection.start_link(
        name: pool_name,
        url: @redis_url,
        pool_size: 5
      )

    Process.unlink(pool_pid)

    on_exit(fn ->
      # Stop the pool first
      try do
        Supervisor.stop(pool_pid, :normal, 1000)
      catch
        :exit, _ -> :ok
      end

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

  describe "cancel_job/3" do
    @tag timeout: 10_000
    test "cancels a running job", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      # Processor that waits for cancellation
      processor = fn job, cancel_token ->
        send(test_pid, {:job_started, job.id})

        # Wait for cancellation or timeout
        receive do
          {:cancel, ^cancel_token, reason} ->
            send(test_pid, {:job_cancelled, job.id, reason})
            {:error, {:cancelled, reason}}
        after
          5000 -> {:ok, :completed}
        end
      end

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: processor,
          concurrency: 1
        )

      # Add a job
      {:ok, job} =
        Queue.add(queue_name, "test-job", %{value: 1}, connection: conn, prefix: @test_prefix)

      # Wait for job to start
      assert_receive {:job_started, job_id}, 2000
      assert job_id == job.id

      # Cancel the job
      assert :ok = Worker.cancel_job(worker, job.id, "user requested")

      # Verify job received cancellation
      assert_receive {:job_cancelled, ^job_id, "user requested"}, 1000

      Worker.close(worker)
    end

    @tag timeout: 10_000
    test "returns error for non-existent job", %{conn: conn, queue_name: queue_name} do
      processor = fn job, _token -> {:ok, job.data} end

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: processor
        )

      assert {:error, :not_found} = Worker.cancel_job(worker, "non-existent-job", "test")

      Worker.close(worker)
    end
  end

  describe "cancel_all_jobs/2" do
    @tag timeout: 15_000
    test "cancels all running jobs", %{conn: conn, queue_name: queue_name} do
      test_pid = self()
      cancelled_jobs = :ets.new(:cancelled_jobs, [:set, :public])

      # Processor that waits for cancellation
      processor = fn job, cancel_token ->
        send(test_pid, {:job_started, job.id})

        receive do
          {:cancel, ^cancel_token, reason} ->
            :ets.insert(cancelled_jobs, {job.id, reason})
            {:error, {:cancelled, reason}}
        after
          5000 -> {:ok, :completed}
        end
      end

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: processor,
          concurrency: 5
        )

      # Add multiple jobs - format is {name, data, opts}
      jobs = for i <- 1..5, do: {"test-job-#{i}", %{value: i}, []}
      {:ok, added_jobs} = Queue.add_bulk(queue_name, jobs, connection: conn, prefix: @test_prefix)
      job_ids = Enum.map(added_jobs, & &1.id)

      # Wait for all jobs to start
      for _ <- 1..5 do
        assert_receive {:job_started, _}, 2000
      end

      # Cancel all jobs
      assert :ok = Worker.cancel_all_jobs(worker, "shutdown")

      # Wait a bit for cancellations to process
      Process.sleep(200)

      # Verify all jobs were cancelled
      cancelled = :ets.tab2list(cancelled_jobs)
      assert length(cancelled) == 5

      for {job_id, reason} <- cancelled do
        assert job_id in job_ids
        assert reason == "shutdown"
      end

      :ets.delete(cancelled_jobs)
      Worker.close(worker)
    end
  end

  describe "processor with cancellation token" do
    @tag timeout: 10_000
    test "processor receives cancellation token as second argument", %{
      conn: conn,
      queue_name: queue_name
    } do
      test_pid = self()

      processor = fn job, cancel_token ->
        send(test_pid, {:processor_called, job.id, is_reference(cancel_token)})
        {:ok, :done}
      end

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: processor
        )

      {:ok, job} = Queue.add(queue_name, "test-job", %{}, connection: conn, prefix: @test_prefix)

      assert_receive {:processor_called, job_id, true}, 2000
      assert job_id == job.id

      Worker.close(worker)
    end

    @tag timeout: 10_000
    test "processor with arity 1 still works (backward compatible)", %{
      conn: conn,
      queue_name: queue_name
    } do
      test_pid = self()

      # Old-style processor without cancellation support
      processor = fn job ->
        send(test_pid, {:job_processed, job.id})
        {:ok, job.data}
      end

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: processor
        )

      {:ok, job} =
        Queue.add(queue_name, "test-job", %{value: 42}, connection: conn, prefix: @test_prefix)

      assert_receive {:job_processed, job_id}, 2000
      assert job_id == job.id

      Worker.close(worker)
    end
  end

  describe "CancellationToken.check/1 pattern" do
    @tag timeout: 10_000
    test "processor can use check/1 for checkpoint-style cancellation", %{
      conn: conn,
      queue_name: queue_name
    } do
      test_pid = self()

      processor = fn job, cancel_token ->
        # Simulate multi-step processing with cancellation checks
        steps = job.data["steps"] || 3

        result =
          Enum.reduce_while(1..steps, {:ok, []}, fn step, {:ok, acc} ->
            case CancellationToken.check(cancel_token) do
              {:cancelled, reason} ->
                {:halt, {:error, {:cancelled, reason, step}}}

              :ok ->
                send(test_pid, {:step_completed, job.id, step})
                # Simulate work
                Process.sleep(50)
                {:cont, {:ok, [step | acc]}}
            end
          end)

        case result do
          {:ok, steps} -> {:ok, Enum.reverse(steps)}
          {:error, _} = err -> err
        end
      end

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: processor
        )

      {:ok, job} =
        Queue.add(queue_name, "test-job", %{"steps" => 5}, connection: conn, prefix: @test_prefix)

      # Wait for a couple steps then cancel
      assert_receive {:step_completed, job_id, 1}, 1000
      assert_receive {:step_completed, ^job_id, 2}, 1000

      # Cancel
      Worker.cancel_job(worker, job.id, "cancelled mid-processing")

      # Should not receive all 5 steps
      Process.sleep(300)

      Worker.close(worker)
    end
  end

  describe "receive after 0 pattern" do
    @tag timeout: 10_000
    test "processor can use receive after 0 for non-blocking cancellation checks", %{
      conn: conn,
      queue_name: queue_name
    } do
      test_pid = self()

      processor = fn job, cancel_token ->
        items = job.data["items"] || [1, 2, 3, 4, 5]

        result =
          Enum.reduce_while(items, {:ok, []}, fn item, {:ok, acc} ->
            receive do
              {:cancel, ^cancel_token, reason} ->
                send(test_pid, {:cancelled_at_item, item, reason})
                {:halt, {:error, {:cancelled, reason}}}
            after
              0 ->
                send(test_pid, {:processed_item, job.id, item})
                Process.sleep(30)
                {:cont, {:ok, [item * 2 | acc]}}
            end
          end)

        case result do
          {:ok, values} -> {:ok, Enum.reverse(values)}
          {:error, _} = err -> err
        end
      end

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: processor
        )

      {:ok, job} =
        Queue.add(queue_name, "test-job", %{"items" => [1, 2, 3, 4, 5]},
          connection: conn,
          prefix: @test_prefix
        )

      # Wait for first item
      assert_receive {:processed_item, _job_id, 1}, 1000

      # Cancel
      Worker.cancel_job(worker, job.id, "stop processing")

      # Wait for processing to complete
      Process.sleep(300)

      Worker.close(worker)
    end
  end

  describe "task wrapper pattern" do
    @tag timeout: 10_000
    test "processor can wrap blocking operations with cancellation", %{
      conn: conn,
      queue_name: queue_name
    } do
      test_pid = self()

      processor = fn job, cancel_token ->
        # Start a long-running task
        task =
          Task.async(fn ->
            Process.sleep(500)
            {:ok, "task completed"}
          end)

        task_ref = task.ref

        # Wait for either completion or cancellation
        receive do
          {:cancel, ^cancel_token, reason} ->
            send(test_pid, {:task_cancelled, job.id, reason})
            Task.shutdown(task, :brutal_kill)
            {:error, {:cancelled, reason}}

          {^task_ref, result} ->
            # Task.async sends {ref, result}
            Process.demonitor(task_ref, [:flush])
            send(test_pid, {:task_completed, job.id})
            result
        end
      end

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: processor
        )

      {:ok, job} = Queue.add(queue_name, "test-job", %{}, connection: conn, prefix: @test_prefix)

      # Wait a bit then cancel before task completes
      Process.sleep(100)
      Worker.cancel_job(worker, job.id, "timeout")

      assert_receive {:task_cancelled, job_id, "timeout"}, 1000
      assert job_id == job.id

      Worker.close(worker)
    end

    @tag timeout: 10_000
    test "task completes before cancellation", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      processor = fn job, cancel_token ->
        # Start a quick task
        task =
          Task.async(fn ->
            Process.sleep(50)
            {:ok, "done"}
          end)

        task_ref = task.ref

        receive do
          {:cancel, ^cancel_token, reason} ->
            Task.shutdown(task, :brutal_kill)
            {:error, {:cancelled, reason}}

          {^task_ref, result} ->
            # Task.async sends {ref, result}, so we need to demonitor
            Process.demonitor(task_ref, [:flush])
            send(test_pid, {:completed, job.id})
            result
        end
      end

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: processor
        )

      {:ok, job} = Queue.add(queue_name, "test-job", %{}, connection: conn, prefix: @test_prefix)

      assert_receive {:completed, job_id}, 2000
      assert job_id == job.id

      Worker.close(worker)
    end
  end
end
