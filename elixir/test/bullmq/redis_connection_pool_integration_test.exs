defmodule BullMQ.RedisConnectionPoolIntegrationTest do
  use ExUnit.Case, async: false

  @moduletag :integration

  alias BullMQ.RedisConnection
  alias BullMQ.RedisConnection.Pool

  @redis_opts [host: "localhost", port: 6379]

  setup do
    conn_name = :"pool_integration_#{System.unique_integer([:positive])}"

    {:ok, pool_pid} =
      RedisConnection.start_link(Keyword.merge(@redis_opts, name: conn_name, pool_size: 5))

    Process.unlink(pool_pid)

    on_exit(fn ->
      # Cleanup test keys
      case Redix.start_link(@redis_opts) do
        {:ok, cleanup_conn} ->
          case Redix.command(cleanup_conn, ["KEYS", "pool:*-"]) do
            {:ok, keys} when keys != [] ->
              Redix.command(cleanup_conn, ["DEL" | keys])

            _ ->
              :ok
          end

          Redix.stop(cleanup_conn)

        _ ->
          :ok
      end

      # Close the pool (waits for scripts to load)
      RedisConnection.close(conn_name)
    end)

    {:ok, conn: conn_name}
  end

  test "handles concurrent commands under load", %{conn: conn} do
    results =
      1..50
      |> Task.async_stream(
        fn _ ->
          Enum.each(1..100, fn _ ->
            {:ok, "PONG"} = RedisConnection.command(conn, ["PING"])
          end)

          :ok
        end,
        max_concurrency: 10,
        timeout: 10_000
      )
      |> Enum.to_list()

    assert Enum.all?(results, fn
             {:ok, :ok} -> true
             _ -> false
           end)
  end

  test "recovers from a killed worker connection", %{conn: conn} do
    pool = Pool.pool_name(conn)

    NimblePool.checkout!(pool, :checkout, fn _from, pid ->
      Process.exit(pid, :kill)
      {:ok, pid}
    end)

    assert {:ok, "PONG"} = RedisConnection.command(conn, ["PING"])
  end

  test "recovers during pipelined stress", %{conn: conn} do
    commands = for i <- 1..50, do: ["SET", "pool:#{i}-", Integer.to_string(i)]

    results =
      1..20
      |> Task.async_stream(
        fn _ ->
          {:ok, _} = RedisConnection.pipeline(conn, commands)

          {:ok, _} =
            RedisConnection.command(conn, ["MGET" | Enum.map(1..50, &"pool:#{&1}-")])

          :ok
        end,
        max_concurrency: 5,
        timeout: 10_000
      )
      |> Enum.to_list()

    assert Enum.all?(results, fn
             {:ok, :ok} -> true
             _ -> false
           end)
  end

  test "blocking connections can be created and closed repeatedly", %{conn: conn} do
    results =
      1..50
      |> Task.async_stream(
        fn _ ->
          {:ok, blocking} = RedisConnection.blocking_connection(conn)
          {:ok, _} = Redix.command(blocking, ["PING"])
          RedisConnection.close_blocking(conn, blocking)
          :ok
        end,
        max_concurrency: 10,
        timeout: 10_000
      )
      |> Enum.to_list()

    assert Enum.all?(results, fn
             {:ok, :ok} -> true
             _ -> false
           end)
  end

  test "pool recovers after supervisor restart", %{conn: conn} do
    sup_name = Pool.supervisor_name(conn)

    assert {:ok, "PONG"} = RedisConnection.command(conn, ["PING"])

    # Stop and restart the pool supervisor
    :ok = Supervisor.stop(sup_name, :normal, 1000)

    {:ok, _} =
      RedisConnection.start_link(Keyword.merge(@redis_opts, name: conn, pool_size: 5))

    assert {:ok, "PONG"} = RedisConnection.command(conn, ["PING"])
  end

  test "handles rapid checkout and kill under load", %{conn: conn} do
    pool = Pool.pool_name(conn)

    results =
      1..30
      |> Task.async_stream(
        fn _ ->
          NimblePool.checkout!(pool, :checkout, fn _from, pid ->
            Process.exit(pid, :kill)
            {:ok, pid}
          end)

          {:ok, "PONG"} = RedisConnection.command(conn, ["PING"])
          :ok
        end,
        max_concurrency: 10,
        timeout: 10_000
      )
      |> Enum.to_list()

    assert Enum.all?(results, fn
             {:ok, :ok} -> true
             _ -> false
           end)
  end

  test "fails fast when supervisor is down under load", %{conn: conn} do
    sup_name = Pool.supervisor_name(conn)
    parent = self()
    task_count = 10

    {:ok, task_sup} = Task.Supervisor.start_link()

    tasks =
      for _ <- 1..task_count do
        Task.Supervisor.async_nolink(task_sup, fn ->
          send(parent, :ready)

          receive do
            :go ->
              RedisConnection.command(conn, ["PING"])
          after
            1_000 -> {:error, :no_signal}
          end
        end)
      end

    :ok = Supervisor.stop(sup_name, :normal, 1000)

    Enum.each(1..task_count, fn _ ->
      assert_receive :ready, 1_000
    end)

    Enum.each(tasks, fn task ->
      send(task.pid, :go)
    end)

    results = Enum.map(tasks, &(Task.yield(&1, 2_000) || Task.shutdown(&1, :brutal_kill)))

    assert Enum.any?(results, fn
             {:ok, {:error, _}} -> true
             {:exit, _} -> true
             _ -> false
           end)
  end

  test "recovers after repeated restarts", %{conn: conn} do
    sup_name = Pool.supervisor_name(conn)

    for _ <- 1..3 do
      :ok = Supervisor.stop(sup_name, :normal, 1000)

      {:ok, _} =
        RedisConnection.start_link(Keyword.merge(@redis_opts, name: conn, pool_size: 5))

      assert {:ok, "PONG"} = RedisConnection.command(conn, ["PING"])
    end
  end

  @tag :skip
  @tag :diagnostic
  test "diagnostic: restart should not break in-flight commands", %{conn: conn} do
    sup_name = Pool.supervisor_name(conn)
    parent = self()
    task_count = 5

    {:ok, task_sup} = Task.Supervisor.start_link()

    tasks =
      for _ <- 1..task_count do
        Task.Supervisor.async_nolink(task_sup, fn ->
          send(parent, :ready)
          RedisConnection.command(conn, ["PING"])
        end)
      end

    Enum.each(1..task_count, fn _ ->
      assert_receive :ready, 1_000
    end)

    :ok = Supervisor.stop(sup_name, :normal, 1000)

    results = Enum.map(tasks, &(Task.yield(&1, 2_000) || Task.shutdown(&1, :brutal_kill)))

    assert Enum.all?(results, fn
             {:ok, {:ok, "PONG"}} -> true
             _ -> false
           end)
  end
end
