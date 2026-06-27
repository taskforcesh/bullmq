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

  alias BullMQ.{Keys, Scripts, Job}

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
  def upsert(conn, queue_name, scheduler_id, repeat_opts, job_name, job_data \\ %{}, opts \\ []) do
    prefix = Keyword.get(opts, :prefix, "bull")
    ctx = Keys.new(queue_name, prefix: prefix)

    # Validate scheduler_id format
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
    |> case do
      :ok ->
        case validate_repeat_opts(repeat_opts) do
          :ok ->
            # Check iteration limit
            iteration_count = Map.get(repeat_opts, :count, 0) + 1
            limit = Map.get(repeat_opts, :limit)

            if limit && iteration_count > limit do
              {:error, :limit_reached}
            else
              # Check end date
              now = System.system_time(:millisecond)
              end_date = normalize_date(Map.get(repeat_opts, :end_date))

              if end_date && now > end_date do
                {:error, :end_date_reached}
              else
                do_upsert(
                  conn,
                  ctx,
                  queue_name,
                  scheduler_id,
                  repeat_opts,
                  job_name,
                  job_data,
                  opts,
                  now,
                  prefix
                )
              end
            end

          {:error, reason} = error ->
            Logger.error("[BullMQ.JobScheduler] Invalid repeat options: #{inspect(reason)}")
            error
        end

      error ->
        error
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
    ctx = Keys.new(queue_name, prefix: prefix)

    {script, key_count} = Scripts.get(:get_job_scheduler)
    keys = [Keys.repeat(ctx)]
    args = [scheduler_id]

    case Redix.command(conn, ["EVAL", script, key_count | keys ++ args]) do
      {:ok, [nil, nil]} ->
        {:ok, nil}

      {:ok, [raw_data, score]} when is_list(raw_data) ->
        scheduler = transform_scheduler_data(scheduler_id, array_to_map(raw_data), score)
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

    ctx = Keys.new(queue_name, prefix: prefix)
    repeat_key = Keys.repeat(ctx)

    # Get scheduler IDs with scores
    command =
      if asc do
        ["ZRANGE", repeat_key, start_idx, end_idx, "WITHSCORES"]
      else
        ["ZREVRANGE", repeat_key, start_idx, end_idx, "WITHSCORES"]
      end

    case Redix.command(conn, command) do
      {:ok, result} when is_list(result) ->
        schedulers =
          result
          |> Enum.chunk_every(2)
          |> Enum.map(fn [scheduler_id, score] ->
            case get(conn, queue_name, scheduler_id, opts) do
              {:ok, scheduler} when not is_nil(scheduler) ->
                %{scheduler | next: parse_int(score)}

              _ ->
                nil
            end
          end)
          |> Enum.reject(&is_nil/1)

        {:ok, schedulers}

      {:error, _} = error ->
        error
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
    ctx = Keys.new(queue_name, prefix: prefix)

    Redix.command(conn, ["ZCARD", Keys.repeat(ctx)])
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
    ctx = Keys.new(queue_name, prefix: prefix)

    {script, key_count} = Scripts.get(:remove_job_scheduler)

    keys = [
      Keys.repeat(ctx),
      Keys.delayed(ctx),
      Keys.events(ctx)
    ]

    args = [
      scheduler_id,
      Keys.base(ctx) <> ":"
    ]

    case Redix.command(conn, ["EVAL", script, key_count | keys ++ args]) do
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

  defp do_upsert(
         conn,
         ctx,
         queue_name,
         scheduler_id,
         repeat_opts,
         job_name,
         job_data,
         opts,
         now,
         _prefix
       ) do
    # Calculate next execution time
    next_millis = calculate_next_millis(repeat_opts, now)

    if is_nil(next_millis) do
      {:ok, nil}
    else
      # Clamp to now if in the past
      next_millis = max(next_millis, now)

      # Prepare script arguments
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

      # Build scheduler opts for msgpack
      scheduler_opts = build_scheduler_opts(repeat_opts, job_name)

      # Build template opts
      template_opts = build_template_opts(opts)

      # Build delayed job opts
      iteration_count = Map.get(repeat_opts, :count, 0) + 1
      offset = Map.get(repeat_opts, :offset, 0)
      delay = max(0, next_millis + offset - now)

      delayed_opts =
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

      # Encode data
      template_data = Jason.encode!(job_data)

      args = [
        next_millis,
        Msgpax.pack!(scheduler_opts, iodata: false),
        scheduler_id,
        template_data,
        Msgpax.pack!(template_opts, iodata: false),
        Msgpax.pack!(delayed_opts, iodata: false),
        now,
        Keys.base(ctx) <> ":",
        # producer key (empty for now)
        ""
      ]

      case Redix.command(conn, ["EVAL", script, key_count | keys ++ args]) do
        {:ok, [job_id, delay]} when is_binary(job_id) ->
          delay = if is_binary(delay), do: String.to_integer(delay), else: delay

          job = %Job{
            id: job_id,
            name: job_name,
            data: job_data,
            queue_name: queue_name,
            delay: delay,
            timestamp: now,
            opts: Map.new(opts),
            repeat_job_key: scheduler_id
          }

          {:ok, job}

        {:ok, @error_scheduler_job_id_collision} ->
          {:error, :job_id_collision}

        {:ok, @error_scheduler_job_slots_busy} ->
          {:error, :job_slots_busy}

        {:ok, nil} ->
          {:ok, nil}

        {:error, _} = error ->
          error
      end
    end
  end

  defp build_scheduler_opts(repeat_opts, job_name) do
    opts = %{name: job_name}

    opts =
      case Map.get(repeat_opts, :pattern) do
        nil -> opts
        pattern -> Map.put(opts, :pattern, pattern)
      end

    opts =
      case Map.get(repeat_opts, :every) do
        nil -> opts
        every -> Map.put(opts, :every, every)
      end

    opts =
      case Map.get(repeat_opts, :tz) do
        nil -> opts
        tz -> Map.put(opts, :tz, tz)
      end

    opts =
      case Map.get(repeat_opts, :limit) do
        nil -> opts
        limit -> Map.put(opts, :limit, limit)
      end

    opts =
      case normalize_date(Map.get(repeat_opts, :start_date)) do
        nil -> opts
        start_date -> Map.put(opts, :startDate, start_date)
      end

    opts =
      case normalize_date(Map.get(repeat_opts, :end_date)) do
        nil -> opts
        end_date -> Map.put(opts, :endDate, end_date)
      end

    case Map.get(repeat_opts, :offset) do
      nil -> opts
      offset -> Map.put(opts, :offset, offset)
    end
  end

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
    scheduler = %{
      key: key,
      name: Map.get(raw_data, "name", key)
    }

    scheduler =
      if score do
        Map.put(scheduler, :next, parse_int(score))
      else
        scheduler
      end

    scheduler =
      case Map.get(raw_data, "ic") do
        nil -> scheduler
        ic -> Map.put(scheduler, :iteration_count, parse_int(ic))
      end

    scheduler =
      case Map.get(raw_data, "limit") do
        nil -> scheduler
        limit -> Map.put(scheduler, :limit, parse_int(limit))
      end

    scheduler =
      case Map.get(raw_data, "startDate") do
        nil -> scheduler
        sd -> Map.put(scheduler, :start_date, parse_int(sd))
      end

    scheduler =
      case Map.get(raw_data, "endDate") do
        nil -> scheduler
        ed -> Map.put(scheduler, :end_date, parse_int(ed))
      end

    scheduler =
      case Map.get(raw_data, "tz") do
        nil -> scheduler
        tz -> Map.put(scheduler, :tz, tz)
      end

    scheduler =
      case Map.get(raw_data, "pattern") do
        nil -> scheduler
        pattern -> Map.put(scheduler, :pattern, pattern)
      end

    scheduler =
      case Map.get(raw_data, "every") do
        nil -> scheduler
        every -> Map.put(scheduler, :every, parse_int(every))
      end

    scheduler =
      case Map.get(raw_data, "offset") do
        nil -> scheduler
        offset -> Map.put(scheduler, :offset, parse_int(offset))
      end

    # Build template if data or opts exist
    template = %{}

    template =
      case Map.get(raw_data, "data") do
        nil ->
          template

        data when is_binary(data) ->
          case Jason.decode(data) do
            {:ok, decoded} -> Map.put(template, :data, decoded)
            _ -> template
          end

        data ->
          Map.put(template, :data, data)
      end

    template =
      case Map.get(raw_data, "opts") do
        nil ->
          template

        opts when is_binary(opts) ->
          case Jason.decode(opts) do
            {:ok, decoded} -> Map.put(template, :opts, decoded)
            _ -> template
          end

        opts ->
          Map.put(template, :opts, opts)
      end

    if map_size(template) > 0 do
      Map.put(scheduler, :template, template)
    else
      scheduler
    end
  end

  defp array_to_map(array) when is_list(array) do
    array
    |> Enum.chunk_every(2)
    |> Enum.into(%{}, fn
      [k, v] -> {k, v}
      [k] -> {k, nil}
    end)
  end

  defp array_to_map(_), do: %{}

  defp parse_int(nil), do: nil
  defp parse_int(n) when is_integer(n), do: n
  defp parse_int(s) when is_binary(s), do: String.to_integer(s)
  defp parse_int(f) when is_float(f), do: round(f)

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
