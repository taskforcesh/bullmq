defmodule BullMQ.Backends.Postgres.Connection do
  @moduledoc """
  Owns the PostgreSQL connection resources for the BullMQ Postgres backend,
  mirroring `BullMQ.RedisConnection`:

    * a `Postgrex` connection pool for regular queries (each pooled connection
      pins its `search_path` to the configured schema, so the portable `.sql`
      files reference unqualified names), and
    * a dedicated `Postgrex.Notifications` process used by the blocking
      "wait for job" / event-stream primitives (`LISTEN`/`NOTIFY`).

  Schema migrations are run exactly once at startup on the pool, guarded by a
  transaction-scoped advisory lock.

  ## Options
    * `:name` (required) — name to register the connection under.
    * `:url` — a `postgres://…` connection string, or
    * `:hostname`/`:port`/`:database`/`:username`/`:password` — discrete opts.
    * `:schema` — the namespace for all queues (default `"bullmq"`).
    * `:pool_size` — pool size (default `10`).
    * `:ssl` — SSL options forwarded to `Postgrex`. Accepts `true`, `false`, or a
      keyword list such as `[verify: :verify_none]` or
      `[verify: :verify_peer, cacertfile: "…"]`. When omitted, `sslmode=require`
      in the `:url` enables SSL with `verify: :verify_none`. The `verify-ca` and
      `verify-full` modes require explicit `:ssl` certificate verification options.
    * `:skip_version_check` — bypass the minimum-server-version assertion.
    * `:skip_migrations` — do not run migrations (assume already applied).
  """

  use Supervisor

  alias BullMQ.Backends.Postgres.Migrator

  @compile {:no_warn_undefined, Postgrex}
  @compile {:no_warn_undefined, Postgrex.Notifications}

  @default_pool_size 10

  @spec start_link(keyword()) :: Supervisor.on_start()
  def start_link(opts) do
    name = Keyword.fetch!(opts, :name)

    case Supervisor.start_link(__MODULE__, opts, name: sup_name(name)) do
      {:ok, pid} ->
        unless Keyword.get(opts, :skip_migrations, false) do
          schema = Keyword.get(opts, :schema, Migrator.default_schema())

          case Migrator.run_migrations(pool_name(name), schema,
                 skip_version_check: Keyword.get(opts, :skip_version_check, false)
               ) do
            {:ok, _version} -> :ok
            {:error, reason} -> raise "BullMQ.Postgres migration failed: #{inspect(reason)}"
          end
        end

        {:ok, pid}

      error ->
        error
    end
  end

  @impl true
  def init(opts) do
    name = Keyword.fetch!(opts, :name)
    schema = Keyword.get(opts, :schema, Migrator.default_schema())
    pg_opts = build_postgrex_opts(opts, schema)

    :persistent_term.put({__MODULE__, name}, %{
      pool: pool_name(name),
      notifications: notif_name(name),
      schema: schema
    })

    children = [
      Supervisor.child_spec({Postgrex, [name: pool_name(name)] ++ pg_opts}, id: :pool),
      Supervisor.child_spec(
        {Postgrex.Notifications, [name: notif_name(name)] ++ Keyword.delete(pg_opts, :pool_size)},
        id: :notifications
      )
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end

  @doc "Returns the connection context (`%{pool, notifications, schema}`) for `name`."
  @spec context(atom()) :: %{pool: term(), notifications: term(), schema: String.t()}
  def context(name), do: :persistent_term.get({__MODULE__, name})

  @doc "The Postgrex pool reference for `name`."
  def pool(name), do: pool_name(name)

  @doc "The `Postgrex.Notifications` reference for `name`."
  def notifications(name), do: notif_name(name)

  @doc "Closes the connection pool and notifications."
  @spec close(atom()) :: :ok
  def close(name) do
    :persistent_term.erase({__MODULE__, name})

    try do
      Supervisor.stop(sup_name(name), :normal, 5_000)
    catch
      :exit, _ -> :ok
    end

    :ok
  end

  # -- naming --
  defp sup_name(name), do: :"#{name}_pg_supervisor"
  defp pool_name(name), do: :"#{name}_pg_pool"
  defp notif_name(name), do: :"#{name}_pg_notifications"

  # -- opts building --
  @doc false
  # Exposed for testing; builds the keyword list passed to Postgrex.
  def build_postgrex_opts(opts, schema) do
    url = Keyword.get(opts, :url)

    base =
      case url do
        nil ->
          [
            hostname: Keyword.get(opts, :hostname, "localhost"),
            port: Keyword.get(opts, :port, 5432),
            database: Keyword.get(opts, :database, "bullmq_test"),
            username: Keyword.get(opts, :username),
            password: Keyword.get(opts, :password)
          ]

        url ->
          parse_url(url)
      end

    quoted = Migrator.quote_schema_name(schema)

    base
    |> Keyword.merge(
      pool_size: Keyword.get(opts, :pool_size, @default_pool_size),
      types: BullMQ.Backends.Postgres.PostgrexTypes,
      after_connect: fn conn ->
        Postgrex.query!(conn, "SET search_path TO #{quoted}", [])
      end
    )
    |> put_ssl(resolve_ssl(opts, url))
    |> Enum.reject(fn {_k, v} -> is_nil(v) end)
  end

  # Explicit `:ssl` wins; otherwise fall back to the URL's `sslmode`.
  defp resolve_ssl(opts, url) do
    case Keyword.fetch(opts, :ssl) do
      {:ok, ssl} ->
        case sslmode_from_url(url) do
          mode when mode in ["verify-ca", "verify-full"] ->
            unless Keyword.keyword?(ssl) and Keyword.get(ssl, :verify) == :verify_peer do
              raise ArgumentError,
                    "sslmode=#{mode} requires explicit :ssl options with verify: :verify_peer"
            end

            ssl

          _ ->
            ssl
        end

      :error ->
        ssl_from_url(url)
    end
  end

  defp ssl_from_url(nil), do: nil

  defp ssl_from_url(url) do
    case sslmode_from_url(url) do
      "require" ->
        [verify: :verify_none]

      mode when mode in ["verify-ca", "verify-full"] ->
        raise ArgumentError,
              "sslmode=#{mode} requires explicit :ssl options with verify: :verify_peer"

      _ ->
        nil
    end
  end

  defp sslmode_from_url(nil), do: nil

  defp sslmode_from_url(url) do
    query = URI.parse(url).query
    is_binary(query) && URI.decode_query(query)["sslmode"]
  end

  # nil means "not configured" — leave Postgrex opts untouched (no SSL).
  defp put_ssl(pg_opts, nil), do: pg_opts
  defp put_ssl(pg_opts, ssl), do: Keyword.put(pg_opts, :ssl, ssl)

  defp parse_url(url) do
    uri = URI.parse(url)

    {username, password} =
      case uri.userinfo do
        nil ->
          {nil, nil}

        info ->
          case String.split(info, ":", parts: 2) do
            [u, p] -> {u, p}
            [u] -> {u, nil}
          end
      end

    database =
      case uri.path do
        nil -> nil
        "/" <> db -> db
        _ -> nil
      end

    [
      hostname: uri.host || "localhost",
      port: uri.port || 5432,
      database: database,
      username: username,
      password: password
    ]
  end
end
