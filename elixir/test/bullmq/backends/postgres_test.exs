defmodule BullMQ.Backends.PostgresTest do
  @moduledoc """
  Validates `BullMQ.Backends.Postgres` against a real PostgreSQL instance,
  exercised through the `BullMQ.Backend` dispatcher.

  Run with:

      POSTGRES_URL=postgres://localhost:5432/bullmq_test \
        mix test test/bullmq/backends/postgres_test.exs --include postgres
  """
  use ExUnit.Case, async: false

  @moduletag :postgres

  alias BullMQ.{Backend, Backends, Job}

  @postgres_url System.get_env("POSTGRES_URL", "postgres://localhost:5432/bullmq_test")

  setup_all do
    conn = :"pg_conn_#{System.unique_integer([:positive])}"

    {:ok, _} =
      Backends.Postgres.Connection.start_link(name: conn, url: @postgres_url, schema: "bullmq")

    on_exit(fn -> Backends.Postgres.Connection.close(conn) end)
    {:ok, conn: conn}
  end

  setup %{conn: conn} do
    queue = "pgtest-#{System.os_time(:nanosecond)}-#{System.unique_integer([:positive])}"
    backend = Backend.create(queue, connection: conn, backend: Backends.Postgres)
    on_exit(fn -> Backend.obliterate(backend, 1000, true) end)
    {:ok, backend: backend, queue: queue}
  end

  test "wait_until_ready", %{backend: b} do
    assert Backend.wait_until_ready(b) == :ok
  end

  test "identity", %{backend: b, queue: q} do
    assert Backend.qualified_name(b) == q
    assert Backend.to_key(b, "x") == "#{q}:x"
    assert Backend.context(b) == %{prefix: "", name: q}
  end

  test "add_job -> get_state -> get_job_data -> remove", %{backend: b, queue: q} do
    job = Job.new(q, "greet", %{"hello" => "world"}, [])
    assert {:ok, id} = Backend.add_job(b, job)
    assert is_binary(id)

    assert {:ok, "waiting"} = Backend.get_state(b, id)

    assert {:ok, data} = Backend.get_job_data(b, id)
    assert data["name"] == "greet"
    assert Jason.decode!(data["data"]) == %{"hello" => "world"}

    assert {:ok, 1} = Backend.remove(b, id, false)
    assert {:ok, nil} = Backend.get_job_data(b, id)
  end

  test "queue metadata round-trips", %{backend: b} do
    assert {:ok, _} = Backend.set_queue_meta(b, %{"version" => "pg-1", "paused" => "1"})
    assert {:ok, "pg-1"} = Backend.get_queue_meta_field(b, "version")
    assert {:ok, true} = Backend.has_queue_meta_field(b, "paused")
    assert {:ok, false} = Backend.has_queue_meta_field(b, "nope")

    assert {:ok, meta} = Backend.get_queue_meta(b)
    assert meta["version"] == "pg-1"
    assert {:ok, ["pg-1", "1"]} = Backend.get_queue_meta_fields(b, ["version", "paused"])
  end

  test "counts reflect state transitions", %{backend: b, queue: q} do
    {:ok, _} = Backend.add_job(b, Job.new(q, "a", %{}, []))
    {:ok, _} = Backend.add_job(b, Job.new(q, "b", %{}, []))
    assert {:ok, [2, 0, 0]} = Backend.get_counts_by_types(b, [:waiting, :active, :completed])

    assert {:ok, [jd, id, 0, 0]} = Backend.move_to_active(b, "t", [])
    assert is_list(jd) and jd != []
    assert {:ok, "active"} = Backend.get_state(b, id)
    assert {:ok, [1, 1, 0]} = Backend.get_counts_by_types(b, [:waiting, :active, :completed])

    assert {:ok, _} = Backend.move_to_completed(b, id, "t", %{"ok" => true}, [])
    assert {:ok, "completed"} = Backend.get_state(b, id)
    assert {:ok, [1, 0, 1]} = Backend.get_counts_by_types(b, [:waiting, :active, :completed])
  end

  test "move_to_active fetches job data as a flat kv list", %{backend: b, queue: q} do
    {:ok, id} = Backend.add_job(b, Job.new(q, "flat", %{"n" => 1}, []))
    assert {:ok, [kv, ^id, 0, 0]} = Backend.move_to_active(b, "tok", [])
    map = kv |> Enum.chunk_every(2) |> Map.new(fn [k, v] -> {k, v} end)
    assert map["name"] == "flat"
  end

  test "move_to_failed marks a job failed", %{backend: b, queue: q} do
    {:ok, id} = Backend.add_job(b, Job.new(q, "boom", %{}, []))
    {:ok, [_, ^id, 0, 0]} = Backend.move_to_active(b, "t", [])
    assert {:ok, _} = Backend.move_to_failed(b, id, "t", "kaboom", [])
    assert {:ok, "failed"} = Backend.get_state(b, id)
  end

  test "pause / drain", %{backend: b, queue: q} do
    {:ok, _} = Backend.add_job(b, Job.new(q, "p", %{}, []))
    assert {:ok, _} = Backend.pause(b, true)
    assert {:ok, true} = Backend.has_queue_meta_field(b, "paused")
    assert {:ok, _} = Backend.pause(b, false)

    {:ok, _} = Backend.add_job(b, Job.new(q, "d", %{}, []))
    assert {:ok, _} = Backend.drain(b, false)
    assert {:ok, [0, _, _]} = Backend.get_counts_by_types(b, [:waiting, :active, :completed])
  end

  test "job logs", %{backend: b, queue: q} do
    {:ok, id} = Backend.add_job(b, Job.new(q, "log", %{}, []))
    assert {:ok, _} = Backend.add_log(b, id, "line 1", nil)
    assert {:ok, _} = Backend.add_log(b, id, "line 2", nil)
    assert {:ok, %{logs: logs, count: 2}} = Backend.get_job_logs(b, id, 0, -1, true)
    assert logs == ["line 1", "line 2"]
  end

  test "get_ranges returns waiting ids", %{backend: b, queue: q} do
    {:ok, id} = Backend.add_job(b, Job.new(q, "r", %{}, []))
    assert {:ok, ids} = Backend.get_ranges(b, [:waiting], 0, -1)
    assert id in ids
  end

  test "for_queue targets a different queue on the shared connection", %{backend: b} do
    sibling = Backend.for_queue(b, "other-queue")
    assert sibling.queue_name == "other-queue"
    assert sibling.owns_connection == false
    assert Backend.wait_until_ready(sibling) == :ok
  end

  test "publish_event / read_events round-trips through the event stream", %{backend: b} do
    assert {:ok, _id} = Backend.publish_event(b, %{"event" => "added", "jobId" => "1"}, 1000)
    assert {:ok, _id} = Backend.publish_event(b, %{"event" => "completed", "jobId" => "1"}, 1000)

    assert {:ok, [["events", entries]]} = Backend.read_events(b, "0", 100)

    events =
      Enum.map(entries, fn [_id, fields] ->
        fields |> Enum.chunk_every(2) |> Map.new(fn [k, v] -> {k, v} end)
      end)

    assert Enum.map(events, & &1["event"]) == ["added", "completed"]
    assert Enum.at(events, 0)["jobId"] == "1"
  end

  test "read_events returns nil when there is nothing after the cursor", %{backend: b} do
    assert {:ok, nil} = Backend.read_events(b, "$", 50)
  end

  test "wait_for_job returns :timeout on an empty queue", %{backend: b} do
    assert Backend.wait_for_job(b, 0.05) == :timeout
  end

  test "wait_for_job wakes immediately when a job is already waiting", %{backend: b, queue: q} do
    {:ok, _} = Backend.add_job(b, Job.new(q, "ready", %{}, []))
    assert {:job_available, nil} = Backend.wait_for_job(b, 5)
  end

  test "job schedulers: add / get / list / count / remove", %{backend: b} do
    now = System.system_time(:millisecond)
    next = now + 5000
    scheduler_opts = %{"name" => "tick", "every" => 5000}

    assert {:ok, [job_id, delay]} =
             Backend.add_job_scheduler(
               b,
               "sched-1",
               next,
               scheduler_opts,
               Jason.encode!(%{"n" => 1}),
               %{},
               %{"delay" => 5000, "timestamp" => now},
               now,
               nil
             )

    assert is_binary(job_id)
    assert is_integer(delay)

    assert {:ok, [flat, score]} = Backend.get_job_scheduler(b, "sched-1")
    hash = flat |> Enum.chunk_every(2) |> Map.new(fn [k, v] -> {k, v} end)
    assert hash["name"] == "tick"
    assert hash["every"] == "5000"
    refute is_nil(score)

    assert {:ok, range} = Backend.get_job_schedulers_range(b, 0, -1, true)
    assert "sched-1" in range

    assert {:ok, 1} = Backend.get_job_schedulers_count(b)

    # remove_job_scheduler returns 0 on success, 1 when not found.
    assert {:ok, 0} = Backend.remove_job_scheduler(b, "sched-1")
    assert {:ok, 0} = Backend.get_job_schedulers_count(b)
    assert {:ok, [nil, nil]} = Backend.get_job_scheduler(b, "sched-1")
    assert {:ok, 1} = Backend.remove_job_scheduler(b, "sched-1")
  end

  test "add_jobs inserts a batch atomically", %{backend: b, queue: q} do
    jobs = [
      {Job.new(q, "j1", %{"a" => 1}, []), %{}},
      {Job.new(q, "j2", %{"b" => 2}, []), %{}},
      {Job.new(q, "j3", %{"c" => 3}, []), %{}}
    ]

    assert {:ok, results} = Backend.add_jobs(b, jobs, [])
    assert length(results) == 3
    assert Enum.all?(results, &match?({:ok, _}, &1))
    assert {:ok, [3, 0, 0]} = Backend.get_counts_by_types(b, [:waiting, :active, :completed])
  end

  test "add_jobs does not double-emit events for existing or duplicate ids", %{backend: b, queue: q} do
    # A job that already exists, added on its own first.
    {:ok, "x1"} = Backend.add_job(b, Job.new(q, "a", %{}, job_id: "x1"))
    assert {:ok, [1, 0, 0]} = Backend.get_counts_by_types(b, [:waiting, :active, :completed])

    # Bulk add: reuse x1 (conflict), a brand-new x2, and x2 again (in-batch dup).
    jobs = [
      {Job.new(q, "a", %{}, job_id: "x1"), %{}},
      {Job.new(q, "b", %{}, job_id: "x2"), %{}},
      {Job.new(q, "b", %{}, job_id: "x2"), %{}}
    ]

    assert {:ok, [{:ok, "x1"}, {:ok, "x2"}, {:ok, "x2"}]} = Backend.add_jobs(b, jobs, [])

    # Only x2 is genuinely new: waiting count is 2, not 4.
    assert {:ok, [2, 0, 0]} = Backend.get_counts_by_types(b, [:waiting, :active, :completed])

    # The event stream carries exactly one 'added' per distinct job (x1 from the
    # first add, x2 from the bulk) — no spurious duplicates from conflicts.
    assert {:ok, [["events", entries]]} = Backend.read_events(b, "0", 50)

    added_ids =
      entries
      |> Enum.map(fn [_id, fields] ->
        fields |> Enum.chunk_every(2) |> Map.new(fn [k, v] -> {k, v} end)
      end)
      |> Enum.filter(&(&1["event"] == "added"))
      |> Enum.map(& &1["jobId"])
      |> Enum.sort()

    assert added_ids == ["x1", "x2"]
  end

  test "add_flow links a parent and its children", %{backend: b, queue: q} do
    now = System.system_time(:millisecond)

    parent_job = %{
      id: "p1",
      name: "parent",
      data: %{},
      queue_name: q,
      opts: %{},
      timestamp: now,
      parent: nil
    }

    child = fn id ->
      %{
        id: id,
        name: "child",
        data: %{},
        queue_name: q,
        opts: %{},
        timestamp: now,
        parent: %{id: "p1", queue: q, queue_key: "bull:#{q}"}
      }
    end

    {:ok, parent_cmd} = Backend.build_add_parent_command(b, parent_job, %{})
    {:ok, c1_cmd} = Backend.build_add_standard_command(b, child.("c1"), %{})
    {:ok, c2_cmd} = Backend.build_add_standard_command(b, child.("c2"), %{})

    assert {:ok, results} = Backend.add_flow(b, [parent_cmd, c1_cmd, c2_cmd], [])
    assert [{:ok, "p1"}, {:ok, "c1"}, {:ok, "c2"}] = results

    assert {:ok, "waiting-children"} = Backend.get_state(b, "p1")
    assert {:ok, "waiting"} = Backend.get_state(b, "c1")
    assert {:ok, "waiting"} = Backend.get_state(b, "c2")
    assert {:ok, 2} = Backend.get_dependencies_count(b, "p1")
  end

  test "has_job_lock? reflects an active lock", %{backend: b, queue: q} do
    {:ok, id} = Backend.add_job(b, Job.new(q, "lk", %{}, []))
    assert {:ok, false} = Backend.has_job_lock?(b, id)

    {:ok, [_, ^id, 0, 0]} = Backend.move_to_active(b, "tok", [])
    assert {:ok, true} = Backend.has_job_lock?(b, id)

    assert {:ok, false} = Backend.has_job_lock?(b, "does-not-exist")
  end

  test "check_stalled_jobs returns recovered/failed counts", %{backend: b, queue: q} do
    {:ok, _} = Backend.add_job(b, Job.new(q, "s", %{}, []))
    assert {:ok, %{recovered: recovered, failed: failed}} = Backend.check_stalled_jobs(b, 1)
    assert is_integer(recovered) and is_integer(failed)
  end

  test "move_stalled_jobs_to_wait returns reclaimed ids", %{backend: b, queue: q} do
    {:ok, _} = Backend.add_job(b, Job.new(q, "st", %{}, []))
    {:ok, [_, _id, 0, 0]} = Backend.move_to_active(b, "t", [])
    assert {:ok, ids} = Backend.move_stalled_jobs_to_wait(b, 1, [])
    assert is_list(ids)
  end

  test "get_client_list / get_workers return client info", %{backend: b} do
    assert {:ok, [blob]} = Backend.get_client_list(b)
    assert is_binary(blob)

    assert {:ok, workers} = Backend.get_workers(b, [])
    assert is_list(workers)
  end

  test "get_counts returns the full state map", %{backend: b, queue: q} do
    {:ok, _} = Backend.add_job(b, Job.new(q, "a", %{}, []))
    {:ok, _} = Backend.add_job(b, Job.new(q, "b", %{}, []))

    assert {:ok, counts} = Backend.get_counts(b)
    assert counts["waiting"] == 2
    assert counts["active"] == 0
    assert counts["completed"] == 0
    assert Map.has_key?(counts, "waiting-children")
  end

  test "update_data and update_progress persist", %{backend: b, queue: q} do
    {:ok, id} = Backend.add_job(b, Job.new(q, "u", %{"x" => 1}, []))

    assert {:ok, _} = Backend.update_data(b, id, %{"x" => 9})
    assert {:ok, data} = Backend.get_job_data(b, id)
    assert Jason.decode!(data["data"]) == %{"x" => 9}

    assert {:ok, _} = Backend.update_progress(b, id, 55)
    assert {:ok, data2} = Backend.get_job_data(b, id)
    assert data2["progress"] == "55"
  end

  test "move_to_delayed then promote returns the job to waiting", %{backend: b, queue: q} do
    {:ok, id} = Backend.add_job(b, Job.new(q, "d", %{}, []))
    {:ok, [_, ^id, 0, 0]} = Backend.move_to_active(b, "t", [])

    assert {:ok, _} = Backend.move_to_delayed(b, id, "t", 60_000, [])
    assert {:ok, "delayed"} = Backend.get_state(b, id)

    assert {:ok, _} = Backend.promote(b, id)
    assert {:ok, "waiting"} = Backend.get_state(b, id)
  end

  test "move_job_from_active_to_wait and release_lock return the job to waiting", %{
    backend: b,
    queue: q
  } do
    {:ok, id} = Backend.add_job(b, Job.new(q, "m", %{}, []))
    {:ok, [_, ^id, 0, 0]} = Backend.move_to_active(b, "t", [])
    assert {:ok, _} = Backend.move_job_from_active_to_wait(b, id, "t")
    assert {:ok, "waiting"} = Backend.get_state(b, id)

    {:ok, [_, ^id, 0, 0]} = Backend.move_to_active(b, "t2", [])
    assert {:ok, _} = Backend.release_lock(b, id, "t2")
    assert {:ok, "waiting"} = Backend.get_state(b, id)
  end

  test "extend_lock and extend_locks", %{backend: b, queue: q} do
    {:ok, id} = Backend.add_job(b, Job.new(q, "l", %{}, []))
    {:ok, [_, ^id, 0, 0]} = Backend.move_to_active(b, "t", [])

    assert {:ok, n} = Backend.extend_lock(b, id, "t", 60_000)
    assert n >= 1
    assert {:ok, true} = Backend.has_job_lock?(b, id)

    assert {:ok, []} = Backend.extend_locks(b, [id], ["t"], 60_000)
    assert {:ok, [^id]} = Backend.extend_locks(b, [id], ["wrong-token"], 60_000)
  end

  test "reprocess_job moves a failed job back to waiting", %{backend: b, queue: q} do
    {:ok, id} = Backend.add_job(b, Job.new(q, "r", %{}, []))
    {:ok, [_, ^id, 0, 0]} = Backend.move_to_active(b, "t", [])
    {:ok, _} = Backend.move_to_failed(b, id, "t", "err", [])
    assert {:ok, "failed"} = Backend.get_state(b, id)

    assert {:ok, 1} = Backend.reprocess_job(b, id, :failed, [])
    assert {:ok, "waiting"} = Backend.get_state(b, id)
  end

  test "retry_job moves an active job back to waiting", %{backend: b, queue: q} do
    {:ok, id} = Backend.add_job(b, Job.new(q, "rt", %{}, []))
    {:ok, [_, ^id, 0, 0]} = Backend.move_to_active(b, "t", [])

    assert {:ok, _} = Backend.retry_job(b, id, false, "t", [])
    assert {:ok, "waiting"} = Backend.get_state(b, id)
  end

  test "clean_jobs_by_state removes completed jobs", %{backend: b, queue: q} do
    {:ok, id} = Backend.add_job(b, Job.new(q, "c", %{}, []))
    {:ok, [_, ^id, 0, 0]} = Backend.move_to_active(b, "t", [])
    {:ok, _} = Backend.move_to_completed(b, id, "t", %{"ok" => true}, [])
    Process.sleep(5)

    assert {:ok, ids} = Backend.clean_jobs_by_state(b, :completed, 0, [])
    assert id in ids
    assert {:ok, [_, _, 0]} = Backend.get_counts_by_types(b, [:waiting, :active, :completed])
  end

  test "is_maxed, get_rate_limit_ttl, get_metrics return sane shapes", %{backend: b} do
    assert {:ok, maxed} = Backend.is_maxed(b)
    assert is_boolean(maxed)

    assert {:ok, ttl} = Backend.get_rate_limit_ttl(b, max_jobs: 10)
    assert is_integer(ttl)

    assert {:ok, [meta, data, count]} = Backend.get_metrics(b, :completed, 0, -1)
    assert is_list(meta) and is_list(data) and is_integer(count)
  end

  test "deduplication key round-trips", %{backend: b, queue: q} do
    job = Job.new(q, "dd", %{}, deduplication: %{id: "dk1"})
    {:ok, id} = Backend.add_job(b, job)

    assert {:ok, ^id} = Backend.get_deduplication_job_id(b, "dk1")
    assert {:ok, _} = Backend.delete_deduplication_key(b, "dk1")
    assert {:ok, nil} = Backend.get_deduplication_job_id(b, "dk1")
  end

  test "get_dependencies and processed children values via a flow", %{backend: b, queue: q} do
    now = System.system_time(:millisecond)

    parent = %{
      id: "p1",
      name: "parent",
      data: %{},
      queue_name: q,
      opts: %{},
      timestamp: now,
      parent: nil
    }

    child =
      %{
        id: "c1",
        name: "child",
        data: %{},
        queue_name: q,
        opts: %{},
        timestamp: now,
        parent: %{id: "p1", queue: q, queue_key: "bull:#{q}"}
      }

    {:ok, pc} = Backend.build_add_parent_command(b, parent, %{})
    {:ok, cc} = Backend.build_add_standard_command(b, child, %{})
    {:ok, _} = Backend.add_flow(b, [pc, cc], [])

    assert {:ok, deps} = Backend.get_dependencies(b, "p1")
    assert length(deps) == 1

    {:ok, [_, "c1", 0, 0]} = Backend.move_to_active(b, "t", [])
    {:ok, _} = Backend.move_to_completed(b, "c1", "t", %{"r" => 1}, [])

    assert {:ok, processed} = Backend.get_processed_children_values(b, "p1")
    assert length(processed) >= 2
    assert {:ok, _ignored} = Backend.get_ignored_children_failures(b, "p1")
  end

  test "update_job_scheduler updates an existing scheduler", %{backend: b} do
    now = System.system_time(:millisecond)

    {:ok, [job_id, _delay]} =
      Backend.add_job_scheduler(
        b,
        "s1",
        now + 1000,
        %{"name" => "t", "every" => 1000},
        Jason.encode!(%{}),
        %{},
        %{"delay" => 1000, "timestamp" => now},
        now,
        nil
      )

    assert is_binary(job_id)

    assert {:ok, updated} =
             Backend.update_job_scheduler(
               b,
               "s1",
               now + 2000,
               Jason.encode!(%{"v" => 2}),
               %{"delay" => 2000, "timestamp" => now},
               nil
             )

    assert is_binary(updated) or is_nil(updated)
  end

  test "move_to_waiting_children returns a boolean", %{backend: b, queue: q} do
    {:ok, id} = Backend.add_job(b, Job.new(q, "wc", %{}, []))
    {:ok, [_, ^id, 0, 0]} = Backend.move_to_active(b, "t", [])

    assert {:ok, moved} = Backend.move_to_waiting_children(b, id, "t", [])
    assert is_boolean(moved)
  end

  test "identity helpers: client_name, parse_node_key, set_name", %{backend: b, queue: q} do
    assert Backends.Postgres.client_name(b, ":w:1") == "#{q}:w:1"
    assert %{queue_name: "myq", id: "abc"} = Backends.Postgres.parse_node_key(b, "myq:abc")
    assert %{queue_name: "", id: "invalid"} = Backends.Postgres.parse_node_key(b, "invalid")
    assert %{queue_name: "", id: "myq:"} = Backends.Postgres.parse_node_key(b, "myq:")
    assert Backend.set_name(b, "test-app") == :ok
  end
end
