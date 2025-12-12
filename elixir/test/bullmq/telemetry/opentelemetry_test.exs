defmodule BullMQ.Telemetry.OpenTelemetryTest do
  use ExUnit.Case, async: true

  alias BullMQ.Telemetry.OpenTelemetry

  describe "available?/0" do
    test "returns true when OpenTelemetry modules are loaded" do
      # OpenTelemetry is installed in dev/test, so it should be available
      assert OpenTelemetry.available?() == true
    end
  end

  describe "start_span/2" do
    test "creates a span tuple" do
      span = OpenTelemetry.start_span("test.operation")
      assert is_tuple(span)
      assert tuple_size(span) == 2
    end

    test "creates span with attributes" do
      span = OpenTelemetry.start_span("test.operation", attributes: %{"key" => "value"})
      assert is_tuple(span)
    end

    test "creates span with kind" do
      span = OpenTelemetry.start_span("test.operation", kind: :producer)
      assert is_tuple(span)
    end
  end

  describe "end_span/2" do
    test "ends a span with ok status" do
      span = OpenTelemetry.start_span("test.operation")
      result = OpenTelemetry.end_span(span, :ok)
      assert result == :ok
    end

    test "ends a span with error status" do
      span = OpenTelemetry.start_span("test.operation")
      result = OpenTelemetry.end_span(span, {:error, "Something failed"})
      assert result == :ok
    end

    test "handles noop span gracefully" do
      result = OpenTelemetry.end_span({:noop, nil}, :ok)
      assert result == :ok
    end
  end

  describe "context serialization" do
    test "serialize_context returns nil for nil context" do
      result = OpenTelemetry.serialize_context(nil)
      assert result == nil
    end

    test "deserialize_context returns nil for non-binary input" do
      result = OpenTelemetry.deserialize_context(nil)
      assert result == nil

      result = OpenTelemetry.deserialize_context(123)
      assert result == nil
    end

    test "deserialize_context handles invalid JSON" do
      result = OpenTelemetry.deserialize_context("not valid json")
      # Should return nil gracefully rather than crash
      assert result == nil
    end

    test "serialize and deserialize context round-trip" do
      # Get current context
      ctx = OpenTelemetry.get_current_context()

      # Serialize it
      serialized = OpenTelemetry.serialize_context(ctx)

      # If serialization returned something, deserialize it
      if serialized do
        deserialized = OpenTelemetry.deserialize_context(serialized)
        assert deserialized != nil
      end
    end

    test "deserialize_context handles Node.js bullmq-otel format" do
      # This is the format produced by Node.js bullmq-otel:
      # propagation.inject(ctx, {}) -> {"traceparent": "...", "tracestate": "..."}
      # JSON.stringify(metadata)
      nodejs_format = ~s({"traceparent":"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"})

      result = OpenTelemetry.deserialize_context(nodejs_format)
      # Should successfully parse without crashing
      # Result may be nil if OTEL SDK isn't fully configured, but shouldn't crash
      assert result == nil or is_reference(result) or is_tuple(result) or is_map(result)
    end

    test "serialize_context produces Node.js compatible format" do
      ctx = OpenTelemetry.get_current_context()
      serialized = OpenTelemetry.serialize_context(ctx)

      # If we got a serialized context, it should be a JSON object (map), not an array
      if serialized do
        {:ok, decoded} = Jason.decode(serialized)

        assert is_map(decoded),
               "Serialized context should be a JSON object for Node.js compatibility"
      end
    end
  end

  describe "with_context/2" do
    test "executes function and returns result" do
      ctx = OpenTelemetry.get_current_context()

      result =
        OpenTelemetry.with_context(ctx, fn ->
          :test_result
        end)

      assert result == :test_result
    end

    test "handles nil context gracefully" do
      result =
        OpenTelemetry.with_context(nil, fn ->
          :test_result
        end)

      assert result == :test_result
    end
  end

  describe "set_attribute/3" do
    test "sets attribute on span" do
      span = OpenTelemetry.start_span("test.operation")
      updated = OpenTelemetry.set_attribute(span, "test_key", "test_value")
      assert is_tuple(updated)
    end

    test "handles noop span gracefully" do
      result = OpenTelemetry.set_attribute({:noop, nil}, "key", "value")
      assert result == {:noop, nil}
    end
  end

  describe "add_event/3" do
    test "adds event to span" do
      span = OpenTelemetry.start_span("test.operation")
      result = OpenTelemetry.add_event(span, "my_event", %{"data" => "value"})
      assert result == :ok
    end

    test "handles noop span gracefully" do
      result = OpenTelemetry.add_event({:noop, nil}, "event", %{})
      assert result == :ok
    end
  end

  describe "record_exception/3" do
    test "records exception on span" do
      span = OpenTelemetry.start_span("test.operation")
      exception = %RuntimeError{message: "Test error"}
      result = OpenTelemetry.record_exception(span, exception, [])
      assert result == :ok
    end

    test "handles noop span gracefully" do
      exception = %RuntimeError{message: "Test error"}
      result = OpenTelemetry.record_exception({:noop, nil}, exception, [])
      assert result == :ok
    end
  end

  describe "trace/3" do
    test "traces a successful operation" do
      result =
        OpenTelemetry.trace("test.operation", [], fn _span ->
          {:ok, :success}
        end)

      assert result == {:ok, :success}
    end

    test "traces an operation that raises" do
      assert_raise RuntimeError, "Test error", fn ->
        OpenTelemetry.trace("test.operation", [], fn _span ->
          raise "Test error"
        end)
      end
    end

    test "traces with propagation" do
      result =
        OpenTelemetry.trace("test.operation", [propagate: true], fn _span, metadata ->
          # metadata should be the serialized context or nil
          {:ok, metadata}
        end)

      assert match?({:ok, _}, result)
    end

    test "traces with parent metadata" do
      # Use list of lists for JSON encoding (tuples don't encode)
      parent_metadata = Jason.encode!([["traceparent", "00-trace-span-01"]])

      result =
        OpenTelemetry.trace("child.operation", [parent_metadata: parent_metadata], fn _span ->
          :child_result
        end)

      assert result == :child_result
    end
  end
end
