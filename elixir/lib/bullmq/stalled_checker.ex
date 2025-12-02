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

  alias BullMQ.{Keys, RedisConnection, Scripts, Telemetry}

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
    ctx = Keys.context(prefix, queue)

    do_check(connection, ctx, max_stalled_count)
  end

  @doc """
  Checks if a specific job is stalled.
  """
  @spec job_stalled?(atom(), String.t(), String.t(), Keyword.t()) :: {:ok, boolean()} | {:error, term()}
  def job_stalled?(connection, queue, job_id, opts \\ []) do
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.context(prefix, queue)
    lock_key = Keys.lock(ctx, job_id)

    case RedisConnection.command(connection, ["EXISTS", lock_key]) do
      {:ok, 0} -> {:ok, true}
      {:ok, 1} -> {:ok, false}
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
    ctx = Keys.context(state.prefix, state.queue)

    case do_check(state.connection, ctx, state.max_stalled_count) do
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

  # Private functions

  defp do_check(connection, ctx, max_stalled_count) do
    # Get active jobs
    case RedisConnection.command(connection, ["LRANGE", Keys.active(ctx), 0, -1]) do
      {:ok, []} ->
        {:ok, %{recovered: 0, failed: 0}}

      {:ok, job_ids} ->
        # Check which jobs are stalled (no valid lock)
        check_jobs_stalled(connection, ctx, job_ids, max_stalled_count)

      {:error, _} = error ->
        error
    end
  end

  defp check_jobs_stalled(connection, ctx, job_ids, max_stalled_count) do
    # Build commands to check all locks
    lock_commands =
      Enum.map(job_ids, fn job_id ->
        ["EXISTS", Keys.lock(ctx, job_id)]
      end)

    case RedisConnection.pipeline(connection, lock_commands) do
      {:ok, results} ->
        # Find stalled jobs (lock doesn't exist)
        stalled_jobs =
          Enum.zip(job_ids, results)
          |> Enum.filter(fn {_id, exists} -> exists == 0 end)
          |> Enum.map(fn {id, _} -> id end)

        if Enum.empty?(stalled_jobs) do
          {:ok, %{recovered: 0, failed: 0}}
        else
          move_stalled_jobs(connection, ctx, stalled_jobs, max_stalled_count)
        end

      {:error, _} = error ->
        error
    end
  end

  defp move_stalled_jobs(connection, ctx, stalled_jobs, max_stalled_count) do
    # Use Lua script to atomically move stalled jobs
    {script, _key_count} = Scripts.get(:move_stalled_jobs_to_wait)

    keys = [
      Keys.stalled(ctx),
      Keys.wait(ctx),
      Keys.active(ctx),
      Keys.failed(ctx),
      Keys.key(ctx),
      Keys.meta(ctx),
      Keys.events(ctx),
      Keys.marker(ctx)
    ]

    args = [
      max_stalled_count,
      System.system_time(:millisecond),
      Enum.count(stalled_jobs),
      Enum.join(stalled_jobs, " ")
    ]

    case Scripts.execute_raw(connection, script, keys, args) do
      {:ok, [recovered, failed]} ->
        # Emit telemetry events
        if recovered > 0 do
          Telemetry.emit(:stalled_recovered, %{count: recovered}, %{
            queue: ctx.name,
            prefix: ctx.prefix
          })
        end

        if failed > 0 do
          Telemetry.emit(:stalled_failed, %{count: failed}, %{
            queue: ctx.name,
            prefix: ctx.prefix
          })
        end

        {:ok, %{recovered: recovered, failed: failed}}

      {:ok, result} ->
        # Handle different response formats
        {:ok, %{recovered: result, failed: 0}}

      {:error, _} = error ->
        error
    end
  end
end
