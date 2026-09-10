defmodule BullMQ.Backends.Redis do
  @moduledoc """
  Redis implementation of the `BullMQ.Backend` behaviour.

  This adapter is the Elixir port of the Node.js `RedisQueueBackend`. It is an
  **immutable struct** carrying the queue identity (key `context`) and a
  reference to the connection process(es) it uses:

    * `connection` — a pooled `BullMQ.RedisConnection` (a `Supervisor` +
      `NimblePool`). Commands run in the caller process via a pool checkout, so
      many operations can run concurrently without a per-backend process.
    * `blocking_conn` — an optional dedicated blocking connection (a `Redix`
      pid) used for the worker's `BZPOPMIN` and the event stream's `XREAD`,
      which must not stall pooled commands.

  The adapter delegates the high-level operations to the existing
  `BullMQ.Scripts` (Lua) and `BullMQ.RedisConnection` (raw command) modules, so
  it is a thin translation layer: `Backend.<fn>(backend, args)` becomes
  `Scripts.<fn>(backend.connection, backend.context, args)`.
  """

  @behaviour BullMQ.Backend

  alias BullMQ.{Keys, RedisConnection, Scripts, Telemetry, Utils, Version}

  @minimum_block_timeout 0.001

  # Maximum number of add-commands per single pipeline call (avoids datastore timeouts).
  @max_bulk_pipeline_size 10_000

  @typedoc "A Redis backend instance."
  @type t :: %__MODULE__{
          connection: term(),
          context: Keys.queue_context(),
          blocking_conn: pid() | nil,
          blocking_telemetry_id: term() | nil,
          client_name: String.t() | nil,
          owns_connection: boolean()
        }

  defstruct connection: nil,
            context: nil,
            blocking_conn: nil,
            blocking_telemetry_id: nil,
            client_name: nil,
            owns_connection: true

  @doc """
  Builds a Redis backend for `name`.

  ## Options
    * `:connection` (required) — a `BullMQ.RedisConnection` reference.
    * `:prefix` — key prefix (default `"bull"`).
    * `:blocking_conn` — an optional dedicated blocking connection pid.
    * `:client_name` — a client name set on the dedicated blocking connection
      when it is established (used for worker discovery via `CLIENT LIST`).
    * `:owns_connection` — whether `close/2` should stop the connection
      (default `true`).
  """
  @spec new(String.t(), keyword()) :: t()
  def new(name, opts) do
    prefix = Keyword.get(opts, :prefix, "bull")

    %__MODULE__{
      connection: Keyword.fetch!(opts, :connection),
      context: Keys.new(name, prefix: prefix),
      blocking_conn: Keyword.get(opts, :blocking_conn),
      client_name: Keyword.get(opts, :client_name),
      owns_connection: Keyword.get(opts, :owns_connection, true)
    }
  end

  @doc "The minimum meaningful blocking timeout (seconds)."
  def minimum_block_timeout, do: @minimum_block_timeout

  # ============================================================
  # Connection lifecycle
  # ============================================================

  @impl true
  def wait_until_ready(%__MODULE__{connection: conn}) do
    case RedisConnection.command(conn, ["PING"]) do
      {:ok, _} -> :ok
      {:error, _} = error -> error
    end
  end

  @impl true
  def close(%__MODULE__{} = b, _force) do
    detach_blocking_handler(b.blocking_telemetry_id)
    if b.blocking_conn, do: RedisConnection.close_blocking(b.connection, b.blocking_conn)
    if b.owns_connection, do: RedisConnection.close(b.connection)
    :ok
  end

  @impl true
  def disconnect(%__MODULE__{} = b), do: close(b, true)

  @impl true
  def set_name(%__MODULE__{connection: conn}, name) do
    RedisConnection.set_client_name(conn, name)
  end

  @impl true
  def for_queue(%__MODULE__{} = b, queue_name, prefix) do
    ctx_prefix = prefix || b.context.prefix

    %__MODULE__{
      b
      | context: Keys.new(queue_name, prefix: ctx_prefix),
        owns_connection: false,
        blocking_conn: nil,
        blocking_telemetry_id: nil,
        client_name: nil
    }
  end

  # ============================================================
  # Identity & keys
  # ============================================================

  @impl true
  def qualified_name(%__MODULE__{context: ctx}), do: Keys.key(ctx)

  @impl true
  def context(%__MODULE__{context: ctx}), do: ctx

  @impl true
  def to_key(%__MODULE__{context: ctx}, type), do: "#{Keys.key(ctx)}:#{type}"

  @impl true
  def parse_node_key(%__MODULE__{}, key) do
    # "<prefix>:<queueName>:<id>" -> prefix, queueName, id
    case String.split(key, ":") do
      parts when length(parts) >= 3 ->
        {id, rest} = List.pop_at(parts, -1)
        [prefix | queue_parts] = rest
        %{prefix: prefix, queue_name: Enum.join(queue_parts, ":"), id: id}

      _ ->
        %{prefix: "", queue_name: "", id: key}
    end
  end

  @impl true
  def client_name(%__MODULE__{context: ctx}, suffix) do
    "#{ctx.prefix}:#{ctx.name}#{suffix || ""}"
  end

  # ============================================================
  # Adding jobs
  # ============================================================

  @impl true
  def add_job(%__MODULE__{connection: conn, context: ctx}, job, _opts) do
    encoded_opts = encode_job_opts(job.opts)

    result =
      cond do
        job.delay > 0 -> Scripts.add_delayed_job(conn, ctx, job, encoded_opts)
        job.priority > 0 -> Scripts.add_prioritized_job(conn, ctx, job, encoded_opts)
        true -> Scripts.add_standard_job(conn, ctx, job, encoded_opts)
      end

    case result do
      {:ok, job_id} when is_binary(job_id) or is_integer(job_id) ->
        {:ok, to_string(job_id)}

      {:error, _} = error ->
        error
    end
  end

  @impl true
  def add_jobs(%__MODULE__{connection: conn, context: ctx}, jobs_with_opts, opts) do
    # jobs_with_opts: list of {job, encoded_opts}. Returns per-job command
    # results (`{:ok, id} | {:error, reason}`) in order, so callers can match
    # them back to their jobs. How the insert is batched (pipeline vs MULTI,
    # single connection vs a pool) is entirely a backend concern.
    Scripts.ensure_scripts_loaded(conn, [:add_standard_job])

    case Scripts.build_bulk_add_commands(ctx, jobs_with_opts) do
      {:ok, jobs_and_commands} ->
        {_jobs, commands} = Enum.unzip(jobs_and_commands)

        max_pipeline = Keyword.get(opts, :max_pipeline_size, @max_bulk_pipeline_size)
        connection_pool = Keyword.get(opts, :connection_pool)
        atomic = Keyword.get(opts, :atomic, true)

        {:ok, execute_bulk_commands(conn, commands, max_pipeline, connection_pool, atomic)}

      {:error, _} = error ->
        error
    end
  end

  # Execute bulk add commands using either MULTI/EXEC (atomic) or plain pipeline,
  # optionally spread across a connection pool for higher throughput.
  defp execute_bulk_commands(conn, commands, max_pipeline, nil, atomic) do
    execute_fn = bulk_execute_fn(atomic)
    execute_command_batches(conn, commands, max_pipeline, execute_fn)
  end

  defp execute_bulk_commands(_conn, commands, max_pipeline, pool, atomic) when is_list(pool) do
    execute_fn = bulk_execute_fn(atomic)
    pool_size = length(pool)
    chunk_size = max(div(length(commands), pool_size), 1)

    commands
    |> Enum.chunk_every(chunk_size)
    |> Enum.with_index()
    |> Task.async_stream(
      fn {chunk, idx} ->
        pool_conn = Enum.at(pool, rem(idx, pool_size))
        execute_command_batches(pool_conn, chunk, max_pipeline, execute_fn)
      end,
      max_concurrency: pool_size,
      timeout: 120_000,
      ordered: true
    )
    |> Enum.flat_map(fn {:ok, results} -> results end)
  end

  defp bulk_execute_fn(true), do: &Scripts.execute_transaction/2
  defp bulk_execute_fn(false), do: &Scripts.execute_pipeline/2

  defp execute_command_batches(conn, commands, max_pipeline, execute_fn) do
    commands
    |> Enum.chunk_every(max_pipeline)
    |> Enum.flat_map(&run_command_batch(conn, &1, execute_fn))
  end

  defp run_command_batch(conn, batch, execute_fn) do
    case execute_fn.(conn, batch) do
      {:ok, results} -> results
      {:error, reason} -> Enum.map(batch, fn _ -> {:error, reason} end)
    end
  end

  @impl true
  def add_flow(%__MODULE__{connection: conn}, commands, _opts) do
    # `commands` is a pre-built list of datastore commands for every node of the
    # flow tree. They are executed atomically so the whole flow is inserted or
    # nothing is. Script loading is ensured here so callers never touch the
    # connection directly.
    Scripts.ensure_scripts_loaded(conn, [:add_standard_job, :add_parent_job])
    Scripts.execute_transaction(conn, commands)
  end

  @impl true
  def build_add_standard_command(%__MODULE__{context: ctx}, job, opts),
    do: Scripts.build_add_standard_job_command(ctx, job, opts)

  @impl true
  def build_add_parent_command(%__MODULE__{context: ctx}, job, opts),
    do: Scripts.build_add_parent_job_command(ctx, job, opts)

  @doc """
  Filters the job option keys that are encoded into the add scripts. Public so
  callers building bulk entries can reuse the same encoding.
  """
  @spec encode_job_opts(map()) :: map()
  def encode_job_opts(opts), do: Utils.encode_job_opts(opts)

  # ============================================================
  # Job state transitions
  # ============================================================

  @impl true
  def move_to_active(%__MODULE__{connection: conn, context: ctx}, token, opts),
    do: Scripts.move_to_active(conn, ctx, token, opts)

  @impl true
  def move_to_completed(%__MODULE__{connection: conn, context: ctx}, job_id, token, rv, opts),
    do: Scripts.move_to_completed(conn, ctx, job_id, token, rv, opts)

  @impl true
  def move_to_failed(%__MODULE__{connection: conn, context: ctx}, job_id, token, error, opts),
    do: Scripts.move_to_failed(conn, ctx, job_id, token, error, opts)

  @impl true
  def move_to_delayed(%__MODULE__{connection: conn, context: ctx}, job_id, token, delay, opts),
    do: Scripts.move_to_delayed(conn, ctx, job_id, token, delay, opts)

  @impl true
  def move_to_waiting_children(%__MODULE__{connection: conn, context: ctx}, job_id, token, opts),
    do: Scripts.move_to_waiting_children(conn, ctx, job_id, token, opts)

  @impl true
  def move_job_from_active_to_wait(%__MODULE__{connection: conn, context: ctx}, job_id, token),
    do: Scripts.move_job_from_active_to_wait(conn, ctx, job_id, token)

  @impl true
  def retry_job(%__MODULE__{connection: conn, context: ctx}, job_id, lifo, token, _opts),
    do: Scripts.retry_job(conn, ctx, job_id, lifo, token)

  @impl true
  def reprocess_job(%__MODULE__{connection: conn, context: ctx}, job_id, state, opts),
    do: Scripts.reprocess_job(conn, ctx, job_id, state, opts)

  @impl true
  def promote(%__MODULE__{connection: conn, context: ctx}, job_id),
    do: Scripts.promote(conn, ctx, job_id)

  @impl true
  def move_stalled_jobs_to_wait(%__MODULE__{connection: conn, context: ctx}, max_stalled, opts),
    do: Scripts.move_stalled_jobs_to_wait(conn, ctx, max_stalled, opts)

  @impl true
  def check_stalled_jobs(%__MODULE__{connection: conn, context: ctx}, max_stalled_count) do
    case RedisConnection.command(conn, ["LRANGE", Keys.active(ctx), 0, -1]) do
      {:ok, []} ->
        {:ok, %{recovered: 0, failed: 0}}

      {:ok, job_ids} ->
        check_jobs_stalled(conn, ctx, job_ids, max_stalled_count)

      {:error, _} = error ->
        error
    end
  end

  @impl true
  def has_job_lock?(%__MODULE__{connection: conn, context: ctx}, job_id) do
    case RedisConnection.command(conn, ["EXISTS", Keys.lock(ctx, job_id)]) do
      {:ok, 1} -> {:ok, true}
      {:ok, 0} -> {:ok, false}
      {:error, _} = error -> error
    end
  end

  # ============================================================
  # Bulk admin transitions
  # ============================================================

  @impl true
  def pause(%__MODULE__{connection: conn, context: ctx}, paused?),
    do: Scripts.pause(conn, ctx, paused?)

  @impl true
  def drain(%__MODULE__{connection: conn, context: ctx}, delayed?),
    do: Scripts.drain(conn, ctx, delayed?)

  @impl true
  def clean_jobs_by_state(%__MODULE__{connection: conn, context: ctx}, state, grace, opts) do
    limit = Keyword.get(opts, :limit, 1000)
    timestamp = System.system_time(:millisecond) - grace

    case clean_state_key(state, ctx) do
      nil -> {:error, :unsupported_state}
      key -> remove_expired_state_jobs(conn, ctx, key, timestamp, limit)
    end
  end

  defp clean_state_key(:completed, ctx), do: Keys.completed(ctx)
  defp clean_state_key(:failed, ctx), do: Keys.failed(ctx)
  defp clean_state_key(_state, _ctx), do: nil

  defp remove_expired_state_jobs(conn, ctx, key, timestamp, limit) do
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
        Enum.each(job_ids, fn job_id -> Scripts.remove_job(conn, ctx, job_id, false) end)
        {:ok, job_ids}

      {:error, _} = error ->
        error
    end
  end

  @impl true
  def obliterate(%__MODULE__{connection: conn, context: ctx}, count, force),
    do: Scripts.obliterate(conn, ctx, count, force)

  # ============================================================
  # Locks
  # ============================================================

  @impl true
  def extend_lock(%__MODULE__{connection: conn, context: ctx}, job_id, token, duration),
    do: Scripts.extend_lock(conn, ctx, job_id, token, duration)

  @impl true
  def extend_locks(%__MODULE__{connection: conn, context: ctx}, job_ids, tokens, duration),
    do: Scripts.extend_locks(conn, ctx, job_ids, tokens, duration)

  @impl true
  def release_lock(%__MODULE__{connection: conn, context: ctx}, job_id, token),
    do: Scripts.release_lock(conn, ctx, job_id, token)

  # ============================================================
  # Job mutations
  # ============================================================

  @impl true
  def update_data(%__MODULE__{connection: conn, context: ctx}, job_id, data),
    do: Scripts.update_data(conn, ctx, job_id, data)

  @impl true
  def update_progress(%__MODULE__{connection: conn, context: ctx}, job_id, progress),
    do: Scripts.update_progress(conn, ctx, job_id, progress)

  @impl true
  def add_log(%__MODULE__{connection: conn, context: ctx}, job_id, log_row, keep_logs),
    do: Scripts.add_log(conn, ctx, job_id, log_row, keep_logs)

  @impl true
  def remove(%__MODULE__{connection: conn, context: ctx}, job_id, remove_children),
    do: Scripts.remove_job(conn, ctx, job_id, remove_children)

  @impl true
  def remove_deduplication_key(%__MODULE__{connection: conn, context: ctx}, dedup_id, job_id) do
    RedisConnection.command(conn, [
      "EVAL",
      """
      local currentJobId = redis.call('GET', KEYS[1])
      if currentJobId and currentJobId == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      end
      return 0
      """,
      "1",
      "#{Keys.key(ctx)}:de:#{dedup_id}",
      job_id
    ])
  end

  @impl true
  def delete_deduplication_key(%__MODULE__{connection: conn, context: ctx}, dedup_id) do
    RedisConnection.command(conn, ["DEL", "#{Keys.key(ctx)}:de:#{dedup_id}"])
  end

  # ============================================================
  # Job schedulers
  # ============================================================

  @impl true
  def update_job_scheduler(
        %__MODULE__{connection: conn, context: ctx},
        scheduler_id,
        next_millis,
        template_data,
        delayed_job_opts,
        producer_id
      ) do
    Scripts.update_job_scheduler(
      conn,
      ctx,
      scheduler_id,
      next_millis,
      template_data,
      delayed_job_opts,
      producer_id
    )
  end

  @impl true
  def get_job_scheduler(%__MODULE__{connection: conn, context: ctx}, scheduler_id) do
    {script, key_count} = Scripts.get(:get_job_scheduler)
    keys = [Keys.repeat(ctx)]
    args = [scheduler_id]
    RedisConnection.command(conn, ["EVAL", script, key_count | keys ++ args])
  end

  @impl true
  def get_job_schedulers_range(%__MODULE__{connection: conn, context: ctx}, start, stop, asc) do
    repeat_key = Keys.repeat(ctx)

    cmd =
      if asc,
        do: ["ZRANGE", repeat_key, start, stop, "WITHSCORES"],
        else: ["ZREVRANGE", repeat_key, start, stop, "WITHSCORES"]

    RedisConnection.command(conn, cmd)
  end

  @impl true
  def get_job_schedulers_count(%__MODULE__{connection: conn, context: ctx}) do
    RedisConnection.command(conn, ["ZCARD", Keys.repeat(ctx)])
  end

  @impl true
  def remove_job_scheduler(%__MODULE__{connection: conn, context: ctx}, scheduler_id) do
    {script, key_count} = Scripts.get(:remove_job_scheduler)
    keys = [Keys.repeat(ctx), Keys.delayed(ctx), Keys.events(ctx)]
    args = [scheduler_id, Keys.base(ctx) <> ":"]
    RedisConnection.command(conn, ["EVAL", script, key_count | keys ++ args])
  end

  @impl true
  def add_job_scheduler(
        %__MODULE__{connection: conn, context: ctx},
        scheduler_id,
        next_millis,
        opts
      ) do
    opts_map = Map.new(opts)
    scheduler_opts = Map.fetch!(opts_map, :scheduler_opts)
    template_data = Map.fetch!(opts_map, :template_data)
    template_opts = Map.fetch!(opts_map, :template_opts)
    delayed_opts = Map.fetch!(opts_map, :delayed_opts)
    now = Map.fetch!(opts_map, :now)
    producer_id = Map.get(opts_map, :producer_id)

    {script, key_count} = Scripts.get(:add_job_scheduler)

    keys = [
      Keys.repeat(ctx),
      Keys.delayed(ctx),
      Keys.wait(ctx),
      Keys.paused(ctx),
      Keys.meta(ctx),
      Keys.prioritized(ctx),
      Keys.marker(ctx),
      Keys.id(ctx),
      Keys.events(ctx),
      Keys.pc(ctx),
      Keys.active(ctx)
    ]

    args = [
      next_millis,
      Msgpax.pack!(scheduler_opts, iodata: false),
      scheduler_id,
      template_data,
      Msgpax.pack!(template_opts, iodata: false),
      Msgpax.pack!(delayed_opts, iodata: false),
      now,
      Keys.base(ctx) <> ":",
      producer_id || ""
    ]

    RedisConnection.command(conn, ["EVAL", script, key_count | keys ++ args])
  end

  # ============================================================
  # Queue / job queries
  # ============================================================

  @impl true
  def get_state(%__MODULE__{connection: conn, context: ctx}, job_id),
    do: Scripts.get_state(conn, ctx, job_id)

  @impl true
  def get_job_data(%__MODULE__{connection: conn, context: ctx}, job_id) do
    case RedisConnection.command(conn, ["HGETALL", Keys.job(ctx, job_id)]) do
      {:ok, []} -> {:ok, nil}
      {:ok, data} -> {:ok, Utils.parse_hash_data(data)}
      {:error, _} = error -> error
    end
  end

  @impl true
  def get_job_logs(%__MODULE__{connection: conn, context: ctx}, job_id, start, stop, asc) do
    logs_key = Keys.logs(ctx, job_id)

    {range_start, range_end} =
      if asc, do: {start, stop}, else: {-(stop + 1), -(start + 1)}

    commands = [["LRANGE", logs_key, range_start, range_end], ["LLEN", logs_key]]

    case RedisConnection.pipeline(conn, commands) do
      {:ok, [logs, count]} ->
        final_logs = if asc, do: logs, else: Enum.reverse(logs)
        {:ok, %{logs: final_logs, count: count}}

      {:error, _} = error ->
        error
    end
  end

  @impl true
  def maxed?(%__MODULE__{connection: conn, context: ctx}) do
    case Scripts.maxed?(conn, ctx) do
      {:ok, res} when res in [1, true, "1"] -> true
      _ -> false
    end
  end

  @impl true
  def get_processed_children_values(%__MODULE__{connection: conn, context: ctx}, job_id),
    do: RedisConnection.command(conn, ["HGETALL", Keys.job_processed(ctx, job_id)])

  @impl true
  def get_ignored_children_failures(%__MODULE__{connection: conn, context: ctx}, job_id),
    do: RedisConnection.command(conn, ["HGETALL", Keys.job_failed(ctx, job_id)])

  @impl true
  def get_dependencies(%__MODULE__{connection: conn, context: ctx}, job_id),
    do: RedisConnection.command(conn, ["SMEMBERS", Keys.job_dependencies(ctx, job_id)])

  @impl true
  def get_dependencies_count(%__MODULE__{connection: conn, context: ctx}, job_id),
    do: RedisConnection.command(conn, ["SCARD", Keys.job_dependencies(ctx, job_id)])

  @impl true
  def get_rate_limit_ttl(%__MODULE__{connection: conn, context: ctx}, opts),
    do: Scripts.get_rate_limit_ttl(conn, ctx, opts)

  @impl true
  def get_counts(%__MODULE__{connection: conn, context: ctx}),
    do: Scripts.get_counts(conn, ctx)

  @impl true
  def get_counts_per_priority(%__MODULE__{connection: conn, context: ctx}, priorities) do
    Scripts.get_counts_per_priority(conn, ctx, priorities)
  end

  @impl true
  def get_counts_by_types(%__MODULE__{connection: conn, context: ctx}, types) do
    commands = Enum.map(types, &count_command(ctx, &1))

    case RedisConnection.pipeline(conn, commands) do
      {:ok, results} -> {:ok, Enum.map(results, &(&1 || 0))}
      {:error, _} = error -> error
    end
  end

  @impl true
  def get_ranges(%__MODULE__{connection: conn, context: ctx}, types, start, stop) do
    results =
      Enum.map(List.wrap(types), fn state ->
        case state_range_command(ctx, state, start, stop) do
          nil -> {:ok, []}
          cmd -> RedisConnection.command(conn, cmd)
        end
      end)

    ids =
      results
      |> Enum.flat_map(fn
        {:ok, list} when is_list(list) -> list
        _ -> []
      end)
      |> Enum.uniq()

    {:ok, ids}
  end

  @impl true
  def get_metrics(%__MODULE__{connection: conn, context: ctx}, type, start, stop),
    do: Scripts.get_metrics(conn, ctx, type, start, stop)

  @impl true
  def get_deduplication_job_id(%__MODULE__{connection: conn, context: ctx}, dedup_id) do
    RedisConnection.command(conn, ["GET", "#{Keys.key(ctx)}:de:#{dedup_id}"])
  end

  @impl true
  def get_client_list(%__MODULE__{connection: conn}) do
    case RedisConnection.command(conn, ["CLIENT", "LIST"]) do
      {:ok, list} when is_list(list) -> {:ok, list}
      {:ok, str} when is_binary(str) -> {:ok, [str]}
      {:error, _} = error -> error
    end
  end

  @impl true
  def get_workers(%__MODULE__{connection: conn, context: ctx}, opts) do
    cluster_connections = Keyword.get(opts, :cluster_connections, [])
    client_name_prefix = "#{ctx.prefix}:#{ctx.name}"

    matcher = fn client ->
      name = client["name"] || ""
      name == client_name_prefix or String.starts_with?(name, "#{client_name_prefix}:w:")
    end

    raw_result = fetch_raw_client_list(conn, cluster_connections, matcher)
    format_client_list_result(raw_result, ctx.name, matcher)
  end

  defp fetch_raw_client_list(_conn, connections, matcher)
       when is_list(connections) and connections != [] do
    fetch_cluster_client_list(connections, matcher)
  end

  defp fetch_raw_client_list(conn, _cluster_connections, _matcher) do
    RedisConnection.command(conn, ["CLIENT", "LIST"])
  end

  defp fetch_cluster_client_list(connections, matcher) do
    lists =
      Enum.reduce(connections, [], fn connection, acc ->
        case RedisConnection.command(connection, ["CLIENT", "LIST"]) do
          {:ok, list} when is_binary(list) ->
            [filter_client_list(list, matcher) | acc]

          _ ->
            acc
        end
      end)

    case lists do
      [] -> {:ok, ""}
      _ -> {:ok, Enum.max_by(lists, &length/1)}
    end
  end

  defp filter_client_list(list, matcher) do
    list
    |> String.split(~r/\r?\n/, trim: true)
    |> Enum.map(&parse_client_info/1)
    |> Enum.filter(matcher)
  end

  defp format_client_list_result({:ok, list}, queue_name, _matcher) when is_list(list) do
    {:ok, Enum.map(list, &Map.put(&1, "queue", queue_name))}
  end

  defp format_client_list_result({:ok, client_list}, queue_name, matcher)
       when is_binary(client_list) do
    workers =
      client_list
      |> filter_client_list(matcher)
      |> Enum.map(&Map.put(&1, "queue", queue_name))

    {:ok, workers}
  end

  defp format_client_list_result({:ok, _}, _queue_name, _matcher), do: {:ok, []}

  defp format_client_list_result({:error, %Redix.Error{message: message}}, _queue_name, _matcher) do
    handle_client_list_error(message)
  end

  defp format_client_list_result({:error, _} = error, _queue_name, _matcher), do: error

  defp handle_client_list_error(message) do
    if String.contains?(message, "unknown command") or String.contains?(message, "CLIENT") do
      {:ok, [%{"name" => "CLIENT LIST not supported"}]}
    else
      {:error, message}
    end
  end

  defp parse_client_info(line), do: Utils.parse_client_info(line)

  # ============================================================
  # Queue metadata & maintenance keys
  # ============================================================

  @impl true
  def set_queue_meta(%__MODULE__{connection: conn, context: ctx}, values) do
    args =
      values
      |> Enum.flat_map(fn {k, v} -> [to_string(k), to_string(v)] end)

    RedisConnection.command(conn, ["HMSET", Keys.meta(ctx) | args])
  end

  @impl true
  def get_queue_meta_field(%__MODULE__{connection: conn, context: ctx}, field) do
    RedisConnection.command(conn, ["HGET", Keys.meta(ctx), field])
  end

  @impl true
  def get_queue_meta_fields(%__MODULE__{connection: conn, context: ctx}, fields) do
    RedisConnection.command(conn, ["HMGET", Keys.meta(ctx) | fields])
  end

  @impl true
  def get_queue_meta(%__MODULE__{connection: conn, context: ctx}) do
    case RedisConnection.command(conn, ["HGETALL", Keys.meta(ctx)]) do
      {:ok, data} -> {:ok, Utils.parse_hash_data(data)}
      {:error, _} = error -> error
    end
  end

  @impl true
  def has_queue_meta_field(%__MODULE__{connection: conn, context: ctx}, field) do
    case RedisConnection.command(conn, ["HEXISTS", Keys.meta(ctx), field]) do
      {:ok, 1} -> {:ok, true}
      {:ok, _} -> {:ok, false}
      {:error, _} = error -> error
    end
  end

  # ============================================================
  # Event stream
  # ============================================================

  @impl true
  def publish_event(%__MODULE__{connection: conn, context: ctx}, fields, max_events) do
    flat = Enum.flat_map(fields, fn {k, v} -> [to_string(k), to_string(v)] end)

    RedisConnection.command(
      conn,
      ["XADD", Keys.events(ctx), "MAXLEN", "~", to_string(max_events), "*" | flat]
    )
  end

  @impl true
  def read_events(%__MODULE__{context: ctx, blocking_conn: bconn}, id, block_ms)
      when is_pid(bconn) do
    Redix.command(bconn, ["XREAD", "BLOCK", block_ms, "STREAMS", Keys.events(ctx), id])
  end

  def read_events(%__MODULE__{connection: conn, context: ctx}, id, block_ms) do
    RedisConnection.command(
      conn,
      ["XREAD", "BLOCK", to_string(block_ms), "STREAMS", Keys.events(ctx), id]
    )
  end

  # ============================================================
  # Worker blocking primitive
  # ============================================================

  @impl true
  def wait_for_job(%__MODULE__{blocking_conn: nil}, _block_timeout), do: :timeout

  def wait_for_job(%__MODULE__{context: ctx, blocking_conn: bconn}, block_timeout) do
    # BZPOPMIN returns [key, member, score] or nil on timeout. The marker member
    # is "0" for an immediately-available job and "1" for a delayed job whose
    # score is the timestamp when it becomes ready.
    case Redix.command(bconn, ["BZPOPMIN", Keys.marker(ctx), block_timeout], timeout: :infinity) do
      {:ok, nil} -> :timeout
      {:ok, [_key, "0", _score]} -> {:job_available, nil}
      {:ok, [_key, "1", score]} -> {:job_available, String.to_integer(score)}
      {:ok, [_key, _member, _score]} -> {:job_available, nil}
      {:error, %Redix.ConnectionError{}} -> :timeout
      {:error, reason} -> {:error, reason}
    end
  end

  @impl true
  def disconnect_blocking(%__MODULE__{blocking_conn: nil}, _wait?), do: :ok

  def disconnect_blocking(%__MODULE__{blocking_conn: bconn}, _wait?) do
    RedisConnection.disconnect_blocking(bconn)
    :ok
  end

  @impl true
  def reconnect_blocking(%__MODULE__{connection: conn, client_name: client_name} = b) do
    detach_blocking_handler(b.blocking_telemetry_id)

    case RedisConnection.blocking_connection(conn) do
      {:ok, bconn} ->
        if client_name, do: RedisConnection.set_client_name(bconn, client_name)
        telemetry_id = attach_blocking_name_handler(bconn, client_name)
        {:ok, %{b | blocking_conn: bconn, blocking_telemetry_id: telemetry_id}}

      {:error, _} = error ->
        error
    end
  end

  # Re-applies the client name whenever the dedicated blocking connection
  # reconnects, so the worker stays discoverable via `CLIENT LIST`. Moved here
  # from the worker so no Redis-specific concern leaks outside the backend.
  @doc false
  def handle_blocking_name_event(_event, _measurements, metadata, config) do
    if metadata.connection == config.blocking_conn do
      _ = RedisConnection.set_client_name(config.blocking_conn, config.client_name)
    end
  end

  defp attach_blocking_name_handler(_bconn, nil), do: nil

  defp attach_blocking_name_handler(bconn, client_name) do
    handler_id = {:bullmq_blocking_client_name, make_ref()}
    config = %{blocking_conn: bconn, client_name: client_name}

    case :telemetry.attach(
           handler_id,
           [:redix, :connection],
           &__MODULE__.handle_blocking_name_event/4,
           config
         ) do
      :ok -> handler_id
      {:error, _} -> nil
    end
  end

  defp detach_blocking_handler(nil), do: :ok
  defp detach_blocking_handler(id), do: :telemetry.detach(id)

  # ============================================================
  # Private helpers
  # ============================================================

  # Stalled-job detection: check each active job's lock and recover the ones
  # whose lock has expired.
  defp check_jobs_stalled(conn, ctx, job_ids, max_stalled_count) do
    lock_commands = Enum.map(job_ids, fn job_id -> ["EXISTS", Keys.lock(ctx, job_id)] end)

    case RedisConnection.pipeline(conn, lock_commands) do
      {:ok, results} ->
        stalled_jobs =
          job_ids
          |> Enum.zip(results)
          |> Enum.filter(fn {_id, exists} -> exists == 0 end)
          |> Enum.map(fn {id, _} -> id end)

        if Enum.empty?(stalled_jobs) do
          {:ok, %{recovered: 0, failed: 0}}
        else
          move_stalled_jobs(conn, ctx, stalled_jobs, max_stalled_count)
        end

      {:error, _} = error ->
        error
    end
  end

  defp move_stalled_jobs(conn, ctx, stalled_jobs, max_stalled_count) do
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

    case Scripts.execute_raw(conn, script, keys, args) do
      {:ok, [recovered, failed]} ->
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
        {:ok, %{recovered: result, failed: 0}}

      {:error, _} = error ->
        error
    end
  end

  defp count_command(ctx, type) do
    case state_key_and_type(ctx, type) do
      {:list, key} -> ["LLEN", key]
      {:zset, key} -> ["ZCARD", key]
      :unknown -> ["LLEN", "nonexistent_key"]
    end
  end

  defp state_range_command(ctx, state, start, stop) do
    case state_key_and_type(ctx, state) do
      {:list, key} -> ["LRANGE", key, start, stop]
      {:zset, key} -> ["ZRANGE", key, start, stop]
      :unknown -> nil
    end
  end

  defp state_key_and_type(ctx, state) when state in [:waiting, :wait], do: {:list, Keys.wait(ctx)}
  defp state_key_and_type(ctx, :active), do: {:list, Keys.active(ctx)}
  defp state_key_and_type(ctx, :paused), do: {:list, Keys.paused(ctx)}
  defp state_key_and_type(ctx, :delayed), do: {:zset, Keys.delayed(ctx)}
  defp state_key_and_type(ctx, :prioritized), do: {:zset, Keys.prioritized(ctx)}
  defp state_key_and_type(ctx, :completed), do: {:zset, Keys.completed(ctx)}
  defp state_key_and_type(ctx, :failed), do: {:zset, Keys.failed(ctx)}
  defp state_key_and_type(ctx, :waiting_children), do: {:zset, Keys.waiting_children(ctx)}
  defp state_key_and_type(_ctx, _state), do: :unknown

  # Silence unused alias warning if Version becomes unused during incremental work.
  @doc false
  def __version__, do: Version.full_version()
end
