defmodule BullMQ.Telemetry.Behaviour do
  @moduledoc """
  Behaviour for telemetry integrations in BullMQ.

  This behaviour allows implementing distributed tracing with OpenTelemetry
  or other tracing systems. It provides callbacks for:

  - Starting and ending spans
  - Propagating trace context across job boundaries
  - Running code within a traced context

  ## Implementing Custom Telemetry

  To implement your own telemetry integration:

      defmodule MyApp.CustomTelemetry do
        @behaviour BullMQ.Telemetry.Behaviour

        @impl true
        def start_span(name, opts) do
          # Create and return a span
          %{span_id: UUID.uuid4(), name: name}
        end

        @impl true
        def end_span(span, status) do
          # End the span and record status
          :ok
        end

        @impl true
        def get_current_context() do
          # Return current trace context
          Process.get(:trace_context, nil)
        end

        @impl true
        def serialize_context(context) do
          # Convert context to string for Redis storage
          Jason.encode!(context)
        end

        @impl true
        def deserialize_context(metadata) do
          # Restore context from Redis
          Jason.decode!(metadata)
        end

        @impl true
        def with_context(context, fun) do
          # Run function within the given context
          Process.put(:trace_context, context)
          try do
            fun.()
          after
            Process.delete(:trace_context)
          end
        end

        @impl true
        def set_attribute(span, key, value) do
          # Add attribute to span
          Map.put(span, key, value)
        end

        @impl true
        def add_event(span, name, attributes) do
          # Add event to span
          :ok
        end

        @impl true
        def record_exception(span, exception, stacktrace) do
          # Record exception on span
          :ok
        end
      end

  ## Usage with Queue and Worker

      # When adding jobs
      {:ok, queue} = BullMQ.Queue.start_link(
        name: :my_queue,
        connection: :redis,
        telemetry: MyApp.CustomTelemetry
      )

      # Trace context is automatically propagated
      {:ok, job} = BullMQ.Queue.add(queue, "email", %{to: "user@example.com"})

      # When processing jobs, context is restored
      {:ok, worker} = BullMQ.Worker.start_link(
        name: :my_worker,
        queue: "my_queue",
        connection: :redis,
        telemetry: MyApp.CustomTelemetry,
        processor: fn job, _token ->
          # This runs within the restored trace context
          do_work(job)
        end
      )
  """

  @typedoc "A span representing a unit of work in the trace"
  @type span :: term()

  @typedoc "The trace context that can be propagated across process/service boundaries"
  @type context :: term()

  @typedoc "Span kind indicating the role of the span"
  @type span_kind :: :internal | :server | :client | :producer | :consumer

  @typedoc "Span status indicating the outcome"
  @type span_status :: :ok | :error | {:error, String.t()}

  @typedoc "Options for starting a span"
  @type span_opts :: [
          kind: span_kind(),
          attributes: map(),
          parent: context() | nil
        ]

  @doc """
  Starts a new span.

  Creates a new span with the given name and options. The span should be
  ended by calling `end_span/2`.

  ## Arguments

    * `name` - The name of the span (e.g., "queue.add", "worker.process")
    * `opts` - Options for the span:
      * `:kind` - The span kind (`:producer`, `:consumer`, `:internal`, etc.)
      * `:attributes` - Initial attributes for the span
      * `:parent` - Parent context for linking spans

  ## Returns

  A span that can be passed to other functions like `end_span/2`,
  `set_attribute/3`, etc.
  """
  @callback start_span(name :: String.t(), opts :: span_opts()) :: span()

  @doc """
  Ends a span.

  Marks the span as complete and records the final status.

  ## Arguments

    * `span` - The span to end
    * `status` - The status of the span (`:ok` or `{:error, reason}`)
  """
  @callback end_span(span :: span(), status :: span_status()) :: :ok

  @doc """
  Gets the current trace context.

  Returns the active trace context, if any. This context can be serialized
  and passed to other processes or services.

  ## Returns

  The current context, or `nil` if no context is active.
  """
  @callback get_current_context() :: context() | nil

  @doc """
  Serializes a trace context to a string.

  Converts the context to a string format suitable for storage in Redis
  or transmission over the network. The serialization should follow W3C
  Trace Context format for interoperability.

  ## Arguments

    * `context` - The context to serialize

  ## Returns

  A string representation of the context.
  """
  @callback serialize_context(context :: context()) :: String.t() | nil

  @doc """
  Deserializes a trace context from a string.

  Restores a context from its serialized string representation.

  ## Arguments

    * `metadata` - The serialized context string

  ## Returns

  The restored context.
  """
  @callback deserialize_context(metadata :: String.t()) :: context()

  @doc """
  Runs a function within a given trace context.

  Sets the given context as the active context for the duration of
  the function call. This is used to restore context when processing
  a job that was added with a trace context.

  ## Arguments

    * `context` - The context to activate
    * `fun` - The function to run within the context

  ## Returns

  The return value of the function.
  """
  @callback with_context(context :: context(), fun :: (-> result)) :: result when result: term()

  @doc """
  Sets an attribute on a span.

  Adds a key-value attribute to the span. Attributes are used to
  annotate spans with additional information.

  ## Arguments

    * `span` - The span to add the attribute to
    * `key` - The attribute key (string or atom)
    * `value` - The attribute value
  """
  @callback set_attribute(span :: span(), key :: String.t() | atom(), value :: term()) :: span()

  @doc """
  Adds an event to a span.

  Events are timestamped annotations that represent something happening
  during the span's lifetime.

  ## Arguments

    * `span` - The span to add the event to
    * `name` - The event name
    * `attributes` - Optional attributes for the event (default: %{})
  """
  @callback add_event(span :: span(), name :: String.t(), attributes :: map()) :: :ok

  @doc """
  Records an exception on a span.

  Marks the span with exception information. This is typically called
  when an error occurs during the span's execution.

  ## Arguments

    * `span` - The span to record the exception on
    * `exception` - The exception that occurred
    * `stacktrace` - The stacktrace at the time of the exception
  """
  @callback record_exception(span :: span(), exception :: Exception.t(), stacktrace :: list()) ::
              :ok
end
