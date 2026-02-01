defmodule BullMQ.Scripts do
  @moduledoc """
  Manages Lua scripts for BullMQ Redis operations.

  This module loads Lua scripts from priv/scripts at compile time,
  extracting the number of keys from the filename pattern `scriptName-numberOfKeys.lua`.

  All scripts are loaded and cached for efficient execution using Redis EVALSHA.

  ## Script Location

  Scripts are copied from the root `rawScripts/` directory to `priv/scripts/`
  before compilation. Run `mix scripts.copy` to update the scripts, or they
  will be copied automatically during CI builds.
  """

  alias BullMQ.{Keys, RedisConnection}

  # Path to the scripts directory
  # First try priv/scripts (for CI and production), fallback to rawScripts (for local dev)
  @scripts_path (
                  priv_scripts_path = Path.expand("../../priv/scripts", __DIR__)
                  raw_scripts_path = Path.expand("../../../rawScripts", __DIR__)

                  cond do
                    File.dir?(priv_scripts_path) and
                        File.ls!(priv_scripts_path) |> Enum.any?(&String.ends_with?(&1, ".lua")) ->
                      priv_scripts_path

                    File.dir?(raw_scripts_path) ->
                      raw_scripts_path

                    true ->
                      # Will result in empty scripts - error will be raised at runtime
                      priv_scripts_path
                  end
                )

  # Map of Elixir atom names to script file base names (without the -N.lua suffix)
  @script_name_mapping %{
    add_delayed_job: "addDelayedJob",
    add_job_scheduler: "addJobScheduler",
    add_log: "addLog",
    add_parent_job: "addParentJob",
    add_prioritized_job: "addPrioritizedJob",
    add_repeatable_job: "addRepeatableJob",
    add_standard_job: "addStandardJob",
    change_delay: "changeDelay",
    change_priority: "changePriority",
    clean_jobs_in_set: "cleanJobsInSet",
    drain: "drain",
    extend_lock: "extendLock",
    extend_locks: "extendLocks",
    get_counts: "getCounts",
    get_counts_per_priority: "getCountsPerPriority",
    get_dependency_counts: "getDependencyCounts",
    get_job_scheduler: "getJobScheduler",
    get_metrics: "getMetrics",
    get_ranges: "getRanges",
    get_rate_limit_ttl: "getRateLimitTtl",
    get_state: "getState",
    get_state_v2: "getStateV2",
    is_finished: "isFinished",
    is_job_in_list: "isJobInList",
    is_maxed: "isMaxed",
    move_job_from_active_to_wait: "moveJobFromActiveToWait",
    move_jobs_to_wait: "moveJobsToWait",
    move_stalled_jobs_to_wait: "moveStalledJobsToWait",
    move_to_active: "moveToActive",
    move_to_delayed: "moveToDelayed",
    move_to_finished: "moveToFinished",
    move_to_waiting_children: "moveToWaitingChildren",
    obliterate: "obliterate",
    paginate: "paginate",
    pause: "pause",
    promote: "promote",
    release_lock: "releaseLock",
    remove_child_dependency: "removeChildDependency",
    remove_job: "removeJob",
    remove_job_scheduler: "removeJobScheduler",
    remove_repeatable: "removeRepeatable",
    reprocess_job: "reprocessJob",
    retry_job: "retryJob",
    retry_jobs: "retryJobs",
    save_stacked_job: "saveStackedJob",
    update_data: "updateData",
    update_job_option: "updateJobOption",
    update_job_scheduler: "updateJobScheduler",
    update_parent: "updateParent",
    update_progress: "updateProgress"
  }

  # Find all script files and register them as external resources
  @script_files (case File.ls(@scripts_path) do
                   {:ok, files} ->
                     files
                     |> Enum.filter(&String.ends_with?(&1, ".lua"))
                     |> Enum.sort()

                   {:error, _} ->
                     []
                 end)

  # Register each script file as an external resource for recompilation on change
  for file <- @script_files do
    @external_resource Path.join(@scripts_path, file)
  end

  # Parse script files to extract name and key count
  @scripts @script_files
           |> Enum.map(fn filename ->
             # Parse filename pattern: scriptName-numberOfKeys.lua
             case Regex.run(~r/^(.+)-(\d+)\.lua$/, filename) do
               [_, base_name, key_count_str] ->
                 key_count = String.to_integer(key_count_str)
                 file_path = Path.join(@scripts_path, filename)
                 content = File.read!(file_path)
                 {base_name, %{content: content, key_count: key_count, filename: filename}}

               nil ->
                 nil
             end
           end)
           |> Enum.reject(&is_nil/1)
           |> Map.new()

  # Build reverse mapping from Elixir atoms to script data
  @script_by_atom @script_name_mapping
                  |> Enum.map(fn {atom_name, base_name} ->
                    case Map.get(@scripts, base_name) do
                      nil -> nil
                      script_data -> {atom_name, script_data}
                    end
                  end)
                  |> Enum.reject(&is_nil/1)
                  |> Map.new()

  # Precompute SHAs at compile time for all scripts
  @script_shas @script_by_atom
               |> Enum.map(fn {atom_name, %{content: content}} ->
                 {atom_name, :crypto.hash(:sha, content) |> Base.encode16(case: :lower)}
               end)
               |> Map.new()

  @type script_name :: atom()
  @type script_result :: {:ok, any()} | {:error, any()}
  @type queue_context :: Keys.queue_context()

  # ---------------------------------------------------------------------------
  # Public API - Script Access
  # ---------------------------------------------------------------------------

  @doc """
  Returns the script content and number of keys for a given script name.

  ## Parameters

    * `name` - The script name as an atom (e.g., `:extend_lock`, `:move_to_active`)

  ## Returns

    * `{content, key_count}` tuple if script exists
    * `nil` if script not found

  ## Examples

      iex> {content, keys} = BullMQ.Scripts.get(:extend_lock)
      iex> is_binary(content) and is_integer(keys)
      true

  """
  @spec get(script_name()) :: {String.t(), non_neg_integer()} | nil
  def get(name) when is_atom(name) do
    case Map.get(@script_by_atom, name) do
      nil -> nil
      %{content: content, key_count: key_count} -> {content, key_count}
    end
  end

  @doc """
  Returns the script content for a given script name.
  """
  @spec get_content(script_name()) :: String.t() | nil
  def get_content(name) when is_atom(name) do
    case get(name) do
      {content, _} -> content
      nil -> nil
    end
  end

  @doc """
  Returns the number of keys for a given script.
  """
  @spec get_key_count(script_name()) :: non_neg_integer() | nil
  def get_key_count(name) when is_atom(name) do
    case get(name) do
      {_, key_count} -> key_count
      nil -> nil
    end
  end

  @doc """
  Lists all available script names.
  """
  @spec list_scripts() :: [script_name()]
  def list_scripts do
    Map.keys(@script_by_atom)
  end

  @doc """
  Checks if a script exists.
  """
  @spec exists?(script_name()) :: boolean()
  def exists?(name) when is_atom(name) do
    Map.has_key?(@script_by_atom, name)
  end

  # ---------------------------------------------------------------------------
  # Script Execution
  # ---------------------------------------------------------------------------

  @doc """
  Executes a Lua script against Redis by name.

  Uses EVALSHA for efficiency, falling back to EVAL if the script
  is not yet cached in Redis.

  ## Parameters

    * `conn` - The Redis connection pool name
    * `script_name` - The script name as an atom
    * `keys` - List of Redis keys
    * `args` - List of arguments to pass to the script

  ## Returns

    * `{:ok, result}` on success
    * `{:error, reason}` on failure

  """
  @spec execute(atom(), script_name(), [String.t()], [any()]) :: script_result()
  def execute(conn, script_name, keys, args) when is_atom(script_name) do
    case get(script_name) do
      nil ->
        {:error, {:script_not_found, script_name}}

      {script, _expected_key_count} ->
        # Use cached SHA for better performance
        sha = get_sha(script_name)
        execute_with_sha(conn, script, sha, keys, args)
    end
  end

  @doc """
  Executes a raw Lua script against Redis.
  """
  @spec execute_raw(atom(), String.t(), [String.t()], [any()]) :: script_result()
  def execute_raw(conn, script, keys, args) do
    sha = sha1(script)
    execute_with_sha(conn, script, sha, keys, args)
  end

  # Internal: Execute with pre-computed SHA
  defp execute_with_sha(conn, script, sha, keys, args) do
    encoded_args = Enum.map(args, &encode_arg/1)
    num_keys = length(keys)

    # Try EVALSHA first (cached script)
    case RedisConnection.command(conn, ["EVALSHA", sha, num_keys | keys ++ encoded_args]) do
      {:ok, result} ->
        {:ok, decode_result(result)}

      {:error, %Redix.Error{message: "NOSCRIPT" <> _}} ->
        # Script not cached, use EVAL which will also cache it
        case RedisConnection.command(conn, ["EVAL", script, num_keys | keys ++ encoded_args]) do
          {:ok, result} -> {:ok, decode_result(result)}
          {:error, reason} -> {:error, reason}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  Builds a Redis command for a Lua script without executing it.
  Useful for pipelining multiple script calls.

  Returns `{:ok, command}` where command is a list that can be passed to Redis pipeline,
  or `{:error, reason}` if the script is not found.
  """
  @spec build_command(script_name(), [String.t()], [any()]) ::
          {:ok, [String.t()]} | {:error, term()}
  def build_command(script_name, keys, args) when is_atom(script_name) do
    case get_sha(script_name) do
      nil ->
        {:error, {:script_not_found, script_name}}

      sha ->
        encoded_args = Enum.map(args, &encode_arg/1)
        num_keys = length(keys)
        {:ok, ["EVALSHA", sha, num_keys | keys ++ encoded_args]}
    end
  end

  @doc """
  Gets the precomputed SHA for a script.
  SHAs are computed at compile time for efficiency.
  """
  @spec get_sha(script_name()) :: String.t() | nil
  def get_sha(script_name) do
    Map.get(@script_shas, script_name)
  end

  @doc """
  Builds multiple add_standard_job commands efficiently by precomputing shared data.
  Much faster than calling build_add_standard_job_command multiple times.

  Returns a list of {job, command} tuples.
  """
  @spec build_bulk_add_commands(queue_context(), [{map() | struct(), map()}]) ::
          {:ok, [{map() | struct(), [String.t()]}]} | {:error, term()}
  def build_bulk_add_commands(ctx, jobs_with_opts) do
    # Precompute shared values (computed once, not per job)
    sha = get_sha(:add_standard_job)
    if sha == nil do
      {:error, {:script_not_found, :add_standard_job}}
    else
      # Precompute keys (same for all jobs in queue)
      keys = [
        Keys.wait(ctx),
        Keys.paused(ctx),
        Keys.meta(ctx),
        Keys.id(ctx),
        Keys.completed(ctx),
        Keys.delayed(ctx),
        Keys.active(ctx),
        Keys.events(ctx),
        Keys.marker(ctx)
      ]
      key_prefix = Keys.key_prefix(ctx)
      num_keys = 9

      # Build commands efficiently
      results = Enum.map(jobs_with_opts, fn {job, opts} ->
        timestamp = get_job_timestamp(job) || System.system_time(:millisecond)
        job_id = get_job_id(job)
        job_name = get_job_name(job)
        {parent_key, parent_deps_key, parent} = get_parent_info_full(job)
        repeat_job_key = get_repeat_job_key(job)
        deduplication_key = get_deduplication_key(job, ctx)

        packed_args =
          Msgpax.pack!(
            [key_prefix, job_id || "", job_name, timestamp,
             parent_key, parent_deps_key, parent, repeat_job_key, deduplication_key],
            iodata: false
          )

        job_data = get_job_data(job) |> Jason.encode!()
        packed_opts = pack_job_opts(job, opts)

        # Build command directly without going through build_command
        cmd = ["EVALSHA", sha, num_keys | keys ++ [packed_args, job_data, packed_opts]]
        {job, cmd}
      end)

      {:ok, results}
    end
  end

  @doc """
  Executes multiple script commands in a pipeline.
  Returns a list of results in the same order as the commands.

  Note: If any script is not cached (NOSCRIPT error), this will fail.
  Use `ensure_scripts_loaded/2` first to cache scripts.
  """
  @spec execute_pipeline(atom(), [[String.t()]]) :: {:ok, [any()]} | {:error, term()}
  def execute_pipeline(conn, commands) when is_list(commands) do
    case RedisConnection.pipeline(conn, commands) do
      {:ok, results} ->
        decoded =
          Enum.map(results, fn
            %Redix.Error{} = error -> {:error, error}
            result -> {:ok, decode_result(result)}
          end)

        {:ok, decoded}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  Executes multiple script commands in a Redis transaction (MULTI/EXEC).
  All commands are executed atomically - either all succeed or none do.

  Returns `{:ok, results}` on success or `{:error, reason}` on failure.

  Note: If any script is not cached (NOSCRIPT error), this will fail.
  Use `ensure_scripts_loaded/2` first to cache scripts.
  """
  @spec execute_transaction(atom(), [[String.t()]]) :: {:ok, [any()]} | {:error, term()}
  def execute_transaction(conn, commands) when is_list(commands) do
    case RedisConnection.transaction(conn, commands) do
      {:ok, results} ->
        decoded =
          Enum.map(results, fn
            %Redix.Error{} = error -> {:error, error}
            result -> {:ok, decode_result(result)}
          end)

        {:ok, decoded}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  Ensures scripts are loaded into Redis cache by executing a dummy SCRIPT LOAD.
  Call this before using pipelined operations to avoid NOSCRIPT errors.
  """
  @spec ensure_scripts_loaded(atom(), [script_name()]) :: :ok | {:error, term()}
  def ensure_scripts_loaded(conn, script_names) do
    Enum.each(script_names, fn script_name ->
      case get(script_name) do
        {script, _} ->
          RedisConnection.command(conn, ["SCRIPT", "LOAD", script])

        nil ->
          :ok
      end
    end)

    :ok
  end

  # ---------------------------------------------------------------------------
  # Job Operations - Used by Queue module
  # ---------------------------------------------------------------------------

  @doc """
  Adds a standard job to the queue.
  """
  @spec add_standard_job(atom(), queue_context(), map() | struct(), map()) :: script_result()
  def add_standard_job(conn, ctx, job, opts) do
    # KEYS in order expected by Lua script
    keys = [
      # KEYS[1] 'wait'
      Keys.wait(ctx),
      # KEYS[2] 'paused'
      Keys.paused(ctx),
      # KEYS[3] 'meta'
      Keys.meta(ctx),
      # KEYS[4] 'id'
      Keys.id(ctx),
      # KEYS[5] 'completed'
      Keys.completed(ctx),
      # KEYS[6] 'delayed'
      Keys.delayed(ctx),
      # KEYS[7] 'active'
      Keys.active(ctx),
      # KEYS[8] events stream key
      Keys.events(ctx),
      # KEYS[9] marker key
      Keys.marker(ctx)
    ]

    timestamp = get_job_timestamp(job) || System.system_time(:millisecond)
    job_id = get_job_id(job)
    job_name = get_job_name(job)
    {parent_key, parent_deps_key, parent} = get_parent_info_full(job)
    repeat_job_key = get_repeat_job_key(job)
    deduplication_key = get_deduplication_key(job, ctx)

    # ARGV[1] msgpacked arguments array
    packed_args =
      Msgpax.pack!(
        [
          # [1] key prefix (with trailing colon for job key building)
          Keys.key_prefix(ctx),
          # [2] custom id (empty = auto generate)
          job_id || "",
          # [3] name
          job_name,
          # [4] timestamp
          timestamp,
          # [5] parentKey?
          parent_key,
          # [6] parent dependencies key
          parent_deps_key,
          # [7] parent? {id, queueKey}
          parent,
          # [8] repeat job key
          repeat_job_key,
          # [9] deduplication key
          deduplication_key
        ],
        iodata: false
      )

    # ARGV[2] Json stringified job data
    job_data = get_job_data(job) |> Jason.encode!()

    # ARGV[3] msgpacked options
    packed_opts = pack_job_opts(job, opts)

    args = [packed_args, job_data, packed_opts]

    execute(conn, :add_standard_job, keys, args)
  end

  @doc """
  Builds a command for adding a standard job without executing it.
  Used for pipelining multiple job additions.
  """
  @spec build_add_standard_job_command(queue_context(), map() | struct(), map()) ::
          {:ok, [String.t()]}
  def build_add_standard_job_command(ctx, job, opts) do
    keys = [
      Keys.wait(ctx),
      Keys.paused(ctx),
      Keys.meta(ctx),
      Keys.id(ctx),
      Keys.completed(ctx),
      Keys.delayed(ctx),
      Keys.active(ctx),
      Keys.events(ctx),
      Keys.marker(ctx)
    ]

    timestamp = get_job_timestamp(job) || System.system_time(:millisecond)
    job_id = get_job_id(job)
    job_name = get_job_name(job)
    {parent_key, parent_deps_key, parent} = get_parent_info_full(job)
    repeat_job_key = get_repeat_job_key(job)
    deduplication_key = get_deduplication_key(job, ctx)

    packed_args =
      Msgpax.pack!(
        [
          Keys.key_prefix(ctx),
          job_id || "",
          job_name,
          timestamp,
          parent_key,
          parent_deps_key,
          parent,
          repeat_job_key,
          deduplication_key
        ],
        iodata: false
      )

    job_data = get_job_data(job) |> Jason.encode!()
    packed_opts = pack_job_opts(job, opts)
    args = [packed_args, job_data, packed_opts]

    build_command(:add_standard_job, keys, args)
  end

  @doc """
  Adds multiple standard jobs atomically in a single transaction (MULTI/EXEC).
  Much more efficient than calling add_standard_job multiple times.

  This operation is atomic - all jobs are added or none are.

  Returns `{:ok, job_ids}` on success or `{:error, reason}` on failure.
  """
  @spec add_standard_jobs_pipelined(atom(), queue_context(), [{map() | struct(), map()}]) ::
          {:ok, [String.t()]} | {:error, term()}
  def add_standard_jobs_pipelined(conn, ctx, jobs_with_opts) do
    # Ensure script is loaded first
    ensure_scripts_loaded(conn, [:add_standard_job])

    # Build all commands
    commands =
      Enum.map(jobs_with_opts, fn {job, opts} ->
        {:ok, cmd} = build_add_standard_job_command(ctx, job, opts)
        cmd
      end)

    # Execute using transaction (MULTI/EXEC) for atomicity
    case execute_transaction(conn, commands) do
      {:ok, results} ->
        # Extract job IDs from results
        job_ids =
          Enum.map(results, fn
            {:ok, job_id} when is_binary(job_id) or is_integer(job_id) -> to_string(job_id)
            {:ok, other} -> other
            {:error, _} = err -> err
          end)

        errors = Enum.filter(job_ids, &match?({:error, _}, &1))

        if Enum.empty?(errors) do
          {:ok, job_ids}
        else
          {:error, {:partial_failure, job_ids}}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  Adds a delayed job to the queue.
  """
  @spec add_delayed_job(atom(), queue_context(), map() | struct(), map()) :: script_result()
  def add_delayed_job(conn, ctx, job, opts) do
    # KEYS in order expected by Lua script
    keys = [
      # KEYS[1] 'marker'
      Keys.marker(ctx),
      # KEYS[2] 'meta'
      Keys.meta(ctx),
      # KEYS[3] 'id'
      Keys.id(ctx),
      # KEYS[4] 'delayed'
      Keys.delayed(ctx),
      # KEYS[5] 'completed'
      Keys.completed(ctx),
      # KEYS[6] events stream key
      Keys.events(ctx)
    ]

    timestamp = get_job_timestamp(job) || System.system_time(:millisecond)
    job_id = get_job_id(job)
    job_name = get_job_name(job)
    delay = get_job_delay(job)
    {parent_key, parent_deps_key, parent} = get_parent_info_full(job)
    repeat_job_key = get_repeat_job_key(job)
    deduplication_key = get_deduplication_key(job, ctx)

    # For delayed jobs, the timestamp should include the delay
    delayed_timestamp = timestamp + delay

    # ARGV[1] msgpacked arguments array
    packed_args =
      Msgpax.pack!(
        [
          # [1] key prefix (with trailing colon)
          Keys.key_prefix(ctx),
          # [2] custom id (empty = auto generate)
          job_id || "",
          # [3] name
          job_name,
          # [4] delayed timestamp
          delayed_timestamp,
          # [5] parentKey?
          parent_key,
          # [6] parent dependencies key
          parent_deps_key,
          # [7] parent? {id, queueKey}
          parent,
          # [8] repeat job key
          repeat_job_key,
          # [9] deduplication key
          deduplication_key
        ],
        iodata: false
      )

    # ARGV[2] Json stringified job data
    job_data = get_job_data(job) |> Jason.encode!()

    # ARGV[3] msgpacked options
    packed_opts = pack_job_opts(job, opts)

    args = [packed_args, job_data, packed_opts]

    execute(conn, :add_delayed_job, keys, args)
  end

  @doc """
  Adds a prioritized job to the queue.
  """
  @spec add_prioritized_job(atom(), queue_context(), map() | struct(), map()) :: script_result()
  def add_prioritized_job(conn, ctx, job, opts) do
    # KEYS in order expected by Lua script
    keys = [
      # KEYS[1] 'marker'
      Keys.marker(ctx),
      # KEYS[2] 'meta'
      Keys.meta(ctx),
      # KEYS[3] 'id'
      Keys.id(ctx),
      # KEYS[4] 'prioritized'
      Keys.prioritized(ctx),
      # KEYS[5] 'delayed'
      Keys.delayed(ctx),
      # KEYS[6] 'completed'
      Keys.completed(ctx),
      # KEYS[7] 'active'
      Keys.active(ctx),
      # KEYS[8] events stream key
      Keys.events(ctx),
      # KEYS[9] 'pc' priority counter
      Keys.pc(ctx)
    ]

    timestamp = get_job_timestamp(job) || System.system_time(:millisecond)
    job_id = get_job_id(job)
    job_name = get_job_name(job)
    {parent_key, parent_deps_key, parent} = get_parent_info_full(job)
    repeat_job_key = get_repeat_job_key(job)
    deduplication_key = get_deduplication_key(job, ctx)

    # ARGV[1] msgpacked arguments array
    packed_args =
      Msgpax.pack!(
        [
          # [1] key prefix (with trailing colon)
          Keys.key_prefix(ctx),
          # [2] custom id (empty = auto generate)
          job_id || "",
          # [3] name
          job_name,
          # [4] timestamp
          timestamp,
          # [5] parentKey?
          parent_key,
          # [6] parent dependencies key
          parent_deps_key,
          # [7] parent? {id, queueKey}
          parent,
          # [8] repeat job key
          repeat_job_key,
          # [9] deduplication key
          deduplication_key
        ],
        iodata: false
      )

    # ARGV[2] Json stringified job data
    job_data = get_job_data(job) |> Jason.encode!()

    # ARGV[3] msgpacked options (includes priority)
    packed_opts = pack_job_opts(job, opts)

    args = [packed_args, job_data, packed_opts]

    execute(conn, :add_prioritized_job, keys, args)
  end

  @doc """
  Builds a command for adding a parent job without executing it.
  Used for building flow transactions where all jobs are added atomically.
  """
  @spec build_add_parent_job_command(queue_context(), map() | struct(), map()) ::
          {:ok, [String.t()]}
  def build_add_parent_job_command(ctx, job, opts) do
    keys = [
      # KEYS[1] 'meta'
      Keys.meta(ctx),
      # KEYS[2] 'id'
      Keys.id(ctx),
      # KEYS[3] 'delayed'
      Keys.delayed(ctx),
      # KEYS[4] 'waiting-children'
      Keys.waiting_children(ctx),
      # KEYS[5] 'completed'
      Keys.completed(ctx),
      # KEYS[6] events stream key
      Keys.events(ctx)
    ]

    timestamp = get_job_timestamp(job) || System.system_time(:millisecond)
    job_id = get_job_id(job)
    job_name = get_job_name(job)
    {parent_key, parent_deps_key, parent} = get_parent_info_full(job)
    repeat_job_key = get_repeat_job_key(job)
    deduplication_key = get_deduplication_key(job, ctx)

    packed_args =
      Msgpax.pack!(
        [
          Keys.key_prefix(ctx),
          job_id || "",
          job_name,
          timestamp,
          parent_key,
          parent_deps_key,
          parent,
          repeat_job_key,
          deduplication_key
        ],
        iodata: false
      )

    job_data = get_job_data(job) |> Jason.encode!()
    packed_opts = pack_job_opts(job, opts)
    args = [packed_args, job_data, packed_opts]

    build_command(:add_parent_job, keys, args)
  end

  @doc """
  Adds a parent job to the queue (waiting-children state).

  Parent jobs are added in waiting-children state until all children complete.
  Used by FlowProducer to create job hierarchies.
  """
  @spec add_parent_job(atom(), queue_context(), map() | struct(), map()) :: script_result()
  def add_parent_job(conn, ctx, job, opts) do
    # KEYS in order expected by addParentJob-6.lua:
    # KEYS[1] 'meta'
    # KEYS[2] 'id'
    # KEYS[3] 'delayed'
    # KEYS[4] 'waiting-children'
    # KEYS[5] 'completed'
    # KEYS[6] events stream key
    keys = [
      # KEYS[1] 'meta'
      Keys.meta(ctx),
      # KEYS[2] 'id'
      Keys.id(ctx),
      # KEYS[3] 'delayed'
      Keys.delayed(ctx),
      # KEYS[4] 'waiting-children'
      Keys.waiting_children(ctx),
      # KEYS[5] 'completed'
      Keys.completed(ctx),
      # KEYS[6] events stream key
      Keys.events(ctx)
    ]

    timestamp = get_job_timestamp(job) || System.system_time(:millisecond)
    job_id = get_job_id(job)
    job_name = get_job_name(job)
    {parent_key, parent_deps_key, parent} = get_parent_info_full(job)
    repeat_job_key = get_repeat_job_key(job)
    deduplication_key = get_deduplication_key(job, ctx)

    # ARGV[1] msgpacked arguments array
    packed_args =
      Msgpax.pack!(
        [
          # [1] key prefix (with trailing colon)
          Keys.key_prefix(ctx),
          # [2] custom id (empty = auto generate)
          job_id || "",
          # [3] name
          job_name,
          # [4] timestamp
          timestamp,
          # [5] parentKey?
          parent_key,
          # [6] parent dependencies key
          parent_deps_key,
          # [7] parent? {id, queueKey}
          parent,
          # [8] repeat job key
          repeat_job_key,
          # [9] deduplication key
          deduplication_key
        ],
        iodata: false
      )

    # ARGV[2] Json stringified job data
    job_data = get_job_data(job) |> Jason.encode!()

    # ARGV[3] msgpacked options
    packed_opts = pack_job_opts(job, opts)

    args = [packed_args, job_data, packed_opts]

    execute(conn, :add_parent_job, keys, args)
  end

  # ---------------------------------------------------------------------------
  # Worker Operations - Used by Worker module
  # ---------------------------------------------------------------------------

  @doc """
  Moves a job to the active state for processing.
  """
  @spec move_to_active(atom(), queue_context(), String.t(), keyword()) :: script_result()
  def move_to_active(conn, ctx, token, opts \\ []) do
    # Keys in order expected by Lua script
    keys = [
      # KEYS[1] wait key
      Keys.wait(ctx),
      # KEYS[2] active key
      Keys.active(ctx),
      # KEYS[3] prioritized key
      Keys.prioritized(ctx),
      # KEYS[4] stream events key
      Keys.events(ctx),
      # KEYS[5] stalled key
      Keys.stalled(ctx),
      # KEYS[6] rate limiter key
      Keys.limiter(ctx),
      # KEYS[7] delayed key
      Keys.delayed(ctx),
      # KEYS[8] paused key
      Keys.paused(ctx),
      # KEYS[9] meta key
      Keys.meta(ctx),
      # KEYS[10] pc priority counter
      Keys.pc(ctx),
      # KEYS[11] marker key
      Keys.marker(ctx)
    ]

    timestamp = Keyword.get(opts, :timestamp, System.system_time(:millisecond))
    lock_duration = Keyword.get(opts, :lock_duration, 30_000)
    limiter = Keyword.get(opts, :limiter)
    name = Keyword.get(opts, :name)

    # ARGV[3] msgpacked opts
    packed_opts =
      Msgpax.pack!(
        %{
          "token" => token,
          "lockDuration" => lock_duration,
          "limiter" => limiter,
          "name" => name
        },
        iodata: false
      )

    args = [
      # ARGV[1] key prefix (with trailing colon)
      Keys.key_prefix(ctx),
      # ARGV[2] timestamp
      timestamp,
      # ARGV[3] msgpacked opts
      packed_opts
    ]

    execute(conn, :move_to_active, keys, args)
  end

  @doc """
  Moves a job to completed state.
  """
  @spec move_to_completed(atom(), queue_context(), String.t(), String.t(), any(), keyword()) ::
          script_result()
  def move_to_completed(conn, ctx, job_id, token, return_value, opts \\ []) do
    move_to_finished(conn, ctx, job_id, token, return_value, :completed, opts)
  end

  @doc """
  Moves a job to failed state.
  """
  @spec move_to_failed(atom(), queue_context(), String.t(), String.t(), any(), keyword()) ::
          script_result()
  def move_to_failed(conn, ctx, job_id, token, error, opts \\ []) do
    move_to_finished(conn, ctx, job_id, token, error, :failed, opts)
  end

  @doc """
  Moves a job to finished (completed/failed) state.
  """
  @spec move_to_finished(atom(), queue_context(), String.t(), String.t(), any(), atom(), keyword()) ::
          script_result()
  def move_to_finished(conn, ctx, job_id, token, result, target, opts \\ []) do
    target_str = to_string(target)
    metrics_key = Keys.metrics(ctx, target_str)

    # Keys in order expected by Lua script
    keys = [
      # KEYS[1] wait key
      Keys.wait(ctx),
      # KEYS[2] active key
      Keys.active(ctx),
      # KEYS[3] prioritized key
      Keys.prioritized(ctx),
      # KEYS[4] event stream key
      Keys.events(ctx),
      # KEYS[5] stalled key
      Keys.stalled(ctx),
      # KEYS[6] rate limiter key
      Keys.limiter(ctx),
      # KEYS[7] delayed key
      Keys.delayed(ctx),
      # KEYS[8] paused key
      Keys.paused(ctx),
      # KEYS[9] meta key
      Keys.meta(ctx),
      # KEYS[10] pc priority counter
      Keys.pc(ctx),
      # KEYS[11] completed/failed key
      Keys.get(ctx, target_str),
      # KEYS[12] jobId key
      Keys.job(ctx, job_id),
      # KEYS[13] metrics key
      metrics_key,
      # KEYS[14] marker key
      Keys.marker(ctx)
    ]

    timestamp = Keyword.get(opts, :timestamp, System.system_time(:millisecond))
    lock_duration = Keyword.get(opts, :lock_duration, 30_000)
    fetch_next = if Keyword.get(opts, :fetch_next, true), do: 1, else: 0
    name = Keyword.get(opts, :name)
    attempts = Keyword.get(opts, :attempts, 0)
    limiter = Keyword.get(opts, :limiter)

    # Determine keepJobs based on target
    keep_jobs =
      case target do
        :completed -> Keyword.get(opts, :remove_on_complete, %{"count" => -1})
        :failed -> Keyword.get(opts, :remove_on_fail, %{"count" => -1})
        _ -> %{"count" => -1}
      end
      |> normalize_keep_jobs()

    # Determine prop val attribute based on target
    prop_val =
      case target do
        :completed -> "returnvalue"
        :failed -> "failedReason"
        _ -> "returnvalue"
      end

    # ARGV[8] msgpacked opts
    packed_opts =
      Msgpax.pack!(
        %{
          "token" => token,
          "name" => name,
          "keepJobs" => keep_jobs,
          "limiter" => limiter,
          "lockDuration" => lock_duration,
          "attempts" => attempts,
          "maxMetricsSize" => Keyword.get(opts, :max_metrics_size, ""),
          "fpof" => Keyword.get(opts, :fail_parent_on_failure, false),
          "cpof" => Keyword.get(opts, :continue_parent_on_failure, false),
          "idof" => Keyword.get(opts, :ignore_dependency_on_failure, false),
          "rdof" => Keyword.get(opts, :remove_dependency_on_failure, false)
        },
        iodata: false
      )

    # Encode result value
    result_val = if result == nil, do: "null", else: encode_result_value(result)

    # Build fields to update (for stacktrace)
    fields_to_update = build_fields_to_update(opts)

    args = [
      # ARGV[1] jobId
      job_id,
      # ARGV[2] timestamp
      timestamp,
      # ARGV[3] msg property returnvalue / failedReason
      prop_val,
      # ARGV[4] return value / failed reason
      result_val,
      # ARGV[5] target (completed/failed)
      target_str,
      # ARGV[6] fetch next?
      fetch_next,
      # ARGV[7] keys prefix (with trailing colon)
      Keys.key_prefix(ctx),
      # ARGV[8] opts
      packed_opts,
      # ARGV[9] job fields to update (for stacktrace)
      fields_to_update
    ]

    execute(conn, :move_to_finished, keys, args)
  end

  # Normalize keep_jobs to BullMQ format
  defp normalize_keep_jobs(true), do: %{"count" => 0}
  defp normalize_keep_jobs(false), do: %{"count" => -1}
  defp normalize_keep_jobs(n) when is_integer(n), do: %{"count" => n}
  defp normalize_keep_jobs(%{count: n}), do: %{"count" => n}
  defp normalize_keep_jobs(%{"count" => _} = m), do: m
  defp normalize_keep_jobs(%{age: n}), do: %{"age" => n}
  defp normalize_keep_jobs(%{"age" => _} = m), do: m
  defp normalize_keep_jobs(%{limit: n}), do: %{"limit" => n}
  defp normalize_keep_jobs(%{"limit" => _} = m), do: m

  # Handle maps with multiple keys (age + count, age + limit, etc.)
  defp normalize_keep_jobs(m) when is_map(m) do
    # Convert atom keys to string keys and keep the map as-is
    # This handles cases like %{age: 1000, limit: 5}
    for {k, v} <- m, into: %{} do
      key = if is_atom(k), do: Atom.to_string(k), else: k
      {key, v}
    end
  end

  defp normalize_keep_jobs(_), do: %{"count" => -1}

  # Build msgpacked fields to update on the job (for stacktrace)
  # The Lua script expects a flat list: ["field1", "value1", "field2", "value2", ...]
  defp build_fields_to_update(opts) do
    stacktrace = Keyword.get(opts, :stacktrace)

    fields =
      if stacktrace && stacktrace != "" do
        # Stacktrace is stored as JSON array in Redis (like Node.js)
        # Each retry appends to the array, but we just store one for now
        stacktrace_json = Jason.encode!([stacktrace])
        ["stacktrace", stacktrace_json]
      else
        []
      end

    if fields == [] do
      ""
    else
      Msgpax.pack!(fields, iodata: false)
    end
  end

  @doc """
  Moves a job to delayed state (for retry with delay).
  """
  @spec move_to_delayed(
          atom(),
          queue_context(),
          String.t(),
          String.t(),
          non_neg_integer(),
          keyword()
        ) :: script_result()
  def move_to_delayed(conn, ctx, job_id, token, delay, opts \\ []) do
    # Lua script expects:
    # KEYS[1] marker key
    # KEYS[2] active key
    # KEYS[3] prioritized key
    # KEYS[4] delayed key
    # KEYS[5] job key
    # KEYS[6] events stream
    # KEYS[7] meta key
    # KEYS[8] stalled key
    keys = [
      Keys.marker(ctx),
      Keys.active(ctx),
      Keys.pc(ctx),
      Keys.delayed(ctx),
      Keys.job(ctx, job_id),
      Keys.events(ctx),
      Keys.meta(ctx),
      Keys.stalled(ctx)
    ]

    timestamp = Keyword.get(opts, :timestamp, System.system_time(:millisecond))
    skip_attempt = if Keyword.get(opts, :skip_attempt, false), do: "1", else: "0"

    # Build fields to update (for stacktrace on retry)
    fields_to_update = build_fields_to_update(opts)

    # ARGV[1] key prefix
    # ARGV[2] timestamp (current time)
    # ARGV[3] job id
    # ARGV[4] queue token
    # ARGV[5] delay value
    # ARGV[6] skip attempt flag ("0" or "1")
    # ARGV[7] optional job fields to update (for stacktrace)
    args = [
      Keys.key_prefix(ctx),
      timestamp,
      job_id,
      token,
      delay,
      skip_attempt,
      fields_to_update
    ]

    execute(conn, :move_to_delayed, keys, args)
  end

  @doc """
  Moves a job from active state back to wait.

  This is useful when manually processing jobs and you need to release
  a job back to the queue (e.g., due to rate limiting).

  ## Returns

    * `{:ok, pttl}` - The rate limit TTL in milliseconds (0 if no rate limit)
  """
  @spec move_job_from_active_to_wait(atom(), queue_context(), String.t(), String.t()) ::
          script_result()
  def move_job_from_active_to_wait(conn, ctx, job_id, token \\ "0") do
    # Keys expected by moveJobFromActiveToWait-9.lua:
    # KEYS[1]  active key
    # KEYS[2]  wait key
    # KEYS[3]  stalled key
    # KEYS[4]  paused key
    # KEYS[5]  meta key
    # KEYS[6]  limiter key
    # KEYS[7]  prioritized key
    # KEYS[8]  marker key
    # KEYS[9]  event key
    keys = [
      Keys.active(ctx),
      Keys.wait(ctx),
      Keys.stalled(ctx),
      Keys.paused(ctx),
      Keys.meta(ctx),
      Keys.limiter(ctx),
      Keys.pc(ctx),
      Keys.marker(ctx),
      Keys.events(ctx)
    ]

    # ARGV[1] job id
    # ARGV[2] lock token
    # ARGV[3] job id key
    args = [
      job_id,
      token,
      Keys.job(ctx, job_id)
    ]

    case execute(conn, :move_job_from_active_to_wait, keys, args) do
      {:ok, pttl} when is_integer(pttl) -> {:ok, pttl}
      {:ok, _} -> {:ok, 0}
      error -> error
    end
  end

  @doc """
  Moves a job from active to waiting-children state.

  This is used when a job needs to wait for its child jobs to complete
  before continuing. The job will be automatically moved back to waiting
  when all children complete.

  ## Returns

    * `{:ok, 0}` - Successfully moved to waiting-children
    * `{:ok, 1}` - No pending dependencies
    * `{:ok, -1}` - Missing job
    * `{:ok, -2}` - Missing lock
    * `{:ok, -3}` - Job not in active set
    * `{:ok, -9}` - Job has failed children
  """
  @spec move_to_waiting_children(atom(), queue_context(), String.t(), String.t(), keyword()) ::
          script_result()
  def move_to_waiting_children(conn, ctx, job_id, token, opts \\ []) do
    # Keys expected by moveToWaitingChildren-7.lua:
    # KEYS[1] active key
    # KEYS[2] wait-children key
    # KEYS[3] job key
    # KEYS[4] job dependencies key
    # KEYS[5] job unsuccessful key
    # KEYS[6] stalled key
    # KEYS[7] events key
    keys = [
      Keys.active(ctx),
      Keys.waiting_children(ctx),
      Keys.job(ctx, job_id),
      Keys.job_dependencies(ctx, job_id),
      Keys.job_unsuccessful(ctx, job_id),
      Keys.stalled(ctx),
      Keys.events(ctx)
    ]

    child_key = Keyword.get(opts, :child_key, "")
    timestamp = Keyword.get(opts, :timestamp, System.system_time(:millisecond))

    # ARGV[1] token
    # ARGV[2] child key
    # ARGV[3] timestamp
    # ARGV[4] jobId
    # ARGV[5] prefix
    args = [
      token,
      child_key,
      timestamp,
      job_id,
      Keys.key_prefix(ctx)
    ]

    execute(conn, :move_to_waiting_children, keys, args)
  end

  @doc """
  Extends the lock on a job.
  """
  @spec extend_lock(atom(), queue_context(), String.t(), String.t(), non_neg_integer()) ::
          script_result()
  def extend_lock(conn, ctx, job_id, token, duration) do
    keys = [
      Keys.lock(ctx, job_id),
      Keys.stalled(ctx)
    ]

    args = [token, duration, job_id]

    execute(conn, :extend_lock, keys, args)
  end

  @doc """
  Extends locks for multiple jobs in a single call.

  This is more efficient than calling extend_lock multiple times when
  processing many concurrent jobs, as it uses a single Redis call.

  Returns a list of results (1 for success, job_id for failures).
  """
  @spec extend_locks(atom(), queue_context(), [String.t()], [String.t()], non_neg_integer()) ::
          script_result()
  def extend_locks(conn, ctx, job_ids, tokens, duration)
      when is_list(job_ids) and is_list(tokens) do
    keys = [
      Keys.stalled(ctx)
    ]

    # Pack job_ids and tokens using msgpack for the Lua script
    args = [
      Keys.key(ctx),
      Msgpax.pack!(tokens, iodata: false),
      Msgpax.pack!(job_ids, iodata: false),
      duration
    ]

    execute(conn, :extend_locks, keys, args)
  end

  @doc """
  Releases the lock on a job.
  """
  @spec release_lock(atom(), queue_context(), String.t(), String.t()) :: script_result()
  def release_lock(conn, ctx, job_id, token) do
    keys = [Keys.lock(ctx, job_id)]
    args = [token]

    execute(conn, :release_lock, keys, args)
  end

  @doc """
  Moves stalled jobs back to wait.
  """
  @spec move_stalled_jobs_to_wait(atom(), queue_context(), non_neg_integer(), keyword()) ::
          script_result()
  def move_stalled_jobs_to_wait(conn, ctx, max_stalled_count, opts \\ []) do
    keys = [
      Keys.stalled(ctx),
      Keys.wait(ctx),
      Keys.active(ctx),
      Keys.failed(ctx),
      Keys.stalled_check(ctx),
      Keys.meta(ctx),
      Keys.paused(ctx),
      Keys.marker(ctx)
    ]

    timestamp = Keyword.get(opts, :timestamp, System.system_time(:millisecond))

    args = [
      # ARGV[1] prefix:queueName
      Keys.key(ctx),
      # ARGV[2] max stalled count
      max_stalled_count,
      # ARGV[3] timestamp
      timestamp
    ]

    execute(conn, :move_stalled_jobs_to_wait, keys, args)
  end

  @doc """
  Retries a failed job.
  """
  @spec retry_job(atom(), queue_context(), String.t(), boolean(), String.t()) :: script_result()
  def retry_job(conn, ctx, job_id, lifo, token) do
    keys = [
      Keys.failed(ctx),
      Keys.wait(ctx),
      Keys.active(ctx),
      Keys.marker(ctx)
    ]

    args = [
      # ARGV[1] prefix:queueName
      Keys.key(ctx),
      # ARGV[2] job id
      job_id,
      # ARGV[3] push type
      if(lifo, do: "LIFO", else: "FIFO"),
      # ARGV[4] worker token
      token
    ]

    execute(conn, :retry_job, keys, args)
  end

  # ---------------------------------------------------------------------------
  # Queue Operations - Used by Queue module
  # ---------------------------------------------------------------------------

  @doc """
  Pauses or resumes the queue.
  """
  @spec pause(atom(), queue_context(), boolean()) :: script_result()
  def pause(conn, ctx, paused?) do
    keys = [
      Keys.wait(ctx),
      Keys.paused(ctx),
      Keys.meta(ctx),
      Keys.prioritized(ctx),
      Keys.pc(ctx),
      Keys.marker(ctx),
      Keys.events(ctx)
    ]

    args = [if(paused?, do: "paused", else: "resumed")]

    execute(conn, :pause, keys, args)
  end

  @doc """
  Drains the queue (removes all jobs).
  """
  @spec drain(atom(), queue_context(), boolean()) :: script_result()
  def drain(conn, ctx, delayed?) do
    keys = [
      Keys.wait(ctx),
      Keys.paused(ctx),
      Keys.delayed(ctx),
      Keys.prioritized(ctx),
      Keys.pc(ctx)
    ]

    args = [
      # ARGV[1] prefix:queueName
      Keys.key(ctx),
      # ARGV[2] include delayed
      if(delayed?, do: 1, else: 0)
    ]

    execute(conn, :drain, keys, args)
  end

  @doc """
  Obliterates the queue (removes everything including meta).
  """
  @spec obliterate(atom(), queue_context(), non_neg_integer(), boolean()) :: script_result()
  def obliterate(conn, ctx, count, force \\ false) do
    keys = [
      Keys.meta(ctx),
      Keys.key_prefix(ctx)
    ]

    args = [count, if(force, do: "force", else: "")]

    execute(conn, :obliterate, keys, args)
  end

  @doc """
  Removes a job from the queue.
  """
  @spec remove_job(atom(), queue_context(), String.t(), boolean()) :: script_result()
  def remove_job(conn, ctx, job_id, remove_children) do
    keys = [
      # KEYS[1] jobKey
      Keys.job(ctx, job_id),
      # KEYS[2] repeat key
      Keys.repeat(ctx)
    ]

    args = [
      # ARGV[1] jobId
      job_id,
      # ARGV[2] remove children
      if(remove_children, do: "1", else: "0"),
      # ARGV[3] queue prefix (with trailing colon)
      Keys.key(ctx) <> ":"
    ]

    execute(conn, :remove_job, keys, args)
  end

  @doc """
  Gets the state of a job.
  """
  @spec get_state(atom(), queue_context(), String.t()) :: script_result()
  def get_state(conn, ctx, job_id) do
    # Keys expected by getState-8.lua:
    # KEYS[1] 'completed' key
    # KEYS[2] 'failed' key
    # KEYS[3] 'delayed' key
    # KEYS[4] 'active' key
    # KEYS[5] 'wait' key
    # KEYS[6] 'paused' key
    # KEYS[7] 'waiting-children' key
    # KEYS[8] 'prioritized' key
    keys = [
      Keys.completed(ctx),
      Keys.failed(ctx),
      Keys.delayed(ctx),
      Keys.active(ctx),
      Keys.wait(ctx),
      Keys.paused(ctx),
      Keys.waiting_children(ctx),
      Keys.prioritized(ctx)
    ]

    args = [job_id]

    execute(conn, :get_state, keys, args)
  end

  @doc """
  Promotes a delayed job to wait.
  """
  @spec promote(atom(), queue_context(), String.t()) :: script_result()
  def promote(conn, ctx, job_id) do
    keys = [
      Keys.delayed(ctx),
      Keys.wait(ctx),
      Keys.pc(ctx),
      Keys.prioritized(ctx),
      Keys.paused(ctx),
      Keys.marker(ctx),
      Keys.events(ctx),
      Keys.meta(ctx),
      Keys.job(ctx, job_id)
    ]

    args = [
      # ARGV[1] prefix:queueName
      Keys.key(ctx),
      # ARGV[2] job id
      job_id
    ]

    execute(conn, :promote, keys, args)
  end

  @doc """
  Updates a job scheduler and adds the next delayed job.

  Called by the worker after completing a repeatable job to schedule
  the next iteration.

  ## Parameters

    * `conn` - Redis connection
    * `ctx` - Queue context (keys structure)
    * `scheduler_id` - The job scheduler ID (repeat_job_key)
    * `next_millis` - Next execution time in milliseconds
    * `template_data` - JSON-encoded job data
    * `job_opts` - Msgpacked job options
    * `producer_id` - The ID of the job that produced this iteration

  ## Returns

    * `{:ok, job_id}` - The ID of the next scheduled job
    * `{:ok, nil}` - Scheduler doesn't exist or duplicate
    * `{:error, reason}` - Error
  """
  @spec update_job_scheduler(
          atom(),
          queue_context(),
          String.t(),
          non_neg_integer(),
          String.t(),
          binary(),
          String.t()
        ) :: script_result()
  def update_job_scheduler(
        conn,
        ctx,
        scheduler_id,
        next_millis,
        template_data,
        job_opts,
        producer_id
      ) do
    # KEYS in order expected by Lua script (updateJobScheduler-12.lua)
    keys = [
      # KEYS[1] 'repeat' key
      Keys.repeat(ctx),
      # KEYS[2] 'delayed'
      Keys.delayed(ctx),
      # KEYS[3] 'wait' key
      Keys.wait(ctx),
      # KEYS[4] 'paused' key
      Keys.paused(ctx),
      # KEYS[5] 'meta'
      Keys.meta(ctx),
      # KEYS[6] 'prioritized' key
      Keys.prioritized(ctx),
      # KEYS[7] 'marker'
      Keys.marker(ctx),
      # KEYS[8] 'id'
      Keys.id(ctx),
      # KEYS[9] events stream key
      Keys.events(ctx),
      # KEYS[10] 'pc' priority counter
      Keys.pc(ctx),
      # KEYS[11] producer key
      Keys.job(ctx, producer_id),
      # KEYS[12] 'active' key
      Keys.active(ctx)
    ]

    timestamp = System.system_time(:millisecond)

    args = [
      # ARGV[1] next milliseconds
      next_millis,
      # ARGV[2] jobs scheduler id
      scheduler_id,
      # ARGV[3] Json stringified delayed data
      template_data,
      # ARGV[4] msgpacked delayed opts
      job_opts,
      # ARGV[5] timestamp
      timestamp,
      # ARGV[6] prefix key
      Keys.key_prefix(ctx),
      # ARGV[7] producer id
      producer_id
    ]

    execute(conn, :update_job_scheduler, keys, args)
  end

  @doc """
  Adds a log entry to a job.
  """
  @spec add_log(atom(), queue_context(), String.t(), String.t(), non_neg_integer() | nil) ::
          script_result()
  def add_log(conn, ctx, job_id, log_message, keep_logs) do
    keys = [
      Keys.job(ctx, job_id),
      Keys.logs(ctx, job_id)
    ]

    args = [
      job_id,
      log_message,
      keep_logs || ""
    ]

    execute(conn, :add_log, keys, args)
  end

  @doc """
  Updates the progress of a job.
  """
  @spec update_progress(atom(), queue_context(), String.t(), any()) :: script_result()
  def update_progress(conn, ctx, job_id, progress) do
    keys = [
      Keys.job(ctx, job_id),
      Keys.events(ctx),
      Keys.meta(ctx)
    ]

    args = [
      job_id,
      encode_progress(progress)
    ]

    execute(conn, :update_progress, keys, args)
  end

  @doc """
  Updates the data of a job.
  """
  @spec update_data(atom(), queue_context(), String.t(), map()) :: script_result()
  def update_data(conn, ctx, job_id, data) do
    keys = [Keys.job(ctx, job_id)]
    args = [Jason.encode!(data)]

    execute(conn, :update_data, keys, args)
  end

  @doc """
  Gets job counts for the queue.
  """
  @spec get_counts(atom(), queue_context()) :: script_result()
  def get_counts(conn, ctx) do
    keys = [Keys.key(ctx)]
    args = []

    execute(conn, :get_counts, keys, args)
  end

  @doc """
  Checks if the queue is at its max limit.
  """
  @spec is_maxed(atom(), queue_context()) :: script_result()
  def is_maxed(conn, ctx) do
    keys = [
      Keys.limiter(ctx),
      Keys.meta(ctx)
    ]

    args = []

    execute(conn, :is_maxed, keys, args)
  end

  @doc """
  Gets the rate limit TTL.

  ## Options
    * `:max_jobs` - Maximum jobs for rate limit (default: 0, uses meta key)
  """
  @spec get_rate_limit_ttl(atom(), queue_context(), keyword()) :: script_result()
  def get_rate_limit_ttl(conn, ctx, opts \\ []) do
    keys = [
      Keys.limiter(ctx),
      Keys.meta(ctx)
    ]

    max_jobs = Keyword.get(opts, :max_jobs, 0)
    args = [max_jobs]

    execute(conn, :get_rate_limit_ttl, keys, args)
  end

  @doc """
  Reprocesses a job that is in completed or failed state.

  Moves a finished job back to the wait queue for reprocessing.

  ## Parameters

    * `conn` - Redis connection
    * `ctx` - Queue context from Keys.new/2
    * `job_id` - The job ID to reprocess
    * `state` - The expected current state (:failed or :completed)
    * `opts` - Options:
      * `:lifo` - If true, push to front of queue (default: false)
      * `:reset_attempts_made` - Reset attempts counter (default: false)
      * `:reset_attempts_started` - Reset attempts started counter (default: false)

  ## Returns

    * `{:ok, 1}` - Job successfully moved to wait
    * `{:error, reason}` - Error with code indicating failure:
      * -1: Job does not exist
      * -3: Job was not found in the expected state
  """
  @spec reprocess_job(atom(), queue_context(), String.t(), atom(), keyword()) :: script_result()
  def reprocess_job(conn, ctx, job_id, state, opts \\ []) when state in [:failed, :completed] do
    state_str = to_string(state)
    lifo = Keyword.get(opts, :lifo, false)
    reset_attempts_made = Keyword.get(opts, :reset_attempts_made, false)
    reset_attempts_started = Keyword.get(opts, :reset_attempts_started, false)

    keys = [
      Keys.job(ctx, job_id),
      Keys.events(ctx),
      if(state == :failed, do: Keys.failed(ctx), else: Keys.completed(ctx)),
      Keys.wait(ctx),
      Keys.meta(ctx),
      Keys.paused(ctx),
      Keys.active(ctx),
      Keys.marker(ctx)
    ]

    args = [
      job_id,
      if(lifo, do: "RPUSH", else: "LPUSH"),
      if(state == :failed, do: "failedReason", else: "returnvalue"),
      state_str,
      if(reset_attempts_made, do: "1", else: "0"),
      if(reset_attempts_started, do: "1", else: "0")
    ]

    execute(conn, :reprocess_job, keys, args)
  end

  @doc """
  Gets queue metrics for completed or failed jobs.

  Returns metrics data including count, previous timestamp, previous count,
  data points, and total number of points.
  """
  @spec get_metrics(atom(), queue_context(), :completed | :failed, integer(), integer()) ::
          script_result()
  def get_metrics(conn, ctx, type, start_idx \\ 0, end_idx \\ -1) do
    type_str = Atom.to_string(type)

    keys = [
      # KEYS[1] metrics key
      Keys.metrics(ctx, type_str),
      # KEYS[2] metrics data key
      "#{Keys.metrics(ctx, type_str)}:data"
    ]

    args = [
      # ARGV[1] start index
      start_idx,
      # ARGV[2] end index
      end_idx
    ]

    case execute(conn, :get_metrics, keys, args) do
      {:ok, [meta, data, count]} ->
        [count_str, prev_ts_str, prev_count_str] = meta || ["0", "0", "0"]

        {:ok,
         %{
           meta: %{
             count: parse_int(count_str || "0"),
             prev_ts: parse_int(prev_ts_str || "0"),
             prev_count: parse_int(prev_count_str || "0")
           },
           data: Enum.map(data || [], fn point -> parse_int(point || "0") end),
           count: count || 0
         }}

      {:ok, result} ->
        {:ok, result}

      {:error, _} = error ->
        error
    end
  end

  defp parse_int(nil), do: 0
  defp parse_int(val) when is_integer(val), do: val

  defp parse_int(val) when is_binary(val) do
    case Integer.parse(val) do
      {int, _} -> int
      :error -> 0
    end
  end

  # ---------------------------------------------------------------------------
  # Private Helpers
  # ---------------------------------------------------------------------------

  defp get_job_id(job) when is_struct(job), do: Map.get(job, :id)
  defp get_job_id(job) when is_map(job), do: Map.get(job, :id) || Map.get(job, "id")
  defp get_job_id(_), do: nil

  defp get_job_name(job) when is_struct(job), do: Map.get(job, :name) || ""
  defp get_job_name(job) when is_map(job), do: Map.get(job, :name) || Map.get(job, "name") || ""
  defp get_job_name(_), do: ""

  defp get_job_timestamp(job) when is_struct(job), do: Map.get(job, :timestamp)

  defp get_job_timestamp(job) when is_map(job),
    do: Map.get(job, :timestamp) || Map.get(job, "timestamp")

  defp get_job_timestamp(_), do: nil

  defp get_job_data(job) when is_struct(job), do: Map.get(job, :data) || %{}
  defp get_job_data(job) when is_map(job), do: Map.get(job, :data) || Map.get(job, "data") || %{}
  defp get_job_data(_), do: %{}

  defp get_job_delay(job) when is_struct(job), do: Map.get(job, :delay) || 0
  defp get_job_delay(job) when is_map(job), do: Map.get(job, :delay) || Map.get(job, "delay") || 0
  defp get_job_delay(_), do: 0

  defp get_job_priority(job) when is_struct(job), do: Map.get(job, :priority) || 0

  defp get_job_priority(job) when is_map(job),
    do: Map.get(job, :priority) || Map.get(job, "priority") || 0

  defp get_job_priority(_), do: 0

  defp get_repeat_job_key(job) when is_struct(job), do: Map.get(job, :repeat_job_key)

  defp get_repeat_job_key(job) when is_map(job),
    do: Map.get(job, :repeat_job_key) || Map.get(job, "repeatJobKey")

  defp get_repeat_job_key(_), do: nil

  defp get_deduplication_key(job, ctx) do
    dedup_id =
      cond do
        is_struct(job) -> Map.get(job, :deduplication_id)
        is_map(job) -> Map.get(job, :deduplication_id) || Map.get(job, "deduplicationId")
        true -> nil
      end

    if dedup_id do
      # Build deduplication key: prefix:queueName:de:deduplicationId
      "#{Keys.key(ctx)}:de:#{dedup_id}"
    else
      nil
    end
  end

  # Get full parent info: {parentKey, parentDepsKey, parent}
  defp get_parent_info_full(job) when is_struct(job) do
    parent = Map.get(job, :parent)

    if parent do
      parent_key = Map.get(parent, :key) || build_parent_key(parent)
      parent_id = Map.get(parent, :id) || ""
      queue_key = Map.get(parent, :queue_key) || ""
      parent_deps_key = if parent_key != "", do: "#{parent_key}:dependencies", else: nil

      parent_obj =
        if parent_id != "" do
          %{"id" => parent_id, "queueKey" => queue_key}
        else
          nil
        end

      {parent_key, parent_deps_key, parent_obj}
    else
      {nil, nil, nil}
    end
  end

  defp get_parent_info_full(job) when is_map(job) do
    parent = Map.get(job, :parent) || Map.get(job, "parent")

    if parent do
      parent_key = Map.get(parent, :key) || Map.get(parent, "key") || build_parent_key(parent)
      parent_id = Map.get(parent, :id) || Map.get(parent, "id") || ""
      queue_key = Map.get(parent, :queue_key) || Map.get(parent, "queueKey") || ""
      parent_deps_key = if parent_key != "", do: "#{parent_key}:dependencies", else: nil

      parent_obj =
        if parent_id != "" do
          %{"id" => parent_id, "queueKey" => queue_key}
        else
          nil
        end

      {parent_key, parent_deps_key, parent_obj}
    else
      {nil, nil, nil}
    end
  end

  defp get_parent_info_full(_), do: {nil, nil, nil}

  defp build_parent_key(parent) when is_map(parent) do
    queue_key = Map.get(parent, :queue_key) || Map.get(parent, "queueKey") || ""
    id = Map.get(parent, :id) || Map.get(parent, "id") || ""

    if queue_key != "" and id != "" do
      "#{queue_key}:#{id}"
    else
      ""
    end
  end

  defp build_parent_key(_), do: ""

  # Get job options (opts field)
  defp get_job_opts(job) when is_struct(job), do: Map.get(job, :opts) || %{}
  defp get_job_opts(job) when is_map(job), do: Map.get(job, :opts) || Map.get(job, "opts") || %{}
  defp get_job_opts(_), do: %{}

  # Pack job options using msgpack with BullMQ's compressed option names
  # Note: This function is kept for potential future use in add_job operations
  @doc false
  def pack_job_opts(job, additional_opts \\ %{}) do
    job_opts = get_job_opts(job)
    delay = get_job_delay(job)
    priority = get_job_priority(job)

    # Build options map with BullMQ's short key names
    opts =
      %{}
      |> maybe_add_opt("del", Map.get(job_opts, :delay) || Map.get(job_opts, "delay") || delay, 0)
      |> maybe_add_opt(
        "pri",
        Map.get(job_opts, :priority) || Map.get(job_opts, "priority") || priority,
        0
      )
      |> maybe_add_opt("at", Map.get(job_opts, :attempts) || Map.get(job_opts, "attempts"), nil)
      |> maybe_add_opt("bo", get_backoff_opts(job_opts), nil)
      |> maybe_add_opt("lifo", Map.get(job_opts, :lifo) || Map.get(job_opts, "lifo"), nil)
      |> maybe_add_opt(
        "ro",
        Map.get(job_opts, :remove_on_complete) || Map.get(job_opts, "removeOnComplete"),
        nil
      )
      |> maybe_add_opt(
        "rof",
        Map.get(job_opts, :remove_on_fail) || Map.get(job_opts, "removeOnFail"),
        nil
      )
      |> maybe_add_opt(
        "fpof",
        Map.get(job_opts, :fail_parent_on_failure) || Map.get(job_opts, "failParentOnFailure"),
        nil
      )
      |> maybe_add_opt(
        "idof",
        Map.get(job_opts, :ignore_dependency_on_failure) ||
          Map.get(job_opts, "ignoreDependencyOnFailure"),
        nil
      )
      |> maybe_add_opt(
        "rdof",
        Map.get(job_opts, :remove_dependency_on_failure) ||
          Map.get(job_opts, "removeDependencyOnFailure"),
        nil
      )
      |> maybe_add_opt("kl", Map.get(job_opts, :keep_logs) || Map.get(job_opts, "keepLogs"), nil)
      |> maybe_add_opt("rep", get_repeat_opts(job_opts), nil)
      |> Map.merge(additional_opts)

    Msgpax.pack!(opts, iodata: false)
  end

  defp maybe_add_opt(map, _key, nil, _default), do: map
  defp maybe_add_opt(map, _key, value, default) when value == default, do: map
  defp maybe_add_opt(map, key, value, _default), do: Map.put(map, key, value)

  defp get_backoff_opts(opts) do
    backoff = Map.get(opts, :backoff) || Map.get(opts, "backoff")

    case backoff do
      %{type: type, delay: delay} -> %{"type" => type, "delay" => delay}
      %{"type" => _, "delay" => _} = b -> b
      _ -> nil
    end
  end

  defp get_repeat_opts(opts) do
    repeat = Map.get(opts, :repeat) || Map.get(opts, "repeat")

    case repeat do
      nil -> nil
      r when is_map(r) -> r
      _ -> nil
    end
  end

  defp encode_result_value(result) when is_map(result), do: Jason.encode!(result)
  defp encode_result_value(result) when is_binary(result), do: result
  defp encode_result_value(result), do: inspect(result)

  defp encode_progress(progress) when is_map(progress), do: Jason.encode!(progress)
  defp encode_progress(progress) when is_integer(progress), do: Integer.to_string(progress)
  defp encode_progress(progress), do: Jason.encode!(progress)

  defp encode_arg(arg) when is_binary(arg), do: arg
  defp encode_arg(arg) when is_integer(arg), do: Integer.to_string(arg)
  defp encode_arg(arg) when is_float(arg), do: Float.to_string(arg)

  defp encode_arg(arg) when is_atom(arg) and not is_nil(arg) and not is_boolean(arg),
    do: Atom.to_string(arg)

  defp encode_arg(true), do: "1"
  defp encode_arg(false), do: "0"
  defp encode_arg(nil), do: ""
  defp encode_arg(arg) when is_map(arg), do: Jason.encode!(arg)
  defp encode_arg(arg) when is_list(arg), do: Jason.encode!(arg)

  defp decode_result(result) when is_list(result), do: Enum.map(result, &decode_result/1)
  defp decode_result(result), do: result

  defp sha1(content) do
    :crypto.hash(:sha, content) |> Base.encode16(case: :lower)
  end
end
