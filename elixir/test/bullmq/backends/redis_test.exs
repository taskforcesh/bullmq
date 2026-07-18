defmodule BullMQ.Backends.RedisTest do
  @moduledoc """
  Validates that `BullMQ.Backends.Redis` correctly implements the
  `BullMQ.Backend` behaviour against a real Redis instance, exercised through
  the `BullMQ.Backend` dispatcher.
  """
  use ExUnit.Case, async: false

  @moduletag :integration

  alias BullMQ.{Backend, Backends, Job, RedisConnection}

  @redis_url BullMQ.TestHelper.redis_url()
  @test_prefix BullMQ.TestHelper.test_prefix()

  setup do
    conn_name = :"backend_test_conn_#{System.unique_integer([:positive])}"
    queue_name = "backend-test-#{System.unique_integer([:positive])}"

    {:ok, _} = RedisConnection.start_link(name: conn_name, url: @redis_url)

    backend = Backends.Redis.new(queue_name, connection: conn_name, prefix: @test_prefix)

    on_exit(fn ->
      # Best-effort cleanup of this queue's keys
      pattern = "#{@test_prefix}:#{queue_name}:*"

      case RedisConnection.command(conn_name, ["KEYS", pattern]) do
        {:ok, keys} when keys != [] -> RedisConnection.command(conn_name, ["DEL" | keys])
        _ -> :ok
      end

      RedisConnection.close(conn_name)
    end)

    {:ok, backend: backend, conn: conn_name, queue_name: queue_name}
  end

  test "identity and keys", %{backend: backend, queue_name: queue_name} do
    assert Backend.qualified_name(backend) == "#{@test_prefix}:#{queue_name}"
    assert Backend.to_key(backend, "wait") == "#{@test_prefix}:#{queue_name}:wait"
    assert Backend.context(backend) == %{prefix: @test_prefix, name: queue_name}
    assert Backend.client_name(backend) == "#{@test_prefix}:#{queue_name}"
    assert Backend.client_name(backend, ":w:1") == "#{@test_prefix}:#{queue_name}:w:1"
  end

  test "wait_until_ready pings the connection", %{backend: backend} do
    assert Backend.wait_until_ready(backend) == :ok
  end

  test "add_job -> get_state -> get_job_data -> remove", %{backend: backend, queue_name: queue_name} do
    job = Job.new(queue_name, "greet", %{"hello" => "world"}, [])

    assert {:ok, job_id} = Backend.add_job(backend, job)
    assert is_binary(job_id)

    assert {:ok, state} = Backend.get_state(backend, job_id)
    assert state in [:waiting, "waiting", :wait, "wait"]

    assert {:ok, data} = Backend.get_job_data(backend, job_id)
    assert is_map(data)
    assert data["name"] == "greet"

    assert {:ok, _} = Backend.remove(backend, job_id, false)
    assert {:ok, nil} = Backend.get_job_data(backend, job_id)
  end

  test "queue metadata round-trips", %{backend: backend} do
    assert {:ok, _} = Backend.set_queue_meta(backend, %{"version" => "test-1", "paused" => "1"})
    assert {:ok, "test-1"} = Backend.get_queue_meta_field(backend, "version")
    assert {:ok, true} = Backend.has_queue_meta_field(backend, "paused")
    assert {:ok, false} = Backend.has_queue_meta_field(backend, "nope")

    assert {:ok, meta} = Backend.get_queue_meta(backend)
    assert meta["version"] == "test-1"

    assert {:ok, ["test-1", "1"]} = Backend.get_queue_meta_fields(backend, ["version", "paused"])
  end

  test "pause/resume via backend", %{backend: backend} do
    assert {:ok, _} = Backend.pause(backend, true)
    assert {:ok, true} = Backend.has_queue_meta_field(backend, "paused")
    assert {:ok, _} = Backend.pause(backend, false)
    assert {:ok, false} = Backend.has_queue_meta_field(backend, "paused")
  end

  test "get_counts returns a map/list", %{backend: backend, queue_name: queue_name} do
    job = Job.new(queue_name, "c", %{}, [])
    assert {:ok, _} = Backend.add_job(backend, job)
    assert {:ok, counts} = Backend.get_counts(backend)
    assert is_map(counts) or is_list(counts)
  end

  test "get_ranges returns waiting ids", %{backend: backend, queue_name: queue_name} do
    job = Job.new(queue_name, "r", %{}, [])
    assert {:ok, job_id} = Backend.add_job(backend, job)
    assert {:ok, ids} = Backend.get_ranges(backend, [:waiting], 0, -1)
    assert job_id in ids
  end

  test "for_queue returns a sibling backend that does not own the connection", %{backend: backend} do
    sibling = Backend.for_queue(backend, "other-queue")
    assert sibling.context.name == "other-queue"
    assert sibling.owns_connection == false
    # closing the sibling must not close the shared connection
    assert Backend.close(sibling) == :ok
    assert Backend.wait_until_ready(backend) == :ok
  end
end
