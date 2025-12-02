defmodule BullMQ.Telemetry.BehaviourTest do
  use ExUnit.Case, async: true

  alias BullMQ.Telemetry.Behaviour

  # A mock telemetry implementation for testing
  defmodule MockTelemetry do
    @behaviour Behaviour

    @impl true
    def start_span(name, opts \\ []) do
      span_id = :erlang.unique_integer([:positive])
      parent = Keyword.get(opts, :parent)
      attributes = Keyword.get(opts, :attributes, %{})

      span = %{
        id: span_id,
        name: name,
        parent: parent,
        attributes: attributes,
        events: [],
        status: :unset,
        ended: false
      }

      # Store in process dict for testing
      Process.put({:span, span_id}, span)
      {span_id, span}
    end

    @impl true
    def end_span({span_id, _span}, status \\ :ok) do
      case Process.get({:span, span_id}) do
        nil -> :ok
        span ->
          updated = %{span | status: status, ended: true}
          Process.put({:span, span_id}, updated)
          :ok
      end
    end

    @impl true
    def get_current_context do
      Process.get(:current_context, %{trace_id: "test-trace-123"})
    end

    @impl true
    def serialize_context(context) do
      Jason.encode!(context)
    end

    @impl true
    def deserialize_context(metadata) when is_binary(metadata) do
      Jason.decode!(metadata)
    end

    @impl true
    def with_context(context, fun) do
      old_context = Process.get(:current_context)
      Process.put(:current_context, context)
      try do
        fun.()
      after
        if old_context do
          Process.put(:current_context, old_context)
        else
          Process.delete(:current_context)
        end
      end
    end

    @impl true
    def set_attribute({span_id, _span}, key, value) do
      case Process.get({:span, span_id}) do
        nil -> {span_id, nil}
        span ->
          updated = %{span | attributes: Map.put(span.attributes, key, value)}
          Process.put({:span, span_id}, updated)
          {span_id, updated}
      end
    end

    @impl true
    def add_event({span_id, _span}, name, attributes \\ %{}) do
      case Process.get({:span, span_id}) do
        nil -> :ok
        span ->
          event = %{name: name, attributes: attributes, timestamp: System.system_time()}
          updated = %{span | events: [event | span.events]}
          Process.put({:span, span_id}, updated)
          :ok
      end
    end

    @impl true
    def record_exception({span_id, _span}, exception, _stacktrace \\ []) do
      case Process.get({:span, span_id}) do
        nil -> :ok
        span ->
          event = %{name: "exception", exception: exception, timestamp: System.system_time()}
          updated = %{span | events: [event | span.events], status: {:error, Exception.message(exception)}}
          Process.put({:span, span_id}, updated)
          :ok
      end
    end

    # Test helper to get span state
    def get_span(span_id), do: Process.get({:span, span_id})
  end

  describe "MockTelemetry behaviour implementation" do
    test "start_span creates a span with name and attributes" do
      {span_id, span} = MockTelemetry.start_span("test.operation", attributes: %{"key" => "value"})

      assert span.name == "test.operation"
      assert span.attributes == %{"key" => "value"}
      assert span.ended == false
      assert is_integer(span_id)
    end

    test "end_span marks span as ended with status" do
      {span_id, _span} = MockTelemetry.start_span("test.operation")

      MockTelemetry.end_span({span_id, nil}, :ok)

      span = MockTelemetry.get_span(span_id)
      assert span.ended == true
      assert span.status == :ok
    end

    test "end_span with error status" do
      {span_id, _span} = MockTelemetry.start_span("test.operation")

      MockTelemetry.end_span({span_id, nil}, {:error, "Something went wrong"})

      span = MockTelemetry.get_span(span_id)
      assert span.ended == true
      assert span.status == {:error, "Something went wrong"}
    end

    test "serialize_context and deserialize_context are inverse operations" do
      context = %{"trace_id" => "abc123", "span_id" => "def456"}

      serialized = MockTelemetry.serialize_context(context)
      assert is_binary(serialized)

      deserialized = MockTelemetry.deserialize_context(serialized)
      assert deserialized == context
    end

    test "with_context sets context during execution" do
      test_context = %{"test" => "context"}

      result = MockTelemetry.with_context(test_context, fn ->
        MockTelemetry.get_current_context()
      end)

      assert result == test_context
    end

    test "set_attribute adds attribute to span" do
      {span_id, _span} = MockTelemetry.start_span("test.operation")

      MockTelemetry.set_attribute({span_id, nil}, "new_key", "new_value")

      span = MockTelemetry.get_span(span_id)
      assert span.attributes["new_key"] == "new_value"
    end

    test "add_event adds event to span" do
      {span_id, _span} = MockTelemetry.start_span("test.operation")

      MockTelemetry.add_event({span_id, nil}, "my_event", %{"data" => "value"})

      span = MockTelemetry.get_span(span_id)
      assert length(span.events) == 1
      [event] = span.events
      assert event.name == "my_event"
      assert event.attributes == %{"data" => "value"}
    end

    test "record_exception records exception as event and sets error status" do
      {span_id, _span} = MockTelemetry.start_span("test.operation")

      exception = %RuntimeError{message: "Test error"}
      MockTelemetry.record_exception({span_id, nil}, exception, [])

      span = MockTelemetry.get_span(span_id)
      assert length(span.events) == 1
      [event] = span.events
      assert event.name == "exception"
      assert event.exception == exception
      assert span.status == {:error, "Test error"}
    end

    test "start_span with parent context" do
      parent_ctx = %{"trace_id" => "parent-trace"}
      {_span_id, span} = MockTelemetry.start_span("child.operation", parent: parent_ctx)

      assert span.parent == parent_ctx
    end
  end
end
