defmodule BullMQ.RedisConnectionUsernameTest do
  use ExUnit.Case, async: false

  import ExUnit.CaptureLog

  @moduletag :integration

  alias BullMQ.RedisConnection

  @base_uri URI.parse(BullMQ.TestHelper.redis_url())

  setup do
    conn_name = :"username_test_#{System.unique_integer([:positive])}"

    on_exit(fn -> RedisConnection.close(conn_name) end)

    {:ok, conn: conn_name}
  end

  test "explicit :username option authenticates as the matching ACL user", %{conn: conn} do
    acl_username = "bullmq_testuser"
    acl_password = "bullmq_testpass123"

    {:ok, admin} = Redix.start_link(host: @base_uri.host, port: @base_uri.port)

    {:ok, _} =
      Redix.command(admin, [
        "ACL",
        "SETUSER",
        acl_username,
        "on",
        ">#{acl_password}",
        "~*",
        "+@all"
      ])

    on_exit(fn ->
      {:ok, admin} = Redix.start_link(host: @base_uri.host, port: @base_uri.port)
      Redix.command(admin, ["ACL", "DELUSER", acl_username])
      Redix.stop(admin)
    end)

    Redix.stop(admin)

    {:ok, _pid} =
      RedisConnection.start_link(
        name: conn,
        host: @base_uri.host,
        port: @base_uri.port,
        username: acl_username,
        password: acl_password
      )

    assert RedisConnection.get_redis_opts(conn)[:username] == acl_username
    assert {:ok, "PONG"} = RedisConnection.command(conn, ["PING"])

    wrong_conn = :"username_test_wrong_#{System.unique_integer([:positive])}"

    on_exit(fn -> RedisConnection.close(wrong_conn) end)

    log =
      capture_log(fn ->
        {:ok, _pid} =
          RedisConnection.start_link(
            name: wrong_conn,
            host: @base_uri.host,
            port: @base_uri.port,
            username: acl_username,
            password: "not-the-right-password"
          )

        assert {:error, _} = RedisConnection.command(wrong_conn, ["PING"])
      end)

    assert log =~ "WRONGPASS"
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
