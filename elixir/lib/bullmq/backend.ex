defmodule BullMQ.Backend do
  @moduledoc """
  Database-agnostic contract describing every high-level operation that the
  `BullMQ.Queue`, `BullMQ.Worker`, `BullMQ.Job`, `BullMQ.QueueEvents`,
  `BullMQ.FlowProducer` and `BullMQ.JobScheduler` modules need in order to
  function.

  This is the Elixir port of the Node.js `IQueueBackend` interface
  (`src/interfaces/queue-backend.ts`). The goal is to express the queue
  semantics ("move job to active", "extend lock", "promote job", …)
  **independently of the underlying datastore**.

  The built-in implementation is the Redis adapter (`BullMQ.Backends.Redis`); a
  PostgreSQL adapter can fulfil the same operations over a different datastore
  without any change to the high-level modules.

  ## Design

  Unlike the Node.js version where the backend is an object instance, an Elixir
  backend is an **immutable struct** that implements this behaviour. The struct
  carries the queue identity (name, prefix, keys) and *references* the
  connection process(es) it uses (a pooled `BullMQ.RedisConnection` plus an
  optional dedicated blocking connection). It never spawns a per-operation
  process, so operations run directly in the caller process — parallelism and
  connection lifecycle come from the referenced connection processes.

  Every callback takes the backend struct as its first argument. Callers invoke
  operations through the thin dispatcher functions defined in this module (e.g.
  `BullMQ.Backend.move_to_active(backend, token, opts)`), which delegate to the
  concrete adapter module identified by the struct
  (`backend.__struct__`).

  ## Return values

  Callback return shapes intentionally mirror the existing `BullMQ.Scripts`
  return shapes (`{:ok, term}` / `{:error, term}` / raw values), so the Redis
  adapter is a near drop-in delegation and refactoring call sites is mechanical.
  """

  alias BullMQ.Keys

  @typedoc """
  A backend instance: any struct whose module implements `BullMQ.Backend`.
  """
  @type t :: struct()

  @typedoc "A job identifier."
  @type job_id :: String.t()

  @typedoc "The queue key context (`%{prefix: ..., name: ...}`)."
  @type context :: Keys.queue_context()

  # ============================================================
  # Connection lifecycle
  # ============================================================

  @doc "Resolves once the backend's connection(s) are ready to accept operations."
  @callback wait_until_ready(t) :: :ok | {:error, term()}

  @doc """
  Closes the backend and its owned connection(s). When `force` is `true`,
  forcibly tears down connection(s) without waiting for in-flight commands.
  """
  @callback close(t, force :: boolean()) :: :ok

  @doc "Forcibly disconnects the backend's underlying connection(s)."
  @callback disconnect(t) :: :ok

  @doc "Sets a human-readable name on the underlying connection (observability)."
  @callback set_name(t, name :: String.t()) :: :ok | {:error, term()}

  @doc """
  Returns a sibling backend bound to a different queue that shares this
  backend's underlying connection(s). Used by `BullMQ.FlowProducer`.
  """
  @callback for_queue(t, queue_name :: String.t(), prefix :: String.t() | nil) :: t

  # ============================================================
  # Queue identity & key building
  # ============================================================

  @doc "The queue's fully-qualified name. Redis: `\"<prefix>:<queue>\"`."
  @callback qualified_name(t) :: String.t()

  @doc "The key context (`%{prefix: ..., name: ...}`) for the queue."
  @callback context(t) :: context()

  @doc "Builds a namespaced sub-key of the given `type` for this queue."
  @callback to_key(t, type :: String.t()) :: String.t()

  @doc """
  Parses a flow child/dependency node key (`\"<qualifiedName>:<id>\"`) back into
  `%{prefix: ..., queue_name: ..., id: ...}`.
  """
  @callback parse_node_key(t, key :: String.t()) :: %{
              prefix: String.t(),
              queue_name: String.t(),
              id: String.t()
            }

  @doc "Builds the connection client name (used for `set_name` and discovery)."
  @callback client_name(t, suffix :: String.t() | nil) :: String.t()

  # ============================================================
  # Adding jobs
  # ============================================================

  @doc """
  Adds a single job, routing it to the correct initial state
  (wait / delayed / prioritized / waiting-children) based on `opts`.
  """
  @callback add_job(t, job :: struct(), opts :: keyword()) ::
              {:ok, job_id} | {:error, term()}

  @doc "Adds many jobs in a single efficient operation (pipeline / bulk)."
  @callback add_jobs(t, jobs_with_opts :: list(), opts :: keyword()) ::
              {:ok, [job_id]} | {:error, term()}

  @doc """
  Atomically inserts a flow (tree) of jobs that may span multiple queues.
  Each entry carries its own `prefix`/`queue_name`.
  """
  @callback add_flow(t, entries :: list(), opts :: keyword()) ::
              {:ok, term()} | {:error, term()}

  @doc "Builds (without executing) the datastore command to add one standard flow node."
  @callback build_add_standard_command(t, job :: map(), opts :: map()) ::
              {:ok, term()} | {:error, term()}

  @doc "Builds (without executing) the datastore command to add one parent flow node."
  @callback build_add_parent_command(t, job :: map(), opts :: map()) ::
              {:ok, term()} | {:error, term()}

  @doc "Registers a job scheduler and enqueues its next delayed iteration."
  @callback add_job_scheduler(
              t,
              scheduler_id :: String.t(),
              next_millis :: integer(),
              scheduler_opts :: map(),
              template_data :: String.t(),
              template_opts :: map(),
              delayed_opts :: map(),
              now :: integer(),
              producer_id :: String.t() | nil
            ) :: {:ok, term()} | {:error, term()}

  # ============================================================
  # Job state transitions
  # ============================================================

  @doc "Moves the next eligible job from wait/prioritized to active."
  @callback move_to_active(t, token :: String.t(), opts :: keyword()) ::
              {:ok, term()} | {:error, term()}

  @doc "Moves an active job to completed and optionally fetches the next job."
  @callback move_to_completed(
              t,
              job_id,
              token :: String.t(),
              return_value :: term(),
              opts :: keyword()
            ) :: {:ok, term()} | {:error, term()}

  @doc "Moves an active job to failed and optionally fetches the next job."
  @callback move_to_failed(
              t,
              job_id,
              token :: String.t(),
              error :: term(),
              opts :: keyword()
            ) :: {:ok, term()} | {:error, term()}

  @doc "Moves a job to the delayed state, scheduling it after `delay` ms."
  @callback move_to_delayed(
              t,
              job_id,
              token :: String.t(),
              delay :: integer(),
              opts :: keyword()
            ) :: {:ok, term()} | {:error, term()}

  @doc "Moves a parent job to the waiting-children state."
  @callback move_to_waiting_children(
              t,
              job_id,
              token :: String.t(),
              opts :: keyword()
            ) :: {:ok, term()} | {:error, term()}

  @doc "Moves a (manually rate-limited) job from active back to wait."
  @callback move_job_from_active_to_wait(t, job_id, token :: String.t()) ::
              {:ok, term()} | {:error, term()}

  @doc "Retries a failed/active job immediately by pushing it back to wait."
  @callback retry_job(
              t,
              job_id,
              lifo :: boolean(),
              token :: String.t(),
              opts :: keyword()
            ) :: {:ok, term()} | {:error, term()}

  @doc "Reprocesses a finished (failed/completed) job, moving it back to wait."
  @callback reprocess_job(
              t,
              job_id,
              state :: :failed | :completed,
              opts :: keyword()
            ) :: {:ok, term()} | {:error, term()}

  @doc "Promotes a single delayed job so it can be processed as soon as possible."
  @callback promote(t, job_id) :: {:ok, term()} | {:error, term()}

  @doc "Recovers stalled jobs (active jobs whose lock expired) back to wait."
  @callback move_stalled_jobs_to_wait(t, max_stalled_count :: integer(), opts :: keyword()) ::
              {:ok, term()} | {:error, term()}

  @doc """
  Runs a full stalled-job sweep: finds active jobs whose lock has expired and
  recovers/fails them, returning `%{recovered: n, failed: n}`.
  """
  @callback check_stalled_jobs(t, max_stalled_count :: integer()) ::
              {:ok, %{recovered: non_neg_integer(), failed: non_neg_integer()}}
              | {:error, term()}

  @doc "Returns whether a job currently holds a (non-expired) processing lock."
  @callback has_job_lock?(t, job_id) :: {:ok, boolean()} | {:error, term()}

  # ============================================================
  # Bulk admin transitions
  # ============================================================

  @doc "Pauses or resumes the whole queue."
  @callback pause(t, paused? :: boolean()) :: {:ok, term()} | {:error, term()}

  @doc "Removes waiting (and optionally delayed) jobs from the queue."
  @callback drain(t, delayed? :: boolean()) :: {:ok, term()} | {:error, term()}

  @doc "Removes jobs in a given state that are older than `grace` ms."
  @callback clean_jobs_by_state(
              t,
              state :: atom(),
              grace :: integer(),
              opts :: keyword()
            ) :: {:ok, [job_id]} | {:error, term()}

  @doc "Irreversibly destroys the queue and all of its contents."
  @callback obliterate(t, count :: integer(), force :: boolean()) ::
              {:ok, term()} | {:error, term()}

  # ============================================================
  # Locks
  # ============================================================

  @doc "Extends the lock of a single active job."
  @callback extend_lock(t, job_id, token :: String.t(), duration :: integer()) ::
              {:ok, term()} | {:error, term()}

  @doc "Extends the lock of several active jobs at once."
  @callback extend_locks(
              t,
              job_ids :: [job_id],
              tokens :: [String.t()],
              duration :: integer()
            ) :: {:ok, term()} | {:error, term()}

  @doc "Releases the lock of a single active job."
  @callback release_lock(t, job_id, token :: String.t()) ::
              {:ok, term()} | {:error, term()}

  # ============================================================
  # Job mutations
  # ============================================================

  @doc "Replaces a job's data payload."
  @callback update_data(t, job_id, data :: term()) :: {:ok, term()} | {:error, term()}

  @doc "Updates a job's progress and emits the corresponding event."
  @callback update_progress(t, job_id, progress :: term()) ::
              {:ok, term()} | {:error, term()}

  @doc "Appends a row to a job's log, optionally trimming old entries."
  @callback add_log(t, job_id, log_row :: String.t(), keep_logs :: integer() | nil) ::
              {:ok, term()} | {:error, term()}

  @doc "Removes a job and (optionally) its children."
  @callback remove(t, job_id, remove_children :: boolean()) ::
              {:ok, term()} | {:error, term()}

  @doc "Removes a deduplication key if it still maps to the given job."
  @callback remove_deduplication_key(t, deduplication_id :: String.t(), job_id) ::
              {:ok, term()} | {:error, term()}

  @doc "Unconditionally deletes a deduplication key."
  @callback delete_deduplication_key(t, deduplication_id :: String.t()) ::
              {:ok, term()} | {:error, term()}

  # ============================================================
  # Job schedulers
  # ============================================================

  @doc "Updates the next-run time of a job scheduler and enqueues the next job."
  @callback update_job_scheduler(
              t,
              scheduler_id :: String.t(),
              next_millis :: integer(),
              template_data :: term(),
              delayed_job_opts :: map(),
              producer_id :: String.t() | nil
            ) :: {:ok, term()} | {:error, term()}

  @doc "Removes a job scheduler."
  @callback remove_job_scheduler(t, scheduler_id :: String.t()) ::
              {:ok, term()} | {:error, term()}

  @doc "Returns a job scheduler's raw metadata and template."
  @callback get_job_scheduler(t, id :: String.t()) :: {:ok, term()} | {:error, term()}

  @doc "Returns a page of scheduler ids with next-run scores, flattened `[id, score, ...]`."
  @callback get_job_schedulers_range(t, start :: integer(), stop :: integer(), asc :: boolean()) ::
              {:ok, [String.t()]} | {:error, term()}

  @doc "Returns the number of registered job schedulers."
  @callback get_job_schedulers_count(t) :: {:ok, non_neg_integer()} | {:error, term()}

  # ============================================================
  # Queue / job queries
  # ============================================================

  @doc "Returns the current state of a job."
  @callback get_state(t, job_id) :: {:ok, term()} | {:error, term()}

  @doc "Returns the stored data for a job, or `nil` if it is missing."
  @callback get_job_data(t, job_id) :: {:ok, term()} | {:error, term()}

  @doc "Returns a page of a job's logs and the total log count."
  @callback get_job_logs(t, job_id, start :: integer(), stop :: integer(), asc :: boolean()) ::
              {:ok, %{logs: [String.t()], count: non_neg_integer()}} | {:error, term()}

  @doc "Returns the raw processed-children hash entries (flat `[k, v, ...]`)."
  @callback get_processed_children_values(t, job_id) :: {:ok, [String.t()]} | {:error, term()}

  @doc "Returns the raw ignored-children failure hash entries (flat `[k, v, ...]`)."
  @callback get_ignored_children_failures(t, job_id) :: {:ok, [String.t()]} | {:error, term()}

  @doc "Returns the pending (unprocessed) child dependency keys."
  @callback get_dependencies(t, job_id) :: {:ok, [String.t()]} | {:error, term()}

  @doc "Returns the count of pending child dependencies."
  @callback get_dependencies_count(t, job_id) :: {:ok, non_neg_integer()} | {:error, term()}

  @doc "Returns whether the queue has reached its concurrency limit."
  @callback is_maxed(t) :: {:ok, boolean()} | {:error, term()}

  @doc "Returns the ttl (ms) of the current rate-limit window."
  @callback get_rate_limit_ttl(t, opts :: keyword()) :: {:ok, term()} | {:error, term()}

  @doc "Returns the job counts across states."
  @callback get_counts(t) :: {:ok, term()} | {:error, term()}

  @doc "Returns the job count for each of the given `types`, in order."
  @callback get_counts_by_types(t, types :: [atom()]) ::
              {:ok, [non_neg_integer()]} | {:error, term()}

  @doc "Returns a page of job ids for the given states/types."
  @callback get_ranges(t, types :: [atom() | String.t()], start :: integer(), stop :: integer()) ::
              {:ok, term()} | {:error, term()}

  @doc "Returns completed/failed metrics for the queue."
  @callback get_metrics(t, type :: :completed | :failed, start :: integer(), stop :: integer()) ::
              {:ok, term()} | {:error, term()}

  @doc "Returns the job id currently holding the given deduplication key."
  @callback get_deduplication_job_id(t, deduplication_id :: String.t()) ::
              {:ok, term()} | {:error, term()}

  @doc "Returns the raw client list(s) for the queue's datastore."
  @callback get_client_list(t) :: {:ok, [String.t()]} | {:error, term()}

  @doc """
  Returns the workers connected to the queue (parsed and filtered by the queue's
  client-name convention). `opts` may carry `:cluster_connections`.
  """
  @callback get_workers(t, opts :: keyword()) :: {:ok, [map()]} | {:error, term()}

  # ============================================================
  # Queue metadata & maintenance keys
  # ============================================================

  @doc "Sets one or more queue metadata fields."
  @callback set_queue_meta(t, values :: map()) :: {:ok, term()} | {:error, term()}

  @doc "Reads a single queue metadata field."
  @callback get_queue_meta_field(t, field :: String.t()) ::
              {:ok, String.t() | nil} | {:error, term()}

  @doc "Reads several queue metadata fields at once, in order."
  @callback get_queue_meta_fields(t, fields :: [String.t()]) ::
              {:ok, [String.t() | nil]} | {:error, term()}

  @doc "Reads the entire queue metadata hash."
  @callback get_queue_meta(t) :: {:ok, map()} | {:error, term()}

  @doc "Returns whether a queue metadata field exists."
  @callback has_queue_meta_field(t, field :: String.t()) ::
              {:ok, boolean()} | {:error, term()}

  # ============================================================
  # Event stream
  # ============================================================

  @doc "Publishes a custom event to the queue's event stream."
  @callback publish_event(t, fields :: map(), max_events :: integer()) ::
              {:ok, String.t()} | {:error, term()}

  @doc """
  Blocks (up to `block_timeout` ms) reading the queue's event stream for entries
  newer than `id`, returning the raw stream entries (or a falsy value on
  timeout).
  """
  @callback read_events(t, id :: String.t(), block_timeout :: integer()) ::
              {:ok, term()} | {:error, term()}

  # ============================================================
  # Worker blocking primitive
  # ============================================================

  @doc """
  Blocks (up to `block_timeout` seconds) until the queue signals that a new job
  may be available.

  Returns `{:job_available, block_until}` when a marker was found (`block_until`
  is the next delayed job's timestamp, or `nil` for an immediately-available
  job), `:timeout` when nothing appeared, or `{:error, reason}`.
  """
  @callback wait_for_job(t, block_timeout :: number()) ::
              {:job_available, integer() | nil} | :timeout | {:error, term()}

  @doc "Interrupts the backend's in-flight blocking wait."
  @callback disconnect_blocking(t, wait? :: boolean()) :: :ok

  @doc "Re-establishes the backend's blocking connection after an interrupt."
  @callback reconnect_blocking(t) :: {:ok, t} | {:error, term()}

  @optional_callbacks [
    add_flow: 3,
    build_add_standard_command: 3,
    build_add_parent_command: 3,
    add_job_scheduler: 9,
    update_job_scheduler: 6,
    remove_job_scheduler: 2,
    get_job_scheduler: 2,
    get_job_schedulers_range: 4,
    get_job_schedulers_count: 1,
    get_workers: 2,
    check_stalled_jobs: 2,
    has_job_lock?: 2,
    read_events: 3,
    publish_event: 3,
    wait_for_job: 2,
    disconnect_blocking: 2,
    reconnect_blocking: 1
  ]

  # ============================================================
  # Dispatcher functions
  #
  # Thin wrappers that delegate to the concrete adapter module identified by the
  # backend struct (`backend.__struct__`). Callers use these instead of calling
  # an adapter module directly, so they depend only on this abstraction.
  # ============================================================

  @doc """
  Builds a backend for `name` using the configured backend factory.

  Mirrors the Node.js `defaultBackendFactory`: the default is the Redis adapter
  (`BullMQ.Backends.Redis`), but it can be overridden per call with the
  `:backend` option or globally via `config :bullmq, :backend, MyAdapter`. The
  chosen module must export `new/2`.
  """
  @spec create(String.t(), keyword()) :: t()
  def create(name, opts) do
    factory =
      Keyword.get(opts, :backend) ||
        Application.get_env(:bullmq, :backend, BullMQ.Backends.Redis)

    factory.new(name, opts)
  end

  @compile {:inline, dispatch: 3}
  defp dispatch(%mod{} = backend, fun, args), do: apply(mod, fun, [backend | args])

  # -- Connection lifecycle --
  @spec wait_until_ready(t) :: :ok | {:error, term()}
  def wait_until_ready(b), do: dispatch(b, :wait_until_ready, [])

  @spec close(t, boolean()) :: :ok
  def close(b, force \\ false), do: dispatch(b, :close, [force])

  @spec disconnect(t) :: :ok
  def disconnect(b), do: dispatch(b, :disconnect, [])

  @spec set_name(t, String.t()) :: :ok | {:error, term()}
  def set_name(b, name), do: dispatch(b, :set_name, [name])

  @spec for_queue(t, String.t(), String.t() | nil) :: t
  def for_queue(b, queue_name, prefix \\ nil), do: dispatch(b, :for_queue, [queue_name, prefix])

  # -- Identity & keys --
  @spec qualified_name(t) :: String.t()
  def qualified_name(b), do: dispatch(b, :qualified_name, [])

  @spec context(t) :: context()
  def context(b), do: dispatch(b, :context, [])

  @spec to_key(t, String.t()) :: String.t()
  def to_key(b, type), do: dispatch(b, :to_key, [type])

  @spec parse_node_key(t, String.t()) :: map()
  def parse_node_key(b, key), do: dispatch(b, :parse_node_key, [key])

  @spec client_name(t, String.t() | nil) :: String.t()
  def client_name(b, suffix \\ nil), do: dispatch(b, :client_name, [suffix])

  # -- Adding jobs --
  @spec add_job(t, struct(), keyword()) :: {:ok, job_id} | {:error, term()}
  def add_job(b, job, opts \\ []), do: dispatch(b, :add_job, [job, opts])

  @spec add_jobs(t, list(), keyword()) :: {:ok, [job_id]} | {:error, term()}
  def add_jobs(b, jobs_with_opts, opts \\ []), do: dispatch(b, :add_jobs, [jobs_with_opts, opts])

  @spec add_flow(t, list(), keyword()) :: {:ok, term()} | {:error, term()}
  def add_flow(b, entries, opts \\ []), do: dispatch(b, :add_flow, [entries, opts])

  @spec build_add_standard_command(t, map(), map()) :: {:ok, term()} | {:error, term()}
  def build_add_standard_command(b, job, opts),
    do: dispatch(b, :build_add_standard_command, [job, opts])

  @spec build_add_parent_command(t, map(), map()) :: {:ok, term()} | {:error, term()}
  def build_add_parent_command(b, job, opts),
    do: dispatch(b, :build_add_parent_command, [job, opts])

  @spec add_job_scheduler(t, String.t(), integer(), map(), String.t(), map(), map(), integer(), String.t() | nil) ::
          {:ok, term()} | {:error, term()}
  def add_job_scheduler(
        b,
        scheduler_id,
        next_millis,
        scheduler_opts,
        template_data,
        template_opts,
        delayed_opts,
        now,
        producer_id \\ nil
      ) do
    dispatch(b, :add_job_scheduler, [
      scheduler_id,
      next_millis,
      scheduler_opts,
      template_data,
      template_opts,
      delayed_opts,
      now,
      producer_id
    ])
  end

  # -- State transitions --
  @spec move_to_active(t, String.t(), keyword()) :: {:ok, term()} | {:error, term()}
  def move_to_active(b, token, opts \\ []), do: dispatch(b, :move_to_active, [token, opts])

  @spec move_to_completed(t, job_id, String.t(), term(), keyword()) ::
          {:ok, term()} | {:error, term()}
  def move_to_completed(b, job_id, token, return_value, opts \\ []),
    do: dispatch(b, :move_to_completed, [job_id, token, return_value, opts])

  @spec move_to_failed(t, job_id, String.t(), term(), keyword()) ::
          {:ok, term()} | {:error, term()}
  def move_to_failed(b, job_id, token, error, opts \\ []),
    do: dispatch(b, :move_to_failed, [job_id, token, error, opts])

  @spec move_to_delayed(t, job_id, String.t(), integer(), keyword()) ::
          {:ok, term()} | {:error, term()}
  def move_to_delayed(b, job_id, token, delay, opts \\ []),
    do: dispatch(b, :move_to_delayed, [job_id, token, delay, opts])

  @spec move_to_waiting_children(t, job_id, String.t(), keyword()) ::
          {:ok, term()} | {:error, term()}
  def move_to_waiting_children(b, job_id, token, opts \\ []),
    do: dispatch(b, :move_to_waiting_children, [job_id, token, opts])

  @spec move_job_from_active_to_wait(t, job_id, String.t()) :: {:ok, term()} | {:error, term()}
  def move_job_from_active_to_wait(b, job_id, token \\ "0"),
    do: dispatch(b, :move_job_from_active_to_wait, [job_id, token])

  @spec retry_job(t, job_id, boolean(), String.t(), keyword()) :: {:ok, term()} | {:error, term()}
  def retry_job(b, job_id, lifo, token, opts \\ []),
    do: dispatch(b, :retry_job, [job_id, lifo, token, opts])

  @spec reprocess_job(t, job_id, :failed | :completed, keyword()) ::
          {:ok, term()} | {:error, term()}
  def reprocess_job(b, job_id, state, opts \\ []),
    do: dispatch(b, :reprocess_job, [job_id, state, opts])

  @spec promote(t, job_id) :: {:ok, term()} | {:error, term()}
  def promote(b, job_id), do: dispatch(b, :promote, [job_id])

  @spec move_stalled_jobs_to_wait(t, integer(), keyword()) :: {:ok, term()} | {:error, term()}
  def move_stalled_jobs_to_wait(b, max_stalled_count, opts \\ []),
    do: dispatch(b, :move_stalled_jobs_to_wait, [max_stalled_count, opts])

  @spec check_stalled_jobs(t, integer()) ::
          {:ok, %{recovered: non_neg_integer(), failed: non_neg_integer()}} | {:error, term()}
  def check_stalled_jobs(b, max_stalled_count),
    do: dispatch(b, :check_stalled_jobs, [max_stalled_count])

  @spec has_job_lock?(t, job_id) :: {:ok, boolean()} | {:error, term()}
  def has_job_lock?(b, job_id), do: dispatch(b, :has_job_lock?, [job_id])

  # -- Bulk admin --
  @spec pause(t, boolean()) :: {:ok, term()} | {:error, term()}
  def pause(b, paused?), do: dispatch(b, :pause, [paused?])

  @spec drain(t, boolean()) :: {:ok, term()} | {:error, term()}
  def drain(b, delayed?), do: dispatch(b, :drain, [delayed?])

  @spec clean_jobs_by_state(t, atom(), integer(), keyword()) :: {:ok, [job_id]} | {:error, term()}
  def clean_jobs_by_state(b, state, grace, opts \\ []),
    do: dispatch(b, :clean_jobs_by_state, [state, grace, opts])

  @spec obliterate(t, integer(), boolean()) :: {:ok, term()} | {:error, term()}
  def obliterate(b, count, force \\ false), do: dispatch(b, :obliterate, [count, force])

  # -- Locks --
  @spec extend_lock(t, job_id, String.t(), integer()) :: {:ok, term()} | {:error, term()}
  def extend_lock(b, job_id, token, duration),
    do: dispatch(b, :extend_lock, [job_id, token, duration])

  @spec extend_locks(t, [job_id], [String.t()], integer()) :: {:ok, term()} | {:error, term()}
  def extend_locks(b, job_ids, tokens, duration),
    do: dispatch(b, :extend_locks, [job_ids, tokens, duration])

  @spec release_lock(t, job_id, String.t()) :: {:ok, term()} | {:error, term()}
  def release_lock(b, job_id, token), do: dispatch(b, :release_lock, [job_id, token])

  # -- Job mutations --
  @spec update_data(t, job_id, term()) :: {:ok, term()} | {:error, term()}
  def update_data(b, job_id, data), do: dispatch(b, :update_data, [job_id, data])

  @spec update_progress(t, job_id, term()) :: {:ok, term()} | {:error, term()}
  def update_progress(b, job_id, progress), do: dispatch(b, :update_progress, [job_id, progress])

  @spec add_log(t, job_id, String.t(), integer() | nil) :: {:ok, term()} | {:error, term()}
  def add_log(b, job_id, log_row, keep_logs \\ nil),
    do: dispatch(b, :add_log, [job_id, log_row, keep_logs])

  @spec remove(t, job_id, boolean()) :: {:ok, term()} | {:error, term()}
  def remove(b, job_id, remove_children \\ false),
    do: dispatch(b, :remove, [job_id, remove_children])

  @spec remove_deduplication_key(t, String.t(), job_id) :: {:ok, term()} | {:error, term()}
  def remove_deduplication_key(b, deduplication_id, job_id),
    do: dispatch(b, :remove_deduplication_key, [deduplication_id, job_id])

  @spec delete_deduplication_key(t, String.t()) :: {:ok, term()} | {:error, term()}
  def delete_deduplication_key(b, deduplication_id),
    do: dispatch(b, :delete_deduplication_key, [deduplication_id])

  # -- Job schedulers --
  @spec update_job_scheduler(t, String.t(), integer(), term(), map(), String.t() | nil) ::
          {:ok, term()} | {:error, term()}
  def update_job_scheduler(
        b,
        scheduler_id,
        next_millis,
        template_data,
        delayed_job_opts,
        producer_id \\ nil
      ) do
    dispatch(b, :update_job_scheduler, [
      scheduler_id,
      next_millis,
      template_data,
      delayed_job_opts,
      producer_id
    ])
  end

  @spec remove_job_scheduler(t, String.t()) :: {:ok, term()} | {:error, term()}
  def remove_job_scheduler(b, scheduler_id),
    do: dispatch(b, :remove_job_scheduler, [scheduler_id])

  @spec get_job_scheduler(t, String.t()) :: {:ok, term()} | {:error, term()}
  def get_job_scheduler(b, id), do: dispatch(b, :get_job_scheduler, [id])

  @spec get_job_schedulers_range(t, integer(), integer(), boolean()) ::
          {:ok, [String.t()]} | {:error, term()}
  def get_job_schedulers_range(b, start, stop, asc),
    do: dispatch(b, :get_job_schedulers_range, [start, stop, asc])

  @spec get_job_schedulers_count(t) :: {:ok, non_neg_integer()} | {:error, term()}
  def get_job_schedulers_count(b), do: dispatch(b, :get_job_schedulers_count, [])

  # -- Queries --
  @spec get_state(t, job_id) :: {:ok, term()} | {:error, term()}
  def get_state(b, job_id), do: dispatch(b, :get_state, [job_id])

  @spec get_job_data(t, job_id) :: {:ok, term()} | {:error, term()}
  def get_job_data(b, job_id), do: dispatch(b, :get_job_data, [job_id])

  @spec get_job_logs(t, job_id, integer(), integer(), boolean()) ::
          {:ok, %{logs: [String.t()], count: non_neg_integer()}} | {:error, term()}
  def get_job_logs(b, job_id, start, stop, asc),
    do: dispatch(b, :get_job_logs, [job_id, start, stop, asc])

  @spec is_maxed(t) :: {:ok, boolean()} | {:error, term()}
  def is_maxed(b), do: dispatch(b, :is_maxed, [])

  @spec get_processed_children_values(t, job_id) :: {:ok, [String.t()]} | {:error, term()}
  def get_processed_children_values(b, job_id),
    do: dispatch(b, :get_processed_children_values, [job_id])

  @spec get_ignored_children_failures(t, job_id) :: {:ok, [String.t()]} | {:error, term()}
  def get_ignored_children_failures(b, job_id),
    do: dispatch(b, :get_ignored_children_failures, [job_id])

  @spec get_dependencies(t, job_id) :: {:ok, [String.t()]} | {:error, term()}
  def get_dependencies(b, job_id), do: dispatch(b, :get_dependencies, [job_id])

  @spec get_dependencies_count(t, job_id) :: {:ok, non_neg_integer()} | {:error, term()}
  def get_dependencies_count(b, job_id), do: dispatch(b, :get_dependencies_count, [job_id])

  @spec get_rate_limit_ttl(t, keyword()) :: {:ok, term()} | {:error, term()}
  def get_rate_limit_ttl(b, opts \\ []), do: dispatch(b, :get_rate_limit_ttl, [opts])

  @spec get_counts(t) :: {:ok, term()} | {:error, term()}
  def get_counts(b), do: dispatch(b, :get_counts, [])

  @spec get_counts_by_types(t, [atom()]) :: {:ok, [non_neg_integer()]} | {:error, term()}
  def get_counts_by_types(b, types), do: dispatch(b, :get_counts_by_types, [types])

  @spec get_ranges(t, [atom() | String.t()], integer(), integer()) ::
          {:ok, term()} | {:error, term()}
  def get_ranges(b, types, start, stop), do: dispatch(b, :get_ranges, [types, start, stop])

  @spec get_metrics(t, :completed | :failed, integer(), integer()) ::
          {:ok, term()} | {:error, term()}
  def get_metrics(b, type, start \\ 0, stop \\ -1),
    do: dispatch(b, :get_metrics, [type, start, stop])

  @spec get_deduplication_job_id(t, String.t()) :: {:ok, term()} | {:error, term()}
  def get_deduplication_job_id(b, deduplication_id),
    do: dispatch(b, :get_deduplication_job_id, [deduplication_id])

  @spec get_client_list(t) :: {:ok, [String.t()]} | {:error, term()}
  def get_client_list(b), do: dispatch(b, :get_client_list, [])

  @spec get_workers(t, keyword()) :: {:ok, [map()]} | {:error, term()}
  def get_workers(b, opts \\ []), do: dispatch(b, :get_workers, [opts])

  # -- Queue metadata --
  @spec set_queue_meta(t, map()) :: {:ok, term()} | {:error, term()}
  def set_queue_meta(b, values), do: dispatch(b, :set_queue_meta, [values])

  @spec get_queue_meta_field(t, String.t()) :: {:ok, String.t() | nil} | {:error, term()}
  def get_queue_meta_field(b, field), do: dispatch(b, :get_queue_meta_field, [field])

  @spec get_queue_meta_fields(t, [String.t()]) :: {:ok, [String.t() | nil]} | {:error, term()}
  def get_queue_meta_fields(b, fields), do: dispatch(b, :get_queue_meta_fields, [fields])

  @spec get_queue_meta(t) :: {:ok, map()} | {:error, term()}
  def get_queue_meta(b), do: dispatch(b, :get_queue_meta, [])

  @spec has_queue_meta_field(t, String.t()) :: {:ok, boolean()} | {:error, term()}
  def has_queue_meta_field(b, field), do: dispatch(b, :has_queue_meta_field, [field])

  # -- Event stream --
  @spec publish_event(t, map(), integer()) :: {:ok, String.t()} | {:error, term()}
  def publish_event(b, fields, max_events), do: dispatch(b, :publish_event, [fields, max_events])

  @spec read_events(t, String.t(), integer()) :: {:ok, term()} | {:error, term()}
  def read_events(b, id, block_timeout), do: dispatch(b, :read_events, [id, block_timeout])

  # -- Worker blocking --
  @spec wait_for_job(t, number()) ::
          {:job_available, integer() | nil} | :timeout | {:error, term()}
  def wait_for_job(b, block_timeout), do: dispatch(b, :wait_for_job, [block_timeout])

  @spec disconnect_blocking(t, boolean()) :: :ok
  def disconnect_blocking(b, wait? \\ false), do: dispatch(b, :disconnect_blocking, [wait?])

  @spec reconnect_blocking(t) :: {:ok, t} | {:error, term()}
  def reconnect_blocking(b), do: dispatch(b, :reconnect_blocking, [])
end
