defmodule BullMQ.Queue do
  @moduledoc """
  Queue management for BullMQ.

  A Queue is the main entry point for adding jobs to be processed. It provides
  methods for adding single jobs, bulk jobs, and managing queue state.

  ## Usage

  The simplest way to use a queue is through the module functions:

      # Add a job
      {:ok, job} = BullMQ.Queue.add("my_queue", "email", %{to: "user@example.com"},
        connection: :my_redis)

      # Add a delayed job
      {:ok, job} = BullMQ.Queue.add("my_queue", "email", %{to: "user@example.com"},
        connection: :my_redis,
        delay: 60_000)  # 1 minute delay

      # Add a prioritized job
      {:ok, job} = BullMQ.Queue.add("my_queue", "email", %{to: "user@example.com"},
        connection: :my_redis,
        priority: 1)  # Higher priority (lower number = higher priority)

  ## Using as a GenServer

  For more control, you can start a Queue as a supervised process:

      children = [
        {BullMQ.Queue, name: :my_queue, queue: "my_queue", connection: :my_redis}
      ]

      # Then use it by name
      {:ok, job} = BullMQ.Queue.add(:my_queue, "email", %{to: "user@example.com"})

  ## Job Options

  When adding jobs, you can specify various options:

    * `:job_id` - Custom job ID (auto-generated if not provided)
    * `:delay` - Delay in milliseconds before the job becomes active
    * `:priority` - Job priority (0 = highest, default)
    * `:attempts` - Max number of retry attempts (default: 1)
    * `:backoff` - Retry backoff configuration
    * `:lifo` - Use LIFO ordering instead of FIFO
    * `:timeout` - Job timeout in milliseconds
    * `:remove_on_complete` - Remove job after completion (true/false/age/count)
    * `:remove_on_fail` - Remove job after failure (true/false/age/count)
    * `:repeat` - Repeat/scheduling options
    * `:parent` - Parent job reference for job flows

  ## Queue Operations

      # Pause the queue
      :ok = BullMQ.Queue.pause("my_queue", connection: :my_redis)

      # Resume the queue
      :ok = BullMQ.Queue.resume("my_queue", connection: :my_redis)

      # Get queue counts
      {:ok, counts} = BullMQ.Queue.get_counts("my_queue", connection: :my_redis)
      # %{waiting: 10, active: 2, delayed: 5, completed: 100, failed: 3}

      # Drain the queue (remove all waiting jobs)
      :ok = BullMQ.Queue.drain("my_queue", connection: :my_redis)
  """

  use GenServer

  alias BullMQ.{Job, Keys, RedisConnection, Scripts, Types, Version}

  require Logger

  @opts_schema NimbleOptions.new!(
                 name: [
                   type: :atom,
                   required: true,
                   doc: "The name to register the GenServer process under."
                 ],
                 queue: [
                   type: :string,
                   required: true,
                   doc: "The name of the queue."
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
                 default_job_opts: [
                   type: :map,
                   default: %{},
                   doc: "Default options to apply to all jobs added through this queue."
                 ],
                 telemetry: [
                   type: :atom,
                   default: nil,
                   doc:
                     "Module implementing `BullMQ.Telemetry.Behaviour` for distributed tracing (e.g., `BullMQ.Telemetry.OpenTelemetry`)."
                 ],
                 skip_meta_update: [
                   type: :boolean,
                   default: false,
                   doc: "Skip updating queue metadata (version, maxLenEvents) in Redis on init."
                 ],
                 streams: [
                   type: :keyword_list,
                   default: [],
                   doc: "Stream configuration options.",
                   keys: [
                     events: [
                       type: :keyword_list,
                       default: [],
                       doc: "Event stream configuration.",
                       keys: [
                         max_len: [
                           type: :pos_integer,
                           default: 10_000,
                           doc: "Maximum length of the event stream."
                         ]
                       ]
                     ]
                   ]
                 ]
               )

  @type t :: %__MODULE__{
          name: String.t(),
          connection: Types.redis_connection(),
          prefix: String.t(),
          default_job_opts: map(),
          keys: Keys.queue_context(),
          telemetry: module() | nil
        }

  defstruct [
    :name,
    :connection,
    :keys,
    :telemetry,
    prefix: "bull",
    default_job_opts: %{}
  ]

  # Client API - Stateless functions

  @doc """
  Adds a job to the queue.

  ## Parameters

    * `queue` - Queue name (string) or Queue GenServer name (atom/pid)
    * `name` - Job name/type
    * `data` - Job data payload
    * `opts` - Job and connection options

  ## Options

    * `:connection` - Redis connection (required when using queue name string)
    * `:prefix` - Queue prefix (default: "bull")
    * `:job_id` - Custom job ID
    * `:delay` - Delay in milliseconds
    * `:priority` - Job priority (0 = highest)
    * `:attempts` - Max retry attempts
    * `:backoff` - Backoff configuration
    * `:lifo` - Use LIFO ordering
    * `:remove_on_complete` - Job removal after completion
    * `:remove_on_fail` - Job removal after failure

  ## Examples

      # Add a simple job
      {:ok, job} = BullMQ.Queue.add("emails", "welcome", %{user_id: 123},
        connection: :redis)

      # Add a delayed job
      {:ok, job} = BullMQ.Queue.add("emails", "reminder", %{user_id: 123},
        connection: :redis,
        delay: :timer.hours(24))

      # Add a job with retries
      {:ok, job} = BullMQ.Queue.add("payments", "process", %{amount: 100},
        connection: :redis,
        attempts: 5,
        backoff: %{type: :exponential, delay: 1000})
  """
  @spec add(atom() | pid() | String.t(), Types.job_name(), Types.job_data(), keyword()) ::
          {:ok, Job.t()} | {:error, term()}
  def add(queue, name, data, opts \\ [])

  def add(queue, name, data, opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, {:add, name, data, opts})
  end

  def add(queue, name, data, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.new(queue, prefix: prefix)

    job = Job.new(queue, name, data, opts)
    add_job(conn, ctx, job)
  end

  @doc """
  Adds multiple jobs to the queue in a single operation.

  Uses Redis pipelining for high throughput. Standard jobs (no delay/priority)
  are processed via optimized bulk commands achieving ~50,000+ jobs/sec.

  ## Arguments

    * `queue` - Queue name (string) or Queue GenServer reference (atom/pid)
    * `jobs` - List of job tuples: `{name, data, opts}`
    * `opts` - Bulk operation options

  ## Options

    * `:connection` - Redis connection (required when using queue name string)
    * `:prefix` - Queue prefix (default: "bull")
    * `:pipeline` - Use pipelining for efficiency (default: `true`)
    * `:atomic` - Wrap pipeline batches in MULTI/EXEC transactions (default: `true`).
      When `true`, each pipeline batch is executed atomically. When using `:connection_pool`,
      each connection's batch is atomic independently, but the overall bulk operation across
      all connections is **not** atomic. Set to `false` for slightly higher throughput when
      atomicity is not required.
    * `:connection_pool` - List of Redis connections for parallel execution (optional).
      When provided, commands are distributed across connections for higher throughput.
      Use this when you need maximum performance and have multiple connections available.
    * `:max_pipeline_size` - Max commands per pipeline batch (default: `10_000`)

  ## Performance

  Default single connection: ~50,000 jobs/sec
  With 4-connection pool: ~70,000+ jobs/sec

  ## Examples

      # Basic bulk add (uses pipelining automatically)
      jobs = [
        {"email", %{to: "user1@example.com"}, []},
        {"email", %{to: "user2@example.com"}, []},
        {"email", %{to: "user3@example.com"}, [priority: 1]}
      ]
      {:ok, added_jobs} = BullMQ.Queue.add_bulk("emails", jobs, connection: :redis)

      # High-performance bulk add with connection pool (~60K jobs/sec)
      # For production, add these connections to your application's supervision tree.
      # This example shows manual creation for illustration purposes only.
      pool = for i <- 1..8 do
        name = :"redis_pool_\#{i}"
        {:ok, _} = BullMQ.RedisConnection.start_link(host: "localhost", name: name)
        name
      end

      # Then use the pool for parallel execution (~70K+ jobs/sec)
      {:ok, jobs} = BullMQ.Queue.add_bulk("emails", large_job_list,
        connection: hd(pool),
        connection_pool: pool
      )

      # Disable pipelining (sequential mode, much slower)
      {:ok, jobs} = BullMQ.Queue.add_bulk("emails", jobs,
        connection: :redis,
        pipeline: false
      )

  ## Notes

    * Standard jobs (no delay or priority) use optimized pipelining
    * Delayed and prioritized jobs fall back to sequential processing
    * Returns `{:error, {:partial_failure, results}}` if some jobs fail
    * Connection pool connections should be supervised in production (e.g., added
      to your application's supervision tree) to ensure proper lifecycle management
      and automatic reconnection on failures
  """
  @spec add_bulk(
          atom() | pid() | String.t(),
          [{Types.job_name(), Types.job_data(), keyword()}],
          keyword()
        ) ::
          {:ok, [Job.t()]} | {:error, term()}
  def add_bulk(queue, jobs, opts \\ [])

  def add_bulk(queue, jobs, opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, {:add_bulk, jobs, opts})
  end

  def add_bulk(queue, jobs, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.new(queue, prefix: prefix)
    pipeline = Keyword.get(opts, :pipeline, true)

    if pipeline do
      # Use pipelined version for efficiency
      add_bulk_pipelined(conn, ctx, queue, jobs, opts)
    else
      # Fallback to sequential adds
      add_bulk_sequential(conn, ctx, queue, jobs, opts)
    end
  end

  # Maximum jobs per single pipeline call (to avoid Redis timeout)
  @max_pipeline_size 10_000

  defp add_bulk_pipelined(conn, ctx, queue, jobs, opts) do
    # Separate jobs by type (standard, delayed, prioritized)
    {standard_jobs, other_jobs} =
      Enum.split_with(jobs, fn {_name, _data, job_opts} ->
        merged = Keyword.merge(opts, job_opts)
        delay = Keyword.get(merged, :delay, 0)
        priority = Keyword.get(merged, :priority, 0)
        delay == 0 and priority == 0
      end)

    # For standard jobs, use optimized single-pipeline approach
    standard_results =
      if Enum.empty?(standard_jobs) do
        []
      else
        # Ensure scripts are loaded and SHA is cached
        Scripts.ensure_scripts_loaded(conn, [:add_standard_job])

        # Prepare jobs with opts for bulk command building
        # Job IDs are auto-generated by Redis via INCR, unless a custom :job_id is provided
        jobs_with_opts =
          Enum.map(standard_jobs, fn {name, data, job_opts} ->
            merged_opts = Keyword.merge(opts, job_opts)
            job = Job.new(queue, name, data, merged_opts)
            encoded_opts = encode_job_opts(job.opts)
            {job, encoded_opts}
          end)

        # Build all commands efficiently using optimized bulk builder
        {:ok, jobs_and_commands} = Scripts.build_bulk_add_commands(ctx, jobs_with_opts)
        {jobs_list, commands} = Enum.unzip(jobs_and_commands)

        # Execute commands - optionally in parallel with connection pool
        max_pipeline = Keyword.get(opts, :max_pipeline_size, @max_pipeline_size)
        connection_pool = Keyword.get(opts, :connection_pool)
        atomic = Keyword.get(opts, :atomic, true)

        results = execute_pipeline_commands(conn, commands, max_pipeline, connection_pool, atomic)

        # Match results with jobs
        Enum.zip(jobs_list, results)
        |> Enum.map(fn
          {job, {:ok, job_id}} when is_binary(job_id) or is_integer(job_id) ->
            {:ok, %{job | id: to_string(job_id)}}

          {_job, {:error, _} = err} ->
            err

          {job, {:ok, other}} ->
            {:ok, %{job | id: to_string(other)}}
        end)
      end

    # For other jobs (delayed/prioritized), fall back to sequential
    other_results =
      Enum.map(other_jobs, fn {name, data, job_opts} ->
        merged_opts = Keyword.merge(opts, job_opts)
        job = Job.new(queue, name, data, merged_opts)
        add_job(conn, ctx, job)
      end)

    all_results = standard_results ++ other_results
    errors = Enum.filter(all_results, &match?({:error, _}, &1))

    if Enum.empty?(errors) do
      {:ok, Enum.map(all_results, fn {:ok, job} -> job end)}
    else
      {:error, {:partial_failure, all_results}}
    end
  end

  # Execute pipeline commands using either MULTI/EXEC transactions (atomic) or plain pipeline.
  # Default is atomic (MULTI/EXEC) which provides atomicity with nearly identical performance.
  # Set atomic: false for slightly higher throughput when atomicity is not required.
  #
  # When using connection_pool with atomic: true, each batch is atomic within its connection,
  # but the overall operation is not atomic across connections.
  defp execute_pipeline_commands(conn, commands, max_pipeline, nil, atomic) do
    # Single connection mode (default)
    execute_fn = if atomic, do: &Scripts.execute_transaction/2, else: &Scripts.execute_pipeline/2

    commands
    |> Enum.chunk_every(max_pipeline)
    |> Enum.flat_map(fn command_batch ->
      case execute_fn.(conn, command_batch) do
        {:ok, batch_results} -> batch_results
        {:error, reason} -> Enum.map(command_batch, fn _ -> {:error, reason} end)
      end
    end)
  end

  defp execute_pipeline_commands(_conn, commands, max_pipeline, pool, atomic) when is_list(pool) do
    # Parallel execution across connection pool
    execute_fn = if atomic, do: &Scripts.execute_transaction/2, else: &Scripts.execute_pipeline/2
    pool_size = length(pool)

    # Split commands into chunks for each connection
    # Each connection gets roughly equal work
    chunk_size = max(div(length(commands), pool_size), 1)

    commands
    |> Enum.chunk_every(chunk_size)
    |> Enum.with_index()
    |> Task.async_stream(
      fn {chunk, idx} ->
        # Round-robin connection assignment
        pool_conn = Enum.at(pool, rem(idx, pool_size))

        # Execute this chunk's commands (possibly in sub-batches for very large chunks)
        chunk
        |> Enum.chunk_every(max_pipeline)
        |> Enum.flat_map(fn batch ->
          case execute_fn.(pool_conn, batch) do
            {:ok, results} -> results
            {:error, reason} -> Enum.map(batch, fn _ -> {:error, reason} end)
          end
        end)
      end,
      max_concurrency: pool_size,
      timeout: 120_000,
      ordered: true
    )
    |> Enum.flat_map(fn {:ok, results} -> results end)
  end

  defp add_bulk_sequential(conn, ctx, queue, jobs, opts) do
    results =
      Enum.map(jobs, fn {name, data, job_opts} ->
        merged_opts = Keyword.merge(opts, job_opts)
        job = Job.new(queue, name, data, merged_opts)
        add_job(conn, ctx, job)
      end)

    errors = Enum.filter(results, &match?({:error, _}, &1))

    if Enum.empty?(errors) do
      {:ok, Enum.map(results, fn {:ok, job} -> job end)}
    else
      {:error, {:partial_failure, results}}
    end
  end

  @doc """
  Gets a job by ID.

  ## Examples

      {:ok, job} = BullMQ.Queue.get_job("my_queue", "123", connection: :redis)
  """
  @spec get_job(atom() | pid() | String.t(), Types.job_id(), keyword()) ::
          {:ok, Job.t() | nil} | {:error, term()}
  def get_job(queue, job_id, opts \\ [])

  def get_job(queue, job_id, _opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, {:get_job, job_id})
  end

  def get_job(queue, job_id, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.new(queue, prefix: prefix)

    case RedisConnection.command(conn, ["HGETALL", Keys.job(ctx, job_id)]) do
      {:ok, []} ->
        {:ok, nil}

      {:ok, data} ->
        job_data = parse_hash_data(data)
        {:ok, Job.from_redis(job_id, queue, job_data, prefix: prefix, connection: conn)}

      {:error, _} = error ->
        error
    end
  end

  @doc """
  Gets the current state of a job.

  ## Examples

      {:ok, :waiting} = BullMQ.Queue.get_job_state("my_queue", "123", connection: :redis)
  """
  @spec get_job_state(atom() | pid() | String.t(), Types.job_id(), keyword()) ::
          {:ok, Types.job_state()} | {:error, term()}
  def get_job_state(queue, job_id, opts \\ [])

  def get_job_state(queue, job_id, _opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, {:get_job_state, job_id})
  end

  def get_job_state(queue, job_id, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.new(queue, prefix: prefix)

    Scripts.get_state(conn, ctx, job_id)
  end

  @doc """
  Gets job counts by state.

  ## Examples

      {:ok, counts} = BullMQ.Queue.get_counts("my_queue", connection: :redis)
      # %{waiting: 10, active: 2, delayed: 5, completed: 100, failed: 3}
  """
  @spec get_counts(atom() | pid() | String.t(), keyword()) ::
          {:ok, map()} | {:error, term()}
  def get_counts(queue, opts \\ [])

  def get_counts(queue, _opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, :get_counts)
  end

  def get_counts(queue, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.new(queue, prefix: prefix)

    commands = [
      ["LLEN", Keys.wait(ctx)],
      ["LLEN", Keys.active(ctx)],
      ["ZCARD", Keys.delayed(ctx)],
      ["ZCARD", Keys.prioritized(ctx)],
      ["ZCARD", Keys.completed(ctx)],
      ["ZCARD", Keys.failed(ctx)],
      ["LLEN", Keys.paused(ctx)],
      ["ZCARD", Keys.waiting_children(ctx)]
    ]

    case RedisConnection.pipeline(conn, commands) do
      {:ok, [waiting, active, delayed, prioritized, completed, failed, paused, waiting_children]} ->
        {:ok,
         %{
           waiting: waiting + paused,
           active: active,
           delayed: delayed,
           prioritized: prioritized,
           completed: completed,
           failed: failed,
           paused: paused,
           waiting_children: waiting_children
         }}

      {:error, _} = error ->
        error
    end
  end

  @doc """
  Returns the number of jobs waiting to be processed.

  This includes jobs that are "waiting", "delayed", "prioritized", or "waiting-children".

  ## Examples

      {:ok, count} = BullMQ.Queue.count("my_queue", connection: :redis)
      # 15
  """
  @spec count(atom() | pid() | String.t(), keyword()) :: {:ok, integer()} | {:error, term()}
  def count(queue, opts \\ [])

  def count(queue, _opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, :count)
  end

  def count(queue, opts) when is_binary(queue) do
    get_job_count_by_types(
      queue,
      [:waiting, :paused, :delayed, :prioritized, :waiting_children],
      opts
    )
  end

  @doc """
  Gets job counts for specific types.

  Returns a map with job counts for each type specified.

  ## Examples

      {:ok, counts} = BullMQ.Queue.get_job_counts("my_queue", [:waiting, :completed], connection: :redis)
      # %{waiting: 10, completed: 50}
  """
  @spec get_job_counts(atom() | pid() | String.t(), [Types.job_state()], keyword()) ::
          {:ok, map()} | {:error, term()}
  def get_job_counts(queue, types, opts \\ [])

  def get_job_counts(queue, types, _opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, {:get_job_counts, types})
  end

  def get_job_counts(queue, types, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.new(queue, prefix: prefix)

    # Sanitize types - if :waiting is included, also include :paused
    sanitized_types = sanitize_job_types(types)

    commands =
      Enum.map(sanitized_types, fn type ->
        build_count_command(ctx, type)
      end)

    case RedisConnection.pipeline(conn, commands) do
      {:ok, results} ->
        counts =
          sanitized_types
          |> Enum.zip(results)
          |> Map.new(fn {type, count} -> {type, count || 0} end)

        {:ok, counts}

      {:error, _} = error ->
        error
    end
  end

  @doc """
  Gets total job count for specific types.

  Returns the sum of job counts for all specified types.

  ## Examples

      {:ok, total} = BullMQ.Queue.get_job_count_by_types("my_queue", [:waiting, :delayed], connection: :redis)
      # 25
  """
  @spec get_job_count_by_types(atom() | pid() | String.t(), [Types.job_state()], keyword()) ::
          {:ok, integer()} | {:error, term()}
  def get_job_count_by_types(queue, types, opts \\ [])

  def get_job_count_by_types(queue, types, _opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, {:get_job_count_by_types, types})
  end

  def get_job_count_by_types(queue, types, opts) when is_binary(queue) do
    case get_job_counts(queue, types, opts) do
      {:ok, counts} ->
        total = counts |> Map.values() |> Enum.sum()
        {:ok, total}

      {:error, _} = error ->
        error
    end
  end

  @doc """
  Gets queue metadata.

  Returns metadata including paused state, version, concurrency, and rate limit settings.

  ## Examples

      {:ok, meta} = BullMQ.Queue.get_meta("my_queue", connection: :redis)
      # %{paused: false, version: "bullmq:5.0.0", concurrency: 10, max: nil, duration: nil}
  """
  @spec get_meta(atom() | pid() | String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def get_meta(queue, opts \\ [])

  def get_meta(queue, _opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, :get_meta)
  end

  def get_meta(queue, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.new(queue, prefix: prefix)

    case RedisConnection.command(conn, ["HGETALL", Keys.meta(ctx)]) do
      {:ok, data} ->
        meta_map = parse_hash_data(data)

        {:ok,
         %{
           paused: meta_map["paused"] == "1",
           version: meta_map["version"],
           concurrency: parse_int_or_nil(meta_map["concurrency"]),
           max: parse_int_or_nil(meta_map["max"]),
           duration: parse_int_or_nil(meta_map["duration"]),
           max_len_events: parse_int_or_nil(meta_map["opts.maxLenEvents"]) || 10_000
         }}

      {:error, _} = error ->
        error
    end
  end

  @doc """
  Gets the BullMQ version stored in the queue's metadata.

  This version indicates the Lua script version/capabilities of the queue,
  which corresponds to the Node.js BullMQ version. This is important for
  frontend tools like Bull Board to match features.

  Returns `nil` if no version has been set (e.g., the queue was never used
  or was created with `skip_meta_update: true`).

  ## Examples

      {:ok, version} = BullMQ.Queue.get_version("my_queue", connection: :redis)
      # "bullmq:5.65.1"

  ## See Also

    * `BullMQ.Version` - Module containing the BullMQ version constants
  """
  @spec get_version(atom() | pid() | String.t(), keyword()) ::
          {:ok, String.t() | nil} | {:error, term()}
  def get_version(queue, opts \\ [])

  def get_version(queue, _opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, :get_version)
  end

  def get_version(queue, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.new(queue, prefix: prefix)

    case RedisConnection.command(conn, ["HGET", Keys.meta(ctx), "version"]) do
      {:ok, version} -> {:ok, version}
      {:error, _} = error -> error
    end
  end

  @doc """
  Updates queue metadata (version and maxLenEvents) in Redis.

  This is automatically called when using a Queue GenServer, but for stateless
  usage you may want to call this explicitly to ensure the version is set.
  This is important for frontend tools like Bull Board to properly detect
  queue capabilities.

  ## Options

    * `:connection` - Redis connection (required)
    * `:prefix` - Queue prefix (default: "bull")
    * `:max_len_events` - Maximum length of the event stream (default: 10_000)

  ## Examples

      :ok = BullMQ.Queue.update_meta("my_queue", connection: :redis)
      :ok = BullMQ.Queue.update_meta("my_queue", connection: :redis, max_len_events: 50_000)

  ## See Also

    * `BullMQ.Version` - The BullMQ version that will be set
  """
  @spec update_meta(String.t(), keyword()) :: :ok | {:error, term()}
  def update_meta(queue, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    max_len_events = Keyword.get(opts, :max_len_events, 10_000)
    ctx = Keys.new(queue, prefix: prefix)

    case RedisConnection.command(conn, [
           "HMSET",
           Keys.meta(ctx),
           "opts.maxLenEvents",
           to_string(max_len_events),
           "version",
           Version.full_version()
         ]) do
      {:ok, _} -> :ok
      {:error, _} = error -> error
    end
  end

  @doc """
  Gets jobs in specific state(s).

  Accepts either a single state atom or a list of states.

  ## Options

    * `:start` - Start index (default: 0)
    * `:end` - End index (default: -1, meaning all)
    * `:asc` - If true, return jobs in ascending order (default: false)

  ## Examples

      {:ok, jobs} = BullMQ.Queue.get_jobs("my_queue", :waiting, connection: :redis)
      {:ok, jobs} = BullMQ.Queue.get_jobs("my_queue", [:waiting, :active], connection: :redis)
      {:ok, jobs} = BullMQ.Queue.get_jobs("my_queue", :failed, connection: :redis, start: 0, end: 9)
  """
  @spec get_jobs(atom() | pid() | String.t(), Types.job_state() | [Types.job_state()], keyword()) ::
          {:ok, [Job.t()]} | {:error, term()}
  def get_jobs(queue, states, opts \\ [])

  def get_jobs(queue, states, opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, {:get_jobs, states, opts})
  end

  def get_jobs(queue, states, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    start_idx = Keyword.get(opts, :start, 0)
    end_idx = Keyword.get(opts, :end, -1)
    ctx = Keys.new(queue, prefix: prefix)

    # Normalize states to always be a list
    state_list = if is_list(states), do: states, else: [states]

    # Get job IDs from all requested states
    job_ids_results =
      Enum.map(state_list, fn state ->
        case state do
          :waiting ->
            RedisConnection.command(conn, ["LRANGE", Keys.wait(ctx), start_idx, end_idx])

          :active ->
            RedisConnection.command(conn, ["LRANGE", Keys.active(ctx), start_idx, end_idx])

          :delayed ->
            RedisConnection.command(conn, ["ZRANGE", Keys.delayed(ctx), start_idx, end_idx])

          :prioritized ->
            RedisConnection.command(conn, ["ZRANGE", Keys.prioritized(ctx), start_idx, end_idx])

          :completed ->
            RedisConnection.command(conn, ["ZRANGE", Keys.completed(ctx), start_idx, end_idx])

          :failed ->
            RedisConnection.command(conn, ["ZRANGE", Keys.failed(ctx), start_idx, end_idx])

          :paused ->
            RedisConnection.command(conn, ["LRANGE", Keys.paused(ctx), start_idx, end_idx])

          :wait ->
            RedisConnection.command(conn, ["LRANGE", Keys.wait(ctx), start_idx, end_idx])

          :waiting_children ->
            RedisConnection.command(conn, ["ZRANGE", Keys.waiting_children(ctx), start_idx, end_idx])

          _ ->
            {:ok, []}
        end
      end)

    # Combine all job IDs
    all_job_ids =
      job_ids_results
      |> Enum.flat_map(fn
        {:ok, ids} when is_list(ids) -> ids
        _ -> []
      end)
      |> Enum.uniq()

    # Fetch jobs
    jobs =
      Enum.map(all_job_ids, fn job_id ->
        case get_job(queue, job_id, opts) do
          {:ok, job} when not is_nil(job) -> job
          _ -> nil
        end
      end)
      |> Enum.reject(&is_nil/1)

    {:ok, jobs}
  end

  # ---------------------------------------------------------------------------
  # Convenience Getters by State
  # ---------------------------------------------------------------------------

  @doc """
  Returns jobs in the "waiting" state.

  ## Parameters

    * `queue` - Queue name or GenServer
    * `opts` - Options

  ## Options

    * `:start` - Start index (default: 0)
    * `:end` - End index (default: -1)
    * `:connection` - Redis connection (required for string queue)
    * `:prefix` - Queue prefix (default: "bull")

  ## Examples

      {:ok, jobs} = BullMQ.Queue.get_waiting("my_queue", connection: :redis)
      {:ok, jobs} = BullMQ.Queue.get_waiting("my_queue", connection: :redis, start: 0, end: 9)
  """
  @spec get_waiting(atom() | pid() | String.t(), keyword()) :: {:ok, [Job.t()]} | {:error, term()}
  def get_waiting(queue, opts \\ []) do
    get_jobs(queue, [:waiting], opts)
  end

  @doc """
  Returns jobs in the "waiting-children" state.

  These are parent jobs that have at least one child that has not completed yet.

  ## Examples

      {:ok, jobs} = BullMQ.Queue.get_waiting_children("my_queue", connection: :redis)
  """
  @spec get_waiting_children(atom() | pid() | String.t(), keyword()) ::
          {:ok, [Job.t()]} | {:error, term()}
  def get_waiting_children(queue, opts \\ []) do
    get_jobs(queue, [:waiting_children], opts)
  end

  @doc """
  Returns jobs in the "active" state.

  ## Examples

      {:ok, jobs} = BullMQ.Queue.get_active("my_queue", connection: :redis)
  """
  @spec get_active(atom() | pid() | String.t(), keyword()) :: {:ok, [Job.t()]} | {:error, term()}
  def get_active(queue, opts \\ []) do
    get_jobs(queue, [:active], opts)
  end

  @doc """
  Returns jobs in the "delayed" state.

  ## Examples

      {:ok, jobs} = BullMQ.Queue.get_delayed("my_queue", connection: :redis)
  """
  @spec get_delayed(atom() | pid() | String.t(), keyword()) :: {:ok, [Job.t()]} | {:error, term()}
  def get_delayed(queue, opts \\ []) do
    get_jobs(queue, [:delayed], opts)
  end

  @doc """
  Returns jobs in the "prioritized" state.

  ## Examples

      {:ok, jobs} = BullMQ.Queue.get_prioritized("my_queue", connection: :redis)
  """
  @spec get_prioritized(atom() | pid() | String.t(), keyword()) ::
          {:ok, [Job.t()]} | {:error, term()}
  def get_prioritized(queue, opts \\ []) do
    get_jobs(queue, [:prioritized], opts)
  end

  @doc """
  Returns jobs in the "completed" state.

  ## Examples

      {:ok, jobs} = BullMQ.Queue.get_completed("my_queue", connection: :redis)
  """
  @spec get_completed(atom() | pid() | String.t(), keyword()) :: {:ok, [Job.t()]} | {:error, term()}
  def get_completed(queue, opts \\ []) do
    get_jobs(queue, [:completed], opts)
  end

  @doc """
  Returns jobs in the "failed" state.

  ## Examples

      {:ok, jobs} = BullMQ.Queue.get_failed("my_queue", connection: :redis)
  """
  @spec get_failed(atom() | pid() | String.t(), keyword()) :: {:ok, [Job.t()]} | {:error, term()}
  def get_failed(queue, opts \\ []) do
    get_jobs(queue, [:failed], opts)
  end

  # ---------------------------------------------------------------------------
  # Convenience Count Getters by State
  # ---------------------------------------------------------------------------

  @doc """
  Returns the number of jobs in the "completed" state.

  ## Examples

      {:ok, count} = BullMQ.Queue.get_completed_count("my_queue", connection: :redis)
  """
  @spec get_completed_count(atom() | pid() | String.t(), keyword()) ::
          {:ok, integer()} | {:error, term()}
  def get_completed_count(queue, opts \\ []) do
    get_job_count_by_types(queue, [:completed], opts)
  end

  @doc """
  Returns the number of jobs in the "failed" state.

  ## Examples

      {:ok, count} = BullMQ.Queue.get_failed_count("my_queue", connection: :redis)
  """
  @spec get_failed_count(atom() | pid() | String.t(), keyword()) ::
          {:ok, integer()} | {:error, term()}
  def get_failed_count(queue, opts \\ []) do
    get_job_count_by_types(queue, [:failed], opts)
  end

  @doc """
  Returns the number of jobs in the "delayed" state.

  ## Examples

      {:ok, count} = BullMQ.Queue.get_delayed_count("my_queue", connection: :redis)
  """
  @spec get_delayed_count(atom() | pid() | String.t(), keyword()) ::
          {:ok, integer()} | {:error, term()}
  def get_delayed_count(queue, opts \\ []) do
    get_job_count_by_types(queue, [:delayed], opts)
  end

  @doc """
  Returns the number of jobs in the "active" state.

  ## Examples

      {:ok, count} = BullMQ.Queue.get_active_count("my_queue", connection: :redis)
  """
  @spec get_active_count(atom() | pid() | String.t(), keyword()) ::
          {:ok, integer()} | {:error, term()}
  def get_active_count(queue, opts \\ []) do
    get_job_count_by_types(queue, [:active], opts)
  end

  @doc """
  Returns the number of jobs in the "prioritized" state.

  ## Examples

      {:ok, count} = BullMQ.Queue.get_prioritized_count("my_queue", connection: :redis)
  """
  @spec get_prioritized_count(atom() | pid() | String.t(), keyword()) ::
          {:ok, integer()} | {:error, term()}
  def get_prioritized_count(queue, opts \\ []) do
    get_job_count_by_types(queue, [:prioritized], opts)
  end

  @doc """
  Returns the number of jobs in the "waiting" or "paused" states.

  ## Examples

      {:ok, count} = BullMQ.Queue.get_waiting_count("my_queue", connection: :redis)
  """
  @spec get_waiting_count(atom() | pid() | String.t(), keyword()) ::
          {:ok, integer()} | {:error, term()}
  def get_waiting_count(queue, opts \\ []) do
    get_job_count_by_types(queue, [:waiting], opts)
  end

  @doc """
  Returns the number of jobs in the "waiting-children" state.

  ## Examples

      {:ok, count} = BullMQ.Queue.get_waiting_children_count("my_queue", connection: :redis)
  """
  @spec get_waiting_children_count(atom() | pid() | String.t(), keyword()) ::
          {:ok, integer()} | {:error, term()}
  def get_waiting_children_count(queue, opts \\ []) do
    get_job_count_by_types(queue, [:waiting_children], opts)
  end

  # ---------------------------------------------------------------------------
  # Global Configuration Getters
  # ---------------------------------------------------------------------------

  @doc """
  Gets the global concurrency value for the queue.

  Returns `nil` if no value is set.

  ## Examples

      {:ok, concurrency} = BullMQ.Queue.get_global_concurrency("my_queue", connection: :redis)
      # {:ok, 10} or {:ok, nil}
  """
  @spec get_global_concurrency(atom() | pid() | String.t(), keyword()) ::
          {:ok, integer() | nil} | {:error, term()}
  def get_global_concurrency(queue, opts \\ [])

  def get_global_concurrency(queue, _opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, :get_global_concurrency)
  end

  def get_global_concurrency(queue, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.new(queue, prefix: prefix)

    case RedisConnection.command(conn, ["HGET", Keys.meta(ctx), "concurrency"]) do
      {:ok, nil} -> {:ok, nil}
      {:ok, value} -> {:ok, parse_int_or_nil(value)}
      {:error, _} = error -> error
    end
  end

  @doc """
  Gets the global rate limit configuration for the queue.

  Returns `nil` if no rate limit is set.

  ## Examples

      {:ok, rate_limit} = BullMQ.Queue.get_global_rate_limit("my_queue", connection: :redis)
      # {:ok, %{max: 100, duration: 60000}} or {:ok, nil}
  """
  @spec get_global_rate_limit(atom() | pid() | String.t(), keyword()) ::
          {:ok, %{max: integer(), duration: integer()} | nil} | {:error, term()}
  def get_global_rate_limit(queue, opts \\ [])

  def get_global_rate_limit(queue, _opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, :get_global_rate_limit)
  end

  def get_global_rate_limit(queue, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.new(queue, prefix: prefix)

    case RedisConnection.command(conn, ["HMGET", Keys.meta(ctx), "max", "duration"]) do
      {:ok, [max, duration]} when not is_nil(max) and not is_nil(duration) ->
        {:ok, %{max: parse_int_or_nil(max), duration: parse_int_or_nil(duration)}}

      {:ok, _} ->
        {:ok, nil}

      {:error, _} = error ->
        error
    end
  end

  @doc """
  Gets the time to live for a rate limited key in milliseconds.

  ## Returns

    * `-2` if the key does not exist
    * `-1` if the key exists but has no associated expire
    * TTL in milliseconds otherwise

  ## Examples

      {:ok, ttl} = BullMQ.Queue.get_rate_limit_ttl("my_queue", connection: :redis)
  """
  @spec get_rate_limit_ttl(atom() | pid() | String.t(), keyword()) ::
          {:ok, integer()} | {:error, term()}
  def get_rate_limit_ttl(queue, opts \\ [])

  def get_rate_limit_ttl(queue, _opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, :get_rate_limit_ttl)
  end

  def get_rate_limit_ttl(queue, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.new(queue, prefix: prefix)

    Scripts.get_rate_limit_ttl(conn, ctx)
  end

  @doc """
  Gets the job ID from a deduplication identifier.

  Returns the job ID that started the deduplicated state, or `nil` if not found.

  ## Examples

      {:ok, job_id} = BullMQ.Queue.get_deduplication_job_id("my_queue", "dedup-123", connection: :redis)
  """
  @spec get_deduplication_job_id(atom() | pid() | String.t(), String.t(), keyword()) ::
          {:ok, String.t() | nil} | {:error, term()}
  def get_deduplication_job_id(queue, dedup_id, opts \\ [])

  def get_deduplication_job_id(queue, dedup_id, _opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, {:get_deduplication_job_id, dedup_id})
  end

  def get_deduplication_job_id(queue, dedup_id, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.new(queue, prefix: prefix)

    RedisConnection.command(conn, ["GET", "#{Keys.key(ctx)}:de:#{dedup_id}"])
  end

  @doc """
  Removes a deduplication key.

  This allows new jobs with the same deduplication ID to be added immediately,
  even if the TTL hasn't expired or the original job hasn't completed.

  Returns the number of keys removed (0 or 1).

  ## Examples

      # Stop deduplication for a specific ID
      {:ok, 1} = BullMQ.Queue.remove_deduplication_key("my_queue", "dedup-123", connection: :redis)

      # Key doesn't exist
      {:ok, 0} = BullMQ.Queue.remove_deduplication_key("my_queue", "unknown", connection: :redis)
  """
  @spec remove_deduplication_key(atom() | pid() | String.t(), String.t(), keyword()) ::
          {:ok, non_neg_integer()} | {:error, term()}
  def remove_deduplication_key(queue, dedup_id, opts \\ [])

  def remove_deduplication_key(queue, dedup_id, _opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, {:remove_deduplication_key, dedup_id})
  end

  def remove_deduplication_key(queue, dedup_id, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.new(queue, prefix: prefix)

    RedisConnection.command(conn, ["DEL", "#{Keys.key(ctx)}:de:#{dedup_id}"])
  end

  # ---------------------------------------------------------------------------
  # Job Logs
  # ---------------------------------------------------------------------------

  @doc """
  Returns the logs for a given job.

  ## Options

    * `:start` - Start index (default: 0)
    * `:end` - End index (default: -1)
    * `:asc` - If true, return logs in ascending order (default: true)

  ## Examples

      {:ok, %{logs: logs, count: count}} = BullMQ.Queue.get_job_logs("my_queue", "123", connection: :redis)
  """
  @spec get_job_logs(atom() | pid() | String.t(), Types.job_id(), keyword()) ::
          {:ok, %{logs: [String.t()], count: integer()}} | {:error, term()}
  def get_job_logs(queue, job_id, opts \\ [])

  def get_job_logs(queue, job_id, opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, {:get_job_logs, job_id, opts})
  end

  def get_job_logs(queue, job_id, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    start_idx = Keyword.get(opts, :start, 0)
    end_idx = Keyword.get(opts, :end, -1)
    asc = Keyword.get(opts, :asc, true)
    ctx = Keys.new(queue, prefix: prefix)

    logs_key = Keys.logs(ctx, job_id)

    {range_start, range_end} =
      if asc do
        {start_idx, end_idx}
      else
        {-(end_idx + 1), -(start_idx + 1)}
      end

    commands = [
      ["LRANGE", logs_key, range_start, range_end],
      ["LLEN", logs_key]
    ]

    case RedisConnection.pipeline(conn, commands) do
      {:ok, [logs, count]} ->
        final_logs = if asc, do: logs, else: Enum.reverse(logs)
        {:ok, %{logs: final_logs, count: count}}

      {:error, _} = error ->
        error
    end
  end

  # ---------------------------------------------------------------------------
  # Metrics
  # ---------------------------------------------------------------------------

  @doc """
  Gets queue metrics for completed or failed jobs.

  The metrics are represented as an array of job counts per unit of time (1 minute).

  ## Parameters

    * `queue` - Queue name or GenServer
    * `type` - `:completed` or `:failed`
    * `opts` - Options

  ## Options

    * `:start` - Start point of the metrics (default: 0, newest)
    * `:end` - End point of the metrics (default: -1, oldest)

  ## Examples

      {:ok, metrics} = BullMQ.Queue.get_metrics("my_queue", :completed, connection: :redis)
      # %{
      #   meta: %{count: 100, prev_ts: 1234567890, prev_count: 5},
      #   data: [10, 15, 20, ...],
      #   count: 60
      # }
  """
  @spec get_metrics(atom() | pid() | String.t(), :completed | :failed, keyword()) ::
          {:ok, map()} | {:error, term()}
  def get_metrics(queue, type, opts \\ [])

  def get_metrics(queue, type, opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, {:get_metrics, type, opts})
  end

  def get_metrics(queue, type, opts) when is_binary(queue) and type in [:completed, :failed] do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    start_idx = Keyword.get(opts, :start, 0)
    end_idx = Keyword.get(opts, :end, -1)
    ctx = Keys.new(queue, prefix: prefix)

    Scripts.get_metrics(conn, ctx, type, start_idx, end_idx)
  end

  # ---------------------------------------------------------------------------
  # Workers
  # ---------------------------------------------------------------------------

  @doc """
  Gets the list of workers connected to the queue.

  Note: This may not work on all Redis providers (e.g., GCP doesn't support CLIENT LIST).

  ## Examples

      {:ok, workers} = BullMQ.Queue.get_workers("my_queue", connection: :redis)
  """
  @spec get_workers(atom() | pid() | String.t(), keyword()) :: {:ok, [map()]} | {:error, term()}
  def get_workers(queue, opts \\ [])

  def get_workers(queue, _opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, :get_workers)
  end

  def get_workers(queue, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    cluster_connections = Keyword.get(opts, :cluster_connections, [])

    client_name_prefix = "#{prefix}:#{queue}"

    matcher = fn client ->
      name = client["name"] || ""
      name == client_name_prefix or String.starts_with?(name, "#{client_name_prefix}:w:")
    end

    client_list_result =
      case cluster_connections do
        connections when is_list(connections) and length(connections) > 0 ->
          lists =
            Enum.reduce(connections, [], fn connection, acc ->
              case RedisConnection.command(connection, ["CLIENT", "LIST"]) do
                {:ok, list} when is_binary(list) ->
                  parsed =
                    list
                    |> String.split(~r/\r?\n/, trim: true)
                    |> Enum.map(&parse_client_info/1)
                    |> Enum.filter(matcher)

                  [parsed | acc]

                _ ->
                  acc
              end
            end)

          case lists do
            [] -> {:ok, ""}
            _ -> {:ok, Enum.max_by(lists, &length/1)}
          end

        _ ->
          RedisConnection.command(conn, ["CLIENT", "LIST"])
      end

    case client_list_result do
      {:ok, list} when is_list(list) ->
        {:ok,
         list
         |> Enum.map(fn client -> Map.put(client, "queue", queue) end)}

      {:ok, client_list} when is_binary(client_list) ->
        workers =
          client_list
          |> String.split(~r/\r?\n/, trim: true)
          |> Enum.map(&parse_client_info/1)
          |> Enum.filter(matcher)
          |> Enum.map(fn client ->
            Map.put(client, "queue", queue)
          end)

        {:ok, workers}

      {:ok, _} ->
        {:ok, []}

      {:error, %Redix.Error{message: message}} ->
        if String.contains?(message, "unknown command") or String.contains?(message, "CLIENT") do
          {:ok, [%{"name" => "CLIENT LIST not supported"}]}
        else
          {:error, message}
        end

      {:error, _} = error ->
        error
    end
  end

  @doc """
  Gets the count of workers connected to the queue.

  ## Examples

      {:ok, count} = BullMQ.Queue.get_workers_count("my_queue", connection: :redis)
  """
  @spec get_workers_count(atom() | pid() | String.t(), keyword()) ::
          {:ok, integer()} | {:error, term()}
  def get_workers_count(queue, opts \\ []) do
    case get_workers(queue, opts) do
      {:ok, workers} -> {:ok, length(workers)}
      {:error, _} = error -> error
    end
  end

  # ---------------------------------------------------------------------------
  # Prometheus Metrics Export
  # ---------------------------------------------------------------------------

  @doc """
  Exports queue metrics in Prometheus format.

  Automatically exports all the counts returned by `get_job_counts/2`.

  ## Options

    * `:global_variables` - Additional labels to add to all metrics

  ## Examples

      {:ok, metrics} = BullMQ.Queue.export_prometheus_metrics("my_queue", connection: :redis)
      # "# HELP bullmq_job_count Number of jobs in the queue by state\\n..."

      {:ok, metrics} = BullMQ.Queue.export_prometheus_metrics("my_queue",
        connection: :redis,
        global_variables: %{"env" => "production"})
  """
  @spec export_prometheus_metrics(atom() | pid() | String.t(), keyword()) ::
          {:ok, String.t()} | {:error, term()}
  def export_prometheus_metrics(queue, opts \\ [])

  def export_prometheus_metrics(queue, opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, {:export_prometheus_metrics, opts})
  end

  def export_prometheus_metrics(queue, opts) when is_binary(queue) do
    global_vars = Keyword.get(opts, :global_variables, %{})

    case get_counts(queue, opts) do
      {:ok, counts} ->
        metrics = [
          "# HELP bullmq_job_count Number of jobs in the queue by state",
          "# TYPE bullmq_job_count gauge"
        ]

        variables_str =
          global_vars
          |> Enum.map(fn {k, v} -> ", #{k}=\"#{v}\"" end)
          |> Enum.join("")

        count_lines =
          counts
          |> Enum.map(fn {state, count} ->
            "bullmq_job_count{queue=\"#{queue}\", state=\"#{state}\"#{variables_str}} #{count}"
          end)

        {:ok, Enum.join(metrics ++ count_lines, "\n")}

      {:error, _} = error ->
        error
    end
  end

  @doc """
  Pauses the queue.

  When paused, workers will not pick up new jobs. Active jobs will continue
  to completion.

  ## Examples

      :ok = BullMQ.Queue.pause("my_queue", connection: :redis)
  """
  @spec pause(atom() | pid() | String.t(), keyword()) :: :ok | {:error, term()}
  def pause(queue, opts \\ [])

  def pause(queue, _opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, :pause)
  end

  def pause(queue, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.new(queue, prefix: prefix)

    case Scripts.pause(conn, ctx, true) do
      {:ok, _} -> :ok
      {:error, _} = error -> error
    end
  end

  @doc """
  Resumes a paused queue.

  ## Examples

      :ok = BullMQ.Queue.resume("my_queue", connection: :redis)
  """
  @spec resume(atom() | pid() | String.t(), keyword()) :: :ok | {:error, term()}
  def resume(queue, opts \\ [])

  def resume(queue, _opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, :resume)
  end

  def resume(queue, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.new(queue, prefix: prefix)

    case Scripts.pause(conn, ctx, false) do
      {:ok, _} -> :ok
      {:error, _} = error -> error
    end
  end

  @doc """
  Checks if the queue is paused.
  """
  @spec paused?(atom() | pid() | String.t(), keyword()) :: boolean()
  def paused?(queue, opts \\ [])

  def paused?(queue, _opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, :paused?)
  end

  def paused?(queue, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.new(queue, prefix: prefix)

    case RedisConnection.command(conn, ["HEXISTS", Keys.meta(ctx), "paused"]) do
      {:ok, 1} -> true
      _ -> false
    end
  end

  @doc """
  Drains the queue, removing all waiting jobs.

  ## Options

    * `:delayed` - Also remove delayed jobs (default: false)

  ## Examples

      :ok = BullMQ.Queue.drain("my_queue", connection: :redis)
      :ok = BullMQ.Queue.drain("my_queue", connection: :redis, delayed: true)
  """
  @spec drain(atom() | pid() | String.t(), keyword()) :: :ok | {:error, term()}
  def drain(queue, opts \\ [])

  def drain(queue, opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, {:drain, opts})
  end

  def drain(queue, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    delayed = Keyword.get(opts, :delayed, false)
    ctx = Keys.new(queue, prefix: prefix)

    case Scripts.drain(conn, ctx, delayed) do
      {:ok, _} -> :ok
      {:error, _} = error -> error
    end
  end

  @doc """
  Completely obliterates a queue and all of its contents irreversibly.

  This method will pause the queue and requires that there are no active jobs.
  It is possible to bypass this requirement using the "force" option.

  Note: This operation requires iterating on all the jobs stored in the queue
  and can be slow for very large queues.

  ## Options

    * `:force` - Force obliteration even with active jobs (default: false)
    * `:count` - Max number of jobs to remove per iteration (default: 1000)
    * `:connection` - Redis connection (required for stateless usage)
    * `:prefix` - Key prefix (default: "bull")

  ## Examples

      :ok = BullMQ.Queue.obliterate("my_queue", connection: :redis)
      :ok = BullMQ.Queue.obliterate("my_queue", force: true, connection: :redis)
  """
  @spec obliterate(atom() | pid() | String.t(), keyword()) :: :ok | {:error, term()}
  def obliterate(queue, opts \\ [])

  def obliterate(queue, opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, {:obliterate, opts})
  end

  def obliterate(queue, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    force = Keyword.get(opts, :force, false)
    count = Keyword.get(opts, :count, 1000)
    ctx = Keys.new(queue, prefix: prefix)

    # First pause the queue
    case Scripts.pause(conn, ctx, true) do
      {:ok, _} ->
        # Keep obliterating until complete
        obliterate_loop(conn, ctx, count, force)

      {:error, _} = error ->
        error
    end
  end

  defp obliterate_loop(conn, ctx, count, force) do
    case Scripts.obliterate(conn, ctx, count, force) do
      {:ok, 0} ->
        :ok

      {:ok, cursor} when is_integer(cursor) and cursor > 0 ->
        obliterate_loop(conn, ctx, count, force)

      {:ok, -1} ->
        {:error, "Cannot obliterate non-paused queue"}

      {:ok, -2} ->
        {:error, "Cannot obliterate queue with active jobs"}

      {:error, _} = error ->
        error
    end
  end

  @doc """
  Removes a job from the queue.

  ## Options

    * `:remove_children` - Also remove child jobs (default: false)

  ## Examples

      {:ok, 1} = BullMQ.Queue.remove_job("my_queue", "123", connection: :redis)
  """
  @spec remove_job(atom() | pid() | String.t(), Types.job_id(), keyword()) ::
          {:ok, integer()} | {:error, term()}
  def remove_job(queue, job_id, opts \\ [])

  def remove_job(queue, job_id, opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, {:remove_job, job_id, opts})
  end

  def remove_job(queue, job_id, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    remove_children = Keyword.get(opts, :remove_children, false)
    ctx = Keys.new(queue, prefix: prefix)

    Scripts.remove_job(conn, ctx, job_id, remove_children)
  end

  @doc """
  Retries a failed job.

  ## Options

    * `:lifo` - Add to front of queue (default: false)

  ## Examples

      :ok = BullMQ.Queue.retry_job("my_queue", "123", connection: :redis)
  """
  @spec retry_job(atom() | pid() | String.t(), Types.job_id(), keyword()) ::
          :ok | {:error, term()}
  def retry_job(queue, job_id, opts \\ [])

  def retry_job(queue, job_id, opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, {:retry_job, job_id, opts})
  end

  def retry_job(queue, job_id, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    lifo = Keyword.get(opts, :lifo, false)
    ctx = Keys.new(queue, prefix: prefix)

    case Scripts.retry_job(conn, ctx, job_id, lifo, "0") do
      {:ok, _} -> :ok
      {:error, _} = error -> error
    end
  end

  @doc """
  Cleans jobs in a specific state older than a grace period.

  ## Parameters

    * `queue` - Queue name or GenServer
    * `state` - State to clean (:completed, :failed, :delayed, :waiting)
    * `grace` - Grace period in milliseconds

  ## Options

    * `:limit` - Maximum number of jobs to clean (default: 1000)

  ## Examples

      # Clean completed jobs older than 1 hour
      {:ok, cleaned_ids} = BullMQ.Queue.clean("my_queue", :completed, 3600_000, connection: :redis)
  """
  @spec clean(atom() | pid() | String.t(), Types.job_state(), non_neg_integer(), keyword()) ::
          {:ok, [Types.job_id()]} | {:error, term()}
  def clean(queue, state, grace, opts \\ [])

  def clean(queue, state, grace, opts) when is_atom(queue) or is_pid(queue) do
    GenServer.call(queue, {:clean, state, grace, opts})
  end

  def clean(queue, state, grace, opts) when is_binary(queue) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    limit = Keyword.get(opts, :limit, 1000)
    ctx = Keys.new(queue, prefix: prefix)

    timestamp = System.system_time(:millisecond) - grace

    key =
      case state do
        :completed -> Keys.completed(ctx)
        :failed -> Keys.failed(ctx)
        _ -> nil
      end

    if key do
      case RedisConnection.command(conn, [
             "ZRANGEBYSCORE",
             key,
             "-inf",
             timestamp,
             "LIMIT",
             "0",
             limit
           ]) do
        {:ok, job_ids} ->
          # Remove each job
          Enum.each(job_ids, fn job_id ->
            Scripts.remove_job(conn, ctx, job_id, false)
          end)

          {:ok, job_ids}

        {:error, _} = error ->
          error
      end
    else
      {:error, :unsupported_state}
    end
  end

  # GenServer implementation

  @doc """
  Starts a Queue GenServer.

  ## Options

    * `:name` - GenServer name (required)
    * `:queue` - Queue name in Redis (required)
    * `:connection` - Redis connection (required)
    * `:prefix` - Queue prefix (default: "bull")
    * `:default_job_opts` - Default options for all jobs

  ## Examples

      {:ok, pid} = BullMQ.Queue.start_link(
        name: :my_queue,
        queue: "my_queue",
        connection: :my_redis
      )
  """
  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    name = Keyword.fetch!(opts, :name)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @impl true
  def init(opts) do
    opts = NimbleOptions.validate!(opts, @opts_schema)

    queue_name = Keyword.fetch!(opts, :queue)
    connection = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")
    default_job_opts = Keyword.get(opts, :default_job_opts, %{})
    telemetry = Keyword.get(opts, :telemetry)
    skip_meta_update = Keyword.get(opts, :skip_meta_update, false)
    streams = Keyword.get(opts, :streams, [])

    state = %__MODULE__{
      name: queue_name,
      connection: connection,
      prefix: prefix,
      default_job_opts: default_job_opts,
      keys: Keys.new(queue_name, prefix: prefix),
      telemetry: telemetry
    }

    # Set meta values in Redis (version and maxLenEvents) unless skipped
    unless skip_meta_update do
      max_len_events = get_in(streams, [:events, :max_len]) || 10_000
      set_meta_values(connection, state.keys, max_len_events)
    end

    {:ok, state}
  end

  @impl true
  def handle_call({:add, name, data, opts}, _from, state) do
    merged_opts =
      state.default_job_opts
      |> Map.merge(Map.new(opts))
      |> Map.put(:prefix, state.prefix)

    # Add telemetry context propagation if telemetry is configured
    merged_opts = maybe_propagate_telemetry_context(merged_opts, state.telemetry)

    job = Job.new(state.name, name, data, merged_opts)
    result = add_job_with_telemetry(state, job)
    {:reply, result, state}
  end

  def handle_call({:add_bulk, jobs, opts}, _from, state) do
    results =
      Enum.map(jobs, fn {name, data, job_opts} ->
        merged_opts =
          state.default_job_opts
          |> Map.merge(Map.new(opts))
          |> Map.merge(Map.new(job_opts))
          |> Map.put(:prefix, state.prefix)

        # Add telemetry context propagation if telemetry is configured
        merged_opts = maybe_propagate_telemetry_context(merged_opts, state.telemetry)

        job = Job.new(state.name, name, data, merged_opts)
        add_job_with_telemetry(state, job)
      end)

    errors = Enum.filter(results, &match?({:error, _}, &1))

    result =
      if Enum.empty?(errors) do
        {:ok, Enum.map(results, fn {:ok, job} -> job end)}
      else
        {:error, {:partial_failure, results}}
      end

    {:reply, result, state}
  end

  def handle_call({:get_job, job_id}, _from, state) do
    result = get_job(state.name, job_id, connection: state.connection, prefix: state.prefix)
    {:reply, result, state}
  end

  def handle_call({:get_job_state, job_id}, _from, state) do
    result = Scripts.get_state(state.connection, state.keys, job_id)
    {:reply, result, state}
  end

  def handle_call(:get_counts, _from, state) do
    result = get_counts(state.name, connection: state.connection, prefix: state.prefix)
    {:reply, result, state}
  end

  def handle_call({:get_jobs, status, opts}, _from, state) do
    merged_opts = Keyword.merge([connection: state.connection, prefix: state.prefix], opts)
    result = get_jobs(state.name, status, merged_opts)
    {:reply, result, state}
  end

  def handle_call(:pause, _from, state) do
    result = pause(state.name, connection: state.connection, prefix: state.prefix)
    {:reply, result, state}
  end

  def handle_call(:resume, _from, state) do
    result = resume(state.name, connection: state.connection, prefix: state.prefix)
    {:reply, result, state}
  end

  def handle_call(:paused?, _from, state) do
    result = paused?(state.name, connection: state.connection, prefix: state.prefix)
    {:reply, result, state}
  end

  def handle_call({:drain, opts}, _from, state) do
    merged_opts = Keyword.merge([connection: state.connection, prefix: state.prefix], opts)
    result = drain(state.name, merged_opts)
    {:reply, result, state}
  end

  def handle_call({:obliterate, opts}, _from, state) do
    merged_opts = Keyword.merge([connection: state.connection, prefix: state.prefix], opts)
    result = obliterate(state.name, merged_opts)
    {:reply, result, state}
  end

  def handle_call({:remove_job, job_id, opts}, _from, state) do
    merged_opts = Keyword.merge([connection: state.connection, prefix: state.prefix], opts)
    result = remove_job(state.name, job_id, merged_opts)
    {:reply, result, state}
  end

  def handle_call({:retry_job, job_id, opts}, _from, state) do
    merged_opts = Keyword.merge([connection: state.connection, prefix: state.prefix], opts)
    result = retry_job(state.name, job_id, merged_opts)
    {:reply, result, state}
  end

  def handle_call({:clean, status, grace, opts}, _from, state) do
    merged_opts = Keyword.merge([connection: state.connection, prefix: state.prefix], opts)
    result = clean(state.name, status, grace, merged_opts)
    {:reply, result, state}
  end

  # New getter handlers

  def handle_call(:count, _from, state) do
    result = count(state.name, connection: state.connection, prefix: state.prefix)
    {:reply, result, state}
  end

  def handle_call({:get_job_counts, types}, _from, state) do
    result = get_job_counts(state.name, types, connection: state.connection, prefix: state.prefix)
    {:reply, result, state}
  end

  def handle_call({:get_job_count_by_types, types}, _from, state) do
    result =
      get_job_count_by_types(state.name, types, connection: state.connection, prefix: state.prefix)

    {:reply, result, state}
  end

  def handle_call(:get_meta, _from, state) do
    result = get_meta(state.name, connection: state.connection, prefix: state.prefix)
    {:reply, result, state}
  end

  def handle_call(:get_global_concurrency, _from, state) do
    result = get_global_concurrency(state.name, connection: state.connection, prefix: state.prefix)
    {:reply, result, state}
  end

  def handle_call(:get_global_rate_limit, _from, state) do
    result = get_global_rate_limit(state.name, connection: state.connection, prefix: state.prefix)
    {:reply, result, state}
  end

  def handle_call(:get_rate_limit_ttl, _from, state) do
    result = get_rate_limit_ttl(state.name, connection: state.connection, prefix: state.prefix)
    {:reply, result, state}
  end

  def handle_call({:get_deduplication_job_id, dedup_id}, _from, state) do
    result =
      get_deduplication_job_id(state.name, dedup_id,
        connection: state.connection,
        prefix: state.prefix
      )

    {:reply, result, state}
  end

  def handle_call({:remove_deduplication_key, dedup_id}, _from, state) do
    result =
      remove_deduplication_key(state.name, dedup_id,
        connection: state.connection,
        prefix: state.prefix
      )

    {:reply, result, state}
  end

  def handle_call({:get_job_logs, job_id, opts}, _from, state) do
    merged_opts = Keyword.merge([connection: state.connection, prefix: state.prefix], opts)
    result = get_job_logs(state.name, job_id, merged_opts)
    {:reply, result, state}
  end

  def handle_call({:get_metrics, type, opts}, _from, state) do
    merged_opts = Keyword.merge([connection: state.connection, prefix: state.prefix], opts)
    result = get_metrics(state.name, type, merged_opts)
    {:reply, result, state}
  end

  def handle_call(:get_workers, _from, state) do
    result = get_workers(state.name, connection: state.connection, prefix: state.prefix)
    {:reply, result, state}
  end

  def handle_call(:get_version, _from, state) do
    result = get_version(state.name, connection: state.connection, prefix: state.prefix)
    {:reply, result, state}
  end

  def handle_call({:export_prometheus_metrics, opts}, _from, state) do
    merged_opts = Keyword.merge([connection: state.connection, prefix: state.prefix], opts)
    result = export_prometheus_metrics(state.name, merged_opts)
    {:reply, result, state}
  end

  # Private helpers

  defp set_meta_values(conn, keys, max_len_events) do
    # Set version and maxLenEvents in Redis meta hash
    # This is done asynchronously to not block init
    Task.start(fn ->
      try do
        RedisConnection.command(conn, [
          "HMSET",
          Keys.meta(keys),
          "opts.maxLenEvents",
          to_string(max_len_events),
          "version",
          Version.full_version()
        ])
      rescue
        _ -> :ok
      end
    end)
  end

  defp add_job(conn, ctx, job) do
    encoded_opts = encode_job_opts(job.opts)

    result =
      cond do
        job.delay > 0 ->
          Scripts.add_delayed_job(conn, ctx, job, encoded_opts)

        job.priority > 0 ->
          Scripts.add_prioritized_job(conn, ctx, job, encoded_opts)

        true ->
          Scripts.add_standard_job(conn, ctx, job, encoded_opts)
      end

    case result do
      {:ok, job_id} when is_binary(job_id) or is_integer(job_id) ->
        {:ok, %{job | id: to_string(job_id)}}

      {:error, _} = error ->
        error
    end
  end

  defp encode_job_opts(opts) do
    opts
    |> Map.take([
      :attempts,
      :backoff,
      :lifo,
      :timeout,
      :remove_on_complete,
      :remove_on_fail,
      :repeat,
      :deduplication,
      :fail_parent_on_failure,
      :ignore_dependency,
      :remove_dependency
    ])
    |> Map.reject(fn {_k, v} -> is_nil(v) end)
  end

  defp parse_hash_data(data) do
    data
    |> Enum.chunk_every(2)
    |> Enum.into(%{}, fn [k, v] -> {k, v} end)
  end

  defp parse_int_or_nil(nil), do: nil

  defp parse_int_or_nil(str) when is_binary(str) do
    case Integer.parse(str) do
      {int, ""} -> int
      _ -> nil
    end
  end

  # Sanitize job types - if :waiting is included, also include :paused
  defp sanitize_job_types(types) do
    types = List.wrap(types)

    if :waiting in types do
      [:paused | types] |> Enum.uniq()
    else
      types
    end
  end

  defp build_count_command(ctx, type) do
    case type do
      :waiting -> ["LLEN", Keys.wait(ctx)]
      :wait -> ["LLEN", Keys.wait(ctx)]
      :active -> ["LLEN", Keys.active(ctx)]
      :paused -> ["LLEN", Keys.paused(ctx)]
      :delayed -> ["ZCARD", Keys.delayed(ctx)]
      :prioritized -> ["ZCARD", Keys.prioritized(ctx)]
      :completed -> ["ZCARD", Keys.completed(ctx)]
      :failed -> ["ZCARD", Keys.failed(ctx)]
      :waiting_children -> ["ZCARD", Keys.waiting_children(ctx)]
      _ -> ["LLEN", "nonexistent_key"]
    end
  end

  defp parse_client_info(line) do
    line
    |> String.split(" ")
    |> Enum.reduce(%{}, fn kv, acc ->
      case String.split(kv, "=", parts: 2) do
        [key, value] -> Map.put(acc, key, value)
        _ -> acc
      end
    end)
  end

  # Telemetry helpers

  # Add job with optional telemetry span
  defp add_job_with_telemetry(%{telemetry: nil} = state, job) do
    add_job(state.connection, state.keys, job)
  end

  defp add_job_with_telemetry(state, job) do
    telemetry_mod = state.telemetry

    span_opts = [
      kind: :producer,
      attributes: %{
        "messaging.system" => "bullmq",
        "messaging.destination.name" => state.name,
        "messaging.operation" => "publish",
        "bullmq.job.name" => job.name,
        "bullmq.job.id" => job.id,
        "bullmq.job.priority" => job.priority,
        "bullmq.job.delay" => job.delay
      }
    ]

    span = telemetry_mod.start_span("bullmq.queue.add", span_opts)

    try do
      result = add_job(state.connection, state.keys, job)

      case result do
        {:ok, updated_job} ->
          telemetry_mod.set_attribute(span, "messaging.message.id", updated_job.id)
          telemetry_mod.end_span(span, :ok)
          result

        {:error, reason} ->
          telemetry_mod.set_attribute(span, "error.message", inspect(reason))
          telemetry_mod.end_span(span, {:error, inspect(reason)})
          result
      end
    rescue
      e ->
        telemetry_mod.record_exception(span, e, __STACKTRACE__)
        telemetry_mod.end_span(span, {:error, Exception.message(e)})
        reraise e, __STACKTRACE__
    end
  end

  # Propagate telemetry context to job opts if telemetry is configured
  defp maybe_propagate_telemetry_context(opts, nil), do: opts

  defp maybe_propagate_telemetry_context(opts, telemetry_mod) do
    # Check if omit_context is set
    if Map.get(opts, :omit_context, false) do
      opts
    else
      # Get current context and serialize it
      ctx = telemetry_mod.get_current_context()

      if ctx do
        case telemetry_mod.serialize_context(ctx) do
          nil -> opts
          metadata -> Map.put(opts, :telemetry_metadata, metadata)
        end
      else
        opts
      end
    end
  end
end
