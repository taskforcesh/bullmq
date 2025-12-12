defmodule BullMQ.TelemetryTest do
  use ExUnit.Case, async: true

  alias BullMQ.Telemetry

  describe "emit/3" do
    test "emits telemetry event with atom name" do
      ref = make_ref()
      test_pid = self()

      :telemetry.attach(
        "test-handler-#{inspect(ref)}",
        [:bullmq, :test_event],
        fn event, measurements, metadata, _config ->
          send(test_pid, {:telemetry_event, event, measurements, metadata})
        end,
        nil
      )

      Telemetry.emit(:test_event, %{value: 42}, %{queue: "test"})

      assert_receive {:telemetry_event, [:bullmq, :test_event], %{value: 42}, %{queue: "test"}}

      :telemetry.detach("test-handler-#{inspect(ref)}")
    end

    test "emits telemetry event with list name" do
      ref = make_ref()
      test_pid = self()

      :telemetry.attach(
        "test-handler-#{inspect(ref)}",
        [:bullmq, :job, :complete],
        fn event, measurements, metadata, _config ->
          send(test_pid, {:telemetry_event, event, measurements, metadata})
        end,
        nil
      )

      Telemetry.emit([:job, :complete], %{duration: 100}, %{job_id: "123"})

      assert_receive {:telemetry_event, [:bullmq, :job, :complete], %{duration: 100},
                      %{job_id: "123"}}

      :telemetry.detach("test-handler-#{inspect(ref)}")
    end
  end

  describe "attach/4" do
    test "attaches handler to bullmq-prefixed event" do
      ref = make_ref()
      test_pid = self()

      Telemetry.attach(
        "test-attach-#{inspect(ref)}",
        [:custom, :event],
        fn event, measurements, metadata, _config ->
          send(test_pid, {:handler_called, event, measurements, metadata})
        end
      )

      :telemetry.execute([:bullmq, :custom, :event], %{data: 1}, %{})

      assert_receive {:handler_called, [:bullmq, :custom, :event], %{data: 1}, %{}}

      :telemetry.detach("test-attach-#{inspect(ref)}")
    end
  end

  describe "attach_many/4" do
    test "attaches handler to multiple events" do
      ref = make_ref()
      test_pid = self()
      events_received = :ets.new(:events, [:set, :public])

      Telemetry.attach_many(
        "test-attach-many-#{inspect(ref)}",
        [[:event, :one], [:event, :two]],
        fn event, _measurements, _metadata, _config ->
          :ets.insert(events_received, {event, true})
          send(test_pid, {:event_received, event})
        end
      )

      :telemetry.execute([:bullmq, :event, :one], %{}, %{})
      :telemetry.execute([:bullmq, :event, :two], %{}, %{})

      assert_receive {:event_received, [:bullmq, :event, :one]}
      assert_receive {:event_received, [:bullmq, :event, :two]}

      :telemetry.detach("test-attach-many-#{inspect(ref)}")
      :ets.delete(events_received)
    end
  end

  describe "span/3" do
    test "emits start and stop events" do
      ref = make_ref()
      test_pid = self()

      :telemetry.attach_many(
        "test-span-#{inspect(ref)}",
        [
          [:bullmq, :operation, :start],
          [:bullmq, :operation, :stop]
        ],
        fn event, measurements, metadata, _config ->
          send(test_pid, {:span_event, event, measurements, metadata})
        end,
        nil
      )

      result =
        Telemetry.span([:operation], %{id: "op-1"}, fn ->
          Process.sleep(10)
          :ok
        end)

      assert result == :ok

      assert_receive {:span_event, [:bullmq, :operation, :start], %{system_time: _}, %{id: "op-1"}}

      assert_receive {:span_event, [:bullmq, :operation, :stop], %{duration: duration},
                      %{id: "op-1"}}

      assert duration > 0

      :telemetry.detach("test-span-#{inspect(ref)}")
    end

    test "emits exception event on error" do
      ref = make_ref()
      test_pid = self()

      :telemetry.attach_many(
        "test-span-error-#{inspect(ref)}",
        [
          [:bullmq, :operation, :start],
          [:bullmq, :operation, :exception]
        ],
        fn event, measurements, metadata, _config ->
          send(test_pid, {:span_event, event, measurements, metadata})
        end,
        nil
      )

      assert_raise RuntimeError, fn ->
        Telemetry.span([:operation], %{id: "op-2"}, fn ->
          raise "test error"
        end)
      end

      assert_receive {:span_event, [:bullmq, :operation, :start], _, _}
      assert_receive {:span_event, [:bullmq, :operation, :exception], %{duration: _}, metadata}
      assert metadata.kind == :error
      assert %RuntimeError{} = metadata.reason

      :telemetry.detach("test-span-error-#{inspect(ref)}")
    end
  end

  describe "convenience functions" do
    test "job_added/4 emits correct event" do
      ref = make_ref()
      test_pid = self()

      :telemetry.attach(
        "test-job-added-#{inspect(ref)}",
        [:bullmq, :job, :add],
        fn event, measurements, metadata, _config ->
          send(test_pid, {:event, event, measurements, metadata})
        end,
        nil
      )

      Telemetry.job_added("test-queue", "job-123", "process", 50)

      assert_receive {:event, [:bullmq, :job, :add], %{queue_time: 50}, metadata}
      assert metadata.queue == "test-queue"
      assert metadata.job_id == "job-123"
      assert metadata.job_name == "process"

      :telemetry.detach("test-job-added-#{inspect(ref)}")
    end

    test "job_completed/5 emits correct event" do
      ref = make_ref()
      test_pid = self()

      :telemetry.attach(
        "test-job-completed-#{inspect(ref)}",
        [:bullmq, :job, :complete],
        fn event, measurements, metadata, _config ->
          send(test_pid, {:event, event, measurements, metadata})
        end,
        nil
      )

      Telemetry.job_completed("emails", "job-456", "send", self(), 1000)

      assert_receive {:event, [:bullmq, :job, :complete], %{duration: 1000}, metadata}
      assert metadata.queue == "emails"
      assert metadata.job_id == "job-456"
      assert metadata.job_name == "send"
      assert metadata.worker == self()

      :telemetry.detach("test-job-completed-#{inspect(ref)}")
    end

    test "job_failed/6 emits correct event" do
      ref = make_ref()
      test_pid = self()

      :telemetry.attach(
        "test-job-failed-#{inspect(ref)}",
        [:bullmq, :job, :fail],
        fn event, measurements, metadata, _config ->
          send(test_pid, {:event, event, measurements, metadata})
        end,
        nil
      )

      error = %RuntimeError{message: "test error"}
      Telemetry.job_failed("emails", "job-789", "send", self(), 500, error)

      assert_receive {:event, [:bullmq, :job, :fail], %{duration: 500}, metadata}
      assert metadata.queue == "emails"
      assert metadata.error == error

      :telemetry.detach("test-job-failed-#{inspect(ref)}")
    end

    test "rate_limit_hit/2 emits correct event" do
      ref = make_ref()
      test_pid = self()

      :telemetry.attach(
        "test-rate-limit-#{inspect(ref)}",
        [:bullmq, :rate_limit, :hit],
        fn event, measurements, metadata, _config ->
          send(test_pid, {:event, event, measurements, metadata})
        end,
        nil
      )

      Telemetry.rate_limit_hit("api-calls", 5000)

      assert_receive {:event, [:bullmq, :rate_limit, :hit], %{delay: 5000}, %{queue: "api-calls"}}

      :telemetry.detach("test-rate-limit-#{inspect(ref)}")
    end
  end
end
