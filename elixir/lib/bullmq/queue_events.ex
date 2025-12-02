defmodule BullMQ.QueueEvents do
  @moduledoc """
  Subscribe to queue events in real-time.

  QueueEvents uses Redis Streams to listen for job lifecycle events.
  This enables reactive patterns and monitoring of job processing.

  ## Usage

      # Start the event listener
      {:ok, pid} = BullMQ.QueueEvents.start_link(
        queue: "my_queue",
        connection: :redis
      )

      # Subscribe to events
      BullMQ.QueueEvents.subscribe(pid, self())

      # Receive events
      receive do
        {:bullmq_event, :completed, %{job_id: id, returnvalue: value}} ->
          IO.puts("Job \#{id} completed with \#{value}")

        {:bullmq_event, :failed, %{job_id: id, failed_reason: reason}} ->
          IO.puts("Job \#{id} failed: \#{reason}")
      end

  ## Events

  The following events are emitted:

    * `:added` - Job was added to the queue
    * `:waiting` - Job is waiting to be processed
    * `:active` - Job started processing
    * `:progress` - Job progress was updated
    * `:completed` - Job completed successfully
    * `:failed` - Job failed
    * `:delayed` - Job was delayed
    * `:stalled` - Job was detected as stalled
    * `:removed` - Job was removed
    * `:drained` - Queue has no more waiting jobs
    * `:paused` - Queue was paused
    * `:resumed` - Queue was resumed

  ## Handler Module

  For more structured event handling, implement a handler module:

      defmodule MyApp.QueueHandler do
        use BullMQ.QueueEvents.Handler

        @impl true
        def handle_event(:completed, %{job_id: id, returnvalue: value}, state) do
          Logger.info("Job \#{id} completed")
          {:ok, state}
        end

        @impl true
        def handle_event(:failed, %{job_id: id, failed_reason: reason}, state) do
          Logger.error("Job \#{id} failed: \#{reason}")
          {:ok, state}
        end

        @impl true
        def handle_event(_event, _data, state) do
          {:ok, state}
        end
      end

      # Use the handler
      BullMQ.QueueEvents.start_link(
        queue: "my_queue",
        connection: :redis,
        handler: MyApp.QueueHandler
      )
  """

  use GenServer

  alias BullMQ.{Keys, RedisConnection, Types}

  require Logger

  @opts_schema NimbleOptions.new!([
    name: [
      type: {:or, [:atom, nil]},
      doc: "Optional name to register the GenServer process under."
    ],
    queue: [
      type: :string,
      required: true,
      doc: "The name of the queue to listen for events from."
    ],
    connection: [
      type: {:or, [:atom, :pid, {:tuple, [:atom, :atom]}]},
      required: true,
      doc: "The Redis connection (atom name, pid, or `{:via, registry}` tuple)."
    ],
    prefix: [
      type: :string,
      default: "bull",
      doc: "The prefix for Redis keys."
    ],
    handler: [
      type: {:or, [:atom, nil]},
      doc: "Optional handler module implementing `BullMQ.QueueEvents.Handler` behaviour."
    ],
    handler_state: [
      type: :any,
      doc: "Initial state passed to the handler module."
    ],
    last_event_id: [
      type: :string,
      default: "$",
      doc: "Start from specific event ID (default: \"$\" for new events only)."
    ],
    autorun: [
      type: :boolean,
      default: true,
      doc: "Whether to start listening for events immediately."
    ]
  ])

  @default_block_timeout 5_000

  @type event :: Types.queue_event()
  @type event_data :: map()

  @type t :: %__MODULE__{
          queue_name: String.t(),
          connection: Types.redis_connection(),
          prefix: String.t(),
          keys: Keys.queue_context(),
          subscribers: [pid()],
          handler: module() | nil,
          handler_state: term(),
          running: boolean(),
          closing: boolean(),
          last_event_id: String.t(),
          blocking_conn: pid() | nil,
          consumer_task: reference() | nil
        }

  defstruct [
    :queue_name,
    :connection,
    :keys,
    :blocking_conn,
    :handler,
    :consumer_task,
    prefix: "bull",
    subscribers: [],
    handler_state: nil,
    running: false,
    closing: false,
    last_event_id: "$"
  ]

  # Client API

  @doc """
  Starts the queue events listener.

  ## Options

    * `:queue` - Queue name (required)
    * `:connection` - Redis connection (required)
    * `:prefix` - Queue prefix (default: "bull")
    * `:handler` - Handler module (optional)
    * `:handler_state` - Initial handler state (optional)
    * `:last_event_id` - Start from specific event ID (default: "$" for new events)
    * `:autorun` - Start listening immediately (default: true)
  """
  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    name = Keyword.get(opts, :name)

    if name do
      GenServer.start_link(__MODULE__, opts, name: name)
    else
      GenServer.start_link(__MODULE__, opts)
    end
  end

  @doc """
  Subscribes a process to receive queue events.

  Events are sent as `{:bullmq_event, event_type, event_data}` messages.
  """
  @spec subscribe(GenServer.server(), pid()) :: :ok
  def subscribe(server, pid \\ self()) do
    GenServer.call(server, {:subscribe, pid})
  end

  @doc """
  Unsubscribes a process from queue events.
  """
  @spec unsubscribe(GenServer.server(), pid()) :: :ok
  def unsubscribe(server, pid \\ self()) do
    GenServer.call(server, {:unsubscribe, pid})
  end

  @doc """
  Closes the event listener.
  """
  @spec close(GenServer.server()) :: :ok
  def close(server) do
    GenServer.call(server, :close)
  end

  # GenServer callbacks

  @impl true
  def init(opts) do
    opts = NimbleOptions.validate!(opts, @opts_schema)
    Process.flag(:trap_exit, true)

    queue_name = Keyword.fetch!(opts, :queue)
    connection = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    autorun = Keyword.get(opts, :autorun, true)

    state = %__MODULE__{
      queue_name: queue_name,
      connection: connection,
      prefix: prefix,
      keys: Keys.new(queue_name, prefix: prefix),
      handler: Keyword.get(opts, :handler),
      handler_state: Keyword.get(opts, :handler_state),
      last_event_id: Keyword.get(opts, :last_event_id, "$")
    }

    if autorun do
      send(self(), :start)
    end

    {:ok, state}
  end

  @impl true
  def handle_call({:subscribe, pid}, _from, state) do
    Process.monitor(pid)
    subscribers = [pid | state.subscribers] |> Enum.uniq()
    {:reply, :ok, %{state | subscribers: subscribers}}
  end

  def handle_call({:unsubscribe, pid}, _from, state) do
    subscribers = List.delete(state.subscribers, pid)
    {:reply, :ok, %{state | subscribers: subscribers}}
  end

  def handle_call(:close, _from, state) do
    # Cancel the consumer task if running
    new_state = cancel_consumer_task(state)
    cleanup(new_state)
    {:reply, :ok, %{new_state | closing: true, running: false}}
  end

  @impl true
  def handle_info(:start, state) do
    case RedisConnection.blocking_connection(state.connection) do
      {:ok, blocking_conn} ->
        new_state = %{state | running: true, blocking_conn: blocking_conn}
        # Start consuming in a separate task
        {:noreply, schedule_consume(new_state)}

      {:error, reason} ->
        Logger.error("[BullMQ.QueueEvents] Failed to create blocking connection: #{inspect(reason)}")
        Process.send_after(self(), :start, 5_000)
        {:noreply, state}
    end
  end

  def handle_info(:consume, %{closing: true} = state) do
    {:noreply, state}
  end

  def handle_info(:consume, state) do
    # Start a task for the blocking read
    {:noreply, schedule_consume(state)}
  end

  def handle_info({ref, result}, %{consumer_task: ref} = state) when is_reference(ref) do
    # Task completed - process the result
    Process.demonitor(ref, [:flush])
    new_state = %{state | consumer_task: nil}

    case result do
      {:ok, nil} ->
        # Timeout, no events
        if not state.closing do
          {:noreply, schedule_consume(new_state)}
        else
          {:noreply, new_state}
        end

      {:ok, [[_key, events]]} ->
        processed_state = process_events(events, new_state)

        if not state.closing do
          {:noreply, schedule_consume(processed_state)}
        else
          {:noreply, processed_state}
        end

      {:error, reason} ->
        Logger.error("[BullMQ.QueueEvents] Error reading events: #{inspect(reason)}")

        if not state.closing do
          Process.send_after(self(), :consume, 1_000)
        end

        {:noreply, new_state}
    end
  end

  def handle_info({:DOWN, ref, :process, _pid, reason}, %{consumer_task: ref} = state) do
    # Consumer task crashed
    Logger.error("[BullMQ.QueueEvents] Consumer task crashed: #{inspect(reason)}")
    new_state = %{state | consumer_task: nil}

    if not state.closing do
      Process.send_after(self(), :consume, 1_000)
    end

    {:noreply, new_state}
  end

  def handle_info({:DOWN, _ref, :process, pid, _reason}, state) do
    subscribers = List.delete(state.subscribers, pid)
    {:noreply, %{state | subscribers: subscribers}}
  end

  def handle_info({:EXIT, _pid, _reason}, state) do
    {:noreply, state}
  end

  @impl true
  def terminate(_reason, state) do
    cleanup(state)
    :ok
  end

  # Private functions

  defp schedule_consume(%{closing: true} = state), do: state
  defp schedule_consume(%{consumer_task: ref} = state) when not is_nil(ref), do: state
  defp schedule_consume(state) do
    events_key = Keys.events(state.keys)
    blocking_conn = state.blocking_conn
    last_event_id = state.last_event_id

    task = Task.async(fn ->
      Redix.command(blocking_conn, [
        "XREAD",
        "BLOCK",
        @default_block_timeout,
        "STREAMS",
        events_key,
        last_event_id
      ])
    end)

    %{state | consumer_task: task.ref}
  end

  defp cancel_consumer_task(%{consumer_task: nil} = state), do: state
  defp cancel_consumer_task(%{consumer_task: ref} = state) when is_reference(ref) do
    # We can't really cancel the blocking Redis command, but we can
    # demonitor and ignore its result
    Process.demonitor(ref, [:flush])
    %{state | consumer_task: nil}
  end

  defp process_events(events, state) do
    Enum.reduce(events, state, fn [event_id, fields], acc ->
      event_data = parse_event_fields(fields)
      event_type = parse_event_type(Map.get(event_data, "event"))

      # Notify subscribers
      Enum.each(acc.subscribers, fn pid ->
        send(pid, {:bullmq_event, event_type, event_data})
      end)

      # Call handler if present
      new_handler_state =
        if acc.handler do
          case acc.handler.handle_event(event_type, event_data, acc.handler_state) do
            {:ok, new_state} -> new_state
            _ -> acc.handler_state
          end
        else
          acc.handler_state
        end

      %{acc | last_event_id: event_id, handler_state: new_handler_state}
    end)
  end

  defp parse_event_fields(fields) do
    fields
    |> Enum.chunk_every(2)
    |> Enum.into(%{}, fn [k, v] -> {k, v} end)
  end

  defp parse_event_type("added"), do: :added
  defp parse_event_type("waiting"), do: :waiting
  defp parse_event_type("active"), do: :active
  defp parse_event_type("progress"), do: :progress
  defp parse_event_type("completed"), do: :completed
  defp parse_event_type("failed"), do: :failed
  defp parse_event_type("delayed"), do: :delayed
  defp parse_event_type("stalled"), do: :stalled
  defp parse_event_type("removed"), do: :removed
  defp parse_event_type("drained"), do: :drained
  defp parse_event_type("paused"), do: :paused
  defp parse_event_type("resumed"), do: :resumed
  defp parse_event_type("duplicated"), do: :duplicated
  defp parse_event_type("deduplicated"), do: :deduplicated
  defp parse_event_type("retries-exhausted"), do: :retries_exhausted
  defp parse_event_type("waiting-children"), do: :waiting_children
  defp parse_event_type("cleaned"), do: :cleaned
  defp parse_event_type(other), do: String.to_atom(other)

  defp cleanup(state) do
    if state.blocking_conn do
      RedisConnection.close_blocking(state.connection, state.blocking_conn)
    end
    :ok
  end
end

defmodule BullMQ.QueueEvents.Handler do
  @moduledoc """
  Behaviour for queue event handlers.

  Implement this behaviour to create structured event handlers.

  ## Example

      defmodule MyApp.QueueHandler do
        use BullMQ.QueueEvents.Handler

        @impl true
        def init(opts) do
          {:ok, %{count: 0}}
        end

        @impl true
        def handle_event(:completed, %{"jobId" => id}, state) do
          Logger.info("Job completed: \#{id}")
          {:ok, %{state | count: state.count + 1}}
        end

        @impl true
        def handle_event(_event, _data, state) do
          {:ok, state}
        end
      end
  """

  @callback init(opts :: keyword()) :: {:ok, state :: term()} | {:error, reason :: term()}
  @callback handle_event(event :: atom(), data :: map(), state :: term()) ::
              {:ok, new_state :: term()} | {:error, reason :: term()}

  defmacro __using__(_opts) do
    quote do
      @behaviour BullMQ.QueueEvents.Handler

      @impl true
      def init(_opts), do: {:ok, nil}

      @impl true
      def handle_event(_event, _data, state), do: {:ok, state}

      defoverridable init: 1, handle_event: 3
    end
  end
end
