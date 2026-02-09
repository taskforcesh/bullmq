defmodule BullMQ.Worker do
  @moduledoc """
  Worker process for processing BullMQ jobs.

  A Worker is responsible for fetching jobs from a queue and processing them.
  It supports configurable concurrency, automatic retries, rate limiting,
  and stalled job detection.

  ## Usage

  Add a worker to your supervision tree:

      children = [
        {BullMQ.RedisConnection, name: :redis, url: "redis://localhost:6379"},
        {BullMQ.Worker,
          name: :my_worker,
          queue: "my_queue",
          connection: :redis,
          processor: &MyApp.Jobs.process/1,
          concurrency: 10}
      ]

  ## Processor Function

  The processor function receives a `BullMQ.Job` struct and should return:

    * `{:ok, result}` - Job completed successfully with result
    * `:ok` - Job completed successfully (no return value)
    * `{:error, reason}` - Job failed with reason
    * `{:delay, milliseconds}` - Delay job and retry later (does not increment attempts)
    * `{:rate_limit, milliseconds}` - Move job to delayed due to rate limiting
    * `:waiting` - Move job back to waiting queue
    * `:waiting_children` - Move job to waiting-children state (waits for child jobs)

  ## Examples

      defmodule MyApp.Jobs do
        def process(%BullMQ.Job{name: "email", data: data}) do
          case send_email(data) do
            :ok -> {:ok, %{sent: true}}
            {:error, reason} -> {:error, reason}
          end
        end

        def process(%BullMQ.Job{name: "heavy_task", data: data} = job) do
          # Update progress
          BullMQ.Worker.update_progress(job, 0)

          result = do_work(data)

          BullMQ.Worker.update_progress(job, 100)
          {:ok, result}
        end
      end

  ## Options

    * `:name` - Process name for registration (atom)
    * `:queue` - Queue name to process (required, string)
    * `:connection` - Redis connection name or pid (required)
    * `:processor` - Job processor function (required). Set to `nil` with `autorun: false` for manual processing
    * `:prefix` - Redis key prefix (default: "bull")
    * `:concurrency` - Max concurrent jobs (default: 1)
    * `:lock_duration` - Job lock TTL in ms (default: 30000)
    * `:stalled_interval` - Stalled check interval in ms (default: 30000)
    * `:max_stalled_count` - Max stalls before failure (default: 1)
    * `:limiter` - Rate limiter config `%{max: n, duration: ms}`
    * `:autorun` - Start processing immediately (default: true)

  ### Event Callbacks

    * `:on_completed` - `fn job, result -> ... end` when a job completes
    * `:on_failed` - `fn job, reason -> ... end` when a job fails
    * `:on_error` - `fn error -> ... end` for worker errors
    * `:on_active` - `fn job -> ... end` when a job becomes active
    * `:on_progress` - `fn job, progress -> ... end` on progress updates
    * `:on_stalled` - `fn job_id -> ... end` when a job stalls

  ## Concurrency

  Unlike Node.js which uses a single thread with async operations, Elixir
  workers use true parallelism with multiple processes. Each concurrent
  job runs in its own process under the worker's supervision.
  """

  use GenServer

  alias BullMQ.{CancellationToken, Job, Keys, LockManager, RedisConnection, Scripts, Types}

  require Logger

  @default_lock_duration 30_000
  @default_stalled_interval 30_000
  @default_max_stalled_count 1
  @default_concurrency 1
  @default_drain_delay 5
  @minimum_block_timeout 0.001
  @maximum_block_timeout 10.0

  @opts_schema NimbleOptions.new!(
                 name: [
                   type: {:or, [:atom, nil]},
                   doc: "Process name for registration."
                 ],
                 queue: [
                   type: :string,
                   required: true,
                   doc: "The name of the queue to process jobs from."
                 ],
                 connection: [
                   type: {:or, [:atom, :pid]},
                   required: true,
                   doc: "The Redis connection name or pid."
                 ],
                 processor: [
                   type: {:or, [{:fun, 1}, {:fun, 2}, {:fun, 3}, nil]},
                   doc:
                     "Function to process jobs. Set to `nil` for manual processing with `autorun: false`."
                 ],
                 prefix: [
                   type: :string,
                   default: "bull",
                   doc: "Prefix for all Redis keys."
                 ],
                 concurrency: [
                   type: :pos_integer,
                   default: @default_concurrency,
                   doc: "Number of jobs to process concurrently."
                 ],
                 lock_duration: [
                   type: :pos_integer,
                   default: @default_lock_duration,
                   doc: "Time in ms before a job lock expires."
                 ],
                 stalled_interval: [
                   type: :pos_integer,
                   default: @default_stalled_interval,
                   doc: "Interval in ms to check for stalled jobs."
                 ],
                 max_stalled_count: [
                   type: :pos_integer,
                   default: @default_max_stalled_count,
                   doc: "Max times a job can stall before being moved to failed."
                 ],
                 limiter: [
                   type: :map,
                   doc: "Rate limiting configuration with `:max` and `:duration` keys."
                 ],
                 autorun: [
                   type: :boolean,
                   default: true,
                   doc: "Whether to start processing jobs automatically."
                 ],
                 drain_delay: [
                   type: {:or, [:pos_integer, :float]},
                   default: @default_drain_delay,
                   doc: "Timeout in seconds for blocking wait when queue is empty (default: 5s)."
                 ],
                 remove_on_complete: [
                   type: {:or, [:boolean, :pos_integer, :map]},
                   doc:
                     "Auto-removal configuration for completed jobs. Can be boolean, integer (count), or map with age/count/limit keys."
                 ],
                 remove_on_fail: [
                   type: {:or, [:boolean, :pos_integer, :map]},
                   doc:
                     "Auto-removal configuration for failed jobs. Can be boolean, integer (count), or map with age/count/limit keys."
                 ],
                 # Event callbacks
                 on_completed: [
                   type: {:or, [{:fun, 2}, nil]},
                   doc: "Callback when a job completes."
                 ],
                 on_failed: [
                   type: {:or, [{:fun, 2}, nil]},
                   doc: "Callback when a job fails."
                 ],
                 on_error: [
                   type: {:or, [{:fun, 1}, nil]},
                   doc: "Callback for worker errors."
                 ],
                 on_active: [
                   type: {:or, [{:fun, 1}, nil]},
                   doc: "Callback when a job becomes active."
                 ],
                 on_progress: [
                   type: {:or, [{:fun, 2}, nil]},
                   doc: "Callback on job progress updates."
                 ],
                 on_stalled: [
                   type: {:or, [{:fun, 1}, nil]},
                   doc: "Callback when a job stalls."
                 ],
                 on_lock_renewal_failed: [
                   type: {:or, [{:fun, 1}, nil]},
                   doc: """
                   Callback when lock renewal fails for jobs. Receives a list of job IDs.
                   When lock renewal fails, affected jobs are automatically cancelled with
                   reason `{:lock_lost, job_id}` to prevent duplicate processing.
                   """
                 ],
                 telemetry: [
                   type: :atom,
                   default: nil,
                   doc:
                     "Module implementing `BullMQ.Telemetry.Behaviour` for distributed tracing (e.g., `BullMQ.Telemetry.OpenTelemetry`)."
                 ]
               )

  @type processor ::
          (Job.t() -> {:ok, term()} | :ok | {:error, term()} | {:delay, non_neg_integer()})
          | (Job.t(), String.t() ->
               {:ok, term()} | :ok | {:error, term()} | {:delay, non_neg_integer()})
          | (Job.t(), String.t(), BullMQ.CancellationToken.t() ->
               {:ok, term()} | :ok | {:error, term()} | {:delay, non_neg_integer()})

  @type t :: %__MODULE__{
          name: atom() | nil,
          queue_name: String.t(),
          connection: Types.redis_connection(),
          processor: processor(),
          processor_supports_cancellation: boolean(),
          prefix: String.t(),
          concurrency: pos_integer(),
          lock_duration: pos_integer(),
          stalled_interval: pos_integer(),
          max_stalled_count: non_neg_integer(),
          drain_delay: number(),
          block_until: non_neg_integer() | nil,
          limiter: map() | nil,
          running: boolean(),
          paused: boolean(),
          closing: boolean(),
          active_jobs: map(),
          cancellation_tokens: map(),
          keys: Keys.queue_context(),
          token: String.t(),
          blocking_conn: pid() | nil,
          client_name_telemetry_id: term() | nil,
          stalled_timer: reference() | nil,
          lock_manager: pid() | nil,
          opts: map(),
          telemetry: module() | nil,
          remove_on_complete: term() | nil,
          remove_on_fail: term() | nil,
          # Event callbacks (like Node.js worker.on('completed', ...))
          on_completed: (Job.t(), term() -> any()) | nil,
          on_failed: (Job.t(), String.t() -> any()) | nil,
          on_error: (term() -> any()) | nil,
          on_active: (Job.t() -> any()) | nil,
          on_progress: (Job.t(), term() -> any()) | nil,
          on_stalled: (String.t() -> any()) | nil,
          on_lock_renewal_failed: ([String.t()] -> any()) | nil
        }

  defstruct [
    :name,
    :queue_name,
    :connection,
    :processor,
    :keys,
    :blocking_conn,
    :client_name_telemetry_id,
    :stalled_timer,
    :lock_manager,
    :on_completed,
    :on_failed,
    :on_error,
    :on_active,
    :on_progress,
    :on_stalled,
    :on_lock_renewal_failed,
    :telemetry,
    :remove_on_complete,
    :remove_on_fail,
    prefix: "bull",
    concurrency: @default_concurrency,
    lock_duration: @default_lock_duration,
    stalled_interval: @default_stalled_interval,
    max_stalled_count: @default_max_stalled_count,
    limiter: nil,
    running: false,
    paused: false,
    closing: false,
    active_jobs: %{},
    worker_pids: %{},
    cancellation_tokens: %{},
    processor_supports_cancellation: false,
    # Track if we're currently doing a blocking wait for jobs
    waiting_for_jobs: false,
    token: "",
    opts: %{},
    drain_delay: @default_drain_delay,
    # Timestamp (ms) of next delayed job, used for calculating block timeout
    block_until: nil
  ]

  # Client API

  @doc """
  Starts a worker process.

  ## Options

    * `:name` - Process name for registration
    * `:queue` - Queue name (required)
    * `:connection` - Redis connection (required)
    * `:processor` - Processor function (required)
    * `:concurrency` - Max concurrent jobs (default: 1)
    * `:lock_duration` - Lock TTL in ms (default: 30000)
    * `:stalled_interval` - Stalled check interval (default: 30000)
    * `:max_stalled_count` - Max stalls before failure (default: 1)
    * `:limiter` - Rate limiter config
    * `:autorun` - Start processing immediately (default: true)
    * `:prefix` - Queue prefix (default: "bull")
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
  Pauses the worker.

  When paused, the worker will not pick up new jobs but will continue
  processing active jobs until completion.

  ## Options

    * `:force` - Don't wait for active jobs to complete (default: false)
  """
  @spec pause(GenServer.server(), keyword()) :: :ok
  def pause(worker, opts \\ []) do
    GenServer.call(worker, {:pause, opts})
  end

  @doc """
  Resumes a paused worker.
  """
  @spec resume(GenServer.server()) :: :ok
  def resume(worker) do
    GenServer.call(worker, :resume)
  end

  @doc """
  Checks if the worker is paused.
  """
  @spec paused?(GenServer.server()) :: boolean()
  def paused?(worker) do
    GenServer.call(worker, :paused?)
  end

  @doc """
  Checks if the worker is running (processing jobs).
  """
  @spec running?(GenServer.server()) :: boolean()
  def running?(worker) do
    GenServer.call(worker, :running?)
  end

  @doc """
  Gets the count of currently active jobs.
  """
  @spec active_count(GenServer.server()) :: non_neg_integer()
  def active_count(worker) do
    GenServer.call(worker, :active_count)
  end

  @doc """
  Cancels a specific job currently being processed by this worker.

  The job's processor function can detect cancellation by:
  - Checking `BullMQ.CancellationToken.cancelled?(cancel_token)`
  - Subscribing with `BullMQ.CancellationToken.subscribe(cancel_token)`

  ## Parameters

    * `worker` - The worker process
    * `job_id` - The ID of the job to cancel
    * `reason` - Optional reason for the cancellation (default: nil)

  ## Returns

    * `true` if the job was found and cancelled
    * `false` if the job was not found (not active)

  ## Example

      BullMQ.Worker.cancel_job(worker, "job-123", "User requested cancellation")
  """
  @spec cancel_job(GenServer.server(), String.t(), BullMQ.CancellationToken.reason()) :: boolean()
  def cancel_job(worker, job_id, reason \\ nil) do
    GenServer.call(worker, {:cancel_job, job_id, reason})
  end

  @doc """
  Cancels all jobs currently being processed by this worker.

  All active job processor functions will be notified of cancellation.

  ## Parameters

    * `worker` - The worker process
    * `reason` - Optional reason for the cancellation (default: nil)

  ## Example

      BullMQ.Worker.cancel_all_jobs(worker, "System shutdown")
  """
  @spec cancel_all_jobs(GenServer.server(), BullMQ.CancellationToken.reason()) :: :ok
  def cancel_all_jobs(worker, reason \\ nil) do
    GenServer.call(worker, {:cancel_all_jobs, reason})
  end

  @doc """
  Gets a list of all active job IDs.
  """
  @spec active_job_ids(GenServer.server()) :: [String.t()]
  def active_job_ids(worker) do
    GenServer.call(worker, :active_job_ids)
  end

  # ============================================
  # Manual Job Processing API
  # ============================================
  # These methods support manual job fetching and processing,
  # similar to Node.js worker.getNextJob() pattern.

  @doc """
  Manually fetches the next job from the queue.

  This is used for manual job processing where you want to control the
  job lifecycle yourself instead of using automatic worker processing.

  When processing jobs manually:
  1. Create a worker without a processor (set `autorun: false`)
  2. Call `get_next_job/2` to fetch jobs
  3. Process the job
  4. Call `Job.move_to_completed/4` or `Job.move_to_failed/4`
  5. Optionally call `start_stalled_check_timer/1` to handle stalled jobs

  ## Parameters

    * `worker` - The worker process
    * `token` - A unique token representing this worker's ownership of the job

  ## Options

    * `:block` - If `true` (default), uses `BZPOPMIN` to efficiently wait for a job.
                 If `false`, returns immediately with `nil` if no job is available.
    * `:timeout` - Timeout in seconds for blocking wait (default: 5). Only used when
                   `block: true`. After timeout, returns `{:ok, nil}`.

  ## Returns

    * `{:ok, job}` - A job was fetched successfully
    * `{:ok, nil}` - No job available (timeout or `block: false`) or worker is paused/closing
    * `{:error, reason}` - An error occurred

  ## Blocking Behavior

  When `block: true` (the default), this function uses Redis's `BZPOPMIN` command
  to efficiently wait for jobs without polling. This is the same mechanism used
  by Node.js BullMQ. The function will:

  1. First try to fetch a job immediately
  2. If no job is available, wait using `BZPOPMIN` on the marker key
  3. When a job becomes available (marker is set), fetch and return it
  4. If timeout is reached, return `{:ok, nil}`

  ## Token

  The token represents ownership of the job's lock. Use a unique value (like a UUID)
  for each job. The same token must be passed to `Job.move_to_completed/4`,
  `Job.move_to_failed/4`, or `Job.extend_lock/3`.

  ## Example

      # Create a worker without automatic processing
      {:ok, worker} = Worker.start_link(
        queue: "my-queue",
        connection: :redis,
        processor: nil,
        autorun: false
      )

      # Start stalled job checker
      :ok = Worker.start_stalled_check_timer(worker)

      # Processing loop - blocks up to 10 seconds waiting for jobs
      token = UUID.uuid4()

      case Worker.get_next_job(worker, token, timeout: 10) do
        {:ok, nil} ->
          # Timeout - no job available
          :ok

        {:ok, job} ->
          # Process the job
          case do_work(job.data) do
            {:ok, result} ->
              Job.move_to_completed(job, result, token)
            {:error, reason} ->
              Job.move_to_failed(job, reason, token)
          end
      end

      # Non-blocking fetch
      case Worker.get_next_job(worker, token, block: false) do
        {:ok, nil} -> :no_job
        {:ok, job} -> process(job)
      end
  """
  @spec get_next_job(GenServer.server(), String.t(), keyword()) ::
          {:ok, Job.t() | nil} | {:error, term()}
  def get_next_job(worker, token, opts \\ []) do
    GenServer.call(worker, {:get_next_job, token, opts}, :infinity)
  end

  @doc """
  Starts the stalled jobs checker timer.

  When processing jobs manually, you should start this timer to ensure
  stalled jobs (whose locks have expired) are moved back to the waiting
  state or failed (if they've exceeded max stalled count).

  The checker runs periodically based on the worker's `stalled_interval` option.

  ## Example

      {:ok, worker} = Worker.start_link(
        queue: "my-queue",
        connection: :redis,
        processor: nil,
        autorun: false,
        stalled_interval: 30_000
      )

      :ok = Worker.start_stalled_check_timer(worker)
  """
  @spec start_stalled_check_timer(GenServer.server()) :: :ok
  def start_stalled_check_timer(worker) do
    GenServer.call(worker, :start_stalled_check_timer)
  end

  @doc """
  Stops the stalled jobs checker timer.

  ## Example

      :ok = Worker.stop_stalled_check_timer(worker)
  """
  @spec stop_stalled_check_timer(GenServer.server()) :: :ok
  def stop_stalled_check_timer(worker) do
    GenServer.call(worker, :stop_stalled_check_timer)
  end

  @doc """
  Closes the worker gracefully.

  ## Options

    * `:force` - Don't wait for active jobs (default: false)
    * `:timeout` - Max wait time in ms (default: 30000)
  """
  @spec close(GenServer.server(), keyword()) :: :ok
  def close(worker, opts \\ []) do
    GenServer.call(worker, {:close, opts}, Keyword.get(opts, :timeout, 30_000) + 5_000)
  end

  @doc """
  Updates the progress of a job being processed.

  Can only be called from within the processor function.
  This updates the progress in Redis and emits a progress event that can be
  received by `QueueEvents` subscribers and triggers the worker's `on_progress` callback.
  """
  @spec update_progress(Job.t(), Types.job_progress()) :: :ok | {:error, term()}
  def update_progress(%Job{} = job, progress) do
    ctx = Keys.new(job.queue_name, prefix: job.prefix)

    # Update progress in Redis (also emits to Redis Streams for QueueEvents)
    case Scripts.update_progress(job.connection, ctx, job.id, progress) do
      {:ok, _} ->
        # Notify the worker to trigger on_progress callback
        if job.worker && Process.alive?(job.worker) do
          GenServer.cast(job.worker, {:progress, job, progress})
        end

        :ok

      {:error, _} = error ->
        error
    end
  rescue
    e -> {:error, e}
  end

  @doc """
  Adds a log entry to a job.

  Can be called from within the processor function.

  Note: Consider using `Job.log/3` instead, which provides the same functionality
  with additional options.
  """
  @spec log(Job.t(), String.t()) :: :ok | {:error, term()}
  def log(%Job{} = job, message) do
    ctx = Keys.new(job.queue_name, prefix: job.prefix)
    keep_logs = get_in(job.opts, [:keep_logs])
    Scripts.add_log(job.connection, ctx, job.id, message, keep_logs)
    :ok
  rescue
    e -> {:error, e}
  end

  @doc """
  Updates the data of a job.

  Can be called from within the processor function.
  """
  @spec update_data(Job.t(), term()) :: :ok | {:error, term()}
  def update_data(%Job{} = job, data) do
    ctx = Keys.new(job.queue_name, prefix: job.prefix)
    Scripts.update_data(job.connection, ctx, job.id, data)
    :ok
  rescue
    e -> {:error, e}
  end

  # GenServer callbacks

  @impl true
  def init(opts) do
    # Validate options using NimbleOptions schema
    opts = NimbleOptions.validate!(opts, @opts_schema)

    Process.flag(:trap_exit, true)

    queue_name = Keyword.fetch!(opts, :queue)
    connection = Keyword.fetch!(opts, :connection)
    processor = Keyword.get(opts, :processor)
    prefix = Keyword.get(opts, :prefix, "bull")
    autorun = Keyword.get(opts, :autorun, true)

    # Check processor arity once at init - skip cancellation overhead for arity-1 processors
    supports_cancellation = processor_supports_cancellation?(processor)

    state = %__MODULE__{
      name: Keyword.get(opts, :name),
      queue_name: queue_name,
      connection: connection,
      processor: processor,
      processor_supports_cancellation: supports_cancellation,
      prefix: prefix,
      concurrency: Keyword.get(opts, :concurrency, @default_concurrency),
      lock_duration: Keyword.get(opts, :lock_duration, @default_lock_duration),
      stalled_interval: Keyword.get(opts, :stalled_interval, @default_stalled_interval),
      max_stalled_count: Keyword.get(opts, :max_stalled_count, @default_max_stalled_count),
      drain_delay: Keyword.get(opts, :drain_delay, @default_drain_delay),
      limiter: Keyword.get(opts, :limiter),
      keys: Keys.new(queue_name, prefix: prefix),
      token: generate_token(),
      opts: Map.new(opts),
      telemetry: Keyword.get(opts, :telemetry),
      remove_on_complete: Keyword.get(opts, :remove_on_complete),
      remove_on_fail: Keyword.get(opts, :remove_on_fail),
      client_name_telemetry_id: nil,
      # Event callbacks
      on_completed: Keyword.get(opts, :on_completed),
      on_failed: Keyword.get(opts, :on_failed),
      on_error: Keyword.get(opts, :on_error),
      on_active: Keyword.get(opts, :on_active),
      on_progress: Keyword.get(opts, :on_progress),
      on_stalled: Keyword.get(opts, :on_stalled),
      on_lock_renewal_failed: Keyword.get(opts, :on_lock_renewal_failed)
    }

    if autorun do
      send(self(), :start)
    end

    {:ok, state}
  end

  @impl true
  def handle_call({:pause, _opts}, _from, state) do
    {:reply, :ok, %{state | paused: true}}
  end

  def handle_call(:resume, _from, %{paused: true} = state) do
    send(self(), :fetch_jobs)
    {:reply, :ok, %{state | paused: false}}
  end

  def handle_call(:resume, _from, state) do
    {:reply, :ok, state}
  end

  def handle_call(:paused?, _from, state) do
    {:reply, state.paused, state}
  end

  def handle_call(:running?, _from, state) do
    {:reply, state.running, state}
  end

  def handle_call(:active_count, _from, state) do
    {:reply, map_size(state.active_jobs), state}
  end

  def handle_call(:active_job_ids, _from, state) do
    {:reply, Map.keys(state.active_jobs), state}
  end

  # ============================================
  # Manual Job Processing Handlers
  # ============================================

  def handle_call({:get_next_job, token, opts}, _from, state) do
    if state.paused or state.closing do
      {:reply, {:ok, nil}, state}
    else
      block = Keyword.get(opts, :block, true)
      # Default 5 second timeout for blocking
      timeout = Keyword.get(opts, :timeout, 5)

      # First try to get a job without blocking
      case fetch_next_job_with_token(state, token) do
        {:ok, nil} when block ->
          # No job available, wait for one using BZPOPMIN on marker
          case wait_for_job(state, timeout) do
            :job_available ->
              # A job became available, try to fetch it
              result = fetch_next_job_with_token(state, token)
              {:reply, result, state}

            :timeout ->
              # Timed out waiting, return nil
              {:reply, {:ok, nil}, state}

            {:error, _} = error ->
              {:reply, error, state}
          end

        result ->
          # Got a job or non-blocking mode returned nil
          {:reply, result, state}
      end
    end
  end

  def handle_call(:start_stalled_check_timer, _from, state) do
    # Cancel existing timer if any
    if state.stalled_timer do
      Process.cancel_timer(state.stalled_timer)
    end

    # Start new timer
    timer = schedule_stalled_check(state.stalled_interval)
    {:reply, :ok, %{state | stalled_timer: timer}}
  end

  def handle_call(:stop_stalled_check_timer, _from, state) do
    if state.stalled_timer do
      Process.cancel_timer(state.stalled_timer)
    end

    {:reply, :ok, %{state | stalled_timer: nil}}
  end

  def handle_call({:cancel_job, job_id, reason}, _from, state) do
    case Map.get(state.cancellation_tokens, job_id) do
      nil ->
        {:reply, {:error, :not_found}, state}

      {token, task_pid} ->
        CancellationToken.cancel(task_pid, token, reason)
        {:reply, :ok, state}
    end
  end

  def handle_call({:cancel_all_jobs, reason}, _from, state) do
    Enum.each(state.cancellation_tokens, fn {_job_id, {token, task_pid}} ->
      CancellationToken.cancel(task_pid, token, reason)
    end)

    {:reply, :ok, state}
  end

  def handle_call({:close, opts}, from, state) do
    force = Keyword.get(opts, :force, false)
    timeout = Keyword.get(opts, :timeout, 30_000)

    new_state = %{state | closing: true, paused: true}

    if force or map_size(state.active_jobs) == 0 do
      cleanup(new_state)
      {:stop, :normal, :ok, new_state}
    else
      # Wait for active jobs with timeout
      Process.send_after(self(), {:close_timeout, from}, timeout)
      {:noreply, %{new_state | closing: from}}
    end
  end

  @impl true
  def handle_cast({:progress, job, progress}, state) do
    # Call the on_progress callback if configured
    if state.on_progress do
      try do
        state.on_progress.(job, progress)
      rescue
        e ->
          Logger.warning("on_progress callback failed: #{inspect(e)}")
      end
    end

    {:noreply, state}
  end

  @impl true
  def handle_info(:start, state) do
    # Create blocking connection for BRPOPLPUSH
    case RedisConnection.blocking_connection(state.connection) do
      {:ok, blocking_conn} ->
        set_worker_client_name(blocking_conn, state)
        client_name_telemetry_id = attach_worker_client_name_handler(blocking_conn, state)
        # Start stalled job checker
        stalled_timer = schedule_stalled_check(state.stalled_interval)

        # Start lock manager (single timer for all jobs)
        # Link it to this process - if LockManager crashes, Worker crashes too
        # and gets restarted by its supervisor
        worker_pid = self()

        {:ok, lock_manager} =
          LockManager.start_link(
            connection: state.connection,
            keys: state.keys,
            lock_duration: state.lock_duration,
            on_lock_renewal_failed: fn failed_job_ids ->
              # Cancel jobs whose locks failed to renew
              send(worker_pid, {:cancel_jobs_lock_lost, failed_job_ids})
            end
          )

        # Explicitly link so crashes propagate
        Process.link(lock_manager)

        new_state = %{
          state
          | running: true,
            blocking_conn: blocking_conn,
            client_name_telemetry_id: client_name_telemetry_id,
            stalled_timer: stalled_timer,
            lock_manager: lock_manager
        }

        send(self(), :fetch_jobs)
        {:noreply, new_state}

      {:error, reason} ->
        Logger.error("[BullMQ.Worker] Failed to create blocking connection: #{inspect(reason)}")
        # Retry after a delay
        Process.send_after(self(), :start, 5_000)
        {:noreply, state}
    end
  end

  # Handle LockManager crash - let it propagate and restart the worker
  # But ignore normal exits (e.g., when we're shutting down)
  def handle_info({:EXIT, pid, :normal}, state) when pid == state.lock_manager do
    # LockManager stopped normally (e.g., during Worker shutdown), ignore
    {:noreply, %{state | lock_manager: nil}}
  end

  def handle_info({:EXIT, pid, :shutdown}, state) when pid == state.lock_manager do
    # LockManager shutdown gracefully, ignore
    {:noreply, %{state | lock_manager: nil}}
  end

  def handle_info({:EXIT, pid, {:shutdown, _}}, state) when pid == state.lock_manager do
    # LockManager shutdown gracefully with reason, ignore
    {:noreply, %{state | lock_manager: nil}}
  end

  def handle_info({:EXIT, pid, reason}, state) when pid == state.lock_manager do
    Logger.error("[BullMQ.Worker] LockManager crashed: #{inspect(reason)}, restarting worker")
    {:stop, {:lock_manager_crashed, reason}, state}
  end

  def handle_info(:fetch_jobs, %{closing: true} = state) do
    {:noreply, state}
  end

  def handle_info(:fetch_jobs, %{paused: true} = state) do
    {:noreply, state}
  end

  def handle_info(:fetch_jobs, %{waiting_for_jobs: true} = state) do
    # Already waiting for jobs, don't start another blocking wait
    {:noreply, state}
  end

  def handle_info(:fetch_jobs, state) do
    available_slots = state.concurrency - map_size(state.active_jobs)

    if available_slots > 0 do
      # Spawn autonomous worker processes for available slots
      new_state = spawn_worker_processes(state, available_slots)
      {:noreply, new_state}
    else
      {:noreply, state}
    end
  end

  # Handle result from blocking wait for jobs
  def handle_info({:blocking_wait_result, result}, state) do
    new_state = %{state | waiting_for_jobs: false}

    case result do
      {:job_available, block_until} ->
        # Job is available, spawn workers to fetch it
        # Update block_until for next blocking wait calculation
        send(self(), :fetch_jobs)
        {:noreply, %{new_state | block_until: block_until}}

      :job_available ->
        # Legacy format (no block_until info) - just fetch jobs
        send(self(), :fetch_jobs)
        {:noreply, new_state}

      :timeout ->
        # Timeout - spawn workers to check for jobs. This is important because:
        # 1. moveToActive calls promoteDelayedJobs which moves ready delayed jobs to wait
        # 2. Workers need to call moveToActive periodically to promote delayed jobs
        # Don't just start another blocking wait - let workers do the actual check
        # Note: Use ! instead of not because closing can be a GenServer.from() tuple
        if !new_state.closing and !new_state.paused do
          send(self(), :fetch_jobs)
          {:noreply, new_state}
        else
          {:noreply, new_state}
        end

      {:error, _reason} ->
        # Error during wait, retry after a short delay
        Process.send_after(self(), :fetch_jobs, 1000)
        {:noreply, new_state}
    end
  end

  def handle_info({:worker_got_job, worker_pid, job, cancel_token}, state) do
    # A worker successfully fetched a job - track it
    if state.lock_manager do
      LockManager.track_job(state.lock_manager, job.id, job.token)
    end

    active_jobs = Map.put(state.active_jobs, job.id, {job, worker_pid})
    worker_pids = Map.put(state.worker_pids, worker_pid, job.id)

    # Track cancellation token if provided (for autonomous workers with cancellation support)
    cancellation_tokens =
      if cancel_token do
        Map.put(state.cancellation_tokens, job.id, {cancel_token, worker_pid})
      else
        state.cancellation_tokens
      end

    {:noreply,
     %{
       state
       | active_jobs: active_jobs,
         worker_pids: worker_pids,
         cancellation_tokens: cancellation_tokens
     }}
  end

  def handle_info({:worker_job_finished, worker_pid, job_id}, state) do
    # Autonomous worker finished a job - clean up tracking
    # The worker handles Redis updates itself, coordinator just tracks state
    if state.lock_manager do
      LockManager.untrack_job(state.lock_manager, job_id)
    end

    active_jobs = Map.delete(state.active_jobs, job_id)
    worker_pids = Map.delete(state.worker_pids, worker_pid)
    cancellation_tokens = Map.delete(state.cancellation_tokens, job_id)

    new_state = %{
      state
      | active_jobs: active_jobs,
        worker_pids: worker_pids,
        cancellation_tokens: cancellation_tokens
    }

    # Check if we're closing and all jobs are done
    check_closing_or_fetch(new_state)
  end

  def handle_info({:worker_stopped, worker_pid}, state) do
    # A worker process stopped (no more jobs) - clean up and try to spawn replacement
    worker_pids = Map.delete(state.worker_pids, worker_pid)

    # Only try to fetch more jobs if we're not closing
    new_state = %{state | worker_pids: worker_pids}
    check_closing_or_fetch(new_state)
  end

  def handle_info({:job_completed, job_id, result}, state) do
    case Map.get(state.active_jobs, job_id) do
      nil ->
        {:noreply, state}

      {job, _task_ref} ->
        # Route {:error, reason} to failure path (triggers retry like exceptions)
        case result do
          {:error, reason} ->
            handle_job_failure(job, reason, [], state)

          _ ->
            handle_job_completion(job, result, state)
        end
    end
  end

  # Handle Task.async completion message (the task sends both manual message AND Task result)
  def handle_info({ref, _result}, state) when is_reference(ref) do
    # Demonitor and flush to avoid :DOWN message
    Process.demonitor(ref, [:flush])
    {:noreply, state}
  end

  def handle_info({:job_failed, job_id, reason}, state) do
    case Map.get(state.active_jobs, job_id) do
      nil ->
        {:noreply, state}

      {job, _task_ref} ->
        handle_job_failure(job, reason, [], state)
    end
  end

  def handle_info({:job_failed, job_id, reason, stacktrace}, state) do
    case Map.get(state.active_jobs, job_id) do
      nil ->
        {:noreply, state}

      {job, _task_ref} ->
        handle_job_failure(job, reason, stacktrace, state)
    end
  end

  def handle_info({:DOWN, ref, :process, _pid, reason}, state) do
    # Find the job associated with this task
    case find_job_by_ref(state.active_jobs, ref) do
      nil ->
        {:noreply, state}

      {job_id, {job, _ref}} ->
        # Task crashed - extract stacktrace if available from reason
        stacktrace = extract_stacktrace_from_exit(reason)
        new_state = cleanup_job_resources(job_id, state)
        handle_job_failure(job, reason, stacktrace, new_state)
    end
  end

  def handle_info(:check_stalled, state) do
    # Run stalled job check
    spawn(fn ->
      Scripts.move_stalled_jobs_to_wait(
        state.connection,
        state.keys,
        state.max_stalled_count,
        []
      )
    end)

    # Schedule next check
    stalled_timer = schedule_stalled_check(state.stalled_interval)
    {:noreply, %{state | stalled_timer: stalled_timer}}
  end

  def handle_info({:cancel_jobs_lock_lost, job_ids}, state) do
    # Cancel jobs whose locks failed to renew
    # This prevents duplicate processing if another worker picks up the job
    Enum.each(job_ids, fn job_id ->
      case Map.get(state.cancellation_tokens, job_id) do
        nil ->
          Logger.warning(
            "[BullMQ.Worker] Lock lost for job #{job_id} but no cancellation token found"
          )

        {token, processor_pid} ->
          Logger.warning("[BullMQ.Worker] Lock lost for job #{job_id}, cancelling processor")
          CancellationToken.cancel(processor_pid, token, {:lock_lost, job_id})
      end

      # Call the user's on_lock_renewal_failed callback if provided (regardless of token)
      if state.on_lock_renewal_failed do
        try do
          state.on_lock_renewal_failed.([job_id])
        rescue
          e ->
            Logger.warning(
              "[BullMQ.Worker] on_lock_renewal_failed callback failed: #{Exception.message(e)}"
            )
        end
      end
    end)

    {:noreply, state}
  end

  def handle_info({:close_timeout, from}, state) do
    cleanup(state)
    GenServer.reply(from, :ok)
    {:stop, :normal, %{state | closing: true}}
  end

  # Handle EXIT signals from autonomous worker processes
  # Note: LockManager exits are handled separately above
  def handle_info({:EXIT, pid, reason}, state) do
    case Map.get(state.worker_pids, pid) do
      nil ->
        # Unknown process, ignore
        {:noreply, state}

      job_id ->
        # Autonomous worker crashed - clean up the job it was processing
        # The job will be picked up by stalled job recovery if needed
        Logger.warning(
          "[BullMQ.Worker] Autonomous worker #{inspect(pid)} crashed while processing job #{job_id}: #{inspect(reason)}"
        )

        if state.lock_manager do
          LockManager.untrack_job(state.lock_manager, job_id)
        end

        active_jobs = Map.delete(state.active_jobs, job_id)
        worker_pids = Map.delete(state.worker_pids, pid)

        # Schedule replacement worker
        send(self(), :fetch_jobs)

        {:noreply, %{state | active_jobs: active_jobs, worker_pids: worker_pids}}
    end
  end

  defp worker_client_name(state) do
    case state.name do
      nil -> "#{state.prefix}:#{state.queue_name}"
      name -> "#{state.prefix}:#{state.queue_name}:w:#{to_string(name)}"
    end
  end

  defp set_worker_client_name(blocking_conn, state) do
    client_name = worker_client_name(state)

    case RedisConnection.set_client_name(blocking_conn, client_name) do
      :ok -> :ok
      {:error, _} -> :ok
    end
  end

  defp attach_worker_client_name_handler(blocking_conn, state) do
    client_name = worker_client_name(state)
    handler_id = {:bullmq_worker_client_name, self(), make_ref()}

    # Store config for the handler
    handler_config = %{blocking_conn: blocking_conn, client_name: client_name}

    case :telemetry.attach(
           handler_id,
           [:redix, :connection],
           &BullMQ.Worker.handle_redix_connection_event/4,
           handler_config
         ) do
      :ok -> handler_id
      {:error, _} -> nil
    end
  end

  # Module function for telemetry handler to avoid performance penalty from anonymous functions
  @doc false
  def handle_redix_connection_event(_event, _measurements, metadata, config) do
    if metadata.connection == config.blocking_conn do
      _ = RedisConnection.set_client_name(config.blocking_conn, config.client_name)
    end
  end

  @impl true
  def terminate(_reason, state) do
    cleanup(state)
    :ok
  end

  # Private functions

  # Spawn autonomous worker processes that handle their own job lifecycle
  defp spawn_worker_processes(state, 0), do: state

  defp spawn_worker_processes(state, count) do
    # Build context for worker processes (everything they need to operate independently)
    worker_ctx = %{
      connection: state.connection,
      keys: state.keys,
      token: state.token,
      processor: state.processor,
      processor_supports_cancellation: state.processor_supports_cancellation,
      lock_duration: state.lock_duration,
      limiter: state.limiter,
      name: state.name,
      queue_name: state.queue_name,
      prefix: state.prefix,
      telemetry: state.telemetry,
      remove_on_complete: state.remove_on_complete || %{"count" => -1},
      remove_on_fail: state.remove_on_fail || %{"count" => -1},
      coordinator: self(),
      # Include callbacks so autonomous workers can emit events
      on_completed: state.on_completed,
      on_failed: state.on_failed,
      on_error: state.on_error,
      on_active: state.on_active
    }

    # Spawn all workers in parallel - each will fetch its own first job
    for _ <- 1..count do
      spawn_link(fn -> autonomous_worker_init(worker_ctx) end)
    end

    # Workers will notify us when they get jobs
    state
  end

  # Worker initialization - fetches first job and starts processing loop
  defp autonomous_worker_init(ctx) do
    # Trap exits so we can handle shutdown gracefully
    Process.flag(:trap_exit, true)

    # Workers use the shared connection pool for all Redis operations
    autonomous_worker_run(ctx)
  end

  # Separate function to run the worker logic - allows proper try/catch with ctx in scope
  defp autonomous_worker_run(ctx) do
    try do
      maybe_handle_autonomous_shutdown(ctx)

      case do_fetch_job(ctx) do
        {:ok, nil} ->
          # No jobs available
          send(ctx.coordinator, {:worker_stopped, self()})

        {:ok, job} ->
          # Create cancellation token if processor supports it (need to register before processing)
          cancel_token =
            if ctx.processor_supports_cancellation, do: CancellationToken.new(), else: nil

          # Notify coordinator that we got a job (include token for cancellation support)
          send(ctx.coordinator, {:worker_got_job, self(), job, cancel_token})
          autonomous_worker_loop(job, ctx, cancel_token)

        {:rate_limited, _delay} ->
          # Rate limited on first fetch, notify and exit
          send(ctx.coordinator, {:worker_stopped, self()})

        {:error, _reason} ->
          send(ctx.coordinator, {:worker_stopped, self()})
      end
    catch
      :exit, reason ->
        exit(reason)
    end
  end

  defp maybe_handle_autonomous_shutdown(_ctx) do
    receive do
      :shutdown ->
        exit(:shutdown)

      {:EXIT, _from, reason} ->
        exit(reason)
    after
      0 ->
        :ok
    end
  end

  # Fetch a job directly (used by autonomous workers)
  defp do_fetch_job(ctx) do
    opts = [
      lock_duration: ctx.lock_duration,
      limiter: ctx.limiter,
      name: ctx.name && Atom.to_string(ctx.name)
    ]

    case Scripts.move_to_active(ctx.connection, ctx.keys, ctx.token, opts) do
      {:ok, [job_data, _job_id, 0, _delay_until]} when job_data in [0, nil, ""] ->
        {:ok, nil}

      {:ok, [job_data, _job_id, rate_limit_delay, _delay_until]}
      when job_data in [0, nil, ""] and is_integer(rate_limit_delay) and rate_limit_delay > 0 ->
        {:rate_limited, rate_limit_delay}

      {:ok, [job_data, job_id, _limit_delay, _delay_until]}
      when is_list(job_data) and job_data != [] ->
        job_map = list_to_job_map(job_data)

        job =
          Job.from_redis(to_string(job_id), ctx.queue_name, job_map,
            prefix: ctx.prefix,
            token: ctx.token,
            connection: ctx.connection,
            worker: ctx.coordinator
          )

        {:ok, job}

      {:error, _} = error ->
        error
    end
  end

  # Autonomous worker loop - runs in its own process, handles entire job lifecycle
  # Workers operate independently and notify coordinator for job tracking
  defp autonomous_worker_loop(job, ctx, cancel_token) do
    maybe_handle_autonomous_shutdown(ctx)

    # Emit active event callback (matching start_job_processing behavior)
    emit_event(ctx.on_active, [job])

    # Schedule the next iteration of a repeatable job BEFORE processing
    # This matches TypeScript behavior where next job is scheduled in nextJobFromJobData
    # before the current job is processed. This ensures that even if the job fails,
    # the next scheduled iteration will still be created.
    schedule_next_repeatable_job(job, ctx)

    # Process the job (pass the pre-created token)
    result = run_processor_sync(job, ctx, cancel_token)

    # Handle result and get next job
    case handle_job_result(job, result, ctx) do
      {:continue, next_job} ->
        # Notify coordinator: old job finished
        send(ctx.coordinator, {:worker_job_finished, self(), job.id})

        # Create new cancellation token for next job if processor supports it
        next_cancel_token =
          if ctx.processor_supports_cancellation, do: CancellationToken.new(), else: nil

        # Notify coordinator about new job (with token)
        send(ctx.coordinator, {:worker_got_job, self(), next_job, next_cancel_token})
        autonomous_worker_loop(next_job, ctx, next_cancel_token)

      :stop ->
        # No more jobs, notify job finished and stopped
        send(ctx.coordinator, {:worker_job_finished, self(), job.id})
        send(ctx.coordinator, {:worker_stopped, self()})

      :retry ->
        # Job moved to delayed for retry, notify finished and try to get next job
        send(ctx.coordinator, {:worker_job_finished, self(), job.id})

        case try_get_next_job(ctx) do
          {:ok, next_job} ->
            # Create new cancellation token for next job if processor supports it
            next_cancel_token =
              if ctx.processor_supports_cancellation, do: CancellationToken.new(), else: nil

            send(ctx.coordinator, {:worker_got_job, self(), next_job, next_cancel_token})
            autonomous_worker_loop(next_job, ctx, next_cancel_token)

          _ ->
            send(ctx.coordinator, {:worker_stopped, self()})
        end
    end
  end

  # Try to get next job directly (for retry case)
  defp try_get_next_job(ctx) do
    case do_fetch_job(ctx) do
      {:ok, nil} -> :no_jobs
      {:ok, job} -> {:ok, job}
      _ -> :error
    end
  end

  # Run processor synchronously (called within worker process)
  # The cancel_token parameter allows passing a pre-created token
  # (used by autonomous workers who need to register the token before processing)
  defp run_processor_sync(job, ctx, cancel_token) do
    processor = ctx.processor

    processor_fn =
      if ctx.processor_supports_cancellation do
        # Use provided token or create new one
        token = cancel_token || CancellationToken.new()
        fn -> processor.(job, token) end
      else
        fn -> processor.(job) end
      end

    try do
      result = processor_fn.()
      {:ok, result}
    rescue
      e ->
        {:error, Exception.message(e), __STACKTRACE__}
    catch
      :exit, reason ->
        {:error, inspect(reason), __STACKTRACE__}

      :throw, value ->
        {:error, inspect(value), __STACKTRACE__}
    end
  end

  # Handle job result: complete/fail and fetch next job
  defp handle_job_result(job, {:ok, result}, ctx) do
    return_value = normalize_result(result)

    case return_value do
      {:error, error_reason} ->
        # Processor returned {:error, reason} - treat as failure
        # Use inspect for non-string error reasons (like tuples)
        error_msg = if is_binary(error_reason), do: error_reason, else: inspect(error_reason)
        handle_job_result(job, {:error, error_msg, []}, ctx)

      {:delay, delay_ms} ->
        Scripts.move_to_delayed(ctx.connection, ctx.keys, job.id, job.token, delay_ms,
          skip_attempt: true
        )

        :stop

      {:rate_limit, delay_ms} ->
        Scripts.move_to_delayed(ctx.connection, ctx.keys, job.id, job.token, delay_ms,
          skip_attempt: true
        )

        :stop

      :waiting ->
        Scripts.move_job_from_active_to_wait(ctx.connection, ctx.keys, job.id, job.token)
        :stop

      :waiting_children ->
        Scripts.move_to_waiting_children(ctx.connection, ctx.keys, job.id, job.token)
        :stop

      _ ->
        # Complete job and get next
        move_opts = build_worker_move_opts(ctx, job)

        case Scripts.move_to_completed(
               ctx.connection,
               ctx.keys,
               job.id,
               job.token,
               return_value,
               move_opts
             ) do
          {:ok, [job_data, job_id, _limit_delay, _delay_until]}
          when is_list(job_data) and job_data != [] ->
            # Emit on_completed callback
            updated_job = %{job | attempts_made: job.attempts_made + 1}
            emit_event(ctx.on_completed, [updated_job, return_value])

            job_map = list_to_job_map(job_data)

            next_job =
              Job.from_redis(to_string(job_id), ctx.queue_name, job_map,
                prefix: ctx.prefix,
                token: ctx.token,
                connection: ctx.connection,
                worker: ctx.coordinator
              )

            {:continue, next_job}

          _ ->
            # Emit on_completed callback even when no next job
            updated_job = %{job | attempts_made: job.attempts_made + 1}
            emit_event(ctx.on_completed, [updated_job, return_value])
            :stop
        end
    end
  end

  defp handle_job_result(job, {:error, error_msg, stacktrace}, ctx) do
    if Job.should_retry?(job) do
      backoff_delay = Job.calculate_backoff(job)
      effective_delay = max(backoff_delay, 1)

      # Emit on_error callback for retry case
      emit_event(ctx.on_error, [job, error_msg, nil])

      Scripts.move_to_delayed(
        ctx.connection,
        ctx.keys,
        job.id,
        job.token,
        effective_delay,
        stacktrace: format_stacktrace(stacktrace)
      )

      :retry
    else
      move_opts = build_worker_move_opts(ctx, job) ++ [stacktrace: format_stacktrace(stacktrace)]

      case Scripts.move_to_failed(ctx.connection, ctx.keys, job.id, job.token, error_msg, move_opts) do
        {:ok, [job_data, job_id, _limit_delay, _delay_until]}
        when is_list(job_data) and job_data != [] ->
          # Emit on_failed callback with failed_reason set
          updated_job = %{job | attempts_made: job.attempts_made + 1, failed_reason: error_msg}
          emit_event(ctx.on_failed, [updated_job, error_msg])

          job_map = list_to_job_map(job_data)

          next_job =
            Job.from_redis(to_string(job_id), ctx.queue_name, job_map,
              prefix: ctx.prefix,
              token: ctx.token,
              connection: ctx.connection,
              worker: ctx.coordinator
            )

          {:continue, next_job}

        _ ->
          # Emit on_failed callback even when no next job
          updated_job = %{job | attempts_made: job.attempts_made + 1, failed_reason: error_msg}
          emit_event(ctx.on_failed, [updated_job, error_msg])
          :stop
      end
    end
  end

  defp normalize_result({:ok, value}), do: value
  defp normalize_result(:ok), do: nil
  defp normalize_result({:delay, delay_ms}), do: {:delay, delay_ms}
  defp normalize_result({:rate_limit, delay_ms}), do: {:rate_limit, delay_ms}
  defp normalize_result(:waiting), do: :waiting
  defp normalize_result(:waiting_children), do: :waiting_children
  defp normalize_result(other), do: other

  defp build_worker_move_opts(ctx, job) do
    [
      lock_duration: ctx.lock_duration,
      fetch_next: true,
      name: ctx.name,
      attempts: get_job_opt(job, :attempts, "attempts", 0),
      limiter: ctx.limiter,
      remove_on_complete: ctx.remove_on_complete,
      remove_on_fail: ctx.remove_on_fail,
      fail_parent_on_failure: false,
      continue_parent_on_failure: false,
      ignore_dependency_on_failure: false,
      remove_dependency_on_failure: false
    ]
  end

  # Fetch next job for manual processing with a custom token
  defp fetch_next_job_with_token(state, token) do
    script_opts = [
      lock_duration: state.lock_duration,
      limiter: state.limiter,
      name: state.name && Atom.to_string(state.name)
    ]

    case Scripts.move_to_active(state.connection, state.keys, token, script_opts) do
      # No job available
      {:ok, [job_data, _job_id, 0, _delay_until]} when job_data in [0, nil, ""] ->
        {:ok, nil}

      # Rate limited - return nil for manual processing (caller handles rate limiting)
      {:ok, [job_data, _job_id, _rate_limit_delay, _delay_until]}
      when job_data in [0, nil, ""] ->
        {:ok, nil}

      # Job available
      {:ok, [job_data, job_id, _limit_delay, _delay_until]}
      when is_list(job_data) and job_data != [] ->
        job_map = list_to_job_map(job_data)

        job =
          Job.from_redis(to_string(job_id), state.queue_name, job_map,
            prefix: state.prefix,
            token: token,
            connection: state.connection,
            worker: self()
          )

        {:ok, job}

      {:error, _} = error ->
        error
    end
  end

  # Wait for a job to become available using BZPOPMIN on the marker key
  # This is more efficient than polling as it uses Redis's blocking primitives
  defp wait_for_job(state, timeout_seconds) do
    marker_key = Keys.marker(state.keys)

    # Use the blocking connection if available, otherwise create one temporarily
    blocking_conn = state.blocking_conn

    if blocking_conn && Process.alive?(blocking_conn) do
      do_wait_for_job(blocking_conn, marker_key, timeout_seconds)
    else
      # Create a temporary blocking connection
      case RedisConnection.blocking_connection(state.connection) do
        {:ok, temp_conn} ->
          set_worker_client_name(temp_conn, state)
          result = do_wait_for_job(temp_conn, marker_key, timeout_seconds)
          RedisConnection.close_blocking(state.connection, temp_conn)
          result

        {:error, reason} ->
          Logger.warning("[BullMQ.Worker] Failed to create blocking connection: #{inspect(reason)}")
          {:error, reason}
      end
    end
  end

  defp do_wait_for_job(conn, marker_key, timeout_seconds) do
    # BZPOPMIN returns [key, member, score] or nil on timeout
    case Redix.command(conn, ["BZPOPMIN", marker_key, timeout_seconds], timeout: :infinity) do
      {:ok, nil} ->
        # Timeout - no job became available
        :timeout

      {:ok, [_key, _member, _score]} ->
        # A marker was added, meaning a job is available
        :job_available

      {:error, %Redix.ConnectionError{}} ->
        # Connection issue - caller should retry
        :timeout

      {:error, reason} ->
        {:error, reason}
    end
  end

  # Convert flat list [key1, val1, key2, val2, ...] to map
  defp list_to_job_map(list) when is_list(list) do
    list
    |> Enum.chunk_every(2)
    |> Enum.map(fn
      [k, v] -> {k, v}
      [k] -> {k, nil}
    end)
    |> Map.new()
  end

  defp list_to_job_map(data), do: data

  defp start_job_processing(job, state) do
    worker_pid = self()
    processor = state.processor
    supports_cancellation = state.processor_supports_cancellation
    telemetry_mod = state.telemetry

    # Emit active event callback
    emit_event(state.on_active, [job])

    # Schedule the next iteration of a repeatable job BEFORE processing
    # This matches TypeScript behavior where next job is scheduled in nextJobFromJobData
    # before the current job is processed. This ensures that even if the job fails,
    # the next scheduled iteration will still be created.
    schedule_next_repeatable_job(job, state)

    # Extract telemetry metadata from job opts for context restoration
    telemetry_metadata =
      get_in(job.opts, [:telemetry_metadata]) ||
        get_in(job.opts, ["telemetry_metadata"])

    # Only create cancellation token if processor supports it (arity 2)
    # This optimization avoids overhead for processors that don't use cancellation
    cancel_token = if supports_cancellation, do: CancellationToken.new(), else: nil

    # Build the processor function based on whether cancellation is supported
    processor_fn =
      if supports_cancellation do
        fn -> processor.(job, cancel_token) end
      else
        fn -> processor.(job) end
      end

    task =
      Task.async(fn ->
        run_processor(processor_fn, job, worker_pid, telemetry_mod, telemetry_metadata)
      end)

    # Track job in LockManager for automatic lock renewal
    if state.lock_manager do
      LockManager.track_job(state.lock_manager, job.id, job.token)
    end

    # Track the active job
    active_jobs = Map.put(state.active_jobs, job.id, {job, task.ref})

    # Only track cancellation token if processor supports cancellation
    cancellation_tokens =
      if supports_cancellation do
        Map.put(state.cancellation_tokens, job.id, {cancel_token, task.pid})
      else
        state.cancellation_tokens
      end

    %{state | active_jobs: active_jobs, cancellation_tokens: cancellation_tokens}
  end

  # Run processor with optional telemetry tracing
  defp run_processor(processor_fn, job, worker_pid, nil = _telemetry_mod, _metadata) do
    # No telemetry configured, run processor directly
    execute_processor(processor_fn, job, worker_pid)
  end

  defp run_processor(processor_fn, job, worker_pid, telemetry_mod, metadata) do
    # Restore parent context if available
    parent_ctx =
      if metadata do
        telemetry_mod.deserialize_context(metadata)
      else
        nil
      end

    span_opts = [
      kind: :consumer,
      parent: parent_ctx,
      attributes: %{
        "messaging.system" => "bullmq",
        "messaging.destination.name" => job.queue_name,
        "messaging.message.id" => job.id,
        "messaging.operation" => "receive",
        "bullmq.job.name" => job.name,
        "bullmq.job.priority" => job.priority,
        "bullmq.job.attempts" => job.attempts_made
      }
    ]

    span = telemetry_mod.start_span("bullmq.worker.process", span_opts)

    # Run processor within the span context
    execute_processor_with_span(processor_fn, job, worker_pid, telemetry_mod, span)
  end

  # Execute processor without telemetry
  defp execute_processor(processor_fn, job, worker_pid) do
    try do
      result = processor_fn.()
      send(worker_pid, {:job_completed, job.id, result})
    rescue
      e ->
        stacktrace = __STACKTRACE__
        send(worker_pid, {:job_failed, job.id, Exception.message(e), stacktrace})
    catch
      :exit, reason ->
        stacktrace = __STACKTRACE__
        send(worker_pid, {:job_failed, job.id, inspect(reason), stacktrace})

      :throw, value ->
        stacktrace = __STACKTRACE__
        send(worker_pid, {:job_failed, job.id, inspect(value), stacktrace})
    end
  end

  # Execute processor with telemetry span
  defp execute_processor_with_span(processor_fn, job, worker_pid, telemetry_mod, span) do
    try do
      result = processor_fn.()
      telemetry_mod.end_span(span, :ok)
      send(worker_pid, {:job_completed, job.id, result})
    rescue
      e ->
        stacktrace = __STACKTRACE__
        telemetry_mod.record_exception(span, e, stacktrace)
        telemetry_mod.end_span(span, {:error, Exception.message(e)})
        send(worker_pid, {:job_failed, job.id, Exception.message(e), stacktrace})
    catch
      :exit, reason ->
        stacktrace = __STACKTRACE__
        telemetry_mod.end_span(span, {:error, inspect(reason)})
        send(worker_pid, {:job_failed, job.id, inspect(reason), stacktrace})

      :throw, value ->
        stacktrace = __STACKTRACE__
        telemetry_mod.end_span(span, {:error, inspect(value)})
        send(worker_pid, {:job_failed, job.id, inspect(value), stacktrace})
    end
  end

  # Check if processor accepts cancellation token (arity 2)
  defp processor_supports_cancellation?(processor) when is_function(processor) do
    case Function.info(processor, :arity) do
      {:arity, 2} -> true
      _ -> false
    end
  end

  defp processor_supports_cancellation?(_), do: false

  defp handle_job_completion(job, result, state) do
    return_value =
      case result do
        {:ok, value} -> value
        :ok -> nil
        {:delay, delay_ms} -> {:delay, delay_ms}
        {:rate_limit, delay_ms} -> {:rate_limit, delay_ms}
        :waiting -> :waiting
        :waiting_children -> :waiting_children
        other -> other
      end

    next_job_result =
      case return_value do
        {:delay, delay_ms} ->
          # Move job back to delayed
          Scripts.move_to_delayed(
            state.connection,
            state.keys,
            job.id,
            job.token,
            delay_ms,
            skip_attempt: true
          )

          nil

        {:rate_limit, delay_ms} ->
          # Move job back to wait and apply rate limiting delay
          # This is similar to delay but indicates the job should wait due to rate limiting
          Scripts.move_to_delayed(
            state.connection,
            state.keys,
            job.id,
            job.token,
            delay_ms,
            skip_attempt: true
          )

          nil

        :waiting ->
          # Move job back to waiting queue
          Scripts.move_job_from_active_to_wait(
            state.connection,
            state.keys,
            job.id,
            job.token
          )

          nil

        :waiting_children ->
          # Move job to waiting-children state
          Scripts.move_to_waiting_children(
            state.connection,
            state.keys,
            job.id,
            job.token
          )

          nil

        _ ->
          # Complete the job and get next job if available
          Scripts.move_to_completed(
            state.connection,
            state.keys,
            job.id,
            job.token,
            return_value,
            build_move_opts(state, job)
          )
      end

    # Determine if this was a "soft" return (not a real completion)
    is_soft_return =
      match?({:delay, _}, return_value) or
        match?({:rate_limit, _}, return_value) or
        return_value == :waiting or
        return_value == :waiting_children

    # Update job's attempts_made to match Redis state (incremented during moveToFinished)
    # This mirrors TypeScript behavior where job.attemptsMade += 1 after moveToCompleted
    updated_job =
      if is_soft_return do
        job
      else
        %{job | attempts_made: job.attempts_made + 1}
      end

    # If this was a repeatable job, schedule the next iteration (only on actual completion)
    unless is_soft_return do
      # Emit completed event callback (soft returns are not completions)
      emit_event(state.on_completed, [updated_job, return_value])
    end

    # Untrack job from LockManager
    if state.lock_manager do
      LockManager.untrack_job(state.lock_manager, job.id)
    end

    # Remove completed job from active jobs and clean up cancellation token
    new_state = cleanup_job_resources(job.id, state)

    # Handle next job from moveToFinished result
    handle_next_job_or_fetch(next_job_result, new_state)
  end

  # Handle the result from moveToFinished which may contain the next job
  defp handle_next_job_or_fetch(nil, state), do: check_closing_or_fetch(state)
  defp handle_next_job_or_fetch({:error, _}, state), do: check_closing_or_fetch(state)

  # Successful completion with no next job (returned 0)
  defp handle_next_job_or_fetch({:ok, 0}, state), do: check_closing_or_fetch(state)

  # No job available [0, 0, 0, 0] or similar
  defp handle_next_job_or_fetch({:ok, [job_data, _job_id, _, _]}, state)
       when job_data in [0, nil, ""] do
    check_closing_or_fetch(state)
  end

  # Next job returned from moveToFinished
  defp handle_next_job_or_fetch({:ok, [job_data, job_id, _limit_delay, _delay_until]}, state)
       when is_list(job_data) and job_data != [] do
    # Parse and process the next job
    job_map = list_to_job_map(job_data)

    next_job =
      Job.from_redis(to_string(job_id), state.queue_name, job_map,
        prefix: state.prefix,
        token: state.token,
        connection: state.connection,
        worker: self()
      )

    # Start processing the next job
    new_state = start_job_processing(next_job, state)
    {:noreply, new_state}
  end

  # Unknown format, fall back to fetch
  defp handle_next_job_or_fetch(_, state), do: check_closing_or_fetch(state)

  defp handle_job_failure(job, reason, stacktrace, state) do
    error_message = if is_binary(reason), do: reason, else: inspect(reason)
    formatted_stacktrace = format_stacktrace(stacktrace)

    is_final_failure = !Job.should_retry?(job)

    # Check if we should retry
    next_job_result =
      if Job.should_retry?(job) do
        # Calculate backoff delay
        backoff_delay = Job.calculate_backoff(job)

        # Use minimum 1ms delay for retry - immediate retry should still go through delayed
        # to properly update attempt counter via Lua script
        effective_delay = max(backoff_delay, 1)

        # Move to delayed for retry (Lua script handles incrementing attempts)
        # Also store the stacktrace for this attempt
        Scripts.move_to_delayed(
          state.connection,
          state.keys,
          job.id,
          job.token,
          effective_delay,
          stacktrace: formatted_stacktrace
        )

        nil
      else
        # Move to failed and get next job
        Scripts.move_to_failed(
          state.connection,
          state.keys,
          job.id,
          job.token,
          error_message,
          build_move_opts(state, job) ++ [stacktrace: formatted_stacktrace]
        )
      end

    # Emit failed event callback only when job has exhausted retries
    if is_final_failure do
      updated_job = %{job | attempts_made: job.attempts_made + 1, failed_reason: error_message}
      emit_event(state.on_failed, [updated_job, error_message])
    end

    # Untrack job from LockManager
    if state.lock_manager do
      LockManager.untrack_job(state.lock_manager, job.id)
    end

    # Remove from active jobs, clean up cancellation token, and handle next job
    new_state = cleanup_job_resources(job.id, state)
    handle_next_job_or_fetch(next_job_result, new_state)
  end

  defp check_closing_or_fetch(state) do
    cond do
      is_reference(state.closing) or is_tuple(state.closing) ->
        # We're waiting to close
        if map_size(state.active_jobs) == 0 do
          cleanup(state)
          GenServer.reply(state.closing, :ok)
          {:stop, :normal, %{state | closing: true}}
        else
          {:noreply, state}
        end

      state.closing == true or state.paused ->
        {:noreply, state}

      state.waiting_for_jobs ->
        # Already waiting, don't start another wait or spawn more workers
        {:noreply, state}

      map_size(state.worker_pids) == 0 and map_size(state.active_jobs) == 0 ->
        # All workers have stopped AND no active jobs - start blocking wait
        # This matches Node.js behavior: only one blocking call when queue is empty
        start_blocking_wait(state)

      true ->
        # Some workers still running or have active jobs, trigger fetch for any free slots
        send(self(), :fetch_jobs)
        {:noreply, state}
    end
  end

  # Start a blocking wait for jobs using BZPOPMIN on the marker key
  # This is done in a spawned process so it doesn't block the GenServer
  defp start_blocking_wait(state) do
    coordinator = self()
    marker_key = Keys.marker(state.keys)
    blocking_conn = state.blocking_conn
    # Calculate timeout based on block_until (like Node.js)
    timeout_seconds = get_block_timeout(state)

    # Spawn a process to do the blocking wait
    spawn_link(fn ->
      result =
        if blocking_conn && Process.alive?(blocking_conn) do
          do_blocking_wait(blocking_conn, marker_key, timeout_seconds)
        else
          # No blocking connection available, use a temporary one
          case RedisConnection.blocking_connection(state.connection) do
            {:ok, temp_conn} ->
              result = do_blocking_wait(temp_conn, marker_key, timeout_seconds)
              RedisConnection.close_blocking(state.connection, temp_conn)
              result

            {:error, reason} ->
              {:error, reason}
          end
        end

      send(coordinator, {:blocking_wait_result, result})
    end)

    {:noreply, %{state | waiting_for_jobs: true}}
  end

  # Calculate blocking timeout like Node.js does:
  # - If block_until is set (delayed job timestamp), wait until that time
  # - Otherwise use drain_delay (default 5s)
  # - Cap at maximum_block_timeout (10s) to avoid long blocks during reconnections
  defp get_block_timeout(%{block_until: block_until})
       when is_integer(block_until) and block_until > 0 do
    now_ms = System.system_time(:millisecond)
    block_delay_ms = block_until - now_ms

    cond do
      # Delayed job is ready now
      block_delay_ms <= 0 ->
        0

      # Delayed job will be ready very soon
      block_delay_ms < @minimum_block_timeout * 1000 ->
        @minimum_block_timeout

      # Wait until delayed job is ready, but cap at maximum
      true ->
        min(block_delay_ms / 1000, @maximum_block_timeout)
    end
  end

  defp get_block_timeout(%{drain_delay: drain_delay}) do
    # No delayed job pending, use drain_delay (like Node.js drainDelay option)
    max(drain_delay, @minimum_block_timeout)
  end

  # Perform the actual blocking wait
  # Returns:
  #   {:job_available, block_until} - a marker was found, block_until is next delayed job timestamp or nil
  #   :timeout - no marker within timeout
  #   {:error, reason} - error occurred
  defp do_blocking_wait(conn, marker_key, timeout_seconds) do
    case Redix.command(conn, ["BZPOPMIN", marker_key, timeout_seconds], timeout: :infinity) do
      {:ok, nil} ->
        # Timeout - no marker available
        :timeout

      {:ok, [_key, member, score]} ->
        # Got a marker. Member "0" means job immediately available,
        # Member "1" with future score means delayed job timestamp.
        case member do
          "0" ->
            # Immediate job available, reset block_until
            {:job_available, nil}

          "1" ->
            # Delayed job marker - score is the timestamp when it becomes ready
            block_until = String.to_integer(score)
            {:job_available, block_until}

          _ ->
            # Unknown marker type, treat as job available
            {:job_available, nil}
        end

      {:error, %Redix.ConnectionError{}} ->
        # Connection issue - caller should retry
        :timeout

      {:error, reason} ->
        {:error, reason}
    end
  end

  # Build options for move_to_finished/completed/failed calls
  defp build_move_opts(state, job) do
    [
      lock_duration: state.lock_duration,
      fetch_next: true,
      name: state.name,
      attempts: get_job_opt(job, :attempts, "attempts", 0),
      limiter: state.limiter,
      remove_on_complete: state.remove_on_complete || %{"count" => -1},
      remove_on_fail: state.remove_on_fail || %{"count" => -1},
      fail_parent_on_failure: false,
      continue_parent_on_failure: false,
      ignore_dependency_on_failure: false,
      remove_dependency_on_failure: false
    ]
  end

  # Helper to extract a value from job.opts supporting both atom and string keys
  defp get_job_opt(%Job{opts: opts}, atom_key, string_key, default) when is_map(opts) do
    case Map.get(opts, atom_key) do
      nil -> Map.get(opts, string_key, default)
      value -> value
    end
  end

  defp get_job_opt(%Job{opts: opts}, atom_key, _string_key, default) when is_list(opts) do
    case Keyword.get(opts, atom_key) do
      nil -> default
      value -> value
    end
  end

  defp get_job_opt(_, _, _, default), do: default

  defp find_job_by_ref(active_jobs, ref) do
    Enum.find(active_jobs, fn {_id, {_job, task_ref}} -> task_ref == ref end)
  end

  # Clean up resources for a completed/failed job
  defp cleanup_job_resources(job_id, state) do
    # No cleanup needed for tokens - they're just references
    %{
      state
      | active_jobs: Map.delete(state.active_jobs, job_id),
        cancellation_tokens: Map.delete(state.cancellation_tokens, job_id)
    }
  end

  # Format Elixir stacktrace to a string similar to Node.js stack traces
  defp format_stacktrace([]), do: nil
  defp format_stacktrace(nil), do: nil

  defp format_stacktrace(stacktrace) when is_list(stacktrace) do
    stacktrace
    |> Exception.format_stacktrace()
    |> String.trim()
  end

  defp format_stacktrace(_), do: nil

  # Extract stacktrace from exit reason if available
  # Some exit reasons include stacktrace info
  defp extract_stacktrace_from_exit({:EXIT, _pid, {_reason, stacktrace}})
       when is_list(stacktrace) do
    stacktrace
  end

  defp extract_stacktrace_from_exit({exception, stacktrace})
       when is_exception(exception) and is_list(stacktrace) do
    stacktrace
  end

  defp extract_stacktrace_from_exit(_), do: []

  defp schedule_stalled_check(interval) do
    Process.send_after(self(), :check_stalled, interval)
  end

  defp generate_token do
    UUID.uuid4()
  end

  defp cleanup(state) do
    # Stop all autonomous worker processes
    # Send explicit shutdown so workers can exit gracefully
    worker_refs =
      for {worker_pid, _job_id} <- state.worker_pids, Process.alive?(worker_pid), into: %{} do
        send(worker_pid, :shutdown)
        {worker_pid, Process.monitor(worker_pid)}
      end

    Enum.each(worker_refs, fn {_pid, ref} ->
      receive do
        {:DOWN, ^ref, :process, _pid, _reason} -> :ok
      after
        2_000 -> :ok
      end
    end)

    # Stop lock manager
    if state.lock_manager do
      LockManager.stop(state.lock_manager)
    end

    # Cancel stalled timer
    if state.stalled_timer do
      Process.cancel_timer(state.stalled_timer)
    end

    # Close blocking connection
    if state.blocking_conn do
      RedisConnection.close_blocking(state.connection, state.blocking_conn)
    end

    if state.client_name_telemetry_id do
      :telemetry.detach(state.client_name_telemetry_id)
    end

    :ok
  end

  # Event callback helper - safely invokes callback if provided
  defp emit_event(nil, _args), do: :ok

  defp emit_event(callback, args) when is_function(callback) do
    try do
      apply(callback, args)
    rescue
      e ->
        Logger.warning("Worker event callback failed: #{Exception.message(e)}")
    end

    :ok
  end

  # Schedule the next iteration of a repeatable job
  # This is called when a job with repeat_job_key starts processing
  defp schedule_next_repeatable_job(%Job{repeat_job_key: nil}, _state), do: :ok
  defp schedule_next_repeatable_job(%Job{repeat_job_key: ""}, _state), do: :ok

  defp schedule_next_repeatable_job(%Job{repeat_job_key: scheduler_id} = job, state) do
    # Check if this is a new-style job scheduler (key without many colons)
    # Old style: "schedulerId:pattern:tz:..." (5+ parts)
    # New style: "schedulerId" (simple key, fewer than 5 colon-separated parts)
    key_parts = String.split(scheduler_id, ":")

    if length(key_parts) < 5 do
      # New style job scheduler - call updateJobScheduler
      repeat_opts = get_repeat_opts(job)

      # Check if we've hit the iteration limit
      count = Map.get(repeat_opts, "count", 0)
      limit = Map.get(repeat_opts, "limit")
      next_count = count + 1

      cond do
        limit && next_count > limit ->
          # Limit reached, don't schedule next job
          :ok

        Map.get(repeat_opts, "endDate") &&
            System.system_time(:millisecond) > Map.get(repeat_opts, "endDate") ->
          # End date passed, don't schedule next job
          :ok

        true ->
          # Schedule the next iteration in a separate process to not block job processing
          schedule_next_iteration(job, scheduler_id, next_count, state)
      end
    else
      # Old-style repeatable job format detected - these are not supported
      # by the new job scheduler system
      Logger.warning(
        "[BullMQ.Worker] Job #{job.id} has repeat_job_key with #{length(key_parts)} colon-separated parts. " <>
          "Job scheduler IDs must have fewer than 5 colon-separated parts. " <>
          "Next iteration will not be scheduled."
      )

      :ok
    end
  end

  # Schedules the next iteration of a job scheduler in a separate process
  defp schedule_next_iteration(job, scheduler_id, next_count, state) do
    spawn(fn ->
      try do
        now = System.system_time(:millisecond)
        # Placeholder next_millis - Lua script calculates the real value based on 'every' interval
        next_millis = now + 1000

        job_opts = build_scheduler_job_opts(job, next_count)
        packed_opts = Msgpax.pack!(job_opts, iodata: false)
        template_data = Jason.encode!(job.data || %{})

        case Scripts.update_job_scheduler(
               state.connection,
               state.keys,
               scheduler_id,
               next_millis,
               template_data,
               packed_opts,
               job.id
             ) do
          {:ok, nil} ->
            # This can happen if: scheduler doesn't exist in Redis, job.id doesn't match
            # the expected format, or next job already exists (duplicate)
            Logger.warning(
              "[BullMQ.Worker] Failed to schedule next iteration for scheduler '#{scheduler_id}': " <>
                "scheduler may not exist or job ID mismatch (job.id=#{job.id})"
            )

          {:ok, _next_job_id} ->
            :ok

          {:error, reason} ->
            Logger.error(
              "[BullMQ.Worker] Error scheduling next iteration for scheduler '#{scheduler_id}': #{inspect(reason)}"
            )
        end
      rescue
        e ->
          Logger.error(
            "[BullMQ.Worker] Exception scheduling next iteration: #{Exception.message(e)}"
          )
      end
    end)

    :ok
  end

  # Extract repeat options from job opts
  defp get_repeat_opts(%Job{opts: opts}) when is_map(opts) do
    case opts do
      %{"repeat" => repeat} when is_map(repeat) -> repeat
      %{repeat: repeat} when is_map(repeat) -> repeat
      _ -> %{}
    end
  end

  defp get_repeat_opts(_), do: %{}

  # Build job options for the next scheduler iteration
  defp build_scheduler_job_opts(job, next_count) do
    opts = job.opts || %{}
    repeat_opts = get_repeat_opts(job)

    # Build the repeat sub-options with the updated count
    repeat =
      %{
        "every" => Map.get(repeat_opts, "every") || Map.get(repeat_opts, :every),
        "pattern" => Map.get(repeat_opts, "pattern") || Map.get(repeat_opts, :pattern),
        "offset" => Map.get(repeat_opts, "offset") || Map.get(repeat_opts, :offset),
        "count" => next_count || Map.get(repeat_opts, "count", 0) + 1,
        "limit" => Map.get(repeat_opts, "limit") || Map.get(repeat_opts, :limit),
        "endDate" => Map.get(repeat_opts, "endDate") || Map.get(repeat_opts, :end_date)
      }
      |> Enum.reject(fn {_k, v} -> is_nil(v) end)
      |> Map.new()

    %{
      "repeat" => repeat,
      "attempts" => opts["attempts"] || opts[:attempts],
      "backoff" => opts["backoff"] || opts[:backoff],
      "removeOnComplete" => opts["removeOnComplete"] || opts[:remove_on_complete],
      "removeOnFail" => opts["removeOnFail"] || opts[:remove_on_fail]
    }
    |> Enum.reject(fn {_k, v} -> is_nil(v) end)
    |> Map.new()
  end
end
