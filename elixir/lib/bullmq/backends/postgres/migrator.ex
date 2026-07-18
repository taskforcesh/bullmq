defmodule BullMQ.Backends.Postgres.Migrator do
  @moduledoc """
  Runs the PostgreSQL backend's schema migrations, mirroring the Node.js
  `migrator.ts`.

  All objects are created in `schema` (default `#{"bullmq"}`), the
  connection-level namespace that replaces Redis's per-queue key prefix. The
  whole run happens inside a single transaction guarded by a transaction-scoped
  advisory lock, so concurrent starters across processes migrate exactly once.
  """

  alias BullMQ.Backends.Postgres.SqlLoader

  require Logger

  @default_schema "bullmq"

  # Stable advisory-lock key; the integer spells `BULL` (0x42554c4c). Shared
  # verbatim with the other language ports so they use the same lock.
  @migration_advisory_lock_key 0x42554C4C

  @minimum_postgres_version 13
  @recommended_postgres_version 14

  # Ordered migrations bundled with this build. Append new entries; never edit
  # or reorder existing ones.
  @migrations [
    {1, "0001_schema.sql"},
    {2, "0002_functions.sql"}
  ]

  @latest_schema_version 2

  @doc "The default schema (namespace) the backend lives in."
  def default_schema, do: @default_schema

  @doc "The highest schema version this build knows how to produce."
  def latest_schema_version, do: @latest_schema_version

  @doc """
  Validates a schema name and returns it double-quoted for safe DDL
  interpolation (schema names cannot be bind parameters).
  """
  @spec quote_schema_name(String.t()) :: String.t()
  def quote_schema_name(schema) do
    if Regex.match?(~r/^[A-Za-z_][A-Za-z0-9_$]*$/, schema) and byte_size(schema) <= 63 do
      ~s("#{schema}")
    else
      raise ArgumentError,
            "BullMQ: invalid PostgreSQL schema name #{inspect(schema)}. " <>
              "Use a simple identifier (letters, digits, underscores; max 63 chars)."
    end
  end

  @doc """
  Verifies the server meets the minimum major version (raises otherwise) and
  warns once when below the recommended version. No-op when `skip_version_check`.
  """
  @spec assert_postgres_version(term(), boolean()) :: :ok
  def assert_postgres_version(_pool, true), do: :ok

  def assert_postgres_version(pool, _skip) do
    %{rows: [[num, ver]]} =
      Postgrex.query!(
        pool,
        "SELECT current_setting('server_version_num') AS num, " <>
          "current_setting('server_version') AS ver",
        []
      )

    major = div(String.to_integer(num), 10_000)

    cond do
      major < @minimum_postgres_version ->
        raise "BullMQ: the PostgreSQL backend requires server version " <>
                "#{@minimum_postgres_version} or newer, but the server reports #{ver}. " <>
                "Upgrade PostgreSQL, or pass `skip_version_check: true` to bypass."

      major < @recommended_postgres_version ->
        Logger.warning(
          "BullMQ: PostgreSQL #{@recommended_postgres_version} or newer is recommended " <>
            "for the PostgreSQL backend (detected #{ver})."
        )

        :ok

      true ->
        :ok
    end
  end

  @doc """
  Runs pending migrations for `schema`, returning the resulting schema version.

  Runs inside a single Postgrex transaction guarded by a transaction-scoped
  advisory lock (serializing concurrent migrators for this schema).
  """
  @spec run_migrations(term(), String.t(), keyword()) :: {:ok, integer()} | {:error, term()}
  def run_migrations(pool, schema \\ @default_schema, opts \\ []) do
    quoted_schema = quote_schema_name(schema)
    assert_postgres_version(pool, Keyword.get(opts, :skip_version_check, false))

    Postgrex.transaction(
      pool,
      fn conn ->
        # Serialize concurrent migrators for THIS schema (released on commit/rollback).
        Postgrex.query!(conn, "SELECT pg_advisory_xact_lock($1, hashtext($2))", [
          @migration_advisory_lock_key,
          schema
        ])

        Postgrex.query!(conn, "CREATE SCHEMA IF NOT EXISTS #{quoted_schema}", [])
        Postgrex.query!(conn, "SET LOCAL search_path TO #{quoted_schema}", [])

        ensure_ledger_table(conn)
        current = current_schema_version(conn)

        if current > @latest_schema_version do
          Postgrex.rollback(
            conn,
            {:schema_version_mismatch, current, @latest_schema_version}
          )
        end

        if current < @latest_schema_version do
          Enum.each(@migrations, fn {version, file} ->
            if version > current, do: apply_migration(conn, version, file)
          end)
        end

        max(current, @latest_schema_version)
      end,
      timeout: :timer.seconds(60)
    )
  end

  defp ensure_ledger_table(conn) do
    Postgrex.query!(
      conn,
      "CREATE TABLE IF NOT EXISTS bullmq_migration (" <>
        "version integer PRIMARY KEY, name text NOT NULL, " <>
        "applied_at timestamptz NOT NULL DEFAULT now())",
      []
    )
  end

  defp current_schema_version(conn) do
    %{rows: [[version]]} =
      Postgrex.query!(
        conn,
        "SELECT COALESCE(MAX(version), 0)::int AS version FROM bullmq_migration",
        []
      )

    version
  end

  defp apply_migration(conn, version, file) do
    sql = SqlLoader.load_migration(file)

    # Postgrex uses the extended protocol (one statement per call), so split the
    # migration into top-level statements. The splitter is dollar-quote aware
    # (PL/pgSQL function bodies contain `;`), and skips single-quoted strings and
    # comments.
    sql
    |> split_statements()
    |> Enum.each(fn statement -> Postgrex.query!(conn, statement, []) end)

    name = Path.rootname(file)

    Postgrex.query!(
      conn,
      "INSERT INTO bullmq_migration (version, name) VALUES ($1, $2)",
      [version, name]
    )
  end

  @doc false
  # Splits a SQL script into individual top-level statements, honoring
  # single-quoted strings, `--`/`/* */` comments and `$tag$` dollar-quoting.
  @spec split_statements(String.t()) :: [String.t()]
  def split_statements(sql) do
    sql
    |> split(:normal, [], [])
    |> Enum.reverse()
    |> Enum.map(&(IO.iodata_to_binary(&1) |> String.trim()))
    |> Enum.reject(&(&1 == ""))
  end

  # End of input: flush the trailing statement.
  defp split(<<>>, _state, acc, stmts), do: [acc | stmts]

  # -- line comment --
  defp split(<<"\n", rest::binary>>, :line, acc, stmts),
    do: split(rest, :normal, [acc, "\n"], stmts)

  defp split(<<c::utf8, rest::binary>>, :line, acc, stmts),
    do: split(rest, :line, [acc, <<c::utf8>>], stmts)

  # -- block comment --
  defp split(<<"*/", rest::binary>>, :block, acc, stmts),
    do: split(rest, :normal, [acc, "*/"], stmts)

  defp split(<<c::utf8, rest::binary>>, :block, acc, stmts),
    do: split(rest, :block, [acc, <<c::utf8>>], stmts)

  # -- single-quoted string ('' is an escaped quote) --
  defp split(<<"''", rest::binary>>, :squote, acc, stmts),
    do: split(rest, :squote, [acc, "''"], stmts)

  defp split(<<"'", rest::binary>>, :squote, acc, stmts),
    do: split(rest, :normal, [acc, "'"], stmts)

  defp split(<<c::utf8, rest::binary>>, :squote, acc, stmts),
    do: split(rest, :squote, [acc, <<c::utf8>>], stmts)

  # -- dollar-quoted string --
  defp split(bin, {:dollar, tag}, acc, stmts) do
    if String.starts_with?(bin, tag) do
      len = byte_size(tag)
      <<matched::binary-size(len), rest::binary>> = bin
      split(rest, :normal, [acc, matched], stmts)
    else
      case bin do
        <<>> -> [acc | stmts]
        <<c::utf8, rest::binary>> -> split(rest, {:dollar, tag}, [acc, <<c::utf8>>], stmts)
      end
    end
  end

  # -- normal --
  defp split(<<"--", rest::binary>>, :normal, acc, stmts),
    do: split(rest, :line, [acc, "--"], stmts)

  defp split(<<"/*", rest::binary>>, :normal, acc, stmts),
    do: split(rest, :block, [acc, "/*"], stmts)

  defp split(<<"'", rest::binary>>, :normal, acc, stmts),
    do: split(rest, :squote, [acc, "'"], stmts)

  defp split(<<"$", rest::binary>>, :normal, acc, stmts) do
    case read_dollar_tag(rest) do
      {:ok, tag, rest2} -> split(rest2, {:dollar, tag}, [acc, tag], stmts)
      :error -> split(rest, :normal, [acc, "$"], stmts)
    end
  end

  defp split(<<";", rest::binary>>, :normal, acc, stmts),
    do: split(rest, :normal, [], [acc | stmts])

  defp split(<<c::utf8, rest::binary>>, :normal, acc, stmts),
    do: split(rest, :normal, [acc, <<c::utf8>>], stmts)

  # `read_dollar_tag` is called with the input *after* the opening `$`.
  defp read_dollar_tag(<<"$", rest::binary>>), do: {:ok, "$$", rest}

  defp read_dollar_tag(<<c, _::binary>> = bin) when c in ?A..?Z or c in ?a..?z or c == ?_ do
    case read_ident(bin, "") do
      {content, <<"$", rest::binary>>} -> {:ok, "$" <> content <> "$", rest}
      _ -> :error
    end
  end

  defp read_dollar_tag(_), do: :error

  defp read_ident(<<c, rest::binary>>, acc)
       when c in ?A..?Z or c in ?a..?z or c in ?0..?9 or c == ?_,
       do: read_ident(rest, acc <> <<c>>)

  defp read_ident(bin, acc), do: {acc, bin}
end
