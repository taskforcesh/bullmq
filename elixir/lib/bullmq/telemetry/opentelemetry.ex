defmodule BullMQ.Telemetry.OpenTelemetry do
  @moduledoc """
  OpenTelemetry adapter for BullMQ distributed tracing.

  This module implements the `BullMQ.Telemetry.Behaviour` using OpenTelemetry APIs.
  It provides distributed tracing capabilities that allow you to:

  - Trace jobs across queue boundaries
  - Link spans from job producers to job consumers
  - Propagate trace context through Redis
  - Integrate with OpenTelemetry backends (Jaeger, Zipkin, Honeycomb, etc.)

  ## Prerequisites

  This module requires the `opentelemetry_api` package. Add it to your dependencies:

      # mix.exs
      defp deps do
        [
          {:bullmq, "~> 0.1"},
          {:opentelemetry_api, "~> 1.0"},
          {:opentelemetry, "~> 1.0"},
          # Choose your exporter
          {:opentelemetry_exporter, "~> 1.0"}
        ]
      end

  ## Configuration

  Configure OpenTelemetry in your application:

      # config/config.exs
      config :opentelemetry,
        span_processor: :batch,
        traces_exporter: :otlp

      config :opentelemetry_exporter,
        otlp_protocol: :grpc,
        otlp_endpoint: "http://localhost:4317"

  ## Usage

      # When adding jobs, trace context is automatically propagated
      {:ok, queue} = BullMQ.Queue.start_link(
        name: :my_queue,
        connection: :redis,
        telemetry: BullMQ.Telemetry.OpenTelemetry
      )

      # Create a parent span and add jobs within it
      require OpenTelemetry.Tracer, as: Tracer
      Tracer.with_span "my_operation" do
        # Trace context from "my_operation" is propagated to the job
        {:ok, job} = BullMQ.Queue.add(queue, "email", %{to: "user@example.com"})
      end

      # When processing, the worker restores the trace context
      {:ok, worker} = BullMQ.Worker.start_link(
        name: :my_worker,
        queue: "my_queue",
        connection: :redis,
        telemetry: BullMQ.Telemetry.OpenTelemetry,
        processor: fn job, _token ->
          # This span is linked to the original "my_operation" span
          Tracer.with_span "process_email" do
            send_email(job.data)
          end
        end
      )

  ## Span Naming Convention

  BullMQ creates spans with the following names:

  - `bullmq.queue.add` - When adding a single job
  - `bullmq.queue.add_bulk` - When adding multiple jobs
  - `bullmq.worker.process` - When processing a job

  ## Span Attributes

  Spans include the following semantic attributes:

  - `messaging.system` - Always "bullmq"
  - `messaging.destination.name` - The queue name
  - `messaging.message.id` - The job ID
  - `messaging.operation` - The operation type ("publish" or "receive")
  - `bullmq.job.name` - The job name/type
  - `bullmq.job.priority` - The job priority
  - `bullmq.job.delay` - The job delay in ms
  - `bullmq.job.attempts` - Number of attempts made
  """

  @behaviour BullMQ.Telemetry.Behaviour

  # Suppress warnings for optional OpenTelemetry dependencies
  @compile {:no_warn_undefined,
            [
              :opentelemetry,
              :otel_ctx,
              :otel_tracer,
              :otel_span,
              :otel_propagator_text_map
            ]}

  @doc """
  Checks if OpenTelemetry is available and properly configured.

  Returns `true` if the required OpenTelemetry modules are loaded.
  Note: This only checks if the modules are available. For the SDK to
  actually record spans, you need to have `opentelemetry` (the SDK)
  installed and configured, not just `opentelemetry_api`.
  """
  @spec available?() :: boolean()
  def available? do
    # Use runtime checks to avoid compile-time type warnings when deps aren't installed
    Code.ensure_loaded?(:opentelemetry) and
      Code.ensure_loaded?(:otel_tracer) and
      Code.ensure_loaded?(:otel_ctx) and
      Code.ensure_loaded?(:otel_propagator_text_map)
  end

  # Get the tracer - returns a noop tracer if SDK isn't configured
  defp get_tracer do
    if available?() do
      try do
        :opentelemetry.get_tracer(:bullmq)
      rescue
        _ -> nil
      catch
        _, _ -> nil
      end
    else
      nil
    end
  end

  @impl true
  def start_span(name, opts \\ []) do
    tracer = get_tracer()

    if tracer do
      try do
        kind = map_span_kind(Keyword.get(opts, :kind, :internal))
        attributes = Keyword.get(opts, :attributes, %{})
        parent_ctx = Keyword.get(opts, :parent)

        # Get or create the parent context
        ctx = parent_ctx || :otel_ctx.get_current()

        # Start span with context and tracer
        # :otel_tracer.start_span(Ctx, Tracer, Name, Opts)
        span_ctx =
          :otel_tracer.start_span(ctx, tracer, name, %{
            kind: kind,
            attributes: build_attributes(attributes)
          })

        # Return both the new context with span and the span context for later use
        new_ctx = :otel_tracer.set_current_span(ctx, span_ctx)
        {new_ctx, span_ctx}
      rescue
        _ -> {:noop, nil}
      catch
        _, _ -> {:noop, nil}
      end
    else
      # Return a no-op span when OpenTelemetry is not available
      {:noop, nil}
    end
  end

  @impl true
  def end_span(span, status \\ :ok) do
    case span do
      {:noop, _} ->
        :ok

      {_ctx, span_ctx} when span_ctx != nil ->
        try do
          # Use set_status/2 with atom or set_status/3 with code + message
          case status do
            :ok ->
              :otel_span.set_status(span_ctx, :ok)

            :error ->
              :otel_span.set_status(span_ctx, :error, "")

            {:error, message} when is_binary(message) ->
              :otel_span.set_status(span_ctx, :error, message)

            {:error, message} ->
              :otel_span.set_status(span_ctx, :error, inspect(message))
          end

          :otel_span.end_span(span_ctx)
        rescue
          _ -> :ok
        catch
          _, _ -> :ok
        end

      _ ->
        :ok
    end

    :ok
  end

  @impl true
  def get_current_context do
    if available?() do
      try do
        :otel_ctx.get_current()
      rescue
        _ -> nil
      catch
        _, _ -> nil
      end
    else
      nil
    end
  end

  @impl true
  def serialize_context(context) do
    if available?() and context != nil do
      try do
        # Use W3C Trace Context propagator to inject trace context into headers
        # The inject_from function takes: Context, Carrier, CarrierSetFun
        # CarrierSetFun has signature: (Key, Value, Carrier) -> Carrier
        # We build a map to match Node.js bullmq-otel format: {"traceparent": "...", ...}
        headers =
          :otel_propagator_text_map.inject_from(context, %{}, fn key, value, carrier ->
            Map.put(carrier, key, value)
          end)

        if headers == %{} do
          nil
        else
          Jason.encode!(headers)
        end
      rescue
        _ -> nil
      catch
        _, _ -> nil
      end
    else
      nil
    end
  end

  @impl true
  def deserialize_context(metadata) when is_binary(metadata) do
    if available?() do
      try do
        case Jason.decode(metadata) do
          {:ok, headers} when is_map(headers) ->
            # Node.js bullmq-otel format: {"traceparent": "...", "tracestate": "..."}
            # Convert map to list of tuples for the propagator
            carrier = Enum.map(headers, fn {k, v} -> {k, v} end)
            :otel_propagator_text_map.extract_to(:otel_ctx.new(), carrier)

          {:ok, headers} when is_list(headers) ->
            # Legacy format: [["traceparent", "..."], ...]
            # Convert JSON array to list of tuples if needed
            carrier =
              Enum.map(headers, fn
                [k, v] -> {k, v}
                {k, v} -> {k, v}
              end)

            :otel_propagator_text_map.extract_to(:otel_ctx.new(), carrier)

          _ ->
            nil
        end
      rescue
        _ -> nil
      catch
        _, _ -> nil
      end
    else
      nil
    end
  end

  def deserialize_context(_), do: nil

  @impl true
  def with_context(context, fun) do
    if available?() and context != nil do
      try do
        # Attach the context and run the function
        token = :otel_ctx.attach(context)

        try do
          fun.()
        after
          :otel_ctx.detach(token)
        end
      rescue
        _ -> fun.()
      catch
        _, _ -> fun.()
      end
    else
      fun.()
    end
  end

  @impl true
  def set_attribute(span, key, value) do
    case span do
      {:noop, _} ->
        span

      {_ctx, span_ctx} when span_ctx != nil ->
        try do
          :otel_span.set_attribute(span_ctx, to_string(key), value)
          span
        rescue
          _ -> span
        catch
          _, _ -> span
        end

      _ ->
        span
    end
  end

  @impl true
  def add_event(span, name, attributes \\ %{}) do
    case span do
      {:noop, _} ->
        :ok

      {_ctx, span_ctx} when span_ctx != nil ->
        try do
          :otel_span.add_event(span_ctx, name, build_attributes(attributes))
        rescue
          _ -> :ok
        catch
          _, _ -> :ok
        end

      _ ->
        :ok
    end

    :ok
  end

  @impl true
  def record_exception(span, exception, stacktrace \\ []) do
    case span do
      {:noop, _} ->
        :ok

      {_ctx, span_ctx} when span_ctx != nil ->
        try do
          # record_exception/5: (SpanCtx, Class, Term, Stacktrace, Attributes)
          :otel_span.record_exception(span_ctx, :error, exception, stacktrace, %{})
          :otel_span.set_status(span_ctx, :error, Exception.message(exception))
        rescue
          _ -> :ok
        catch
          _, _ -> :ok
        end

      _ ->
        :ok
    end

    :ok
  end

  # Helper to trace a complete operation
  @doc """
  Traces a complete operation with automatic span lifecycle management.

  This is a convenience function that starts a span, runs the given function,
  and ends the span with the appropriate status.

  ## Arguments

    * `name` - The span name
    * `opts` - Span options (see `start_span/2`)
    * `fun` - The function to trace. Receives the span and optional propagation metadata.

  ## Options

    * `:propagate` - If `true`, the function receives a second argument with
      the serialized trace context for propagation

  ## Examples

      # Simple trace
      BullMQ.Telemetry.OpenTelemetry.trace("my.operation", [], fn _span ->
        do_work()
      end)

      # Trace with context propagation (for queue.add)
      BullMQ.Telemetry.OpenTelemetry.trace("queue.add", [propagate: true], fn _span, metadata ->
        # metadata contains serialized trace context to store in job
        {:ok, job} = add_job_with_metadata(metadata)
      end)
  """
  @spec trace(String.t(), keyword(), (term() -> result) | (term(), String.t() | nil -> result)) ::
          result
        when result: term()
  def trace(name, opts \\ [], fun) do
    parent_metadata = Keyword.get(opts, :parent_metadata)
    propagate = Keyword.get(opts, :propagate, false)

    # If we have parent metadata, deserialize and use it as parent
    parent_ctx =
      if parent_metadata do
        deserialize_context(parent_metadata)
      else
        nil
      end

    span_opts =
      opts
      |> Keyword.delete(:parent_metadata)
      |> Keyword.delete(:propagate)
      |> Keyword.put(:parent, parent_ctx)

    span = start_span(name, span_opts)

    # Get context for propagation if requested
    dst_metadata =
      case span do
        {:noop, nil} ->
          nil

        {ctx, span_data} when span_data != nil ->
          if propagate and available?() do
            try do
              span_ctx = :otel_tracer.set_current_span(ctx, span_data)
              serialize_context(span_ctx)
            rescue
              _ -> nil
            catch
              _, _ -> nil
            end
          else
            nil
          end

        _ ->
          nil
      end

    try do
      result =
        if propagate do
          with_span_context(span, fn ->
            fun.(span, dst_metadata)
          end)
        else
          with_span_context(span, fn ->
            fun.(span)
          end)
        end

      end_span(span, :ok)
      result
    rescue
      e ->
        record_exception(span, e, __STACKTRACE__)
        end_span(span, {:error, Exception.message(e)})
        reraise e, __STACKTRACE__
    catch
      kind, reason ->
        end_span(span, {:error, inspect(reason)})
        :erlang.raise(kind, reason, __STACKTRACE__)
    end
  end

  # Run function with span set as current
  defp with_span_context({ctx, span_data}, fun) when span_data != nil do
    if available?() do
      try do
        # Create a new context with this span as current
        new_ctx = :otel_tracer.set_current_span(ctx, span_data)
        token = :otel_ctx.attach(new_ctx)

        try do
          fun.()
        after
          :otel_ctx.detach(token)
        end
      rescue
        _ -> fun.()
      catch
        _, _ -> fun.()
      end
    else
      fun.()
    end
  end

  defp with_span_context(_, fun), do: fun.()

  # Map our span kinds to OpenTelemetry span kinds
  defp map_span_kind(:internal), do: :internal
  defp map_span_kind(:server), do: :server
  defp map_span_kind(:client), do: :client
  defp map_span_kind(:producer), do: :producer
  defp map_span_kind(:consumer), do: :consumer
  defp map_span_kind(_), do: :internal

  # Build OpenTelemetry attributes from a map
  defp build_attributes(attrs) when is_map(attrs) do
    Enum.map(attrs, fn {k, v} -> {to_string(k), v} end)
  end

  defp build_attributes(attrs) when is_list(attrs), do: attrs
  defp build_attributes(_), do: []
end
