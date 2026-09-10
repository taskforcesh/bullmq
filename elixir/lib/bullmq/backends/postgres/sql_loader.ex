defmodule BullMQ.Backends.Postgres.SqlLoader do
  @moduledoc """
  Loads the PostgreSQL backend's SQL from `.sql` files — the portable source of
  truth shared with the Node.js/Python/other ports.

  Runtime queries live under `postgres/commands/` (each file is one
  parameterized `SELECT fn(...)` or direct statement); schema migrations live
  under `postgres/migrations/`. The files contain **no** schema/namespace
  references — the connection's `search_path` selects the schema — so they are
  portable verbatim.

  Like `BullMQ.Scripts` (which prefers `priv/scripts` and falls back to the
  repo's `rawScripts`), this loader prefers `priv/postgres` and falls back to
  the shared `src/postgres` tree during local development. Results are cached in
  `:persistent_term` after the first read.
  """

  # Fallback used only when developing inside the bullmq repo, where the SQL
  # lives under `src/postgres` and may not have been copied into `priv` yet.
  # Resolved at compile time relative to this file — acceptable because it is a
  # dev-only fallback, never used from a packaged/released dependency.
  @src_dir Path.expand("../../../../../src/postgres", __DIR__)

  @doc "Loads a runtime command's SQL by name (without the `.sql` extension)."
  @spec load_command(String.t()) :: String.t()
  def load_command(name), do: cached({:pg_command, name}, fn -> read("commands", "#{name}.sql") end)

  @doc "Loads a migration's SQL by file name (with the `.sql` extension)."
  @spec load_migration(String.t()) :: String.t()
  def load_migration(file), do: cached({:pg_migration, file}, fn -> read("migrations", file) end)

  @doc "Returns the base directory the SQL is loaded from (priv or src)."
  @spec base_dir() :: String.t()
  def base_dir do
    priv = priv_dir()

    cond do
      priv && dir_has_sql?(Path.join(priv, "commands")) -> priv
      File.dir?(Path.join(@src_dir, "commands")) -> @src_dir
      # Prefer the (possibly not-yet-populated) priv path for the error message;
      # fall back to src only when priv can't be resolved at all.
      priv -> priv
      true -> @src_dir
    end
  end

  # Resolve `priv/postgres` at RUNTIME so it works inside a Mix release (where the
  # app lives under `.../lib/bullmq-<vsn>/priv`) as well as in dev/test. Using a
  # compile-time `__DIR__` path fails in releases because the original build
  # directory (e.g. `/build/.../deps/bullmq`) no longer exists at runtime.
  defp priv_dir do
    case :code.priv_dir(:bullmq) do
      {:error, _} -> nil
      dir -> Path.join(to_string(dir), "postgres")
    end
  end

  defp read(subdir, file) do
    path = Path.join([base_dir(), subdir, file])

    case File.read(path) do
      {:ok, sql} ->
        sql

      {:error, reason} ->
        raise "BullMQ.Postgres: could not read SQL file #{path}: #{inspect(reason)}"
    end
  end

  defp dir_has_sql?(dir) do
    File.dir?(dir) and match?({:ok, [_ | _]}, File.ls(dir))
  end

  defp cached(key, fun) do
    case :persistent_term.get({__MODULE__, key}, :__miss__) do
      :__miss__ ->
        value = fun.()
        :persistent_term.put({__MODULE__, key}, value)
        value

      value ->
        value
    end
  end
end
