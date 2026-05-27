defmodule BullMQ.Backoff do
  @moduledoc """
  Backoff strategies for job retries.

  BullMQ supports various backoff strategies to control the delay between
  retry attempts when jobs fail.

  ## Built-in Strategies

    * `:fixed` - Fixed delay between retries
    * `:exponential` - Exponentially increasing delay

  ## Configuration

      # Fixed backoff - 5 second delay between retries
      BullMQ.Queue.add("my_queue", "job", %{},
        connection: :redis,
        attempts: 3,
        backoff: %{type: :fixed, delay: 5_000}
      )

      # Exponential backoff - delays of 1s, 2s, 4s, 8s, etc.
      BullMQ.Queue.add("my_queue", "job", %{},
        connection: :redis,
        attempts: 5,
        backoff: %{type: :exponential, delay: 1_000}
      )

      # Exponential with jitter
      BullMQ.Queue.add("my_queue", "job", %{},
        connection: :redis,
        attempts: 5,
        backoff: %{type: :exponential, delay: 1_000, jitter: 0.2}
      )

  ## Custom Strategies

  You can register custom backoff strategies:

      # Register a custom strategy
      BullMQ.Backoff.register(:linear, fn attempt, delay, _error, _job ->
        attempt * delay
      end)

      # Use it
      BullMQ.Queue.add("my_queue", "job", %{},
        connection: :redis,
        attempts: 5,
        backoff: %{type: :linear, delay: 1_000}
      )
  """

  use Agent

  @type strategy :: :fixed | :exponential | atom()
  @type backoff_fn :: (non_neg_integer(), non_neg_integer(), term(), map() -> non_neg_integer())

  @doc """
  Starts the backoff strategy registry.

  This is automatically started by the BullMQ application.
  """
  @spec start_link(keyword()) :: Agent.on_start()
  def start_link(_opts \\ []) do
    Agent.start_link(fn -> %{} end, name: __MODULE__)
  end

  @doc """
  Registers a custom backoff strategy.

  ## Parameters

    * `name` - Strategy name (atom)
    * `fun` - Function that calculates delay: `(attempt, base_delay, error, job) -> delay_ms`

  ## Examples

      BullMQ.Backoff.register(:linear, fn attempt, delay, _error, _job ->
        attempt * delay
      end)

      BullMQ.Backoff.register(:custom, fn attempt, delay, error, job ->
        case error do
          %{retryable: false} -> 0  # Don't retry
          _ -> delay * attempt * 2
        end
      end)
  """
  @spec register(atom(), backoff_fn()) :: :ok
  def register(name, fun) when is_atom(name) and is_function(fun, 4) do
    Agent.update(__MODULE__, fn strategies ->
      Map.put(strategies, name, fun)
    end)
  end

  @doc """
  Unregisters a custom backoff strategy.
  """
  @spec unregister(atom()) :: :ok
  def unregister(name) when is_atom(name) do
    Agent.update(__MODULE__, fn strategies ->
      Map.delete(strategies, name)
    end)
  end

  @doc """
  Calculates the backoff delay for a given attempt.

  ## Parameters

    * `strategy` - Backoff strategy (`:fixed`, `:exponential`, or custom)
    * `attempt` - Current attempt number (1-based)
    * `base_delay` - Base delay in milliseconds
    * `opts` - Additional options (`:jitter`, etc.)
    * `error` - The error that caused the retry (optional)
    * `job` - The job being retried (optional)

  ## Returns

  Returns the delay in milliseconds.

  ## Examples

      BullMQ.Backoff.calculate(:fixed, 3, 1000)
      #=> 1000

      BullMQ.Backoff.calculate(:exponential, 3, 1000)
      #=> 4000

      BullMQ.Backoff.calculate(:exponential, 3, 1000, jitter: 0.2)
      #=> ~4000 (with +/- 20% randomness)
  """
  @spec calculate(strategy(), non_neg_integer(), non_neg_integer(), keyword()) ::
          non_neg_integer()
  def calculate(strategy, attempt, base_delay, opts \\ [])

  def calculate(:fixed, _attempt, base_delay, opts) do
    jitter = Keyword.get(opts, :jitter, 0)
    apply_jitter(base_delay, jitter)
  end

  def calculate(:exponential, attempt, base_delay, opts) do
    jitter = Keyword.get(opts, :jitter, 0)
    delay = trunc(:math.pow(2, attempt - 1) * base_delay)
    apply_jitter(delay, jitter)
  end

  def calculate(strategy, attempt, base_delay, opts) when is_atom(strategy) do
    error = Keyword.get(opts, :error)
    job = Keyword.get(opts, :job)

    case get_custom_strategy(strategy) do
      nil ->
        # Unknown strategy, fall back to fixed
        base_delay

      fun ->
        fun.(attempt, base_delay, error, job)
    end
  end

  @doc """
  Calculates backoff from a backoff configuration map.

  ## Examples

      config = %{type: :exponential, delay: 1000, jitter: 0.1}
      BullMQ.Backoff.calculate_from_config(config, 3)
      #=> ~4000
  """
  @spec calculate_from_config(map(), non_neg_integer(), keyword()) :: non_neg_integer()
  def calculate_from_config(config, attempt, opts \\ [])

  def calculate_from_config(nil, _attempt, _opts), do: 0

  def calculate_from_config(%{type: type, delay: delay} = config, attempt, opts) do
    jitter = Map.get(config, :jitter, 0)
    merged_opts = Keyword.merge(opts, jitter: jitter)
    calculate(type, attempt, delay, merged_opts)
  end

  def calculate_from_config(%{delay: delay}, _attempt, _opts), do: delay

  def calculate_from_config(delay, _attempt, _opts) when is_integer(delay), do: delay

  def calculate_from_config(_, _attempt, _opts), do: 0

  # Private functions

  defp get_custom_strategy(name) do
    try do
      Agent.get(__MODULE__, fn strategies -> Map.get(strategies, name) end)
    catch
      :exit, _ -> nil
    end
  end

  defp apply_jitter(delay, 0), do: delay

  defp apply_jitter(delay, jitter) when is_float(jitter) and jitter == 0.0, do: delay

  defp apply_jitter(delay, jitter) when jitter > 0 and jitter <= 1 do
    min_delay = trunc(delay * (1 - jitter))
    jitter_range = trunc(delay * jitter * 2)
    min_delay + :rand.uniform(jitter_range + 1) - 1
  end

  defp apply_jitter(delay, _), do: delay
end
