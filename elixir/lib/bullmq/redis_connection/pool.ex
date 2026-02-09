defmodule BullMQ.RedisConnection.Pool do
  @moduledoc false

  @spec pool_name(atom() | pid() | String.t()) :: atom()
  def pool_name(name) when is_atom(name), do: :"#{name}_pool"
  def pool_name(name), do: :"#{name}_pool"

  @spec supervisor_name(atom() | pid() | String.t()) :: atom()
  def supervisor_name(name) when is_atom(name), do: :"#{name}_sup"
  def supervisor_name(name), do: :"#{name}_sup"

  @spec registry_name(atom() | pid() | String.t()) :: atom()
  def registry_name(name) when is_atom(name), do: :"#{name}_registry"
  def registry_name(name), do: :"#{name}_registry"

  # NimblePool worker implementation
  defmodule Worker do
    @moduledoc false

    @behaviour NimblePool

    # Max retries for transient connection errors (e.g., eaddrnotavail)
    @max_init_retries 5
    @init_retry_base_delay 100

    @impl NimblePool
    def init_worker(redis_opts) do
      # Retry with backoff for transient errors like eaddrnotavail
      case start_link_with_retry(redis_opts, @max_init_retries) do
        {:ok, pid} -> {:ok, pid, redis_opts}
        {:error, reason} -> raise "Failed to connect to Redis: #{inspect(reason)}"
      end
    end

    defp start_link_with_retry(redis_opts, retries_left, attempt \\ 1) do
      case Redix.start_link(redis_opts) do
        {:ok, pid} ->
          {:ok, pid}

        {:error, %Redix.ConnectionError{reason: reason}} = _error
        when reason in [:eaddrnotavail, :econnrefused, :timeout] and retries_left > 0 ->
          # Transient error - wait and retry with exponential backoff
          delay = @init_retry_base_delay * attempt
          Process.sleep(delay)
          start_link_with_retry(redis_opts, retries_left - 1, attempt + 1)

        {:error, _reason} = error ->
          error
      end
    end

    @impl NimblePool
    def handle_checkout(:checkout, _from, pid, pool_state) do
      if Process.alive?(pid) do
        {:ok, pid, pid, pool_state}
      else
        # Recovery: create new connection
        case Redix.start_link(pool_state) do
          {:ok, new_pid} -> {:ok, new_pid, new_pid, pool_state}
          {:error, _reason} -> {:remove, :connection_failed, pool_state}
        end
      end
    end

    @impl NimblePool
    def handle_checkin(pid, _from, _old_pid, pool_state) do
      if Process.alive?(pid) do
        {:ok, pid, pool_state}
      else
        # Recovery: create new connection
        case Redix.start_link(pool_state) do
          {:ok, new_pid} -> {:ok, new_pid, pool_state}
          {:error, _reason} -> {:remove, pool_state}
        end
      end
    end

    @impl NimblePool
    def terminate_worker(_reason, pid, pool_state) do
      Redix.stop(pid)
      {:ok, pool_state}
    rescue
      _ -> {:ok, pool_state}
    end

    @impl NimblePool
    def handle_ping(_pid, pool_state) do
      {:ok, pool_state}
    end
  end
end
