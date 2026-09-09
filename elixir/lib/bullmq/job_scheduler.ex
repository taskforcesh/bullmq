defmodule BullMQ.JobScheduler do
  @moduledoc """
  Job scheduler for creating recurring jobs.

  The JobScheduler allows you to create jobs that repeat on a schedule,
  using either cron expressions or fixed intervals. This supersedes the
  older "repeatable jobs" concept.

  > #### Node.js Interoperability Note {: .warning}
  >
  > **Seconds field:** Node.js supports an optional 6th field for seconds at the
  > beginning (`second minute hour day month weekday`). Elixir's `crontab` library
  > uses standard 5-field format by default. **6-field expressions with seconds
  > from Node.js will fail to parse in Elixir.**
  >
  > **Sunday:** Elixir uses `7` for Sunday, Node.js uses `0` (or `7`).
  > Use `7` for Sunday to ensure compatibility.
  >
  > | Feature | Elixir | Node.js | Compatible? |
  > |---------|--------|---------|-------------|
  > | 5-field (no seconds) | ✅ | ✅ | ✅ Yes |
  > | 6-field (with seconds) | ❌ | ✅ | ❌ No |
  > | Sunday = 7 | ✅ | ✅ | ✅ Yes |
  > | Sunday = 0 | ❌ | ✅ | ❌ No |
  >
  > **For cross-platform compatibility:**
  > - Use 5-field cron expressions (no seconds)
  > - Use `7` for Sunday, not `0`
  > - Or use interval-based schedulers (`:every`)

  ## Usage

      # Create a scheduler with cron pattern
      {:ok, job} = BullMQ.JobScheduler.upsert(conn, queue_name, "daily_report",
        %{pattern: "0 9 * * *"},  # Every day at 9 AM
        "report",
        %{type: "daily"},
        []
      )

      # Create an interval-based scheduler (RECOMMENDED for cross-platform)
      {:ok, job} = BullMQ.JobScheduler.upsert(conn, queue_name, "heartbeat",
        %{every: 60_000},  # Every minute
        "ping",
        %{},
        []
      )

  ## Repeat Options

    * `:pattern` - Cron expression (e.g., "*/5 * * * *" for every 5 minutes)
    * `:every` - Interval in milliseconds (mutually exclusive with `:pattern`)
    * `:limit` - Maximum number of times to repeat
    * `:start_date` - When to start the schedule (milliseconds or DateTime)
    * `:end_date` - When to stop the schedule (milliseconds or DateTime)
    * `:tz` - Timezone for cron expressions (default: UTC)
    * `:immediately` - Run the first job immediately (only with pattern)
    * `:offset` - Offset in milliseconds for every-based jobs

  ## Cron Expressions

  Cron expressions follow the standard 5-field format:

      ┌───────────── minute (0 - 59)
      │ ┌───────────── hour (0 - 23)
      │ │ ┌───────────── day of month (1 - 31)
      │ │ │ ┌───────────── month (1 - 12)
      │ │ │ │ ┌───────────── day of week (1 - 7) (Monday to Sunday)
      │ │ │ │ │
      * * * * *

  > #### Weekday Numbering {: .info}
  >
  > | Day       | Elixir | Node.js | Compatible? |
  > |-----------|--------|---------|-------------|
  > | Monday    | 1      | 1       | ✅ Yes |
  > | Tuesday   | 2      | 2       | ✅ Yes |
  > | Wednesday | 3      | 3       | ✅ Yes |
  > | Thursday  | 4      | 4       | ✅ Yes |
  > | Friday    | 5      | 5       | ✅ Yes |
  > | Saturday  | 6      | 6       | ✅ Yes |
  > | Sunday    | 7      | 0 or 7  | ⚠️ Use `7` |
  >
  > **Use `7` for Sunday** - it works in both Elixir and Node.js.
  > Avoid `0` for Sunday as it fails to parse in Elixir.

  Examples:
    * `"0 * * * *"` - Every hour
    * `"*/15 * * * *"` - Every 15 minutes
    * `"0 9 * * 1-5"` - Every weekday at 9 AM
    * `"0 0 1 * *"` - First day of every month at midnight
    * `"0 0 * * 7"` - Every Sunday at midnight (Elixir only)
  """

  alias BullMQ.{Backend, Job, Keys, Utils}

  require Logger

  @type repeat_opts :: %{
          optional(:pattern) => String.t(),
          optional(:every) => non_neg_integer(),
          optional(:limit) => pos_integer(),
          optional(:start_date) => DateTime.t() | non_neg_integer(),
          optional(:end_date) => DateTime.t() | non_neg_integer(),
          optional(:tz) => String.t(),
          optional(:immediately) => boolean(),
          optional(:offset) => non_neg_integer(),
          optional(:count) => non_neg_integer()
        }

  @type job_opts :: %{
          optional(:priority) => non_neg_integer(),
          optional(:lifo) => boolean(),
          optional(:delay) => non_neg_integer(),
          optional(:attempts) => pos_integer(),
          optional(:backoff) => map(),
          optional(:remove_on_complete) => boolean() | map(),
          optional(:remove_on_fail) => boolean() | map()
        }

  @type scheduler_json :: %{
          :key => String.t(),
          :name => String.t(),
          optional(:next) => non_neg_integer(),
          optional(:iteration_count) => non_neg_integer(),
          optional(:limit) => non_neg_integer(),
          optional(:start_date) => non_neg_integer(),
          optional(:end_date) => non_neg_integer(),
          optional(:tz) => String.t(),
          optional(:pattern) => String.t(),
          optional(:every) => non_neg_integer(),
          optional(:offset) => non_neg_integer(),
          optional(:template) => map()
        }

  # Error codes from Lua scripts
  @error_scheduler_job_id_collision -10
  @error_scheduler_job_slots_busy -11

  # ---------------------------------------------------------------------------
  # Public API
  # ---------------------------------------------------------------------------

  @doc """
  Creates or updates a job scheduler.

  If a scheduler with the given ID already exists, it will be updated.
  The scheduler will create a delayed job for the next scheduled execution.

  ## Parameters

    * `conn` - Redis connection
    * `queue_name` - Queue name
    * `scheduler_id` - Unique identifier for the scheduler
    * `repeat_opts` - Repeat configuration (pattern, every, limit, etc.)
    * `job_name` - Name for the jobs created by this scheduler
    * `job_data` - Data to be passed to each job
    * `opts` - Job options (priority, attempts, backoff, etc.)

  ## Returns

    * `{:ok, job}` - The job struct for the next scheduled execution
    * `{:error, :both_pattern_and_every}` - Both pattern and every specified
    * `{:error, :no_pattern_or_every}` - Neither pattern nor every specified
    * `{:error, :immediately_with_start_date}` - Both immediately and start_date specified
    * `{:error, :limit_reached}` - Job has reached its iteration limit
    * `{:error, :end_date_reached}` - Job has passed its end date
    * `{:error, :job_id_collision}` - A job with the same ID already exists in a non-updatable state
    * `{:error, :job_slots_busy}` - Both current and next time slots have jobs

  ## Examples

      # Every day at 9 AM
      {:ok, job} = BullMQ.JobScheduler.upsert(conn, "emails", "daily_digest",
        %{pattern: "0 9 * * *"},
        "send_digest",
        %{recipient: "all"},
        priority: 10
      )

      # Every 5 minutes, limited to 100 executions
      {:ok, job} = BullMQ.JobScheduler.upsert(conn, "health", "heartbeat",
        %{every: 300_000, limit: 100},
        "ping",
        %{timestamp: true},
        []
      )

      # Start immediately then repeat every hour
      {:ok, job} = BullMQ.JobScheduler.upsert(conn, "sync", "data_sync",
        %{pattern: "0 * * * *", immediately: true},
        "sync_data",
        %{},
        []
      )
  """
  @spec upsert(
          pid() | atom(),
          String.t(),
          String.t(),
          repeat_opts(),
          String.t(),
          map(),
          keyword()
        ) :: {:ok, Job.t()} | {:error, atom()}
  # credo:disable-for-next-line Credo.Check.Refactor.FunctionArity
  def upsert(conn, queue_name, scheduler_id, repeat_opts, job_name, job_data \\ %{}, opts \\ []) do
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.new(queue_name, prefix: prefix)
    now = System.system_time(:millisecond)

    with :ok <- check_scheduler_id(scheduler_id),
         :ok <- check_repeat_opts(repeat_opts),
         :ok <- check_repeat_limits(repeat_opts, now) do
      job_params = %{
        queue_name: queue_name,
        repeat_opts: repeat_opts,
        job_name: job_name,
        job_data: job_data,
        now: now,
        prefix: prefix
      }

      do_upsert(conn, ctx, scheduler_id, job_params, opts)
    end
  end

  defp check_scheduler_id(scheduler_id) do
    case validate_scheduler_id(scheduler_id) do
      :ok ->
        :ok

      {:error, {:invalid_scheduler_id, message}} = error ->
        Logger.error("[BullMQ.JobScheduler] #{message}")
        error

      {:error, reason} = error ->
        Logger.error("[BullMQ.JobScheduler] Invalid scheduler_id: #{inspect(reason)}")
        error
    end
  end

  defp check_repeat_opts(repeat_opts) do
    case validate_repeat_opts(repeat_opts) do
      :ok ->
        :ok

      {:error, reason} = error ->
        Logger.error("[BullMQ.JobScheduler] Invalid repeat options: #{inspect(reason)}")
        error
    end
  end

  defp check_repeat_limits(repeat_opts, now) do
    iteration_count = Map.get(repeat_opts, :count, 0) + 1
    limit = Map.get(repeat_opts, :limit)
    end_date = normalize_date(Map.get(repeat_opts, :end_date))

    cond do
      limit && iteration_count > limit -> {:error, :limit_reached}
      end_date && now > end_date -> {:error, :end_date_reached}
      true -> :ok
    end
  end

  @doc """
  Gets a job scheduler by ID.

  ## Parameters

    * `conn` - Redis connection
    * `queue_name` - Queue name
    * `scheduler_id` - The scheduler ID
    * `opts` - Options (prefix)

  ## Returns

    * `{:ok, scheduler}` - The scheduler data
    * `{:ok, nil}` - Scheduler not found
    * `{:error, reason}` - Redis error

  ## Examples

      {:ok, scheduler} = BullMQ.JobScheduler.get(conn, "my_queue", "daily_report")
      # => %{
      #   key: "daily_report",
      #   name: "daily_report",
      #   pattern: "0 9 * * *",
      #   next: 1699999999000,
      #   iteration_count: 5,
      #   template: %{data: %{}, opts: %{}}
      # }
  """
  @spec get(pid() | atom(), String.t(), String.t(), keyword()) ::
          {:ok, scheduler_json() | nil} | {:error, term()}
  def get(conn, queue_name, scheduler_id, opts \\ []) do
    prefix = Keyword.get(opts, :prefix, "bull")
    backend = Backend.create(queue_name, connection: conn, prefix: prefix)

    case Backend.get_job_scheduler(backend, scheduler_id) do
      {:ok, [nil, nil]} ->
        {:ok, nil}

      {:ok, [raw_data, score]} when is_list(raw_data) ->
        scheduler = transform_scheduler_data(scheduler_id, Utils.parse_hash_data(raw_data), score)
        {:ok, scheduler}

      {:ok, _} ->
        {:ok, nil}

      {:error, _} = error ->
        error
    end
  end

  @doc """
  Lists all job schedulers for a queue.

  ## Parameters

    * `conn` - Redis connection
    * `queue_name` - Queue name
    * `opts` - Options:
      * `:start` - Start index (default: 0)
      * `:end` - End index (default: -1 for all)
      * `:asc` - Sort ascending (default: false)
      * `:prefix` - Key prefix (default: "bull")

  ## Returns

    * `{:ok, schedulers}` - List of scheduler data
    * `{:error, reason}` - Redis error

  ## Examples

      {:ok, schedulers} = BullMQ.JobScheduler.list(conn, "my_queue")
      {:ok, first_10} = BullMQ.JobScheduler.list(conn, "my_queue", start: 0, end: 9)
  """
  @spec list(pid() | atom(), String.t(), keyword()) ::
          {:ok, [scheduler_json()]} | {:error, term()}
  def list(conn, queue_name, opts \\ []) do
    prefix = Keyword.get(opts, :prefix, "bull")
    start_idx = Keyword.get(opts, :start, 0)
    end_idx = Keyword.get(opts, :end, -1)
    asc = Keyword.get(opts, :asc, false)

    backend = Backend.create(queue_name, connection: conn, prefix: prefix)

    # Get scheduler IDs with scores
    case Backend.get_job_schedulers_range(backend, start_idx, end_idx, asc) do
      {:ok, result} when is_list(result) ->
        schedulers =
          result
          |> Enum.chunk_every(2)
          |> Enum.map(fn [scheduler_id, score] ->
            fetch_scheduler_with_score(conn, queue_name, scheduler_id, score, opts)
          end)
          |> Enum.reject(&is_nil/1)

        {:ok, schedulers}

      {:error, _} = error ->
        error
    end
  end

  defp fetch_scheduler_with_score(conn, queue_name, scheduler_id, score, opts) do
    case get(conn, queue_name, scheduler_id, opts) do
      {:ok, scheduler} when not is_nil(scheduler) ->
        %{scheduler | next: Utils.parse_int_or_nil(score)}

      _ ->
        nil
    end
  end

  @doc """
  Gets the count of job schedulers for a queue.

  ## Examples

      {:ok, count} = BullMQ.JobScheduler.count(conn, "my_queue")
      # => {:ok, 5}
  """
  @spec count(pid() | atom(), String.t(), keyword()) :: {:ok, non_neg_integer()} | {:error, term()}
  def count(conn, queue_name, opts \\ []) do
    prefix = Keyword.get(opts, :prefix, "bull")
    backend = Backend.create(queue_name, connection: conn, prefix: prefix)

    Backend.get_job_schedulers_count(backend)
  end

  @doc """
  Removes a job scheduler and its next scheduled job.

  ## Parameters

    * `conn` - Redis connection
    * `queue_name` - Queue name
    * `scheduler_id` - The scheduler ID to remove
    * `opts` - Options (prefix)

  ## Returns

    * `{:ok, true}` - Scheduler was removed
    * `{:ok, false}` - Scheduler not found
    * `{:error, reason}` - Redis error

  ## Examples

      {:ok, true} = BullMQ.JobScheduler.remove(conn, "my_queue", "daily_report")
  """
  @spec remove(pid() | atom(), String.t(), String.t(), keyword()) ::
          {:ok, boolean()} | {:error, term()}
  def remove(conn, queue_name, scheduler_id, opts \\ []) do
    prefix = Keyword.get(opts, :prefix, "bull")
    backend = Backend.create(queue_name, connection: conn, prefix: prefix)

    case Backend.remove_job_scheduler(backend, scheduler_id) do
      {:ok, 0} -> {:ok, true}
      {:ok, 1} -> {:ok, false}
      {:error, _} = error -> error
    end
  end

  @doc """
  Removes a job scheduler by its key (alias for remove/4).

  For backwards compatibility with the "repeatable jobs" API.
  """
  @spec remove_by_key(pid() | atom(), String.t(), String.t(), keyword()) ::
          {:ok, boolean()} | {:error, term()}
  def remove_by_key(conn, queue_name, key, opts \\ []) do
    remove(conn, queue_name, key, opts)
  end

  @doc """
  Calculates the next execution time for a repeat configuration.

  ## Parameters

    * `repeat_opts` - Repeat options with pattern or every
    * `reference_time` - Reference time in milliseconds (default: now)

  ## Returns

    * The next execution time in milliseconds, or nil if no next time

  ## Examples

      # Next minute
      next = BullMQ.JobScheduler.calculate_next_millis(%{every: 60_000}, now)

      # Next cron execution
      next = BullMQ.JobScheduler.calculate_next_millis(%{pattern: "0 * * * *"}, now)
  """
  @spec calculate_next_millis(repeat_opts(), non_neg_integer()) :: non_neg_integer() | nil
  def calculate_next_millis(repeat_opts, reference_time \\ System.system_time(:millisecond))

  def calculate_next_millis(%{immediately: true}, reference_time) do
    reference_time
  end

  def calculate_next_millis(%{every: every} = opts, reference_time) when is_integer(every) do
    start_date = normalize_date(Map.get(opts, :start_date))
    offset = Map.get(opts, :offset, 0)
    prev_millis = Map.get(opts, :prev_millis)

    next_millis =
      cond do
        prev_millis ->
          next = prev_millis + every
          # Check if we missed some iterations
          if next < reference_time do
            div(reference_time, every) * every + every + offset
          else
            next
          end

        start_date && start_date > reference_time ->
          start_date

        true ->
          # Default: next execution is reference_time + every
          reference_time + every
      end

    # Check end date
    end_date = normalize_date(Map.get(opts, :end_date))

    if end_date && next_millis > end_date do
      nil
    else
      next_millis
    end
  end

  def calculate_next_millis(%{pattern: pattern} = opts, reference_time) do
    tz = Map.get(opts, :tz, "Etc/UTC")
    start_date = normalize_date(Map.get(opts, :start_date))
    end_date = normalize_date(Map.get(opts, :end_date))

    # Use start_date as reference if it's in the future
    effective_reference =
      if start_date && start_date > reference_time do
        start_date
      else
        reference_time
      end

    case parse_cron_next(pattern, effective_reference, tz) do
      {:ok, next_time} ->
        # Check end date
        if end_date && next_time > end_date do
          nil
        else
          next_time
        end

      {:error, _} ->
        nil
    end
  end

  def calculate_next_millis(_, _), do: nil

  # ---------------------------------------------------------------------------
  # Private Functions
  # ---------------------------------------------------------------------------

  # Validate scheduler_id format to prevent confusion with legacy repeatable jobs
  # Legacy format used 5+ colon-separated parts (e.g., "name:pattern:tz:endDate:every")
  # New job scheduler IDs must have fewer than 5 colon-separated parts
  defp validate_scheduler_id(scheduler_id) when is_binary(scheduler_id) do
    parts = String.split(scheduler_id, ":")

    cond do
      scheduler_id == "" ->
        {:error, :empty_scheduler_id}

      length(parts) >= 5 ->
        {:error,
         {:invalid_scheduler_id,
          "Scheduler ID '#{scheduler_id}' contains #{length(parts)} colon-separated parts. " <>
            "Job scheduler IDs must have fewer than 5 colon-separated parts to avoid confusion " <>
            "with legacy repeatable jobs. Consider using a different separator (e.g., '_' or '-') " <>
            "or removing trailing colons."}}

      true ->
        :ok
    end
  end

  defp validate_scheduler_id(_), do: {:error, :scheduler_id_must_be_string}

  defp validate_repeat_opts(%{pattern: _, every: _}) do
    {:error, :both_pattern_and_every}
  end

  defp validate_repeat_opts(%{immediately: true, start_date: _}) do
    {:error, :immediately_with_start_date}
  end

  defp validate_repeat_opts(%{pattern: _}), do: :ok
  defp validate_repeat_opts(%{every: _}), do: :ok
  defp validate_repeat_opts(_), do: {:error, :no_pattern_or_every}

  defp do_upsert(conn, ctx, scheduler_id, job_params, opts) do
    case calculate_next_millis(job_params.repeat_opts, job_params.now) do
      nil -> {:ok, nil}
      next_millis -> perform_upsert(conn, ctx, scheduler_id, job_params, opts, next_millis)
    end
  end

  defp perform_upsert(conn, ctx, scheduler_id, job_params, opts, next_millis) do
    now = job_params.now
    next_millis = max(next_millis, now)

    scheduler_opts = build_scheduler_opts(job_params.repeat_opts, job_params.job_name)
    template_opts = build_template_opts(opts)
    delayed_opts = build_delayed_opts(job_params.repeat_opts, scheduler_id, next_millis, now, opts)
    template_data = Jason.encode!(job_params.job_data)

    backend = Backend.create(ctx.name, connection: conn, prefix: ctx.prefix)

    result =
      Backend.add_job_scheduler(
        backend,
        scheduler_id,
        next_millis,
        scheduler_opts: scheduler_opts,
        template_data: template_data,
        template_opts: template_opts,
        delayed_opts: delayed_opts,
        now: now,
        producer_id: nil
      )

    handle_upsert_result(result, scheduler_id, job_params, opts)
  end

  defp handle_upsert_result({:ok, [job_id, delay]}, scheduler_id, job_params, opts)
       when is_binary(job_id) do
    parsed_delay = if is_binary(delay), do: String.to_integer(delay), else: delay

    job = %Job{
      id: job_id,
      name: job_params.job_name,
      data: job_params.job_data,
      queue_name: job_params.queue_name,
      delay: parsed_delay,
      timestamp: job_params.now,
      opts: Map.new(opts),
      repeat_job_key: scheduler_id
    }

    {:ok, job}
  end

  defp handle_upsert_result({:ok, @error_scheduler_job_id_collision}, _id, _params, _opts) do
    {:error, :job_id_collision}
  end

  defp handle_upsert_result({:ok, @error_scheduler_job_slots_busy}, _id, _params, _opts) do
    {:error, :job_slots_busy}
  end

  defp handle_upsert_result({:ok, nil}, _id, _params, _opts), do: {:ok, nil}
  defp handle_upsert_result({:error, _} = error, _id, _params, _opts), do: error
  defp handle_upsert_result(other, _id, _params, _opts), do: {:ok, other}

  defp build_delayed_opts(repeat_opts, scheduler_id, next_millis, now, opts) do
    iteration_count = Map.get(repeat_opts, :count, 0) + 1
    offset = Map.get(repeat_opts, :offset, 0)
    delay = max(0, next_millis + offset - now)

    %{
      delay: delay,
      timestamp: now,
      prevMillis: next_millis,
      repeatJobKey: scheduler_id,
      repeat: %{
        count: iteration_count,
        limit: Map.get(repeat_opts, :limit),
        pattern: Map.get(repeat_opts, :pattern),
        every: Map.get(repeat_opts, :every),
        offset: offset,
        startDate: normalize_date(Map.get(repeat_opts, :start_date)),
        endDate: normalize_date(Map.get(repeat_opts, :end_date)),
        tz: Map.get(repeat_opts, :tz)
      }
    }
    |> maybe_add_job_opts(opts)
  end

  defp build_scheduler_opts(repeat_opts, job_name) do
    %{name: job_name}
    |> maybe_put_opt(:pattern, Map.get(repeat_opts, :pattern))
    |> maybe_put_opt(:every, Map.get(repeat_opts, :every))
    |> maybe_put_opt(:tz, Map.get(repeat_opts, :tz))
    |> maybe_put_opt(:limit, Map.get(repeat_opts, :limit))
    |> maybe_put_opt(:startDate, normalize_date(Map.get(repeat_opts, :start_date)))
    |> maybe_put_opt(:endDate, normalize_date(Map.get(repeat_opts, :end_date)))
    |> maybe_put_opt(:offset, Map.get(repeat_opts, :offset))
  end

  defp maybe_put_opt(map, _key, nil), do: map
  defp maybe_put_opt(map, key, val), do: Map.put(map, key, val)

  defp build_template_opts(opts) do
    Enum.reduce(opts, %{}, fn
      {:priority, v}, acc -> Map.put(acc, :priority, v)
      {:attempts, v}, acc -> Map.put(acc, :attempts, v)
      {:backoff, v}, acc -> Map.put(acc, :backoff, v)
      {:lifo, v}, acc -> Map.put(acc, :lifo, v)
      {:remove_on_complete, v}, acc -> Map.put(acc, :removeOnComplete, v)
      {:remove_on_fail, v}, acc -> Map.put(acc, :removeOnFail, v)
      _, acc -> acc
    end)
  end

  defp maybe_add_job_opts(delayed_opts, opts) do
    Enum.reduce(opts, delayed_opts, fn
      {:priority, v}, acc -> Map.put(acc, :priority, v)
      {:attempts, v}, acc -> Map.put(acc, :attempts, v)
      {:backoff, v}, acc -> Map.put(acc, :backoff, v)
      {:lifo, v}, acc -> Map.put(acc, :lifo, v)
      _, acc -> acc
    end)
  end

  defp transform_scheduler_data(key, raw_data, score) when is_map(raw_data) do
    %{
      key: key,
      name: Map.get(raw_data, "name", key)
    }
    |> maybe_put_opt(:next, Utils.parse_int_or_nil(score))
    |> maybe_put_parsed_int(:iteration_count, Map.get(raw_data, "ic"))
    |> maybe_put_parsed_int(:limit, Map.get(raw_data, "limit"))
    |> maybe_put_parsed_int(:start_date, Map.get(raw_data, "startDate"))
    |> maybe_put_parsed_int(:end_date, Map.get(raw_data, "endDate"))
    |> maybe_put_opt(:tz, Map.get(raw_data, "tz"))
    |> maybe_put_opt(:pattern, Map.get(raw_data, "pattern"))
    |> maybe_put_parsed_int(:every, Map.get(raw_data, "every"))
    |> maybe_put_parsed_int(:offset, Map.get(raw_data, "offset"))
    |> maybe_put_template(raw_data)
  end

  defp maybe_put_parsed_int(map, _key, nil), do: map
  defp maybe_put_parsed_int(map, key, val), do: Map.put(map, key, Utils.parse_int_or_nil(val))

  defp maybe_put_template(scheduler, raw_data) do
    template =
      %{}
      |> maybe_decode_json_field(:data, Map.get(raw_data, "data"))
      |> maybe_decode_json_field(:opts, Map.get(raw_data, "opts"))

    if map_size(template) > 0 do
      Map.put(scheduler, :template, template)
    else
      scheduler
    end
  end

  defp maybe_decode_json_field(map, _key, nil), do: map

  defp maybe_decode_json_field(map, key, val) when is_binary(val) do
    case Jason.decode(val) do
      {:ok, decoded} -> Map.put(map, key, decoded)
      _ -> map
    end
  end

  defp maybe_decode_json_field(map, key, val), do: Map.put(map, key, val)

  defp normalize_date(nil), do: nil
  defp normalize_date(ms) when is_integer(ms), do: ms
  defp normalize_date(%DateTime{} = dt), do: DateTime.to_unix(dt, :millisecond)
  defp normalize_date(_), do: nil

  defp parse_cron_next(pattern, reference_time, _tz) do
    # Convert reference time to DateTime
    reference_dt = DateTime.from_unix!(reference_time, :millisecond)

    # Parse cron expression
    case Crontab.CronExpression.Parser.parse(pattern) do
      {:ok, cron} ->
        # Get next run date
        case Crontab.Scheduler.get_next_run_date(cron, reference_dt) do
          {:ok, next_dt} ->
            {:ok, DateTime.to_unix(next_dt, :millisecond)}

          error ->
            error
        end

      error ->
        error
    end
  rescue
    e -> {:error, e}
  end
end
