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

  test "does not preload scripts when the connection starts" do
    flush_script_cache()

    conn = start_pool()

    shas = all_script_shas()
    {:ok, existing} = RedisConnection.command(conn, ["SCRIPT", "EXISTS" | shas])

    assert length(existing) == length(shas)
    assert Enum.all?(existing, &(&1 == 0))
  end

  test "loads only the requested scripts for pipelined operations" do
    flush_script_cache()

    conn = start_pool()
    :ok = Scripts.ensure_scripts_loaded(conn, [:add_standard_job])

    {:ok, [add_standard_job, add_parent_job]} =
      RedisConnection.command(conn, [
        "SCRIPT",
        "EXISTS",
        Scripts.get_sha(:add_standard_job),
        Scripts.get_sha(:add_parent_job)
      ])

    assert add_standard_job == 1
    assert add_parent_job == 0
  end
end
