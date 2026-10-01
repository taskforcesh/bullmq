defmodule BullMQ.RedisConnectionUsernameTest do
  use ExUnit.Case, async: false

  @moduletag :integration

  alias BullMQ.RedisConnection

  @base_uri URI.parse(BullMQ.TestHelper.redis_url())

  setup do
    conn_name = :"username_test_#{System.unique_integer([:positive])}"

    on_exit(fn -> RedisConnection.close(conn_name) end)

    {:ok, conn: conn_name}
  end

  test "explicit :username option is stored in redis opts and connection still works", %{
    conn: conn
  } do
    {:ok, _pid} =
      RedisConnection.start_link(
        name: conn,
        host: @base_uri.host,
        port: @base_uri.port,
        username: "testuser"
      )

    assert RedisConnection.get_redis_opts(conn)[:username] == "testuser"
    assert {:ok, "PONG"} = RedisConnection.command(conn, ["PING"])
  end

  test "no username defaults to nil", %{conn: conn} do
    {:ok, _pid} =
      RedisConnection.start_link(name: conn, host: @base_uri.host, port: @base_uri.port)

    assert RedisConnection.get_redis_opts(conn)[:username] == nil
  end

  test "username and password are parsed from a redis:// URL", %{conn: conn} do
    # This test Redis has no ACL user configured, so the pool's background
    # connections will fail to AUTH and keep retrying - that's expected and
    # harmless here: start_link/1 stores the parsed opts in persistent_term
    # during init/1, before any connection attempt completes, so we can
    # assert on the parse result without a successful live connection.
    url = "redis://someuser:somepass@#{@base_uri.host}:#{@base_uri.port}"

    {:ok, _pid} = RedisConnection.start_link(name: conn, url: url)

    opts = RedisConnection.get_redis_opts(conn)
    assert opts[:username] == "someuser"
    assert opts[:password] == "somepass"
  end
end
