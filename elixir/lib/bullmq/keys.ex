defmodule BullMQ.Keys do
  @moduledoc """
  Redis key generation for BullMQ queues.

  This module generates consistent Redis keys following the BullMQ naming convention.
  All keys follow the pattern: `{prefix}:{queue_name}:{key_type}`.

  The default prefix is "bull" for compatibility with the Node.js BullMQ library.
  """

  @default_prefix "bull"

  @typedoc "Queue key context containing prefix and name"
  @type queue_context :: %{
          prefix: String.t(),
          name: String.t()
        }

  @doc """
  Creates a new queue context for key generation.

  ## Examples

      iex> BullMQ.Keys.context("bull", "my_queue")
      %{prefix: "bull", name: "my_queue"}

      iex> BullMQ.Keys.context("my_queue")
      %{prefix: "bull", name: "my_queue"}
  """
  @spec context(String.t(), String.t()) :: queue_context()
  def context(prefix, name) do
    %{prefix: prefix, name: name}
  end

  @spec context(String.t()) :: queue_context()
  def context(name) do
    %{prefix: @default_prefix, name: name}
  end

  @doc """
  Creates a new queue context for key generation.

  Alias for `context/1` and `context/2` with keyword options.

  ## Examples

      iex> BullMQ.Keys.new("my_queue")
      %{prefix: "bull", name: "my_queue"}

      iex> BullMQ.Keys.new("my_queue", prefix: "myapp")
      %{prefix: "myapp", name: "my_queue"}
  """
  @spec new(String.t(), keyword()) :: queue_context()
  def new(name, opts \\ []) do
    %{
      prefix: Keyword.get(opts, :prefix, @default_prefix),
      name: name
    }
  end

  @doc """
  Returns the base key for a queue (without suffix).

  ## Examples

      iex> ctx = BullMQ.Keys.new("my_queue")
      iex> BullMQ.Keys.key(ctx)
      "bull:my_queue"
  """
  @spec key(queue_context()) :: String.t()
  def key(%{prefix: prefix, name: name}), do: "#{prefix}:#{name}"

  @doc """
  Returns the key prefix for building job keys (with trailing colon).

  This matches the Node.js `queueKeys['']` which is used to build job keys
  by concatenating with the job ID: `prefix:queuename:jobid`

  ## Examples

      iex> ctx = BullMQ.Keys.new("my_queue")
      iex> BullMQ.Keys.key_prefix(ctx)
      "bull:my_queue:"
  """
  @spec key_prefix(queue_context()) :: String.t()
  def key_prefix(%{prefix: prefix, name: name}), do: "#{prefix}:#{name}:"

  @doc """
  Returns the base key for a queue.

  ## Examples

      iex> ctx = BullMQ.Keys.new("my_queue")
      iex> BullMQ.Keys.base(ctx)
      "bull:my_queue"
  """
  @spec base(queue_context()) :: String.t()
  def base(%{prefix: prefix, name: name}), do: "#{prefix}:#{name}"

  @doc "Key for the waiting jobs list"
  @spec wait(queue_context()) :: String.t()
  def wait(ctx), do: "#{base(ctx)}:wait"

  @doc "Key for the active jobs list"
  @spec active(queue_context()) :: String.t()
  def active(ctx), do: "#{base(ctx)}:active"

  @doc "Key for the delayed jobs sorted set"
  @spec delayed(queue_context()) :: String.t()
  def delayed(ctx), do: "#{base(ctx)}:delayed"

  @doc "Key for the prioritized jobs sorted set"
  @spec prioritized(queue_context()) :: String.t()
  def prioritized(ctx), do: "#{base(ctx)}:prioritized"

  @doc "Key for the completed jobs sorted set"
  @spec completed(queue_context()) :: String.t()
  def completed(ctx), do: "#{base(ctx)}:completed"

  @doc "Key for the failed jobs sorted set"
  @spec failed(queue_context()) :: String.t()
  def failed(ctx), do: "#{base(ctx)}:failed"

  @doc "Get a key by name (dynamic key lookup)"
  @spec get(queue_context(), String.t()) :: String.t()
  def get(ctx, "completed"), do: completed(ctx)
  def get(ctx, "failed"), do: failed(ctx)
  def get(ctx, "wait"), do: wait(ctx)
  def get(ctx, "active"), do: active(ctx)
  def get(ctx, "delayed"), do: delayed(ctx)
  def get(ctx, "paused"), do: paused(ctx)
  def get(ctx, "prioritized"), do: prioritized(ctx)
  def get(ctx, "stalled"), do: stalled(ctx)
  def get(ctx, "limiter"), do: limiter(ctx)
  def get(ctx, "meta"), do: meta(ctx)
  def get(ctx, "events"), do: events(ctx)
  def get(ctx, "marker"), do: marker(ctx)
  def get(ctx, "pc"), do: pc(ctx)
  def get(ctx, "id"), do: id(ctx)
  def get(ctx, key), do: "#{base(ctx)}:#{key}"

  @doc "Key for the paused jobs list"
  @spec paused(queue_context()) :: String.t()
  def paused(ctx), do: "#{base(ctx)}:paused"

  @doc "Key for the waiting-children jobs sorted set"
  @spec waiting_children(queue_context()) :: String.t()
  def waiting_children(ctx), do: "#{base(ctx)}:waiting-children"

  @doc "Key for the stalled jobs set"
  @spec stalled(queue_context()) :: String.t()
  def stalled(ctx), do: "#{base(ctx)}:stalled"

  @doc "Key for the stalled check marker"
  @spec stalled_check(queue_context()) :: String.t()
  def stalled_check(ctx), do: "#{base(ctx)}:stalled-check"

  @doc "Key for the rate limiter"
  @spec limiter(queue_context()) :: String.t()
  def limiter(ctx), do: "#{base(ctx)}:limiter"

  @doc "Key for the queue metadata hash"
  @spec meta(queue_context()) :: String.t()
  def meta(ctx), do: "#{base(ctx)}:meta"

  @doc "Key for the events stream"
  @spec events(queue_context()) :: String.t()
  def events(ctx), do: "#{base(ctx)}:events"

  @doc "Key for the marker sorted set (for blocking operations)"
  @spec marker(queue_context()) :: String.t()
  def marker(ctx), do: "#{base(ctx)}:marker"

  @doc "Key for the job ID counter"
  @spec id(queue_context()) :: String.t()
  def id(ctx), do: "#{base(ctx)}:id"

  @doc "Key for the priority counter"
  @spec pc(queue_context()) :: String.t()
  def pc(ctx), do: "#{base(ctx)}:pc"

  @doc "Key for the repeatable jobs hash"
  @spec repeat(queue_context()) :: String.t()
  def repeat(ctx), do: "#{base(ctx)}:repeat"

  @doc "Key for the job schedulers (short form)"
  @spec schedulers(queue_context()) :: String.t()
  def schedulers(ctx), do: "#{base(ctx)}:sc"

  @doc "Key for the job schedulers"
  @spec job_scheduler(queue_context()) :: String.t()
  def job_scheduler(ctx), do: "#{base(ctx)}:job-scheduler"

  @doc "Key for the metrics hash"
  @spec metrics(queue_context(), String.t() | :completed | :failed) :: String.t()
  def metrics(ctx, type) when is_atom(type), do: "#{base(ctx)}:metrics:#{type}"
  def metrics(ctx, type) when is_binary(type), do: "#{base(ctx)}:metrics:#{type}"
  # Job-specific keys

  @doc "Key for a specific job hash"
  @spec job(queue_context(), String.t()) :: String.t()
  def job(ctx, job_id), do: "#{base(ctx)}:#{job_id}"

  @doc "Key for a job's lock"
  @spec lock(queue_context(), String.t()) :: String.t()
  def lock(ctx, job_id), do: "#{job(ctx, job_id)}:lock"

  @doc "Key for a job's lock (alias for lock/2)"
  @spec job_lock(queue_context(), String.t()) :: String.t()
  def job_lock(ctx, job_id), do: lock(ctx, job_id)

  @doc "Key for a job's logs list"
  @spec logs(queue_context(), String.t()) :: String.t()
  def logs(ctx, job_id), do: "#{job(ctx, job_id)}:logs"

  @doc "Key for a job's logs list (alias for logs/2)"
  @spec job_logs(queue_context(), String.t()) :: String.t()
  def job_logs(ctx, job_id), do: logs(ctx, job_id)

  @doc "Key for a job's dependencies set (child jobs)"
  @spec dependencies(queue_context(), String.t()) :: String.t()
  def dependencies(ctx, job_id), do: "#{job(ctx, job_id)}:dependencies"

  @doc "Key for a job's dependencies set (alias)"
  @spec job_dependencies(queue_context(), String.t()) :: String.t()
  def job_dependencies(ctx, job_id), do: dependencies(ctx, job_id)

  @doc "Key for a job's processed children hash"
  @spec processed(queue_context(), String.t()) :: String.t()
  def processed(ctx, job_id), do: "#{job(ctx, job_id)}:processed"

  @doc "Key for a job's processed children hash (alias)"
  @spec job_processed(queue_context(), String.t()) :: String.t()
  def job_processed(ctx, job_id), do: processed(ctx, job_id)

  @doc "Key for a job's failed children hash"
  @spec job_failed(queue_context(), String.t()) :: String.t()
  def job_failed(ctx, job_id), do: "#{job(ctx, job_id)}:failed"

  @doc "Key for a job's unsuccessful children sorted set"
  @spec job_unsuccessful(queue_context(), String.t()) :: String.t()
  def job_unsuccessful(ctx, job_id), do: "#{job(ctx, job_id)}:unsuccessful"

  @doc "Key for deduplication"
  @spec dedup(queue_context(), String.t()) :: String.t()
  def dedup(ctx, dedup_id), do: "#{base(ctx)}:de:#{dedup_id}"

  @doc """
  Returns all queue-level keys for obliteration/cleanup.
  """
  @spec all_queue_keys(queue_context()) :: [String.t()]
  def all_queue_keys(ctx) do
    [
      wait(ctx),
      active(ctx),
      delayed(ctx),
      prioritized(ctx),
      completed(ctx),
      failed(ctx),
      paused(ctx),
      waiting_children(ctx),
      stalled(ctx),
      stalled_check(ctx),
      limiter(ctx),
      meta(ctx),
      events(ctx),
      marker(ctx),
      id(ctx),
      pc(ctx),
      repeat(ctx),
      job_scheduler(ctx),
      metrics(ctx, :completed),
      metrics(ctx, :failed)
    ]
  end

  @doc """
  Returns all keys matching the queue pattern for scanning.
  """
  @spec scan_pattern(queue_context()) :: String.t()
  def scan_pattern(ctx), do: "#{base(ctx)}:*"

  @doc """
  Parses a job key to extract the job ID.

  ## Examples

      iex> BullMQ.Keys.parse_job_id("bull:my_queue:123")
      "123"
  """
  @spec parse_job_id(String.t()) :: String.t()
  def parse_job_id(key) do
    key
    |> String.split(":")
    |> List.last()
  end

  @doc """
  Extracts queue name and job ID from a full job key.

  ## Examples

      iex> BullMQ.Keys.parse_job_key("bull:my_queue:123")
      {:ok, %{prefix: "bull", queue: "my_queue", job_id: "123"}}
  """
  @spec parse_job_key(String.t()) :: {:ok, map()} | {:error, :invalid_key}
  def parse_job_key(key) do
    case String.split(key, ":") do
      [prefix, queue, job_id] ->
        {:ok, %{prefix: prefix, queue: queue, job_id: job_id}}

      _ ->
        {:error, :invalid_key}
    end
  end
end
