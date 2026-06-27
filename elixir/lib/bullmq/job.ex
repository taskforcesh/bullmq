defmodule BullMQ.Job do
  @moduledoc """
  Represents a job in a BullMQ queue.

  A job contains the data to be processed, along with metadata about its state,
  attempts, progress, and results. Jobs are persisted in Redis and can be
  processed by workers across multiple nodes.

  ## Job Lifecycle

  Jobs transition through the following states:

  1. **waiting** - Job is in the queue waiting to be processed
  2. **active** - Job is currently being processed by a worker
  3. **delayed** - Job is scheduled to be processed at a future time
  4. **prioritized** - Job is in the priority queue
  5. **completed** - Job finished successfully
  6. **failed** - Job failed after exhausting all retries
  7. **waiting-children** - Parent job waiting for child jobs to complete

  ## Examples

      # Jobs are typically created through the Queue module
      {:ok, job} = BullMQ.Queue.add("my_queue", "email", %{to: "user@example.com"})

      # Access job properties
      job.id         #=> "1"
      job.name       #=> "email"
      job.data       #=> %{to: "user@example.com"}
      job.state      #=> :waiting

      # In a worker, you receive the job and can update progress
      defmodule MyWorker do
        def process(job) do
          BullMQ.Job.update_progress(job, 50)
          result = do_work(job.data)
          BullMQ.Job.update_progress(job, 100)
          result
        end
      end

  ## Flow Methods

  When processing parent jobs in a flow, you can access child results:

      def process(job) do
        # Get children that completed successfully
        {:ok, children_values} = BullMQ.Job.get_children_values(job)

        # Get children that failed but were ignored
        {:ok, ignored_failures} = BullMQ.Job.get_ignored_children_failures(job)

        # Get pending dependencies
        {:ok, deps} = BullMQ.Job.get_dependencies(job)

        {:ok, aggregate(children_values)}
      end
  """

  alias BullMQ.{Keys, RedisConnection, Scripts, Types}

  # Mapping for encoding option names to short keys (for Redis storage)
  # Elixir uses snake_case, which gets encoded to short keys for Node.js compatibility
  @opts_encode_map %{
    "deduplication" => "de",
    "fail_parent_on_failure" => "fpof",
    "continue_parent_on_failure" => "cpof",
    "ignore_dependency_on_failure" => "idof",
    "keep_logs" => "kl",
    "remove_dependency_on_failure" => "rdof",
    "telemetry_metadata" => "tm",
    "omit_context" => "omc"
  }

  # Mapping for decoding short keys back to snake_case option names
  @opts_decode_map %{
    "de" => "deduplication",
    "fpof" => "fail_parent_on_failure",
    "cpof" => "continue_parent_on_failure",
    "idof" => "ignore_dependency_on_failure",
    "kl" => "keep_logs",
    "rdof" => "remove_dependency_on_failure",
    "tm" => "telemetry_metadata",
    "omc" => "omit_context"
  }

  @type t :: %__MODULE__{
          id: Types.job_id(),
          name: Types.job_name(),
          data: Types.job_data(),
          opts: map(),
          queue_name: Types.queue_name(),
          prefix: String.t(),
          timestamp: Types.timestamp_ms(),
          delay: Types.duration_ms(),
          priority: Types.priority(),
          processed_on: Types.timestamp_ms() | nil,
          finished_on: Types.timestamp_ms() | nil,
          progress: Types.job_progress(),
          return_value: term(),
          failed_reason: String.t() | nil,
          stacktrace: [String.t()],
          attempts_made: non_neg_integer(),
          attempts_started: non_neg_integer(),
          stalled_counter: non_neg_integer(),
          parent_key: String.t() | nil,
          parent: map() | nil,
          processed_by: String.t() | nil,
          repeat_job_key: String.t() | nil,
          deduplication_id: String.t() | nil,
          deferred_failure: String.t() | nil,
          token: Types.lock_token() | nil,
          connection: Types.redis_connection() | nil,
          worker: pid() | nil
        }

  @enforce_keys [:id, :name, :data, :queue_name]
  defstruct [
    :id,
    :name,
    :data,
    :queue_name,
    :token,
    :connection,
    :worker,
    :parent_key,
    :parent,
    :processed_by,
    :repeat_job_key,
    :deduplication_id,
    :deferred_failure,
    :processed_on,
    :finished_on,
    :failed_reason,
    :return_value,
    opts: %{},
    prefix: "bull",
    timestamp: 0,
    delay: 0,
    priority: 0,
    progress: 0,
    stacktrace: [],
    attempts_made: 0,
    attempts_started: 0,
    stalled_counter: 0
  ]

  @doc """
  Creates a new job struct with the given parameters.

  ## Parameters

    * `queue_name` - The name of the queue
    * `name` - The job type/name identifier
    * `data` - The job payload data
    * `opts` - Job options (see `BullMQ.Types.job_opts()`)

  ## Examples

      iex> job = BullMQ.Job.new("my_queue", "email", %{to: "test@example.com"})
      iex> job.name
      "email"

      iex> job = BullMQ.Job.new("my_queue", "email", %{to: "test@example.com"},
      ...>   job_id: "custom-id", priority: 5)
      iex> job.id
      "custom-id"
      iex> job.priority
      5
  """
  @spec new(Types.queue_name(), Types.job_name(), Types.job_data(), keyword() | map()) :: t()
  def new(queue_name, name, data, opts \\ []) do
    opts = opts_to_map(opts)

    %__MODULE__{
      id: Map.get(opts, :job_id),
      name: name,
      data: data,
      queue_name: queue_name,
      opts: opts,
      prefix: Map.get(opts, :prefix, "bull"),
      timestamp: Map.get(opts, :timestamp, System.system_time(:millisecond)),
      delay: Map.get(opts, :delay, 0),
      priority: Map.get(opts, :priority, 0),
      parent: Map.get(opts, :parent),
      parent_key: build_parent_key(Map.get(opts, :parent)),
      deduplication_id: get_in(opts, [:deduplication, :id])
    }
  end

  @doc """
  Reconstructs a job from Redis hash data.

  ## Parameters

    * `job_id` - The job ID
    * `queue_name` - The queue name
    * `data` - Map of field-value pairs from Redis HGETALL
    * `opts` - Additional options like connection and prefix

  """
  @spec from_redis(Types.job_id(), Types.queue_name(), map(), keyword()) :: t()
  def from_redis(job_id, queue_name, data, opts \\ []) do
    %__MODULE__{
      id: job_id,
      name: Map.get(data, "name", ""),
      data: decode_json(Map.get(data, "data", "{}")),
      queue_name: queue_name,
      opts: decode_opts(Map.get(data, "opts", "{}")),
      prefix: Keyword.get(opts, :prefix, "bull"),
      timestamp: parse_int(Map.get(data, "timestamp", "0")),
      delay: parse_int(Map.get(data, "delay", "0")),
      priority: parse_int(Map.get(data, "priority", "0")),
      processed_on: parse_int_or_nil(Map.get(data, "processedOn")),
      finished_on: parse_int_or_nil(Map.get(data, "finishedOn")),
      progress: decode_progress(Map.get(data, "progress")),
      return_value: decode_json_or_nil(Map.get(data, "returnvalue")),
      failed_reason: Map.get(data, "failedReason"),
      stacktrace: decode_stacktrace(Map.get(data, "stacktrace")),
      attempts_made: parse_int(Map.get(data, "attemptsMade") || Map.get(data, "atm", "0")),
      attempts_started: parse_int(Map.get(data, "ats", "0")),
      stalled_counter: parse_int(Map.get(data, "stc", "0")),
      parent_key: Map.get(data, "parentKey"),
      parent: decode_json_or_nil(Map.get(data, "parent")),
      processed_by: Map.get(data, "processedBy"),
      repeat_job_key: Map.get(data, "rjk"),
      deduplication_id: Map.get(data, "deid"),
      deferred_failure: Map.get(data, "defa"),
      token: Keyword.get(opts, :token),
      connection: Keyword.get(opts, :connection),
      worker: Keyword.get(opts, :worker)
    }
  end

  @doc """
  Converts a job to a map suitable for Redis storage.
  """
  @spec to_redis(t()) :: map()
  def to_redis(%__MODULE__{} = job) do
    base = %{
      "name" => job.name,
      "data" => encode_json(job.data),
      "opts" => encode_opts(job.opts),
      "timestamp" => to_string(job.timestamp)
    }

    base
    |> maybe_put("delay", job.delay, 0)
    |> maybe_put("priority", job.priority, 0)
    |> maybe_put("parentKey", job.parent_key, nil)
    |> maybe_put("parent", encode_json_or_nil(job.parent), nil)
    |> maybe_put("deid", job.deduplication_id, nil)
    |> maybe_put("rjk", job.repeat_job_key, nil)
  end

  @doc """
  Returns the Redis key for this job's hash.
  """
  @spec key(t()) :: String.t()
  def key(%__MODULE__{} = job) do
    ctx = Keys.new(job.queue_name, prefix: job.prefix)
    Keys.job(ctx, job.id)
  end

  @doc """
  Returns the Redis key for this job's lock.
  """
  @spec lock_key(t()) :: String.t()
  def lock_key(%__MODULE__{} = job) do
    ctx = Keys.new(job.queue_name, prefix: job.prefix)
    Keys.job_lock(ctx, job.id)
  end

  @doc """
  Returns the Redis key for this job's logs.
  """
  @spec logs_key(t()) :: String.t()
  def logs_key(%__MODULE__{} = job) do
    ctx = Keys.new(job.queue_name, prefix: job.prefix)
    Keys.job_logs(ctx, job.id)
  end

  @doc """
  Adds a log entry to the job.

  Logs are stored in Redis and can be retrieved later. This is useful for
  tracking the progress of long-running jobs or debugging.

  ## Example

      def process(job) do
        Job.log(job, "Starting processing")
        result = do_work(job.data)
        Job.log(job, "Completed with result: \#{inspect(result)}")
        {:ok, result}
      end

  ## Options

    * `:keep_logs` - Maximum number of log entries to keep. Older entries
      will be removed when this limit is exceeded. If not provided, all
      logs are kept.

  Returns the total number of log entries for this job.
  """
  @spec log(t(), String.t(), keyword()) :: {:ok, integer()} | {:error, term()}
  def log(%__MODULE__{} = job, message, opts \\ []) do
    ctx = Keys.new(job.queue_name, prefix: job.prefix)
    keep_logs = Keyword.get(opts, :keep_logs)
    Scripts.add_log(job.connection, ctx, job.id, message, keep_logs)
  end

  @doc """
  Checks if the job has been completed.
  """
  @spec completed?(t()) :: boolean()
  def completed?(%__MODULE__{finished_on: finished_on, failed_reason: nil})
      when not is_nil(finished_on),
      do: true

  def completed?(_), do: false

  @doc """
  Checks if the job has failed.
  """
  @spec failed?(t()) :: boolean()
  def failed?(%__MODULE__{failed_reason: reason}) when not is_nil(reason), do: true
  def failed?(_), do: false

  @doc """
  Checks if the job is currently being processed.
  """
  @spec active?(t()) :: boolean()
  def active?(%__MODULE__{processed_on: processed_on, finished_on: nil})
      when not is_nil(processed_on),
      do: true

  def active?(_), do: false

  @doc """
  Checks if the job is delayed.
  """
  @spec delayed?(t()) :: boolean()
  def delayed?(%__MODULE__{delay: delay}) when delay > 0, do: true
  def delayed?(_), do: false

  @doc """
  Checks if the job has a parent job (is a child in a flow).
  """
  @spec has_parent?(t()) :: boolean()
  def has_parent?(%__MODULE__{parent: parent}) when not is_nil(parent) and parent != %{}, do: true
  def has_parent?(%__MODULE__{parent_key: key}) when not is_nil(key) and key != "", do: true
  def has_parent?(_), do: false

  @doc """
  Returns the estimated state of the job based on its properties.

  Note: For accurate state, use `BullMQ.Queue.get_job_state/2` which
  checks Redis directly.
  """
  @spec estimated_state(t()) :: Types.job_state()
  def estimated_state(%__MODULE__{} = job) do
    cond do
      failed?(job) -> :failed
      completed?(job) -> :completed
      active?(job) -> :active
      delayed?(job) -> :delayed
      job.priority > 0 -> :prioritized
      true -> :waiting
    end
  end

  @doc """
  Checks if the job should be retried based on attempts configuration.
  """
  @spec should_retry?(t()) :: boolean()
  def should_retry?(%__MODULE__{opts: opts, attempts_made: attempts_made}) do
    # Handle both atom and string keys (string keys come from JSON decode)
    max_attempts = get_opt(opts, :attempts, "attempts", 1)
    attempts_made + 1 < max_attempts
  end

  @doc """
  Calculates the backoff delay for the next retry attempt.
  """
  @spec calculate_backoff(t()) :: Types.duration_ms()
  def calculate_backoff(%__MODULE__{opts: opts, attempts_made: attempts_made}) do
    # Handle both atom and string keys (string keys come from JSON decode)
    backoff = get_opt(opts, :backoff, "backoff", nil)

    case backoff do
      nil ->
        0

      %{type: :fixed, delay: delay} ->
        delay

      %{"type" => "fixed", "delay" => delay} ->
        delay

      %{type: :exponential, delay: delay} ->
        jitter = get_in(backoff, [:jitter]) || 0
        calculate_exponential_backoff(delay, attempts_made, jitter)

      %{"type" => "exponential", "delay" => delay} ->
        jitter = get_in(backoff, ["jitter"]) || 0
        calculate_exponential_backoff(delay, attempts_made, jitter)

      %{type: type, delay: delay} when is_atom(type) ->
        # Custom backoff type - return base delay
        delay

      %{"type" => _type, "delay" => delay} ->
        # Custom backoff type with string keys - return base delay
        delay

      delay when is_integer(delay) ->
        delay

      _ ->
        0
    end
  end

  # Helper to get option value with both atom and string keys
  defp get_opt(opts, atom_key, string_key, default) do
    case Map.get(opts, atom_key) do
      nil -> Map.get(opts, string_key, default)
      value -> value
    end
  end

  @doc """
  Calculates the delay before the job should be processed.

  Takes into account the job's delay option and timestamp.
  """
  @spec delay_until(t()) :: Types.timestamp_ms()
  def delay_until(%__MODULE__{timestamp: timestamp, delay: delay}) do
    timestamp + delay
  end

  @doc """
  Increments the attempts made counter.
  """
  @spec increment_attempts(t()) :: t()
  def increment_attempts(%__MODULE__{attempts_made: attempts} = job) do
    %{job | attempts_made: attempts + 1}
  end

  @doc """
  Marks the job as started processing.
  """
  @spec mark_as_active(t(), Types.lock_token()) :: t()
  def mark_as_active(%__MODULE__{} = job, token) do
    %{job | processed_on: System.system_time(:millisecond), token: token}
  end

  @doc """
  Marks the job as completed with a return value.
  """
  @spec mark_as_completed(t(), term()) :: t()
  def mark_as_completed(%__MODULE__{} = job, return_value) do
    %{job | finished_on: System.system_time(:millisecond), return_value: return_value}
  end

  @doc """
  Marks the job as failed with an error.
  """
  @spec mark_as_failed(t(), String.t(), [String.t()]) :: t()
  def mark_as_failed(%__MODULE__{stacktrace: existing} = job, reason, stacktrace \\ []) do
    %{
      job
      | finished_on: System.system_time(:millisecond),
        failed_reason: reason,
        stacktrace: [stacktrace | existing] |> List.flatten() |> Enum.take(3)
    }
  end

  @doc """
  Updates the job progress.
  """
  @spec update_progress(t(), Types.job_progress()) :: t()
  def update_progress(%__MODULE__{} = job, progress) do
    %{job | progress: progress}
  end

  @doc """
  Formats the job for logging/display.
  """
  @spec format(t()) :: String.t()
  def format(%__MODULE__{} = job) do
    "Job #{job.queue_name}:#{job.id} (#{job.name})"
  end

  # Private helpers

  defp opts_to_map(opts) when is_list(opts), do: Map.new(opts)
  defp opts_to_map(opts) when is_map(opts), do: opts

  defp build_parent_key(nil), do: nil

  defp build_parent_key(%{id: id, queue: queue} = parent) do
    prefix = Map.get(parent, :prefix, "bull")
    "#{prefix}:#{queue}:#{id}"
  end

  defp calculate_exponential_backoff(delay, attempts, jitter) when jitter > 0 do
    base_delay = trunc(:math.pow(2, attempts - 1) * delay)
    min_delay = trunc(base_delay * (1 - jitter))
    jitter_range = trunc(base_delay * jitter)
    min_delay + :rand.uniform(jitter_range + 1) - 1
  end

  defp calculate_exponential_backoff(delay, attempts, _jitter) do
    trunc(:math.pow(2, attempts - 1) * delay)
  end

  defp encode_json(nil), do: "null"
  defp encode_json(data), do: Jason.encode!(data)

  defp encode_json_or_nil(nil), do: nil
  defp encode_json_or_nil(data), do: Jason.encode!(data)

  # Encode opts map with short keys for Node.js interoperability
  defp encode_opts(nil), do: "{}"
  defp encode_opts(opts) when opts == %{}, do: "{}"

  defp encode_opts(opts) when is_map(opts) do
    encoded =
      Enum.reduce(opts, %{}, fn {key, value}, acc ->
        string_key = to_string(key)
        short_key = Map.get(@opts_encode_map, string_key, string_key)
        Map.put(acc, short_key, value)
      end)

    Jason.encode!(encoded)
  end

  # Decode opts JSON string, expanding short keys to full names
  defp decode_opts(nil), do: %{}
  defp decode_opts(""), do: %{}
  defp decode_opts("{}"), do: %{}

  defp decode_opts(str) when is_binary(str) do
    case Jason.decode(str) do
      {:ok, data} when is_map(data) ->
        Enum.reduce(data, %{}, fn {key, value}, acc ->
          full_key = Map.get(@opts_decode_map, key, key)
          Map.put(acc, full_key, value)
        end)

      {:ok, data} ->
        data

      {:error, _} ->
        %{}
    end
  end

  # ============================================
  # Manual Processing Methods
  # ============================================
  # These methods are used when manually fetching and processing jobs
  # instead of using the automatic worker processor.

  @doc """
  Moves the job to the completed state.

  This is used when manually processing jobs. The job will be marked as completed
  with the given return value.

  ## Parameters

    * `job` - The job struct (must have `connection` and `token` set)
    * `return_value` - The result to store with the completed job
    * `opts` - Options:
      * `:fetch_next` - If `true`, returns the next job data (default: `true`)
      * `:remove_on_complete` - Job removal settings

  ## Returns

    * `{:ok, nil}` - Job completed, no next job available
    * `{:ok, {job_data, job_id}}` - Job completed, next job available (when `fetch_next: true`)
    * `{:error, reason}` - Failed to move job

  ## Examples

      # Complete job and get next job
      {:ok, next} = Job.move_to_completed(job, %{result: "done"}, token)

      # Complete job without fetching next
      {:ok, nil} = Job.move_to_completed(job, %{result: "done"}, token, fetch_next: false)
  """
  @spec move_to_completed(t(), term(), String.t(), keyword()) ::
          {:ok, nil | {list(), String.t()}} | {:error, term()}
  def move_to_completed(%__MODULE__{} = job, return_value, token, opts \\ []) do
    ctx = Keys.new(job.queue_name, prefix: job.prefix)

    script_opts = [
      fetch_next: Keyword.get(opts, :fetch_next, true),
      lock_duration: Keyword.get(opts, :lock_duration, 30_000),
      remove_on_complete: Keyword.get(opts, :remove_on_complete),
      attempts: job.attempts_made
    ]

    case Scripts.move_to_completed(job.connection, ctx, job.id, token, return_value, script_opts) do
      {:ok, [job_data, job_id | _]} when is_list(job_data) and job_data != [] ->
        {:ok, {job_data, to_string(job_id)}}

      {:ok, _} ->
        {:ok, nil}

      {:error, _} = error ->
        error
    end
  end

  @doc """
  Moves the job to the failed state.

  This is used when manually processing jobs. The job will be marked as failed
  with the given error.

  ## Parameters

    * `job` - The job struct (must have `connection` and `token` set)
    * `error` - The error (can be an Exception or a string/term)
    * `token` - The lock token
    * `opts` - Options:
      * `:fetch_next` - If `true`, returns the next job data (default: `false`)
      * `:remove_on_fail` - Job removal settings

  ## Returns

    * `{:ok, nil}` - Job failed, no next job available
    * `{:ok, {job_data, job_id}}` - Job failed, next job available (when `fetch_next: true`)
    * `{:error, reason}` - Failed to move job

  ## Examples

      # Fail job
      {:ok, nil} = Job.move_to_failed(job, "Processing error", token)

      # Fail job with exception
      {:ok, nil} = Job.move_to_failed(job, %RuntimeError{message: "oops"}, token)
  """
  @spec move_to_failed(t(), term(), String.t(), keyword()) ::
          {:ok, nil | {list(), String.t()}} | {:error, term()}
  def move_to_failed(%__MODULE__{} = job, error, token, opts \\ []) do
    ctx = Keys.new(job.queue_name, prefix: job.prefix)

    error_message =
      case error do
        %{message: msg} -> msg
        msg when is_binary(msg) -> msg
        other -> inspect(other)
      end

    script_opts = [
      fetch_next: Keyword.get(opts, :fetch_next, false),
      lock_duration: Keyword.get(opts, :lock_duration, 30_000),
      remove_on_fail: Keyword.get(opts, :remove_on_fail),
      attempts: job.attempts_made
    ]

    case Scripts.move_to_failed(job.connection, ctx, job.id, token, error_message, script_opts) do
      {:ok, [job_data, job_id | _]} when is_list(job_data) and job_data != [] ->
        {:ok, {job_data, to_string(job_id)}}

      {:ok, _} ->
        {:ok, nil}

      {:error, _} = error ->
        error
    end
  end

  @doc """
  Moves the job back to the wait state.

  This is useful when you need to release a job back to the queue, for example
  when rate limiting is applied. The job will be available for processing again.

  ## Parameters

    * `job` - The job struct (must have `connection` set)
    * `token` - The lock token (use "0" if no token)

  ## Returns

    * `{:ok, pttl}` - Job moved back to wait, returns the rate limit TTL (or 0)
    * `{:error, reason}` - Failed to move job

  ## Examples

      # Move job back to wait due to rate limiting
      await Queue.rate_limit(queue, 60_000)
      {:ok, _pttl} = Job.move_to_wait(job, token)
  """
  @spec move_to_wait(t(), String.t()) :: {:ok, non_neg_integer()} | {:error, term()}
  def move_to_wait(%__MODULE__{} = job, token \\ "0") do
    ctx = Keys.new(job.queue_name, prefix: job.prefix)
    Scripts.move_job_from_active_to_wait(job.connection, ctx, job.id, token)
  end

  @doc """
  Attempts to retry the job. Only a job that has failed or completed can be retried.

  Moves the job from the completed or failed state back to the wait queue for
  reprocessing.

  ## Parameters

    * `job` - The job struct (must have `connection` set)
    * `state` - The expected current state: `:failed` (default) or `:completed`
    * `opts` - Options:
      * `:reset_attempts_made` - If `true`, resets the `attempts_made` counter to 0 (default: `false`)
      * `:reset_attempts_started` - If `true`, resets the `attempts_started` counter to 0 (default: `false`)

  ## Returns

    * `{:ok, job}` - Job successfully moved to wait queue with updated state
    * `{:error, reason}` - Failed to retry job

  ## Error Codes

    * `-1` - Job does not exist
    * `-3` - Job was not found in the expected state
  ## Examples

      # Retry a failed job
      {:ok, updated_job} = Job.retry(job)

      # Retry a completed job
      {:ok, updated_job} = Job.retry(job, :completed)

      # Retry and reset attempt counters
      {:ok, updated_job} = Job.retry(job, :failed, reset_attempts_made: true)

  """
  @spec retry(t(), atom(), keyword()) :: {:ok, t()} | {:error, term()}
  def retry(%__MODULE__{} = job, state \\ :failed, opts \\ [])
      when state in [:failed, :completed] do
    ctx = Keys.new(job.queue_name, prefix: job.prefix)

    lifo =
      case Map.fetch(job.opts, :lifo) do
        {:ok, value} -> value
        :error -> Map.get(job.opts, "lifo", false)
      end

    script_opts = [
      lifo: lifo,
      reset_attempts_made: Keyword.get(opts, :reset_attempts_made, false),
      reset_attempts_started: Keyword.get(opts, :reset_attempts_started, false)
    ]

    case Scripts.reprocess_job(job.connection, ctx, job.id, state, script_opts) do
      {:ok, 1} ->
        updated_job = %{
          job
          | failed_reason: nil,
            finished_on: nil,
            processed_on: nil,
            return_value: nil
        }

        updated_job =
          if Keyword.get(opts, :reset_attempts_made, false) do
            %{updated_job | attempts_made: 0}
          else
            updated_job
          end

        updated_job =
          if Keyword.get(opts, :reset_attempts_started, false) do
            %{updated_job | attempts_started: 0}
          else
            updated_job
          end

        {:ok, updated_job}

      {:ok, code} when is_integer(code) ->
        {:error, {:reprocess_failed, code}}

      {:error, _} = error ->
        error
    end
  end

  @doc """
  Extends the lock on a job.

  When manually processing jobs, locks are not automatically renewed.
  Call this method to extend the lock if processing takes longer than
  the lock duration.

  ## Parameters

    * `job` - The job struct (must have `connection` set)
    * `token` - The lock token
    * `duration` - Duration in milliseconds to extend the lock

  ## Returns

    * `{:ok, result}` - Lock extended successfully
    * `{:error, reason}` - Failed to extend lock

  ## Examples

      # Extend lock by 30 seconds
      {:ok, _} = Job.extend_lock(job, token, 30_000)
  """
  @spec extend_lock(t(), String.t(), non_neg_integer()) :: {:ok, term()} | {:error, term()}
  def extend_lock(%__MODULE__{} = job, token, duration) do
    ctx = Keys.new(job.queue_name, prefix: job.prefix)
    Scripts.extend_lock(job.connection, ctx, job.id, token, duration)
  end

  # ============================================
  # Flow / Dependencies Methods
  # ============================================
  # These methods are used for parent jobs in flows to access
  # their children's results and status.

  @doc """
  Gets the return values of this job's children.

  When a parent job is processed, it can access the results of all its
  completed children using this method.

  ## Parameters

    * `job` - The job struct (must have `connection` set)

  ## Returns

    * `{:ok, map}` - Map of child job keys to their return values
    * `{:error, reason}` - Failed to get children values

  ## Examples

      def process(job) do
        {:ok, children_values} = BullMQ.Job.get_children_values(job)
        # children_values: %{"bull:queue:123" => %{result: "done"}, ...}
        {:ok, aggregate(children_values)}
      end
  """
  @spec get_children_values(t()) :: {:ok, map()} | {:error, term()}
  def get_children_values(%__MODULE__{} = job) do
    ctx = Keys.new(job.queue_name, prefix: job.prefix)
    processed_key = Keys.job_processed(ctx, job.id)

    case RedisConnection.command(job.connection, ["HGETALL", processed_key]) do
      {:ok, []} ->
        {:ok, %{}}

      {:ok, data} ->
        values = parse_hash_result(data)
        {:ok, values}

      {:error, _} = error ->
        error
    end
  end

  @doc """
  Gets the failures of child jobs that were explicitly ignored.

  When using the `ignore_dependency_on_failure` option, failed children
  don't fail the parent. This method retrieves those ignored failures.

  ## Parameters

    * `job` - The job struct (must have `connection` set)

  ## Returns

    * `{:ok, map}` - Map of child job keys to their failure reasons
    * `{:error, reason}` - Failed to get ignored failures

  ## Examples

      {:ok, ignored} = BullMQ.Job.get_ignored_children_failures(job)
      # ignored: %{"bull:queue:456" => "Timeout error", ...}
  """
  @spec get_ignored_children_failures(t()) :: {:ok, map()} | {:error, term()}
  def get_ignored_children_failures(%__MODULE__{} = job) do
    ctx = Keys.new(job.queue_name, prefix: job.prefix)
    failed_key = Keys.job_failed(ctx, job.id)

    case RedisConnection.command(job.connection, ["HGETALL", failed_key]) do
      {:ok, []} ->
        {:ok, %{}}

      {:ok, data} ->
        values = parse_hash_result(data)
        {:ok, values}

      {:error, _} = error ->
        error
    end
  end

  @doc """
  Gets the pending dependencies (unprocessed children) of this job.

  Returns a list of child job keys that haven't completed yet.

  ## Parameters

    * `job` - The job struct (must have `connection` set)

  ## Returns

    * `{:ok, list}` - List of pending child job keys
    * `{:error, reason}` - Failed to get dependencies

  ## Examples

      {:ok, deps} = BullMQ.Job.get_dependencies(job)
      # deps: ["bull:queue:789", "bull:queue:790"]
  """
  @spec get_dependencies(t()) :: {:ok, [String.t()]} | {:error, term()}
  def get_dependencies(%__MODULE__{} = job) do
    ctx = Keys.new(job.queue_name, prefix: job.prefix)
    deps_key = Keys.job_dependencies(ctx, job.id)

    case RedisConnection.command(job.connection, ["SMEMBERS", deps_key]) do
      {:ok, deps} -> {:ok, deps}
      {:error, _} = error -> error
    end
  end

  @doc """
  Gets the count of pending dependencies for this job.

  ## Parameters

    * `job` - The job struct (must have `connection` set)

  ## Returns

    * `{:ok, count}` - Number of pending child jobs
    * `{:error, reason}` - Failed to get count

  ## Examples

      {:ok, count} = BullMQ.Job.get_dependencies_count(job)
      # count: 3
  """
  @spec get_dependencies_count(t()) :: {:ok, non_neg_integer()} | {:error, term()}
  def get_dependencies_count(%__MODULE__{} = job) do
    ctx = Keys.new(job.queue_name, prefix: job.prefix)
    deps_key = Keys.job_dependencies(ctx, job.id)

    case RedisConnection.command(job.connection, ["SCARD", deps_key]) do
      {:ok, count} -> {:ok, count}
      {:error, _} = error -> error
    end
  end

  # Helper to parse HGETALL result into a map with JSON-decoded values
  defp parse_hash_result(data) do
    data
    |> Enum.chunk_every(2)
    |> Enum.into(%{}, fn [k, v] ->
      value =
        case Jason.decode(v) do
          {:ok, decoded} -> decoded
          _ -> v
        end

      {k, value}
    end)
  end

  # ============================================
  # Private Functions
  # ============================================

  defp decode_json(nil), do: nil
  defp decode_json(""), do: nil

  defp decode_json(str) when is_binary(str) do
    case Jason.decode(str) do
      {:ok, data} -> data
      {:error, _} -> str
    end
  end

  defp decode_json_or_nil(nil), do: nil
  defp decode_json_or_nil(""), do: nil
  defp decode_json_or_nil(str), do: decode_json(str)

  defp decode_progress(nil), do: 0
  defp decode_progress(""), do: 0

  defp decode_progress(str) when is_binary(str) do
    case Integer.parse(str) do
      {int, ""} -> int
      _ -> decode_json(str)
    end
  end

  defp decode_stacktrace(nil), do: []
  defp decode_stacktrace(""), do: []

  defp decode_stacktrace(str) when is_binary(str) do
    case Jason.decode(str) do
      {:ok, list} when is_list(list) -> list
      _ -> []
    end
  end

  defp parse_int(str) when is_binary(str) do
    case Integer.parse(str) do
      {int, _} -> int
      :error -> 0
    end
  end

  defp parse_int(int) when is_integer(int), do: int
  defp parse_int(_), do: 0

  defp parse_int_or_nil(nil), do: nil
  defp parse_int_or_nil(""), do: nil
  defp parse_int_or_nil(str), do: parse_int(str)

  defp maybe_put(map, _key, value, default) when value == default, do: map

  defp maybe_put(map, key, value, _default) when is_integer(value),
    do: Map.put(map, key, to_string(value))

  defp maybe_put(map, key, value, _default), do: Map.put(map, key, value)
end
