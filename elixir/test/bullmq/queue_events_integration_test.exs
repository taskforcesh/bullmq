defmodule BullMQ.QueueEventsIntegrationTest do
  @moduledoc """
  Integration tests for QueueEvents functionality with a real Redis instance.

  These tests verify that QueueEvents properly receives events from Redis streams
  when jobs are added, processed, completed, failed, etc.

  Pattern: Uses QueueEvents.subscribe/2 to receive events via message passing,
  enabling `assert_receive` for clean Promise-like waiting (similar to Node.js
  `queueEvents.on('completed', ...)` pattern).
  """
  use ExUnit.Case, async: false

  @moduletag :integration

  alias BullMQ.{Queue, Worker, QueueEvents}

  @redis_url BullMQ.TestHelper.redis_url()
  @test_prefix BullMQ.TestHelper.test_prefix()

  setup do
    pool_name = :"events_pool_#{System.unique_integer([:positive])}"

    {:ok, pool_pid} =
      BullMQ.RedisConnection.start_link(
        name: pool_name,
        url: @redis_url,
        pool_size: 5
      )

    Process.unlink(pool_pid)

    queue_name = "events-queue-#{System.unique_integer([:positive])}"

    on_exit(fn ->
      # Close the pool (waits for scripts to load)
      BullMQ.RedisConnection.close(pool_name)

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

    {:ok, conn: pool_name, queue_name: queue_name}
  end

  # ---------------------------------------------------------------------------
  # Waiting Events
  # ---------------------------------------------------------------------------

  describe "waiting events" do
    @tag :integration
    @tag timeout: 10_000
    test "emits waiting event when a job has been added", %{conn: conn, queue_name: queue_name} do
      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix
        )

      QueueEvents.subscribe(events)

      # Small delay to ensure QueueEvents is listening
      Process.sleep(100)

      {:ok, job} =
        Queue.add(queue_name, "test", %{foo: "bar"}, connection: conn, prefix: @test_prefix)

      # Should receive waiting event
      assert_receive {:bullmq_event, :waiting, event_data}, 5_000
      assert event_data["jobId"] == job.id

      QueueEvents.close(events)
    end

    @tag :integration
    @tag timeout: 10_000
    test "emits added event when a job has been added", %{conn: conn, queue_name: queue_name} do
      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix
        )

      QueueEvents.subscribe(events)

      Process.sleep(100)

      {:ok, job} =
        Queue.add(queue_name, "test-name", %{foo: "bar"}, connection: conn, prefix: @test_prefix)

      # Should receive added event
      assert_receive {:bullmq_event, :added, event_data}, 5_000
      assert event_data["jobId"] == job.id
      assert event_data["name"] == "test-name"

      QueueEvents.close(events)
    end
  end

  # ---------------------------------------------------------------------------
  # Active Events
  # ---------------------------------------------------------------------------

  describe "active events" do
    @tag :integration
    @tag timeout: 10_000
    test "emits active event when job becomes active", %{conn: conn, queue_name: queue_name} do
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
            Process.sleep(100)
            :ok
          end
        )

      Process.sleep(100)

      {:ok, job} = Queue.add(queue_name, "test", %{}, connection: conn, prefix: @test_prefix)

      # Should receive active event
      assert_receive {:bullmq_event, :active, event_data}, 5_000
      assert event_data["jobId"] == job.id
      assert event_data["prev"] == "waiting"

      Worker.close(worker)
      QueueEvents.close(events)
    end
  end

  # ---------------------------------------------------------------------------
  # Completed Events
  # ---------------------------------------------------------------------------

  describe "completed events" do
    @tag :integration
    @tag timeout: 10_000
    test "emits completed event when job completes", %{conn: conn, queue_name: queue_name} do
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
            {:ok, "done"}
          end
        )

      Process.sleep(100)

      {:ok, job} =
        Queue.add(queue_name, "test", %{foo: "bar"}, connection: conn, prefix: @test_prefix)

      # Should receive completed event
      assert_receive {:bullmq_event, :completed, event_data}, 5_000
      assert event_data["jobId"] == job.id
      assert event_data["returnvalue"] != nil

      Worker.close(worker)
      QueueEvents.close(events)
    end
  end

  # ---------------------------------------------------------------------------
  # Failed Events
  # ---------------------------------------------------------------------------

  describe "failed events" do
    @tag :integration
    @tag timeout: 10_000
    test "emits failed event when job fails", %{conn: conn, queue_name: queue_name} do
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
            raise "Job error"
          end
        )

      Process.sleep(100)

      {:ok, job} =
        Queue.add(queue_name, "test", %{}, connection: conn, prefix: @test_prefix, attempts: 1)

      # Should receive failed event
      assert_receive {:bullmq_event, :failed, event_data}, 5_000
      assert event_data["jobId"] == job.id
      assert event_data["failedReason"] =~ "Job error"

      Worker.close(worker)
      QueueEvents.close(events)
    end
  end

  # ---------------------------------------------------------------------------
  # Progress Events
  # ---------------------------------------------------------------------------

  describe "progress events" do
    @tag :integration
    @tag timeout: 10_000
    test "emits progress event when job updates progress", %{conn: conn, queue_name: queue_name} do
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
            Worker.update_progress(job, 50)
            Process.sleep(50)
            Worker.update_progress(job, 100)
            :ok
          end
        )

      Process.sleep(100)

      {:ok, job} = Queue.add(queue_name, "test", %{}, connection: conn, prefix: @test_prefix)

      # Should receive progress events
      assert_receive {:bullmq_event, :progress, event_data}, 5_000
      assert event_data["jobId"] == job.id
      assert event_data["data"] != nil

      Worker.close(worker)
      QueueEvents.close(events)
    end
  end

  # ---------------------------------------------------------------------------
  # Delayed Events
  # ---------------------------------------------------------------------------

  describe "delayed events" do
    @tag :integration
    @tag timeout: 10_000
    test "emits delayed event when job is retried with backoff", %{
      conn: conn,
      queue_name: queue_name
    } do
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
            raise "Temporary error"
          end
        )

      Process.sleep(100)

      # Job with backoff that will trigger delayed event on retry
      {:ok, job} =
        Queue.add(queue_name, "test", %{},
          connection: conn,
          prefix: @test_prefix,
          attempts: 2,
          backoff: %{type: "fixed", delay: 1000}
        )

      # Should receive delayed event when job moves to delayed for retry
      assert_receive {:bullmq_event, :delayed, event_data}, 5_000
      assert event_data["jobId"] == job.id

      Worker.close(worker)
      QueueEvents.close(events)
    end
  end

  # ---------------------------------------------------------------------------
  # Event Sequence Tests
  # ---------------------------------------------------------------------------

  describe "event sequences" do
    @tag :integration
    @tag timeout: 10_000
    test "receives waiting -> active -> completed sequence", %{conn: conn, queue_name: queue_name} do
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
            :ok
          end
        )

      Process.sleep(100)

      {:ok, job} = Queue.add(queue_name, "test", %{}, connection: conn, prefix: @test_prefix)

      # Collect events for this job
      events_received = collect_job_events(job.id, [:waiting, :active, :completed], 5_000)

      # Should have received all three events
      assert :waiting in events_received
      assert :active in events_received
      assert :completed in events_received

      Worker.close(worker)
      QueueEvents.close(events)
    end

    @tag :integration
    @tag timeout: 10_000
    test "receives waiting -> active -> failed sequence", %{conn: conn, queue_name: queue_name} do
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
            raise "Job failed"
          end
        )

      Process.sleep(100)

      {:ok, job} =
        Queue.add(queue_name, "test", %{}, connection: conn, prefix: @test_prefix, attempts: 1)

      # Collect events for this job
      events_received = collect_job_events(job.id, [:waiting, :active, :failed], 5_000)

      # Should have received all three events
      assert :waiting in events_received
      assert :active in events_received
      assert :failed in events_received

      Worker.close(worker)
      QueueEvents.close(events)
    end
  end

  # ---------------------------------------------------------------------------
  # Multiple Subscribers
  # ---------------------------------------------------------------------------

  describe "multiple subscribers" do
    @tag :integration
    @tag timeout: 10_000
    test "broadcasts events to all subscribers", %{conn: conn, queue_name: queue_name} do
      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix
        )

      test_pid = self()

      # Subscribe from main process
      QueueEvents.subscribe(events)

      # Create another process that also subscribes and reports back
      _other_pid =
        spawn_link(fn ->
          QueueEvents.subscribe(events)

          receive do
            {:bullmq_event, :completed, _data} ->
              send(test_pid, :other_received_completed)
          after
            5_000 -> send(test_pid, :other_timeout)
          end
        end)

      # Small delay to ensure both are subscribed
      Process.sleep(100)

      {:ok, worker} =
        Worker.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          processor: fn _job -> :ok end
        )

      {:ok, _job} = Queue.add(queue_name, "test", %{}, connection: conn, prefix: @test_prefix)

      # Main process should receive event
      assert_receive {:bullmq_event, :completed, _}, 5_000

      # Other process should also receive event
      assert_receive :other_received_completed, 1_000

      Worker.close(worker)
      QueueEvents.close(events)
    end
  end

  # ---------------------------------------------------------------------------
  # Autorun Option
  # ---------------------------------------------------------------------------

  describe "autorun option" do
    @tag :integration
    @tag timeout: 10_000
    test "does not start listening when autorun is false", %{conn: conn, queue_name: queue_name} do
      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          autorun: false
        )

      QueueEvents.subscribe(events)

      # Add a job - but since autorun is false, we shouldn't receive events
      {:ok, _job} =
        Queue.add(queue_name, "test", %{foo: "bar"}, connection: conn, prefix: @test_prefix)

      # Should NOT receive any events since autorun is false
      refute_receive {:bullmq_event, _, _}, 500

      QueueEvents.close(events)
    end
  end

  # ---------------------------------------------------------------------------
  # Handler Module
  # ---------------------------------------------------------------------------

  describe "handler module" do
    @tag :integration
    @tag timeout: 10_000
    test "calls handler module for events", %{conn: conn, queue_name: queue_name} do
      test_pid = self()

      # Define a simple handler module
      defmodule TestHandler do
        use BullMQ.QueueEvents.Handler

        @impl true
        def init(_opts), do: {:ok, %{events: []}}

        @impl true
        def handle_event(event_type, event_data, state) do
          # Send to test process for verification
          send(state[:test_pid], {:handler_event, event_type, event_data})
          {:ok, %{state | events: [event_type | state.events]}}
        end
      end

      {:ok, events} =
        QueueEvents.start_link(
          queue: queue_name,
          connection: conn,
          prefix: @test_prefix,
          handler: TestHandler,
          handler_state: %{test_pid: test_pid, events: []}
        )

      Process.sleep(100)

      {:ok, _job} =
        Queue.add(queue_name, "test", %{foo: "bar"}, connection: conn, prefix: @test_prefix)

      # Handler should receive events
      assert_receive {:handler_event, :waiting, _}, 5_000

      QueueEvents.close(events)
    end
  end

  # ---------------------------------------------------------------------------
  # Helper Functions
  # ---------------------------------------------------------------------------

  defp collect_job_events(job_id, expected_events, timeout) do
    deadline = System.monotonic_time(:millisecond) + timeout
    do_collect_job_events(job_id, expected_events, [], deadline)
  end

  defp do_collect_job_events(_job_id, [], acc, _deadline), do: acc

  defp do_collect_job_events(job_id, remaining_events, acc, deadline) do
    time_left = deadline - System.monotonic_time(:millisecond)

    if time_left <= 0 do
      acc
    else
      receive do
        {:bullmq_event, event_type, %{"jobId" => ^job_id}} ->
          new_acc = [event_type | acc]
          new_remaining = List.delete(remaining_events, event_type)
          do_collect_job_events(job_id, new_remaining, new_acc, deadline)

        {:bullmq_event, _event_type, _data} ->
          # Event for different job, continue
          do_collect_job_events(job_id, remaining_events, acc, deadline)
      after
        min(time_left, 100) ->
          do_collect_job_events(job_id, remaining_events, acc, deadline)
      end
    end
  end
end
