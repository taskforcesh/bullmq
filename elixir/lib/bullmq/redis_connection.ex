defmodule BullMQ.RedisConnection do
  @moduledoc """
  Redis connection management for BullMQ.

  This module provides a supervised Redis connection pool using NimblePool.
  It handles connection lifecycle, reconnection, and provides a clean API
  for executing Redis commands.

  ## Connection Behavior

  This module follows the same philosophy as Redix:

    * **Supervised connections** - Connections are started under a supervisor and
      automatically reconnect when the TCP connection drops.

    * **Fail-fast** - Commands fail immediately with `{:error, reason}` if the
      connection is unavailable. No hidden retries are performed.

    * **Caller handles retries** - It's the caller's responsibility to decide
      whether to retry failed commands. BullMQ's Worker handles retries for
      job processing automatically.

  This design follows Erlang/OTP principles: let the connection supervision
  handle reconnection, and let callers decide retry policy based on their
  specific needs.

  ## Error Handling

  Commands return `{:error, reason}` on failure. Common errors include:

    * `%Redix.ConnectionError{reason: :closed}` - Connection is down
    * `%Redix.ConnectionError{reason: :timeout}` - Command timed out
    * `%Redix.Error{}` - Redis returned an error (e.g., wrong type)

  Example handling:

      case BullMQ.RedisConnection.command(conn, ["GET", "key"]) do
        {:ok, value} -> value
        {:error, %Redix.ConnectionError{}} -> :connection_error
        {:error, %Redix.Error{message: msg}} -> {:redis_error, msg}
        {:error, reason} -> {:error, reason}
      end

  ## Usage

  Add to your supervision tree:

      children = [
        {BullMQ.RedisConnection,
          name: :bullmq_redis,
          url: "redis://localhost:6379",
          pool_size: 10}
      ]

  Then use it with queues and workers:

      BullMQ.Queue.add("my_queue", "job", %{}, connection: :bullmq_redis)

  ## Lua Script Loading

  BullMQ uses Lua scripts for atomic Redis operations. All scripts are
  automatically loaded into Redis's script cache when the connection starts.
  This ensures the connection is fully ready for BullMQ operations (Worker,
  Queue, QueueEvents, etc.) before it's used.

  Unlike Node.js BullMQ which uses ioredis's `defineCommand` to register scripts
  on the client, the Elixir version loads scripts via `SCRIPT LOAD` during
  initialization and uses `EVALSHA` for execution with automatic `EVAL` fallback
  on `NOSCRIPT` errors (in case Redis was restarted and lost its script cache).

  ## Options

    * `:name` - The name to register the connection pool (required)
    * `:url` - Redis URL (e.g., "redis://localhost:6379")
    * `:host` - Redis host (default: "localhost")
    * `:port` - Redis port (default: 6379)
    * `:password` - Redis password (optional)
    * `:database` - Redis database number (default: 0)
    * `:pool_size` - Number of connections in the pool (default: 10)
    * `:ssl` - Enable SSL (default: false)
    * `:socket_opts` - Additional socket options
    * `:timeout` - Connection timeout in ms (default: 5000)
  """

  use Supervisor

  require Logger

  alias BullMQ.RedisConnection.Pool
  alias BullMQ.Scripts

  @default_pool_size 10
  @default_timeout 5000
  @minimum_redis_version {6, 2, 0}

  @type connection :: atom() | pid()
  @type command :: [binary() | integer()]
  @type pipeline :: [command()]

  @doc """
  Starts the Redis connection pool.
  """
  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts) do
    name = Keyword.fetch!(opts, :name)

    case Supervisor.start_link(__MODULE__, opts, name: Pool.supervisor_name(name)) do
      {:ok, pid} ->
        # Check Redis version before loading scripts
        check_redis_version!(name)
        # Load scripts synchronously - connection isn't ready until scripts are loaded
        load_scripts(name)
        {:ok, pid}

      error ->
        error
    end
  end

  @impl true
  def init(opts) do
    name = Keyword.fetch!(opts, :name)
    pool_size = Keyword.get(opts, :pool_size, @default_pool_size)
    redis_opts = build_redis_opts(opts)

    # Store redis_opts in persistent_term for later retrieval (dedicated connections)
    :persistent_term.put({__MODULE__, :redis_opts, name}, redis_opts)

    children = [
      # Main connection pool for commands
      {NimblePool,
       worker: {Pool.Worker, redis_opts}, pool_size: pool_size, name: Pool.pool_name(name)},

      # Registry for tracking blocking connections
      {Registry, keys: :unique, name: Pool.registry_name(name)}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end

  @doc """
  Closes the Redis connection pool.
  """
  @spec close(connection(), timeout()) :: :ok | {:error, term()}
  def close(conn, timeout \\ 5000) do
    # Clean up persistent_term entries
    :persistent_term.erase({__MODULE__, :redis_opts, conn})

    # Stop the supervisor
    sup_name = Pool.supervisor_name(conn)

    try do
      Supervisor.stop(sup_name, :normal, timeout)
    catch
      :exit, _ -> :ok
    end

    :ok
  end

  # Checks that Redis version meets minimum requirements (6.2+)
  # Required for BZPOPMIN float timeout support and other features
  defp check_redis_version!(conn) do
    case command(conn, ["INFO", "server"]) do
      {:ok, info} ->
        version = parse_redis_version(info)

        if version_lt?(version, @minimum_redis_version) do
          {min_major, min_minor, _} = @minimum_redis_version
          {major, minor, patch} = version

          raise ArgumentError,
                "BullMQ requires Redis version #{min_major}.#{min_minor}.0 or higher. " <>
                  "Current version: #{major}.#{minor}.#{patch}"
        end

        :ok

      {:error, reason} ->
        Logger.warning(
          "BullMQ: Could not check Redis version for #{inspect(conn)}: #{inspect(reason)}. " <>
            "Proceeding without version check."
        )

        :ok
    end
  end

  # Parses Redis version from INFO server output
  defp parse_redis_version(info) when is_binary(info) do
    case Regex.run(~r/redis_version:([\d.]+)/, info) do
      [_, version_str] ->
        parts =
          version_str
          |> String.split(".")
          |> Enum.take(3)
          |> Enum.map(&String.to_integer/1)

        case parts do
          [major, minor, patch] -> {major, minor, patch}
          [major, minor] -> {major, minor, 0}
          [major] -> {major, 0, 0}
          _ -> {0, 0, 0}
        end

      _ ->
        {0, 0, 0}
    end
  end

  defp parse_redis_version(_), do: {0, 0, 0}

  # Compares two version tuples, returns true if v1 < v2
  defp version_lt?({maj1, min1, patch1}, {maj2, min2, patch2}) do
    cond do
      maj1 < maj2 -> true
      maj1 > maj2 -> false
      min1 < min2 -> true
      min1 > min2 -> false
      patch1 < patch2 -> true
      true -> false
    end
  end

  # Loads all BullMQ Lua scripts into Redis script cache.
  # Called once during initialization - scripts are cached server-side in Redis,
  # so all pool connections can use EVALSHA to execute them efficiently.
  defp load_scripts(conn) do
    scripts = Scripts.list_scripts()

    # Use pipeline for efficiency - load all scripts in one round trip
    commands =
      Enum.map(scripts, fn script_name ->
        case Scripts.get(script_name) do
          {content, _key_count} -> ["SCRIPT", "LOAD", content]
          nil -> nil
        end
      end)
      |> Enum.reject(&is_nil/1)

    case pipeline(conn, commands) do
      {:ok, _shas} ->
        Logger.debug(
          "BullMQ: Loaded #{length(commands)} Lua scripts into Redis cache for #{inspect(conn)}"
        )

        :ok

      {:error, reason} ->
        Logger.warning(
          "BullMQ: Failed to pre-load scripts for #{inspect(conn)}: #{inspect(reason)}. " <>
            "Scripts will be loaded on first use via EVAL fallback."
        )

        :ok
    end
  end

  @doc """
  Executes a Redis command.

  ## Examples

      BullMQ.RedisConnection.command(:my_redis, ["SET", "key", "value"])
      #=> {:ok, "OK"}

      BullMQ.RedisConnection.command(:my_redis, ["GET", "key"])
      #=> {:ok, "value"}
  """
  @spec command(connection(), command(), keyword()) :: {:ok, term()} | {:error, term()}
  def command(conn, command, opts \\ [])

  def command({:dedicated, redix_pid}, command, opts) do
    timeout = Keyword.get(opts, :timeout, @default_timeout)
    Redix.command(redix_pid, command, timeout: timeout)
  rescue
    e -> {:error, e}
  end

  def command(conn, command, opts) do
    timeout = Keyword.get(opts, :timeout, @default_timeout)

    NimblePool.checkout!(
      Pool.pool_name(conn),
      :checkout,
      fn _from, redix ->
        result = Redix.command(redix, command, timeout: timeout)
        {result, redix}
      end,
      timeout
    )
  rescue
    e -> {:error, e}
  catch
    :exit, reason -> {:error, {:exit, reason}}
  end

  @doc """
  Executes a Redis command, raising on error.
  """
  @spec command!(connection(), command(), keyword()) :: term()
  def command!(conn, command, opts \\ []) do
    case command(conn, command, opts) do
      {:ok, result} -> result
      {:error, error} -> raise error
    end
  end

  @doc """
  Executes a pipeline of Redis commands.

  ## Examples

      BullMQ.RedisConnection.pipeline(:my_redis, [
        ["SET", "key1", "value1"],
        ["SET", "key2", "value2"],
        ["GET", "key1"]
      ])
      #=> {:ok, ["OK", "OK", "value1"]}
  """
  @spec pipeline(connection(), pipeline(), keyword()) :: {:ok, [term()]} | {:error, term()}
  def pipeline(conn, commands, opts \\ [])

  def pipeline({:dedicated, redix_pid}, commands, opts) do
    timeout = Keyword.get(opts, :timeout, @default_timeout)
    Redix.pipeline(redix_pid, commands, timeout: timeout)
  rescue
    e -> {:error, e}
  end

  def pipeline(conn, commands, opts) do
    timeout = Keyword.get(opts, :timeout, @default_timeout)

    NimblePool.checkout!(
      Pool.pool_name(conn),
      :checkout,
      fn _from, redix ->
        result = Redix.pipeline(redix, commands, timeout: timeout)
        {result, redix}
      end,
      timeout
    )
  rescue
    e -> {:error, e}
  catch
    :exit, reason -> {:error, {:exit, reason}}
  end

  @doc """
  Executes a pipeline, raising on error.
  """
  @spec pipeline!(connection(), pipeline(), keyword()) :: [term()]
  def pipeline!(conn, commands, opts \\ []) do
    case pipeline(conn, commands, opts) do
      {:ok, results} -> results
      {:error, error} -> raise error
    end
  end

  @doc """
  Executes multiple commands in a Redis transaction (MULTI/EXEC).

  All commands are executed atomically - either all succeed or none do.
  Returns `{:ok, results}` where results is a list of command results,
  or `{:error, reason}` if the transaction fails.

  ## Examples

      BullMQ.RedisConnection.transaction(:my_redis, [
        ["SET", "key1", "value1"],
        ["SET", "key2", "value2"],
        ["GET", "key1"]
      ])
      #=> {:ok, ["OK", "OK", "value1"]}
  """
  @spec transaction(connection(), pipeline(), keyword()) :: {:ok, [term()]} | {:error, term()}
  def transaction(conn, commands, opts \\ []) do
    timeout = Keyword.get(opts, :timeout, @default_timeout)

    # Wrap commands in MULTI/EXEC
    transaction_commands = [["MULTI"]] ++ commands ++ [["EXEC"]]

    NimblePool.checkout!(
      Pool.pool_name(conn),
      :checkout,
      fn _from, redix ->
        result = Redix.pipeline(redix, transaction_commands, timeout: timeout)
        {result, redix}
      end,
      timeout
    )
    |> case do
      {:ok, results} ->
        # Results are: ["OK" (MULTI), "QUEUED", "QUEUED", ..., [actual_results] (EXEC)]
        # The last element is the EXEC result which contains all the actual results
        case List.last(results) do
          nil ->
            # Transaction was aborted (e.g., WATCH failed)
            {:error, :transaction_aborted}

          exec_results when is_list(exec_results) ->
            # Check for errors in results
            errors = Enum.filter(exec_results, &match?(%Redix.Error{}, &1))

            if Enum.empty?(errors) do
              {:ok, exec_results}
            else
              {:error, {:transaction_errors, exec_results}}
            end

          %Redix.Error{} = error ->
            {:error, error}
        end

      {:error, reason} ->
        {:error, reason}
    end
  rescue
    e -> {:error, e}
  catch
    :exit, reason -> {:error, {:exit, reason}}
  end

  @doc """
  Executes a Lua script.

  ## Examples

      BullMQ.RedisConnection.eval(:my_redis, "return KEYS[1]", ["mykey"], [])
      #=> {:ok, "mykey"}
  """
  @spec eval(connection(), String.t(), [String.t()], [term()], keyword()) ::
          {:ok, term()} | {:error, term()}
  def eval(conn, script, keys, args, opts \\ []) do
    timeout = Keyword.get(opts, :timeout, @default_timeout)
    num_keys = length(keys)
    command = ["EVAL", script, num_keys | keys ++ stringify_args(args)]

    NimblePool.checkout!(
      Pool.pool_name(conn),
      :checkout,
      fn _from, redix ->
        result = Redix.command(redix, command, timeout: timeout)
        {result, redix}
      end,
      timeout
    )
  rescue
    e -> {:error, e}
  catch
    :exit, reason -> {:error, {:exit, reason}}
  end

  @doc """
  Executes a Lua script using EVALSHA (cached script).
  Falls back to EVAL if the script is not cached.
  """
  @spec evalsha(connection(), String.t(), String.t(), [String.t()], [term()], keyword()) ::
          {:ok, term()} | {:error, term()}
  def evalsha(conn, sha, script, keys, args, opts \\ []) do
    timeout = Keyword.get(opts, :timeout, @default_timeout)
    num_keys = length(keys)
    command = ["EVALSHA", sha, num_keys | keys ++ stringify_args(args)]

    NimblePool.checkout!(
      Pool.pool_name(conn),
      :checkout,
      fn _from, redix ->
        case Redix.command(redix, command, timeout: timeout) do
          {:error, %Redix.Error{message: "NOSCRIPT" <> _}} ->
            # Script not cached, use EVAL
            eval_command = ["EVAL", script, num_keys | keys ++ stringify_args(args)]
            result = Redix.command(redix, eval_command, timeout: timeout)
            {result, redix}

          result ->
            {result, redix}
        end
      end,
      timeout
    )
  rescue
    e -> {:error, e}
  catch
    :exit, reason -> {:error, {:exit, reason}}
  end

  @doc """
  Creates a dedicated blocking connection for operations like BRPOPLPUSH or BZPOPMIN.

  Returns a connection that can be used for blocking operations without
  affecting the main pool.
  """
  @spec blocking_connection(connection(), keyword()) :: {:ok, pid()} | {:error, term()}
  def blocking_connection(conn, opts \\ []) do
    redis_opts = get_redis_opts(conn)

    case Redix.start_link(redis_opts ++ opts) do
      {:ok, pid} ->
        # Register the blocking connection
        Registry.register(Pool.registry_name(conn), {:blocking, self()}, pid)
        {:ok, pid}

      error ->
        error
    end
  end

  @doc """
  Closes a blocking connection.
  """
  @spec close_blocking(connection(), pid()) :: :ok
  def close_blocking(conn, pid) do
    Registry.unregister(Pool.registry_name(conn), {:blocking, self()})

    # Safely stop the Redix connection
    if Process.alive?(pid) do
      try do
        Redix.stop(pid)
      catch
        :exit, _ -> :ok
      end
    end

    :ok
  rescue
    _ -> :ok
  end

  @doc """
  Disconnects a blocking connection for reconnection.
  """
  @spec disconnect_blocking(pid()) :: :ok
  def disconnect_blocking(pid) do
    # Send a command to interrupt blocking
    try do
      Redix.command(pid, ["CLIENT", "UNBLOCK", "self"], timeout: 100)
    rescue
      _ -> :ok
    end

    :ok
  end

  @doc """
  Sets the Redis client name on a connection or pid.
  """
  @spec set_client_name(connection() | pid(), String.t()) :: :ok | {:error, term()}
  def set_client_name(conn, name) when is_pid(conn) do
    case Redix.command(conn, ["CLIENT", "SETNAME", name]) do
      {:ok, _} -> :ok
      {:error, _} = error -> error
    end
  end

  def set_client_name(conn, name) do
    case command(conn, ["CLIENT", "SETNAME", name]) do
      {:ok, _} -> :ok
      {:error, _} = error -> error
    end
  end

  @doc """
  Gets the underlying redis options for creating new connections.
  """
  @spec get_redis_opts(connection()) :: keyword()
  def get_redis_opts(conn) do
    # Retrieve opts from persistent_term (stored during init)
    case :persistent_term.get({__MODULE__, :redis_opts, conn}, nil) do
      nil -> []
      opts -> opts
    end
  end

  # Private helpers

  defp build_redis_opts(opts) do
    base_opts =
      cond do
        Keyword.has_key?(opts, :url) ->
          parse_redis_url(Keyword.get(opts, :url))

        true ->
          [
            host: Keyword.get(opts, :host, "localhost"),
            port: Keyword.get(opts, :port, 6379),
            password: Keyword.get(opts, :password),
            database: Keyword.get(opts, :database, 0)
          ]
      end

    base_opts
    |> Keyword.merge(
      ssl: Keyword.get(opts, :ssl, false),
      # Add reuseaddr to help with rapid connection cycling in tests
      socket_opts: [{:reuseaddr, true} | Keyword.get(opts, :socket_opts, [])],
      timeout: Keyword.get(opts, :timeout, @default_timeout),
      # Use sync_connect: true to ensure connection is established before returning.
      # This is required for reliable script loading and immediate command execution.
      sync_connect: true
    )
    |> Keyword.reject(fn {_k, v} -> is_nil(v) end)
  end

  defp parse_redis_url(url) when is_binary(url) do
    uri = URI.parse(url)

    # Parse host and port
    host = uri.host || "localhost"
    port = uri.port || 6379

    # Parse password from userinfo (format: user:password or just password)
    password =
      case uri.userinfo do
        nil ->
          nil

        userinfo ->
          case String.split(userinfo, ":", parts: 2) do
            [_, pass] -> pass
            [pass] -> pass
          end
      end

    # Parse database from path (e.g., /0 for database 0)
    database =
      case uri.path do
        nil ->
          0

        "" ->
          0

        "/" ->
          0

        "/" <> db_str ->
          case Integer.parse(db_str) do
            {db, _} -> db
            :error -> 0
          end
      end

    [host: host, port: port, password: password, database: database]
  end

  defp parse_redis_url(_), do: [host: "localhost", port: 6379]

  defp stringify_args(args) do
    Enum.map(args, fn
      arg when is_binary(arg) -> arg
      arg when is_integer(arg) -> Integer.to_string(arg)
      arg when is_float(arg) -> Float.to_string(arg)
      arg when is_atom(arg) -> Atom.to_string(arg)
      arg -> inspect(arg)
    end)
  end
end
