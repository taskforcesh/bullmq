defmodule BullMQ.LockManager do
  @moduledoc """
  Manages lock renewal for BullMQ workers.

  Instead of creating a timer for each active job, LockManager uses a single timer
  that periodically checks all tracked jobs and extends locks for those that are
  about to expire. This is much more efficient when processing many concurrent jobs.

  The lock manager:
  - Runs a single timer every `lock_renew_time / 2` milliseconds
  - Tracks all active jobs with their tokens and timestamps
  - Extends locks in batch for all jobs whose locks are expiring
  - Emits events when lock renewal fails
  """

  use GenServer
  require Logger

  alias BullMQ.Scripts

  @type job_info :: %{
          token: String.t(),
          ts: non_neg_integer()
        }

  @type state :: %{
          connection: atom(),
          keys: map(),
          lock_duration: non_neg_integer(),
          lock_renew_time: non_neg_integer(),
          tracked_jobs: %{String.t() => job_info()},
          timer_ref: reference() | nil,
          closed: boolean(),
          on_lock_renewal_failed: function() | nil,
          on_locks_renewed: function() | nil
        }

  # Client API

  @doc """
  Starts the lock manager.

  ## Options

    * `:connection` - The Redis connection name (required)
    * `:keys` - Queue keys context (required)
    * `:lock_duration` - Lock duration in milliseconds (default: 30000)
    * `:lock_renew_time` - Time between lock renewal checks (default: lock_duration / 2)
    * `:on_lock_renewal_failed` - Callback when lock renewal fails for jobs
    * `:on_locks_renewed` - Callback when locks are successfully renewed

  """
  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  @doc """
  Starts tracking a job for lock renewal.
  """
  @spec track_job(pid(), String.t(), String.t()) :: :ok
  def track_job(manager, job_id, token) do
    GenServer.cast(manager, {:track_job, job_id, token})
  end

  @doc """
  Stops tracking a job (call when job completes or fails).
  """
  @spec untrack_job(pid(), String.t()) :: :ok
  def untrack_job(manager, job_id) do
    GenServer.cast(manager, {:untrack_job, job_id})
  end

  @doc """
  Gets the number of jobs currently being tracked.
  """
  @spec get_active_job_count(pid()) :: non_neg_integer()
  def get_active_job_count(manager) do
    GenServer.call(manager, :get_active_job_count)
  end

  @doc """
  Gets a list of all tracked job IDs.
  """
  @spec get_tracked_job_ids(pid()) :: [String.t()]
  def get_tracked_job_ids(manager) do
    GenServer.call(manager, :get_tracked_job_ids)
  end

  @doc """
  Checks if a specific job is being tracked.
  """
  @spec is_tracked?(pid(), String.t()) :: boolean()
  def is_tracked?(manager, job_id) do
    GenServer.call(manager, {:is_tracked, job_id})
  end

  @doc """
  Stops the lock manager.
  """
  @spec stop(pid()) :: :ok
  def stop(manager) do
    try do
      GenServer.stop(manager)
    catch
      :exit, _ -> :ok
    end
  end

  # Server callbacks

  @impl true
  def init(opts) do
    connection = Keyword.fetch!(opts, :connection)
    keys = Keyword.fetch!(opts, :keys)
    lock_duration = Keyword.get(opts, :lock_duration, 30_000)
    lock_renew_time = Keyword.get(opts, :lock_renew_time, div(lock_duration, 2))

    state = %{
      connection: connection,
      keys: keys,
      lock_duration: lock_duration,
      lock_renew_time: lock_renew_time,
      tracked_jobs: %{},
      timer_ref: nil,
      closed: false,
      on_lock_renewal_failed: Keyword.get(opts, :on_lock_renewal_failed),
      on_locks_renewed: Keyword.get(opts, :on_locks_renewed)
    }

    # Start the renewal timer
    timer_ref = schedule_renewal(lock_renew_time)

    {:ok, %{state | timer_ref: timer_ref}}
  end

  @impl true
  def handle_cast({:track_job, job_id, token}, state) do
    if state.closed do
      {:noreply, state}
    else
      job_info = %{token: token, ts: System.system_time(:millisecond)}
      tracked_jobs = Map.put(state.tracked_jobs, job_id, job_info)
      {:noreply, %{state | tracked_jobs: tracked_jobs}}
    end
  end

  def handle_cast({:untrack_job, job_id}, state) do
    tracked_jobs = Map.delete(state.tracked_jobs, job_id)
    {:noreply, %{state | tracked_jobs: tracked_jobs}}
  end

  @impl true
  def handle_call(:get_active_job_count, _from, state) do
    {:reply, map_size(state.tracked_jobs), state}
  end

  def handle_call(:get_tracked_job_ids, _from, state) do
    {:reply, Map.keys(state.tracked_jobs), state}
  end

  def handle_call({:is_tracked, job_id}, _from, state) do
    {:reply, Map.has_key?(state.tracked_jobs, job_id), state}
  end

  @impl true
  def handle_info(:extend_locks, state) do
    if state.closed do
      {:noreply, state}
    else
      now = System.system_time(:millisecond)
      threshold = div(state.lock_renew_time, 2)

      # Find jobs whose locks need extension (older than threshold)
      {jobs_to_extend, updated_tracked} =
        Enum.reduce(state.tracked_jobs, {[], %{}}, fn {job_id, info}, {to_extend, tracked} ->
          if info.ts + threshold < now do
            # This job needs lock extension
            updated_info = %{info | ts: now}
            {[{job_id, info.token} | to_extend], Map.put(tracked, job_id, updated_info)}
          else
            # Job lock is still fresh
            {to_extend, Map.put(tracked, job_id, info)}
          end
        end)

      # Extend locks if there are jobs to process
      new_state =
        if length(jobs_to_extend) > 0 do
          extend_locks(jobs_to_extend, %{state | tracked_jobs: updated_tracked})
        else
          %{state | tracked_jobs: updated_tracked}
        end

      # Schedule next renewal
      timer_ref = schedule_renewal(state.lock_renew_time)
      {:noreply, %{new_state | timer_ref: timer_ref}}
    end
  end

  def handle_info(_msg, state) do
    {:noreply, state}
  end

  @impl true
  def terminate(_reason, state) do
    if state.timer_ref do
      Process.cancel_timer(state.timer_ref)
    end

    :ok
  end

  # Private functions

  defp schedule_renewal(lock_renew_time) do
    # Fire every lock_renew_time / 2
    interval = div(lock_renew_time, 2)
    Process.send_after(self(), :extend_locks, interval)
  end

  defp extend_locks(jobs_to_extend, state) do
    job_ids = Enum.map(jobs_to_extend, fn {id, _token} -> id end)
    tokens = Enum.map(jobs_to_extend, fn {_id, token} -> token end)

    case Scripts.extend_locks(state.connection, state.keys, job_ids, tokens, state.lock_duration) do
      {:ok, failed_job_ids} when is_list(failed_job_ids) ->
        # Script returns a list of job IDs that failed (empty list = all succeeded)
        failed_ids = Enum.map(failed_job_ids, &to_string/1)
        succeeded_ids = job_ids -- failed_ids

        # Update state with failed jobs removed
        updated_state =
          if length(failed_ids) > 0 do
            emit_callback(state.on_lock_renewal_failed, [failed_ids])

            # Untrack failed jobs (lock was lost)
            Enum.each(failed_ids, fn job_id ->
              Logger.warning("[BullMQ.LockManager] Lost lock for job #{job_id}")
            end)

            tracked_jobs = Enum.reduce(failed_ids, state.tracked_jobs, &Map.delete(&2, &1))
            %{state | tracked_jobs: tracked_jobs}
          else
            state
          end

        if length(succeeded_ids) > 0 do
          emit_callback(state.on_locks_renewed, [succeeded_ids])
        end

        updated_state

      {:ok, _} ->
        # Unexpected result format
        state

      {:error, reason} ->
        Logger.error("[BullMQ.LockManager] Error extending locks: #{inspect(reason)}")
        state
    end
  end

  defp emit_callback(nil, _args), do: :ok

  defp emit_callback(callback, args) when is_function(callback) do
    try do
      apply(callback, args)
    rescue
      e ->
        Logger.warning("[BullMQ.LockManager] Callback failed: #{Exception.message(e)}")
    end

    :ok
  end
end
