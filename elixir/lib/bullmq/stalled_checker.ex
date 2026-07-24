defmodule BullMQ.StalledChecker do
  @moduledoc """
  Detects and handles stalled jobs.

  A job is considered "stalled" when a worker takes a job but fails to:
  - Complete it (move to completed/failed)
  - Renew its lock before the lock expires

  This typically happens when:
  - The worker process crashes
  - The machine running the worker loses power
  - Network issues prevent lock renewal
  - The job processor blocks without yielding

  ## Detection Algorithm

  BullMQ uses a two-phase stalled job detection:

  1. **Mark Phase**: Jobs without valid locks are moved to a "stalled" set
  2. **Recover Phase**: On next check, jobs still in stalled set are
     either requeued or moved to failed (based on `max_stalled_count`)

  This two-phase approach prevents false positives from timing issues.

  ## Configuration

  The stalled checker is configured on the worker. The defaults are sensible
  and should normally not be changed:

      {BullMQ.Worker,
        queue: "emails",
        connection: :redis,
        processor: &MyApp.send_email/1,
        lock_duration: 30_000,      # Default: 30s - normally don't change
        stalled_interval: 30_000,   # Default: 30s - normally don't change
        max_stalled_count: 1        # Default: 1 - see note below
      }

  ### About max_stalled_count

  The default `max_stalled_count` is 1 because stalled jobs are considered a rare
  occurrence. If a job stalls more than once, it typically indicates a more serious
  issue such as:

  - Repeated worker crashes on specific job data
  - Resource exhaustion (memory, CPU)
  - External service failures
  - Bugs in job processing logic

  Increasing this value is generally not recommended. Instead, investigate why
  jobs are stalling and fix the underlying issue.

  ### About lock_duration

  The `lock_duration` should only be increased if you have jobs that legitimately
  take longer than 30 seconds between lock renewals (which happen automatically).
  Jobs that process quickly don't need longer lock durations.

  ## Manual Checking

  You can also run the stalled check manually:

      BullMQ.StalledChecker.check(:redis, "emails")
  """

  use GenServer
  require Logger

  alias BullMQ.Backend

  @type opts :: [
          connection: atom(),
          queue: String.t(),
          prefix: String.t(),
          stalled_interval: pos_integer(),
          max_stalled_count: pos_integer()
        ]

  defstruct [
    :connection,
    :queue,
    :prefix,
    :stalled_interval,
    :max_stalled_count,
    :timer_ref
  ]

  # Client API

  @doc """
  Starts the stalled job checker.

  ## Options

    * `:connection` - Required. Redis connection name
    * `:queue` - Required. Queue name
    * `:prefix` - Key prefix (default: "bull")
    * `:stalled_interval` - Check interval in ms (default: 30_000)
    * `:max_stalled_count` - Max stall count before failing (default: 1)
  """
  @spec start_link(opts()) :: GenServer.on_start()
  def start_link(opts) do
    name = Keyword.get(opts, :name)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @doc """
  Manually triggers a stalled jobs check.

  Returns `{:ok, %{recovered: count, failed: count}}`.
  """
  @spec check(atom(), String.t(), Keyword.t()) :: {:ok, map()} | {:error, term()}
  def check(connection, queue, opts \\ []) do
    prefix = Keyword.get(opts, :prefix, "bull")
    max_stalled_count = Keyword.get(opts, :max_stalled_count, 1)
    backend = Backend.create(queue, connection: connection, prefix: prefix)

    Backend.check_stalled_jobs(backend, max_stalled_count)
  end

  @doc """
  Checks if a specific job is stalled.
  """
  @spec job_stalled?(atom(), String.t(), String.t(), Keyword.t()) ::
          {:ok, boolean()} | {:error, term()}
  def job_stalled?(connection, queue, job_id, opts \\ []) do
    prefix = Keyword.get(opts, :prefix, "bull")
    backend = Backend.create(queue, connection: connection, prefix: prefix)

    case Backend.has_job_lock?(backend, job_id) do
      {:ok, exists} -> {:ok, not exists}
      {:error, _} = error -> error
    end
  end

  # Server callbacks

  @impl true
  def init(opts) do
    connection = Keyword.fetch!(opts, :connection)
    queue = Keyword.fetch!(opts, :queue)
    prefix = Keyword.get(opts, :prefix, "bull")
    stalled_interval = Keyword.get(opts, :stalled_interval, 30_000)
    max_stalled_count = Keyword.get(opts, :max_stalled_count, 1)

    state = %__MODULE__{
      connection: connection,
      queue: queue,
      prefix: prefix,
      stalled_interval: stalled_interval,
      max_stalled_count: max_stalled_count
    }

    # Start checking after a delay to allow workers to start
    timer_ref = Process.send_after(self(), :check_stalled, stalled_interval)

    {:ok, %{state | timer_ref: timer_ref}}
  end

  @impl true
  def handle_info(:check_stalled, state) do
    backend = Backend.create(state.queue, connection: state.connection, prefix: state.prefix)

    case Backend.check_stalled_jobs(backend, state.max_stalled_count) do
      {:ok, result} ->
        if result.recovered > 0 or result.failed > 0 do
          Logger.info(
            "[BullMQ] Stalled check for #{state.queue}: " <>
              "recovered=#{result.recovered}, failed=#{result.failed}"
          )
        end

      {:error, reason} ->
        Logger.warning("[BullMQ] Stalled check failed for #{state.queue}: #{inspect(reason)}")
    end

    # Schedule next check
    timer_ref = Process.send_after(self(), :check_stalled, state.stalled_interval)
    {:noreply, %{state | timer_ref: timer_ref}}
  end

  @impl true
  def terminate(_reason, state) do
    if state.timer_ref do
      Process.cancel_timer(state.timer_ref)
    end

    :ok
  end
end
