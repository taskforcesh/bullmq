defmodule BullMQ.Backends.Postgres do
  @moduledoc """
  PostgreSQL implementation of the `BullMQ.Backend` behaviour — the Elixir port
  of the Node.js `PostgresQueueBackend`.

  The heavy lifting lives in **language-agnostic SQL**: the schema and PL/pgSQL
  operation functions are applied by `BullMQ.Backends.Postgres.Migrator` from
  the shared `src/postgres/migrations/*.sql`, and every runtime operation runs a
  parameterized statement from `src/postgres/commands/*.sql` (loaded by
  `BullMQ.Backends.Postgres.SqlLoader`). This adapter only builds the parameter
  lists and maps result rows into the same shapes the high-level BullMQ modules
  already consume from the Redis backend.

  The connection-level `schema` is the namespace for all queues (the SQL-native
  replacement for Redis's per-queue key `prefix`), so the `.sql` files reference
  unqualified names and stay portable.

  ## Usage

      {:ok, _} = BullMQ.Backends.Postgres.Connection.start_link(
        name: :pg, url: "postgres://localhost/bullmq", schema: "bullmq")

      # Point BullMQ at the Postgres backend, then use Queue/Worker as usual:
      {:ok, _} = BullMQ.Queue.add("emails", "welcome", %{},
        connection: :pg, backend: BullMQ.Backends.Postgres)
  """

  @behaviour BullMQ.Backend

  alias BullMQ.Backends.Postgres.{Connection, SqlLoader}

  @minimum_block_timeout 0.001
  @event_read_batch 100

  @typedoc "A Postgres backend instance."
  @type t :: %__MODULE__{
          connection: atom(),
          queue_name: String.t(),
          pool: term(),
          notifications: term(),
          schema: String.t(),
          owns_connection: boolean()
        }

  defstruct connection: nil,
            queue_name: nil,
            pool: nil,
            notifications: nil,
            schema: nil,
            owns_connection: true

  @doc """
  Builds a Postgres backend for the queue `name`.

  ## Options
    * `:connection` (required) — a started `BullMQ.Backends.Postgres.Connection`.
    * `:owns_connection` — whether `close/2` stops the connection (default `true`).
  """
  @spec new(String.t(), keyword()) :: t()
  def new(name, opts) do
    conn = Keyword.fetch!(opts, :connection)
    ctx = Connection.context(conn)

    %__MODULE__{
      connection: conn,
      queue_name: name,
      pool: ctx.pool,
      notifications: ctx.notifications,
      schema: ctx.schema,
      owns_connection: Keyword.get(opts, :owns_connection, true)
    }
  end

  def minimum_block_timeout, do: @minimum_block_timeout

  # ============================================================
  # SQL helpers
  # ============================================================

  # Loads a named command's SQL and runs it with `params`, returning the raw
  # `Postgrex.Result`.
  defp run(%__MODULE__{pool: pool}, command, params) do
    Postgrex.query!(pool, SqlLoader.load_command(command), params)
  end

  # Returns the first result row as a column-name => value map (or nil).
  defp first_map(%Postgrex.Result{columns: cols, rows: [row | _]}) do
    cols |> Enum.zip(row) |> Map.new()
  end

  defp first_map(%Postgrex.Result{rows: []}), do: nil

  # Returns all result rows as column-name => value maps.
  defp maps(%Postgrex.Result{columns: cols, rows: rows}) do
    Enum.map(rows, fn row -> cols |> Enum.zip(row) |> Map.new() end)
  end

  # Maps a `bullmq_job` row into the Redis-hash-shaped string-keyed map that
  # `BullMQ.Job.from_redis/4` consumes.
  defp row_to_job_map(row) do
    %{
      "name" => row["name"],
      "data" => json(row["data"] || %{}),
      "opts" => json(row["opts"] || %{}),
      "progress" => json(row["progress"] || 0),
      "attemptsMade" => to_string(row["attempts_made"] || 0),
      "ats" => to_string(row["attempts_started"] || 0),
      "stc" => to_string(row["stalled_count"] || 0),
      "timestamp" => to_string(row["added_at_ms"]),
      "delay" => opt_to_string(row["delay_ms"]),
      "priority" => to_string(row["priority"] || 0),
      "processedOn" => opt_to_string(row["processed_at_ms"]),
      "finishedOn" => opt_to_string(row["finished_at_ms"]),
      "failedReason" => row["failed_reason"],
      "stacktrace" => json(row["stacktrace"] || []),
      "returnvalue" => json(row["return_value"]),
      "parentKey" => row["parent_key"],
      "parent" => parent_json(row),
      "processedBy" => row["processed_by"],
      "rjk" => row["scheduler_id"],
      "deid" => row["dedup_id"],
      "defa" => row["deferred_failure"]
    }
    |> reject_nil()
  end

  # A job hash as a flat `[k, v, k, v, ...]` list, matching a Redis `HGETALL`
  # reply (what the Worker's `list_to_job_map/1` expects from `move_to_*`).
  defp row_to_job_kv(row) do
    row |> row_to_job_map() |> Enum.flat_map(fn {k, v} -> [k, v] end)
  end

  defp parent_json(row) do
    case row["parent_id"] do
      nil -> nil
      id -> json(%{"id" => id, "queueKey" => row["parent_queue"] || ""})
    end
  end

  defp json(nil), do: "null"
  defp json(term) when is_binary(term), do: term
  defp json(term), do: Jason.encode!(term)

  defp opt_to_string(nil), do: nil
  defp opt_to_string(v), do: to_string(v)

  defp reject_nil(map), do: :maps.filter(fn _k, v -> v != nil end, map)

  # Normalizes `remove_on_complete`/`remove_on_fail` into the retention params
  # the move_to_completed/failed functions take.
  defp normalize_keep(true), do: {true, nil, nil}
  defp normalize_keep(opt) when opt in [false, nil], do: {false, nil, nil}
  defp normalize_keep(count) when is_integer(count), do: {false, nil, count}

  defp normalize_keep(%{} = opt) do
    {false, opt[:age] || opt["age"], opt[:count] || opt["count"]}
  end

  defp normalize_keep(_), do: {false, nil, nil}

  defp limiter_max(nil), do: nil
  defp limiter_max(%{} = l), do: l[:max] || l["max"]

  defp limiter_duration(nil), do: nil
  defp limiter_duration(%{} = l), do: l[:duration] || l["duration"]

  defp now_ms, do: System.system_time(:millisecond)

  # ============================================================
  # Connection lifecycle
  # ============================================================

  @impl true
  def wait_until_ready(%__MODULE__{pool: pool}) do
    Postgrex.query!(pool, "SELECT 1", [])
    :ok
  end

  @impl true
  def close(%__MODULE__{owns_connection: false}, _force), do: :ok
  def close(%__MODULE__{connection: conn}, _force), do: Connection.close(conn)

  @impl true
  def disconnect(%__MODULE__{} = b), do: close(b, true)

  @impl true
  def set_name(%__MODULE__{pool: pool}, name) do
    Postgrex.query!(pool, "SELECT set_config('application_name', $1, false)", [name])
    :ok
  end

  @impl true
  def for_queue(%__MODULE__{} = b, queue_name, _prefix) do
    %__MODULE__{b | queue_name: queue_name, owns_connection: false}
  end

  # ============================================================
  # Identity & keys (schema-based namespace: no prefix)
  # ============================================================

  @impl true
  def qualified_name(%__MODULE__{queue_name: q}), do: q

  @impl true
  def context(%__MODULE__{queue_name: q}), do: %{prefix: "", name: q}

  @impl true
  def to_key(%__MODULE__{queue_name: q}, type), do: "#{q}:#{type}"

  @impl true
  def parse_node_key(%__MODULE__{}, key) do
    case :binary.matches(key, ":") do
      [] ->
        %{prefix: "", queue_name: "", id: key}

      matches ->
        {pos, _} = List.last(matches)
        queue_name = binary_part(key, 0, pos)
        id = binary_part(key, pos + 1, byte_size(key) - pos - 1)

        if queue_name == "" or id == "" do
          %{prefix: "", queue_name: "", id: key}
        else
          %{prefix: "", queue_name: queue_name, id: id}
        end
    end
  end

  @impl true
  def client_name(%__MODULE__{queue_name: q}, suffix), do: "#{q}#{suffix || ""}"

  # ============================================================
  # Adding jobs
  # ============================================================

  @impl true
  def add_job(%__MODULE__{} = b, job, _opts) do
    opts = job.opts || %{}

    result =
      run(b, "add_job", [
        b.queue_name,
        job.id || "",
        job.name,
        to_jsonb(job.data),
        to_jsonb(opts),
        job.priority || opts[:priority] || 0,
        job.delay || opts[:delay] || 0,
        job.timestamp || now_ms(),
        opts[:attempts] || 1,
        parent_queue_key(job),
        parent_id(job),
        job.parent_key,
        opts[:deduplication] && (opts[:deduplication][:id] || opts[:deduplication]["id"]),
        job.repeat_job_key,
        opts[:lifo] || false
      ])

    %{"id" => id} = first_map(result)
    {:ok, to_string(id)}
  end

  defp parent_queue_key(job) do
    case job.parent do
      %{} = p -> p[:queue_key] || p["queueKey"]
      _ -> nil
    end
  end

  defp parent_id(job) do
    case job.parent do
      %{} = p -> p[:id] || p["id"]
      _ -> nil
    end
  end

  @impl true
  def add_jobs(%__MODULE__{} = b, jobs_with_opts, _opts) do
    # jobs_with_opts: list of {job, encoded_opts}. The whole batch is inserted
    # atomically; results (`{:ok, id} | {:error, code}`) are returned in input
    # order.
    entries =
      Enum.map(jobs_with_opts, fn {job, encoded} ->
        batch_entry(b.queue_name, job, encoded, false)
      end)

    # Fast path: when every job is independent (no parent, no deduplication),
    # use the set-based `add_jobs_bulk` (one INSERT + one event INSERT) instead
    # of the row-by-row flow engine. Flows/deduplicated batches fall back to
    # `add_flow`, which handles dependency wiring and dedup.
    if Enum.all?(entries, &independent_entry?/1) do
      result = run(b, "add_jobs_bulk", [b.queue_name, entries])
      {:ok, Enum.map(result.rows, fn [id] -> {:ok, to_string(id)} end)}
    else
      {:ok, Enum.map(run_add_flow(b, entries), &flow_result/1)}
    end
  end

  defp independent_entry?(e) do
    is_nil(e["parentId"]) and is_nil(e["parentQueue"]) and is_nil(e["dedupId"])
  end

  # ============================================================
  # Flows
  # ============================================================

  @impl true
  def build_add_standard_command(%__MODULE__{queue_name: queue}, job, encoded_opts) do
    {:ok, batch_entry(queue, job, encoded_opts, false)}
  end

  @impl true
  def build_add_parent_command(%__MODULE__{queue_name: queue}, job, encoded_opts) do
    # A node with children goes to `waiting-children` (it waits for its own
    # children before becoming runnable).
    {:ok, batch_entry(queue, job, encoded_opts, true)}
  end

  @impl true
  def add_flow(%__MODULE__{} = b, commands, _opts) do
    # `commands` is the pre-built, roots-first list of batch entries for every
    # node of the flow tree (from `build_add_*_command`). `bullmq_add_flow`
    # inserts the whole tree in one atomic statement.
    {:ok, Enum.map(run_add_flow(b, commands), &flow_result/1)}
  end

  # Runs `bullmq_add_flow` with the ordered (roots-first) entry array and
  # returns the resulting ids in input order. The list is passed as an Elixir
  # term so Postgrex encodes it to a jsonb array (a JSON string would be wrapped
  # as a jsonb scalar and `jsonb_array_elements` would reject it).
  defp run_add_flow(b, entries) do
    result = run(b, "add_flow", [entries])
    Enum.map(result.rows, fn [id] -> id end)
  end

  # A negative-integer id is an error/skip code (e.g. -5 = missing parent,
  # -7 = already has a different parent), mirroring the Redis `addFlow`
  # `[err, idOrCode]` convention; anything else is a real job id.
  defp flow_result(id) do
    s = to_string(id)

    case Integer.parse(s) do
      {n, ""} when n < 0 -> {:error, n}
      _ -> {:ok, s}
    end
  end

  # Builds one entry of the JSONB batch consumed by `bullmq_add_flow`. `job` is
  # either a `%BullMQ.Job{}` (Queue.add_bulk) or a flow job map (FlowProducer);
  # both expose id/name/data/opts/timestamp/parent as atom keys.
  defp batch_entry(queue, job, encoded_opts, add_to_waiting_children) do
    opts = Map.get(job, :opts) || %{}
    parent = Map.get(job, :parent)

    %{
      "queue" => queue,
      "id" => Map.get(job, :id) || "",
      "name" => Map.get(job, :name),
      "data" => Map.get(job, :data) || %{},
      "opts" => encoded_opts,
      "priority" => opt(opts, :priority, 0),
      "delay" => Map.get(job, :delay) || opt(opts, :delay, 0),
      "timestamp" => Map.get(job, :timestamp) || now_ms(),
      "attempts" => opt(opts, :attempts, 1),
      "parentQueue" => batch_parent_queue(parent),
      "parentId" => batch_parent_id(parent),
      "parentKey" => batch_parent_key(parent),
      "dedupId" => dedup_id(opts),
      "schedulerId" => Map.get(job, :repeat_job_key),
      "lifo" => opt(opts, :lifo, false),
      "addToWaitingChildren" => add_to_waiting_children
    }
  end

  # `bullmq_add_flow` links a child to its parent by `(parentQueue, parentId)`
  # matched against the parent's `queue` column — the plain queue name (no
  # prefix), which the flow job map exposes as `parent.queue`.
  defp batch_parent_queue(nil), do: nil
  defp batch_parent_queue(p), do: p[:queue] || p["queue"] || p[:queue_key] || p["queueKey"]

  defp batch_parent_id(nil), do: nil
  defp batch_parent_id(p), do: p[:id] || p["id"]

  defp batch_parent_key(nil), do: nil

  defp batch_parent_key(p) do
    p[:key] || p["parentKey"] ||
      case {batch_parent_queue(p), batch_parent_id(p)} do
        {q, id} when not is_nil(q) and not is_nil(id) -> "#{q}:#{id}"
        _ -> nil
      end
  end

  defp dedup_id(opts) do
    case opts[:deduplication] || opts["deduplication"] do
      %{} = d -> d[:id] || d["id"]
      _ -> nil
    end
  end

  # Reads `key` (atom or its string form) from an options map, falling back to
  # `default` when absent or nil.
  defp opt(opts, key, default) when is_map(opts) do
    case Map.get(opts, key, Map.get(opts, to_string(key))) do
      nil -> default
      value -> value
    end
  end

  defp opt(_opts, _key, default), do: default

  # ============================================================
  # Job state transitions
  # ============================================================

  @impl true
  def move_to_active(%__MODULE__{} = b, token, opts) do
    lock_duration = Keyword.get(opts, :lock_duration, 30_000)
    limiter = Keyword.get(opts, :limiter)
    name = Keyword.get(opts, :name)
    now = now_ms()

    result =
      run(b, "move_to_active", [
        b.queue_name,
        token,
        lock_duration,
        now,
        name,
        limiter_max(limiter),
        limiter_duration(limiter)
      ])

    {:ok, build_next_job_result(b, maps(result), limiter_max(limiter), now)}
  end

  # Shapes a claim result into the worker's `[jobData, id, rateLimitDelay,
  # delayUntil]` tuple (jobData a flat [k,v,...] list; a claim of none reports
  # the rate-limit ttl or next delayed wake-up via next_signal).
  defp build_next_job_result(_b, [row | _], _limiter_max, _now) do
    [row_to_job_kv(row), to_string(row["id"]), 0, 0]
  end

  defp build_next_job_result(b, [], limiter_max, now) do
    sig = first_map(run(b, "next_signal", [b.queue_name, limiter_max, now]))
    ttl = to_int(sig["rate_limit_ttl"])

    if ttl > 0 do
      [nil, "", ttl, 0]
    else
      [nil, "", 0, to_int(sig["next_delay"])]
    end
  end

  @impl true
  def move_to_completed(%__MODULE__{} = b, job_id, token, return_value, opts) do
    keep = normalize_keep(Keyword.get(opts, :remove_on_complete))
    fetch_next = Keyword.get(opts, :fetch_next, false)
    finished_on = now_ms()

    if fetch_next do
      {remove_all, keep_age, keep_count} = keep
      lock_duration = Keyword.get(opts, :lock_duration, 30_000)
      limiter = Keyword.get(opts, :limiter)
      name = Keyword.get(opts, :name)
      now = now_ms()

      result =
        run(b, "move_to_completed_fetch", [
          b.queue_name,
          job_id,
          token,
          json(return_value),
          finished_on,
          remove_all,
          keep_age,
          keep_count,
          lock_duration,
          now,
          name,
          limiter_max(limiter),
          limiter_duration(limiter)
        ])

      collect_metrics(b, "completed", finished_on)
      {:ok, build_next_job_result(b, maps(result), limiter_max(limiter), now)}
    else
      {remove_all, keep_age, keep_count} = keep

      run(b, "move_to_completed", [
        b.queue_name,
        job_id,
        token,
        json(return_value),
        finished_on,
        remove_all,
        keep_age,
        keep_count
      ])

      collect_metrics(b, "completed", finished_on)
      {:ok, nil}
    end
  end

  @impl true
  def move_to_failed(%__MODULE__{} = b, job_id, token, error, opts) do
    keep = normalize_keep(Keyword.get(opts, :remove_on_fail))
    fetch_next = Keyword.get(opts, :fetch_next, false)
    stacktrace = Keyword.get(opts, :stacktrace)
    finished_on = now_ms()

    if fetch_next do
      {remove_all, keep_age, keep_count} = keep
      lock_duration = Keyword.get(opts, :lock_duration, 30_000)
      limiter = Keyword.get(opts, :limiter)
      name = Keyword.get(opts, :name)
      now = now_ms()

      result =
        run(b, "move_to_failed_fetch", [
          b.queue_name,
          job_id,
          token,
          to_string(error),
          stacktrace && json(stacktrace),
          finished_on,
          remove_all,
          keep_age,
          keep_count,
          lock_duration,
          now,
          name,
          limiter_max(limiter),
          limiter_duration(limiter)
        ])

      collect_metrics(b, "failed", finished_on)
      {:ok, build_next_job_result(b, maps(result), limiter_max(limiter), now)}
    else
      {remove_all, keep_age, keep_count} = keep

      run(b, "move_to_failed", [
        b.queue_name,
        job_id,
        token,
        to_string(error),
        stacktrace && json(stacktrace),
        finished_on,
        remove_all,
        keep_age,
        keep_count
      ])

      collect_metrics(b, "failed", finished_on)
      {:ok, nil}
    end
  end

  defp collect_metrics(b, type, timestamp) do
    run(b, "collect_metrics", [b.queue_name, type, timestamp])
    :ok
  rescue
    _ -> :ok
  end

  @impl true
  def move_to_delayed(%__MODULE__{} = b, job_id, token, delay, opts) do
    timestamp = now_ms() + delay

    run(b, "move_to_delayed", [
      b.queue_name,
      job_id,
      token || "",
      timestamp,
      delay,
      Keyword.get(opts, :skip_attempt, false),
      Keyword.get(opts, :failed_reason),
      Keyword.get(opts, :stacktrace) && json(Keyword.get(opts, :stacktrace))
    ])

    if Keyword.get(opts, :fetch_next, false) and token do
      {:ok, next} = move_to_active(b, token, opts)

      case next do
        [job_data | _] when is_list(job_data) and job_data != [] -> {:ok, next}
        _ -> {:ok, []}
      end
    else
      {:ok, []}
    end
  end

  @impl true
  def move_job_from_active_to_wait(%__MODULE__{} = b, job_id, token) do
    %{"n" => n} =
      first_map(run(b, "move_active_to_wait", [b.queue_name, job_id, token || "0", now_ms()]))

    {:ok, to_int(n)}
  end

  @impl true
  def move_to_waiting_children(%__MODULE__{} = b, job_id, token, _opts) do
    %{"code" => code} = first_map(run(b, "move_to_waiting_children", [b.queue_name, job_id, token]))
    {:ok, code == 1}
  end

  @impl true
  def retry_job(%__MODULE__{} = b, job_id, lifo, token, opts) do
    run(b, "retry_job", [
      b.queue_name,
      job_id,
      token || "",
      lifo,
      Keyword.get(opts, :failed_reason),
      Keyword.get(opts, :stacktrace) && json(Keyword.get(opts, :stacktrace))
    ])

    {:ok, nil}
  end

  @impl true
  def reprocess_job(%__MODULE__{} = b, job_id, state, opts) do
    %{"code" => code} =
      first_map(
        run(b, "reprocess_job", [
          b.queue_name,
          job_id,
          to_string(state),
          Keyword.get(opts, :lifo, false),
          Keyword.get(opts, :reset_attempts_made, false),
          Keyword.get(opts, :reset_attempts_started, false)
        ])
      )

    {:ok, code}
  end

  @impl true
  def promote(%__MODULE__{} = b, job_id) do
    %{"code" => code} = first_map(run(b, "promote", [b.queue_name, job_id]))
    {:ok, code}
  end

  @impl true
  def move_stalled_jobs_to_wait(%__MODULE__{} = b, max_stalled_count, opts) do
    max_check_time = Keyword.get(opts, :stalled_interval, 30_000)

    result =
      run(b, "move_stalled_jobs_to_wait", [
        b.queue_name,
        max_stalled_count,
        now_ms(),
        max_check_time
      ])

    {:ok, Enum.map(maps(result), & &1["id"])}
  end

  @impl true
  def check_stalled_jobs(%__MODULE__{} = b, max_stalled_count) do
    # PG performs the two-phase mark/reclaim atomically and returns the reclaimed
    # ids (all pushed back to `waiting`; those over the limit carry a deferred
    # failure that trips on their next pickup). Mirrors the Redis stalled check's
    # `%{recovered, failed}` shape.
    result =
      run(b, "move_stalled_jobs_to_wait", [b.queue_name, max_stalled_count, now_ms(), 30_000])

    {:ok, %{recovered: length(result.rows), failed: 0}}
  end

  @impl true
  def has_job_lock?(%__MODULE__{pool: pool, queue_name: q}, job_id) do
    # A job holds a lock while `lock_token` is set and `locked_until_ms` has not
    # elapsed (the PG analogue of the Redis lock key's TTL).
    result =
      Postgrex.query!(
        pool,
        "SELECT lock_token IS NOT NULL AND locked_until_ms > $3 AS locked " <>
          "FROM bullmq_job WHERE queue = $1 AND id = $2",
        [q, job_id, now_ms()]
      )

    case result.rows do
      [[true]] -> {:ok, true}
      _ -> {:ok, false}
    end
  end

  # ============================================================
  # Bulk admin transitions
  # ============================================================

  @impl true
  def pause(%__MODULE__{} = b, paused?) do
    run(b, "pause", [b.queue_name, paused?])
    {:ok, :ok}
  end

  @impl true
  def drain(%__MODULE__{} = b, delayed?) do
    run(b, "drain", [b.queue_name, delayed?])
    {:ok, :ok}
  end

  @impl true
  def clean_jobs_by_state(%__MODULE__{} = b, state, grace, opts) do
    limit = Keyword.get(opts, :limit, 0)
    timestamp = now_ms() - grace
    result = run(b, "clean", [b.queue_name, to_string(state), timestamp, limit])
    {:ok, Enum.map(maps(result), & &1["id"])}
  end

  @impl true
  def obliterate(%__MODULE__{} = b, count, force) do
    %{"cursor" => cursor} = first_map(run(b, "obliterate", [b.queue_name, count, force]))
    {:ok, cursor}
  end

  # ============================================================
  # Locks
  # ============================================================

  @impl true
  def extend_lock(%__MODULE__{} = b, job_id, token, duration) do
    %{"n" => n} =
      first_map(run(b, "extend_lock", [b.queue_name, job_id, token, duration, now_ms()]))

    {:ok, to_int(n)}
  end

  @impl true
  def extend_locks(%__MODULE__{} = b, job_ids, tokens, duration) do
    # Best-effort per-job extension; returns the ids that failed to extend.
    now = now_ms()

    failed =
      job_ids
      |> Enum.zip(tokens)
      |> Enum.filter(fn {id, token} ->
        %{"n" => n} = first_map(run(b, "extend_lock", [b.queue_name, id, token, duration, now]))
        to_int(n) <= 0
      end)
      |> Enum.map(fn {id, _} -> id end)

    {:ok, failed}
  end

  @impl true
  def release_lock(%__MODULE__{} = b, job_id, _token) do
    # Releasing a lock is expressed as moving the active job back to wait.
    move_job_from_active_to_wait(b, job_id, "0")
  end

  # ============================================================
  # Job mutations
  # ============================================================

  @impl true
  def update_data(%__MODULE__{} = b, job_id, data) do
    run(b, "update_data", [b.queue_name, job_id, json(data)])
    {:ok, nil}
  end

  @impl true
  def update_progress(%__MODULE__{} = b, job_id, progress) do
    run(b, "update_progress", [b.queue_name, job_id, json(progress)])
    {:ok, nil}
  end

  @impl true
  def add_log(%__MODULE__{} = b, job_id, log_row, keep_logs) do
    %{"idx" => idx} = first_map(run(b, "add_log", [b.queue_name, job_id, log_row]))
    count = to_int(idx) + 1

    if keep_logs && count > keep_logs do
      run(b, "trim_logs", [b.queue_name, job_id, count - keep_logs])
      {:ok, keep_logs}
    else
      {:ok, count}
    end
  end

  @impl true
  def remove(%__MODULE__{} = b, job_id, remove_children) do
    %{"n" => n} = first_map(run(b, "remove", [b.queue_name, job_id, remove_children]))
    {:ok, to_int(n)}
  end

  @impl true
  def remove_deduplication_key(%__MODULE__{} = b, dedup_id, _job_id) do
    delete_deduplication_key(b, dedup_id)
  end

  @impl true
  def delete_deduplication_key(%__MODULE__{} = b, dedup_id) do
    result = run(b, "delete_deduplication_key", [b.queue_name, dedup_id])
    {:ok, result.num_rows}
  end

  # ============================================================
  # Queries
  # ============================================================

  @impl true
  def get_state(%__MODULE__{} = b, job_id) do
    case first_map(run(b, "get_state", [b.queue_name, job_id])) do
      nil ->
        {:ok, "unknown"}

      %{"state" => "waiting", "priority" => p} when p > 0 ->
        {:ok, "prioritized"}

      %{"state" => state} ->
        {:ok, state}
    end
  end

  @impl true
  def get_job_data(%__MODULE__{} = b, job_id) do
    case first_map(run(b, "get_job_data", [b.queue_name, job_id])) do
      nil -> {:ok, nil}
      row -> {:ok, row_to_job_map(row)}
    end
  end

  @impl true
  def is_maxed(%__MODULE__{} = b) do
    %{"maxed" => maxed} = first_map(run(b, "is_maxed", [b.queue_name]))
    {:ok, maxed}
  end

  @impl true
  def get_rate_limit_ttl(%__MODULE__{} = b, opts) do
    max_jobs = Keyword.get(opts, :max_jobs, 0)
    %{"ttl" => ttl} = first_map(run(b, "get_rate_limit_ttl", [b.queue_name, max_jobs, now_ms()]))
    {:ok, to_int(ttl)}
  end

  @impl true
  def get_counts(%__MODULE__{} = b) do
    {:ok, count_lookup(b)}
  end

  @impl true
  def get_counts_by_types(%__MODULE__{} = b, types) do
    lookup = count_lookup(b)
    {:ok, Enum.map(types, fn type -> Map.get(lookup, normalize_type(type), 0) end)}
  end

  defp count_lookup(b) do
    row = first_map(run(b, "get_counts", [b.queue_name]))
    waiting = to_int(row["waiting"])
    prioritized = to_int(row["prioritized"])
    is_paused = row["paused"] == "1"

    %{
      "active" => to_int(row["active"]),
      "completed" => to_int(row["completed"]),
      "failed" => to_int(row["failed"]),
      "delayed" => to_int(row["delayed"]),
      "wait" => if(is_paused, do: 0, else: waiting),
      "waiting" => if(is_paused, do: 0, else: waiting),
      "prioritized" => prioritized,
      "waiting-children" => to_int(row["waiting-children"]),
      "paused" => if(is_paused, do: waiting, else: 0)
    }
  end

  defp normalize_type(:waiting_children), do: "waiting-children"
  defp normalize_type(type) when is_atom(type), do: Atom.to_string(type)
  defp normalize_type(type) when is_binary(type), do: type

  @impl true
  def get_ranges(%__MODULE__{} = b, types, start, stop) do
    ids =
      List.wrap(types)
      |> Enum.flat_map(fn type ->
        result = run(b, "get_range", [b.queue_name, normalize_type(type), start, stop, false])
        Enum.map(maps(result), & &1["id"])
      end)
      |> Enum.uniq()

    {:ok, ids}
  end

  @impl true
  def get_job_logs(%__MODULE__{} = b, job_id, start, stop, asc) do
    %{"count" => count} = first_map(run(b, "get_job_logs_count", [b.queue_name, job_id]))
    count = to_int(count)

    from = if start < 0, do: max(count + start, 0), else: start
    to = if stop < 0, do: count + stop, else: stop
    limit = to - from + 1

    logs =
      if limit <= 0 do
        []
      else
        cmd = if asc, do: "get_job_logs_asc", else: "get_job_logs_desc"
        result = run(b, cmd, [b.queue_name, job_id, from, limit])
        Enum.map(maps(result), & &1["row"])
      end

    {:ok, %{logs: logs, count: count}}
  end

  @impl true
  def get_metrics(%__MODULE__{} = b, type, start, stop) do
    row = first_map(run(b, "get_metrics", [b.queue_name, to_string(type), start, stop]))
    total = to_string((row && row["total"]) || "0")
    data = ((row && row["data"]) || []) |> Enum.map(&to_string/1)
    # [meta, data, count]: meta = [count, prevTS, prevCount] (only the cumulative
    # count is tracked here), matching getMetrics-1.lua.
    {:ok, [[total, "0", "0"], data, length(data)]}
  end

  @impl true
  def get_deduplication_job_id(%__MODULE__{} = b, dedup_id) do
    case first_map(run(b, "get_deduplication_job_id", [b.queue_name, dedup_id, now_ms()])) do
      nil -> {:ok, nil}
      %{"job_id" => id} -> {:ok, id}
    end
  end

  @impl true
  def get_client_list(%__MODULE__{} = b) do
    # Mirror Redis `CLIENT LIST` via `pg_stat_activity`: each named session
    # (workers / QueueEvents set their `application_name`) becomes a
    # `name=<application_name>` line for the shared client-list parser. Returned
    # as a single-element list (PostgreSQL has no cluster-node fan-out).
    result = run(b, "get_client_list", [])
    lines = Enum.map_join(maps(result), "\n", fn m -> "name=#{m["application_name"]}" end)
    {:ok, [lines]}
  end

  @impl true
  def get_workers(%__MODULE__{queue_name: q} = b, _opts) do
    # The queue's dedicated client is named `<queue>` (unnamed worker) or
    # `<queue>:w:<id>` (named worker), matching `client_name/2`.
    unnamed = q
    named = "#{q}:w:"
    {:ok, [blob]} = get_client_list(b)

    workers =
      blob
      |> String.split(~r/\r?\n/, trim: true)
      |> Enum.map(&parse_client_info/1)
      |> Enum.filter(fn c ->
        name = c["name"] || ""
        name == unnamed or String.starts_with?(name, named)
      end)
      |> Enum.map(fn c -> Map.put(c, "queue", q) end)

    {:ok, workers}
  end

  # Parses a `key=value key=value` client-list line into a string-keyed map.
  defp parse_client_info(line) do
    line
    |> String.split(" ", trim: true)
    |> Enum.reduce(%{}, fn kv, acc ->
      case String.split(kv, "=", parts: 2) do
        [key, value] -> Map.put(acc, key, value)
        _ -> acc
      end
    end)
  end

  # ============================================================
  # Queue metadata
  # ============================================================

  @impl true
  def set_queue_meta(%__MODULE__{pool: pool} = b, values) do
    Enum.each(values, fn {field, value} ->
      Postgrex.query!(
        pool,
        "INSERT INTO bullmq_meta (queue, field, value) VALUES ($1, $2, $3) " <>
          "ON CONFLICT (queue, field) DO UPDATE SET value = EXCLUDED.value",
        [b.queue_name, to_string(field), to_string(value)]
      )
    end)

    {:ok, map_size_or_length(values)}
  end

  defp map_size_or_length(v) when is_map(v), do: map_size(v)
  defp map_size_or_length(v) when is_list(v), do: length(v)

  @impl true
  def get_queue_meta_field(%__MODULE__{} = b, field) do
    case first_map(run(b, "get_queue_meta_field", [b.queue_name, field])) do
      nil -> {:ok, nil}
      %{"value" => value} -> {:ok, value}
    end
  end

  @impl true
  def get_queue_meta_fields(%__MODULE__{} = b, fields) do
    meta = queue_meta_map(b)
    {:ok, Enum.map(fields, fn field -> Map.get(meta, field) end)}
  end

  @impl true
  def get_queue_meta(%__MODULE__{} = b) do
    {:ok, queue_meta_map(b)}
  end

  defp queue_meta_map(b) do
    run(b, "get_queue_meta", [b.queue_name])
    |> maps()
    |> Map.new(fn %{"field" => f, "value" => v} -> {f, v} end)
  end

  @impl true
  def has_queue_meta_field(%__MODULE__{} = b, field) do
    %{"exists" => exists} = first_map(run(b, "has_queue_meta_field", [b.queue_name, field]))
    {:ok, exists}
  end

  # ============================================================
  # Children / dependencies
  # ============================================================

  @impl true
  def get_processed_children_values(%__MODULE__{} = b, job_id) do
    result = run(b, "get_processed_children_values", [b.queue_name, job_id])

    {:ok,
     Enum.flat_map(maps(result), fn m -> [m["child_key"] || m["k"], json(m["value"] || m["v"])] end)}
  end

  @impl true
  def get_ignored_children_failures(%__MODULE__{} = b, job_id) do
    result = run(b, "get_ignored_children_failures", [b.queue_name, job_id])

    {:ok,
     Enum.flat_map(maps(result), fn m -> [m["child_key"] || m["k"], m["reason"] || m["v"]] end)}
  end

  @impl true
  def get_dependencies(%__MODULE__{} = b, job_id) do
    result = run(b, "get_dependencies", [b.queue_name, job_id])
    {:ok, Enum.map(maps(result), fn m -> m["child_key"] || m["id"] end)}
  end

  @impl true
  def get_dependencies_count(%__MODULE__{} = b, job_id) do
    # Mirrors the Redis backend's `SCARD` on the pending-dependencies set: the
    # number of not-yet-processed children.
    m = first_map(run(b, "get_dependency_counts", [b.queue_name, job_id]))
    {:ok, to_int((m && (m["unprocessed"] || m["pending"] || m["count"])) || 0)}
  end

  # ============================================================
  # Job schedulers
  # ============================================================

  @impl true
  def add_job_scheduler(
        %__MODULE__{} = b,
        scheduler_id,
        next_millis,
        scheduler_opts,
        template_data,
        template_opts,
        delayed_opts,
        now,
        producer_id
      ) do
    result =
      run(b, "add_job_scheduler", [
        b.queue_name,
        scheduler_id,
        next_millis,
        to_jsonb(template_data),
        to_jsonb(template_opts),
        to_jsonb(scheduler_opts),
        to_jsonb(delayed_opts),
        now,
        producer_id
      ])

    case first_map(result) do
      %{"job_id" => job_id, "delay" => delay} when not is_nil(job_id) ->
        {:ok, [to_string(job_id), to_int(delay)]}

      _ ->
        {:ok, nil}
    end
  end

  @impl true
  def update_job_scheduler(
        %__MODULE__{} = b,
        scheduler_id,
        next_millis,
        template_data,
        delayed_opts,
        producer_id
      ) do
    result =
      run(b, "update_job_scheduler", [
        b.queue_name,
        scheduler_id,
        next_millis,
        to_jsonb(template_data),
        to_jsonb(delayed_opts),
        now_ms(),
        producer_id
      ])

    case first_map(result) do
      %{"job_id" => job_id} when not is_nil(job_id) -> {:ok, to_string(job_id)}
      _ -> {:ok, nil}
    end
  end

  @impl true
  def remove_job_scheduler(%__MODULE__{} = b, scheduler_id) do
    m = first_map(run(b, "remove_job_scheduler", [b.queue_name, scheduler_id]))
    {:ok, to_int(m && m["removed"])}
  end

  @impl true
  def get_job_scheduler(%__MODULE__{} = b, id) do
    case first_map(run(b, "get_job_scheduler", [b.queue_name, id])) do
      nil ->
        {:ok, [nil, nil]}

      row ->
        {hash, next} = map_scheduler_row(row)
        {:ok, [Enum.flat_map(hash, fn {k, v} -> [k, v] end), next]}
    end
  end

  @impl true
  def get_job_schedulers_range(%__MODULE__{} = b, start, stop, asc) do
    count = if stop < 0, do: nil, else: stop - start + 1
    result = run(b, "get_job_schedulers_range", [b.queue_name, asc, start, count])
    {:ok, Enum.flat_map(maps(result), fn r -> [r["scheduler_id"], to_string(r["next_run_ms"])] end)}
  end

  @impl true
  def get_job_schedulers_count(%__MODULE__{} = b) do
    m = first_map(run(b, "get_job_schedulers_count", [b.queue_name]))
    {:ok, to_int(m && m["count"])}
  end

  # Mirrors NodeJS `mapSchedulerRow`: builds the Redis-hash-shaped scheduler map
  # (only non-null fields) plus the next-run score.
  defp map_scheduler_row(row) do
    hash =
      [
        {"name", row["name"]},
        {"ic", row["iteration_count"]},
        {"limit", row["limit_count"]},
        {"startDate", row["start_date_ms"]},
        {"endDate", row["end_date_ms"]},
        {"tz", row["tz"]},
        {"pattern", row["pattern"]},
        {"every", row["every_ms"]},
        {"offset", row["offset_ms"]}
      ]
      |> Enum.reduce(%{}, fn
        {_k, nil}, acc -> acc
        {k, v}, acc -> Map.put(acc, k, to_string(v))
      end)
      |> maybe_put_json("data", row["template_data"])
      |> maybe_put_json("opts", row["template_opts"])

    next = if is_nil(row["next_run_ms"]), do: nil, else: to_string(row["next_run_ms"])
    {hash, next}
  end

  defp maybe_put_json(hash, _key, nil), do: hash

  defp maybe_put_json(hash, key, value) do
    case json(value) do
      "{}" -> hash
      encoded -> Map.put(hash, key, encoded)
    end
  end

  # jsonb parameters must be passed as Elixir terms (not JSON strings): the
  # scheduler command SQL does not cast `$n::jsonb`, so Postgrex encodes the
  # param from the function signature — a raw string would become a jsonb string
  # literal, not an object. `template_data` arrives pre-encoded (a JSON string),
  # and the Worker pre-packs next-iteration opts as MessagePack; both are
  # decoded back to maps here.
  defp to_jsonb(nil), do: %{}
  defp to_jsonb(m) when is_map(m), do: m

  defp to_jsonb(bin) when is_binary(bin) do
    case Msgpax.unpack(bin) do
      {:ok, m} when is_map(m) ->
        m

      _ ->
        case Jason.decode(bin) do
          {:ok, decoded} -> decoded
          _ -> %{}
        end
    end
  end

  # ============================================================
  # Event stream
  # ============================================================

  @impl true
  def publish_event(%__MODULE__{} = b, fields, _max_events) do
    {event, rest} = pop_event(fields)
    m = first_map(run(b, "publish_event", [b.queue_name, to_string(event), Jason.encode!(rest)]))
    {:ok, to_string(m["id"])}
  end

  @impl true
  def read_events(%__MODULE__{} = b, id, block_ms) do
    cursor =
      if id == "$" do
        to_int(first_map(run(b, "read_events_max", [b.queue_name]))["max"])
      else
        to_int(id)
      end

    events =
      case fetch_events(b, cursor) do
        [] ->
          wait_for_event(b, block_ms)
          fetch_events(b, cursor)

        evts ->
          evts
      end

    case events do
      [] -> {:ok, nil}
      _ -> {:ok, [["events", Enum.map(events, fn {eid, fields} -> [eid, fields] end)]]}
    end
  end

  # Fetches the next batch of events after `cursor` and shapes each into the
  # Redis `XREAD` field layout `[event, <name>, k, v, ...]`.
  defp fetch_events(b, cursor) do
    result = run(b, "read_events", [b.queue_name, cursor, @event_read_batch])

    Enum.map(maps(result), fn r ->
      data = decode_event_data(r["data"])

      fields =
        ["event", r["event"]] ++
          Enum.flat_map(data, fn {k, v} ->
            [to_string(k), if(is_binary(v), do: v, else: to_string(v))]
          end)

      {to_string(r["id"]), fields}
    end)
  end

  defp decode_event_data(nil), do: %{}
  defp decode_event_data(m) when is_map(m), do: m
  defp decode_event_data(s) when is_binary(s), do: Jason.decode!(s)
  defp decode_event_data(_), do: %{}

  # Blocks (up to `block_ms`) until a new event is published for this queue via
  # `LISTEN`/`NOTIFY` on the shared events channel, or the timeout elapses.
  defp wait_for_event(%__MODULE__{notifications: notif} = b, block_ms) do
    {:ok, ref} = Postgrex.Notifications.listen(notif, "bullmq_events")

    try do
      deadline = System.monotonic_time(:millisecond) + max(block_ms || 5000, 1)
      wait_notify(ref, "bullmq_events", b.queue_name, deadline)
    after
      Postgrex.Notifications.unlisten(notif, ref)
    end

    :ok
  end

  defp pop_event(fields) when is_map(fields) do
    event = fields["event"] || fields[:event]
    {event, fields |> Map.delete("event") |> Map.delete(:event)}
  end

  defp pop_event(fields) when is_list(fields) do
    fields |> Map.new(fn {k, v} -> {to_string(k), v} end) |> pop_event()
  end

  # ============================================================
  # Worker blocking primitive
  # ============================================================

  @impl true
  def wait_for_job(%__MODULE__{notifications: nil}, _block_timeout), do: :timeout

  def wait_for_job(%__MODULE__{notifications: notif} = b, block_timeout) do
    # Producers `NOTIFY bullmq_jobs` with the queue name as payload (in
    # `bullmq_add_job`), so a producer in any process wakes a blocked worker
    # immediately. This mirrors the Redis backend's `BZPOPMIN`.
    {:ok, ref} = Postgrex.Notifications.listen(notif, "bullmq_jobs")

    try do
      # With the listener registered, probe for an already-claimable job: this
      # closes the race with a NOTIFY that fired before we subscribed.
      if has_waiting_job?(b) do
        {:job_available, nil}
      else
        deadline = System.monotonic_time(:millisecond) + block_wait_ms(b, block_timeout)

        case wait_notify(ref, "bullmq_jobs", b.queue_name, deadline) do
          :notified -> {:job_available, nil}
          :timeout -> :timeout
        end
      end
    after
      Postgrex.Notifications.unlisten(notif, ref)
    end
  end

  @impl true
  def disconnect_blocking(%__MODULE__{}, _wait?), do: :ok

  @impl true
  def reconnect_blocking(%__MODULE__{} = b), do: {:ok, b}

  # Waits until a NOTIFY on `channel` carrying `payload` (the queue name)
  # arrives, or the monotonic `deadline` passes. Notifications for other queues
  # are ignored (the channel is shared across every queue).
  defp wait_notify(ref, channel, payload, deadline) do
    remaining = deadline - System.monotonic_time(:millisecond)

    if remaining <= 0 do
      :timeout
    else
      receive do
        {:notification, _pid, ^ref, ^channel, ^payload} ->
          :notified

        {:notification, _pid, ^ref, _channel, _payload} ->
          wait_notify(ref, channel, payload, deadline)
      after
        remaining -> :timeout
      end
    end
  end

  defp has_waiting_job?(b) do
    match?(%{"present" => true}, first_map(run(b, "has_waiting_job", [b.queue_name])))
  end

  # The base wait is `block_timeout` seconds, shortened to the next due delayed
  # job: a delayed job's promotion is not announced by a NOTIFY at its due time.
  defp block_wait_ms(b, block_timeout) do
    base = max(round(block_timeout * 1000), 1)

    case next_delay_ms(b) do
      nil -> base
      due_in when due_in <= 0 -> 0
      due_in -> min(due_in, base)
    end
  end

  defp next_delay_ms(b) do
    case first_map(run(b, "next_delay", [b.queue_name])) do
      %{"next_delay" => nil} -> nil
      %{"next_delay" => next} -> to_int(next) - now_ms()
      _ -> nil
    end
  end

  # ============================================================
  # Helpers
  # ============================================================

  defp to_int(nil), do: 0
  defp to_int(n) when is_integer(n), do: n
  defp to_int(n) when is_float(n), do: trunc(n)

  defp to_int(s) when is_binary(s) do
    case Integer.parse(s) do
      {i, _} -> i
      :error -> 0
    end
  end
end
