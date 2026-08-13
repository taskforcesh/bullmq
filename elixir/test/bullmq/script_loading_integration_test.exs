defmodule BullMQ.ScriptLoadingIntegrationTest do
  use ExUnit.Case, async: false

  @moduletag :integration

  alias BullMQ.RedisConnection
  alias BullMQ.Scripts

  @redis_opts [host: "localhost", port: 6379]

  defp flush_script_cache do
    {:ok, conn} = Redix.start_link(@redis_opts)
    {:ok, _} = Redix.command(conn, ["SCRIPT", "FLUSH", "SYNC"])
    Redix.stop(conn)
  end

  defp all_script_shas do
    Scripts.list_scripts()
    |> Enum.map(&Scripts.get_sha/1)
  end

  defp start_pool do
    conn_name = :"script_loading_#{System.unique_integer([:positive])}"

    {:ok, pool_pid} =
      RedisConnection.start_link(Keyword.merge(@redis_opts, name: conn_name, pool_size: 1))

    Process.unlink(pool_pid)
    on_exit(fn -> RedisConnection.close(conn_name) end)
    conn_name
  end

  test "loads every script into the server-side cache when it is empty" do
    flush_script_cache()

    conn = start_pool()

    shas = all_script_shas()
    {:ok, existing} = RedisConnection.command(conn, ["SCRIPT", "EXISTS" | shas])

    assert length(existing) == length(shas)
    assert Enum.all?(existing, &(&1 == 1))
  end

  test "leaves all scripts cached when starting with a warm script cache" do
    flush_script_cache()

    # Warm the cache with a first connection.
    _first = start_pool()

    # A second connection must find the scripts already cached (only a single
    # SCRIPT EXISTS round trip is needed) and must not remove or corrupt them.
    second = start_pool()

    shas = all_script_shas()
    {:ok, existing} = RedisConnection.command(second, ["SCRIPT", "EXISTS" | shas])

    assert Enum.all?(existing, &(&1 == 1))
  end
end
