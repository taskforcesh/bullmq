defmodule BullMQ.Backends.PostgresIntegrationTest do
  @moduledoc """
  End-to-end integration tests that drive the real high-level modules
  (`Queue`, `Worker`, `QueueEvents`, `FlowProducer`, `JobScheduler`) against the
  PostgreSQL backend, proving the adapter works through the same code paths the
  Redis backend uses.

  This file sets the backend globally via `config :bullmq, :backend` for
  convenience, so it must be run on its own — never alongside the Redis suite:

      POSTGRES_URL=postgres://localhost:5432/bullmq_test \
        mix test test/bullmq/backends/postgres_integration_test.exs --include postgres
  """
  use ExUnit.Case, async: false

  @moduletag :postgres
  @moduletag timeout: 30_000

  alias BullMQ.{Backend, Backends, Job, Queue, Worker, QueueEvents, FlowProducer, JobScheduler}

  @postgres_url System.get_env("POSTGRES_URL", "postgres://localhost:5432/bullmq_test")

  setup_all do
    previous = Application.get_env(:bullmq, :backend)
    Application.put_env(:bullmq, :backend, Backends.Postgres)

    conn = :pg_integration_conn

    {:ok, _} =
      Backends.Postgres.Connection.start_link(name: conn, url: @postgres_url, schema: "bullmq")

    on_exit(fn ->
      Backends.Postgres.Connection.close(conn)

      if previous do
        Application.put_env(:bullmq, :backend, previous)
      else
        Application.delete_env(:bullmq, :backend)
      end
    end)

    {:ok, conn: conn}
  end

  setup %{conn: conn} do
    queue = "pg-int-#{System.os_time(:nanosecond)}-#{System.unique_integer([:positive])}"

    on_exit(fn ->
      backend = Backend.create(queue, connection: conn, backend: Backends.Postgres)
      Backend.obliterate(backend, 1000, true)
    end)

    {:ok, conn: conn, queue: queue}
  end

  test "worker processes a single job end-to-end", %{conn: conn, queue: queue} do
    test_pid = self()

    {:ok, worker} =
      Worker.start_link(
        queue: queue,
        connection: conn,
        processor: fn job -> {:ok, %{doubled: job.data["value"] * 2}} end,
        on_completed: fn job, result -> send(test_pid, {:completed, job.id, result}) end
      )

    {:ok, job} = Queue.add(queue, "double", %{value: 21}, connection: conn)

    assert_receive {:completed, job_id, result}, 10_000
    assert job_id == job.id
    assert result == %{doubled: 42}

    assert {:ok, "completed"} = Queue.get_job_state(queue, job.id, connection: conn)

    Worker.close(worker)
  end

  # Regression: a worker registered with an atom `name` must still process jobs on
  # the Postgres backend. The worker forwards its `name` to the backend as a SQL
  # parameter (application_name / move_to_completed_fetch). A raw atom raised
  # `DBConnection.EncodeError: expected a binary, got <atom>` inside the spawned
  # autonomous worker while completing-and-fetching the next job — the jobs then
  # stayed stuck in "active". We assert on the final job STATE (not the
  # on_completed callback, which can fire before the crashing move). Multiple jobs
  # ensure the complete-and-fetch-next path (which carries `name`) is exercised.
  # See `name_as_string/1` in BullMQ.Worker.
  test "worker with an atom name completes jobs (name coerced to a string for the backend)",
       %{conn: conn, queue: queue} do
    {:ok, worker} =
      Worker.start_link(
        queue: queue,
        connection: conn,
        name: :"named_worker_#{System.unique_integer([:positive])}",
        processor: fn job -> {:ok, job.data["value"] * 2} end
      )

    job_ids =
      for i <- 1..3 do
        {:ok, job} = Queue.add(queue, "double", %{value: i}, connection: conn)
        job.id
      end

    # Poll until all jobs settle. Without the fix the autonomous workers crash and
    # the jobs remain "active" forever, so this eventually fails.
    assert eventually(fn ->
             Enum.all?(job_ids, fn id ->
               Queue.get_job_state(queue, id, connection: conn) == {:ok, "completed"}
             end)
           end),
           "expected all jobs to reach \"completed\"; got " <>
             inspect(Enum.map(job_ids, &Queue.get_job_state(queue, &1, connection: conn)))

    Worker.close(worker)
  end

  defp eventually(fun, retries \\ 50, sleep_ms \\ 100) do
    cond do
      fun.() -> true
      retries <= 0 -> false
      true ->
        Process.sleep(sleep_ms)
        eventually(fun, retries - 1, sleep_ms)
    end
  end

  test "worker processes a bulk batch", %{conn: conn, queue: queue} do
    test_pid = self()

    {:ok, worker} =
      Worker.start_link(
        queue: queue,
        connection: conn,
        processor: fn job -> {:ok, job.data["idx"]} end,
        on_completed: fn _job, result -> send(test_pid, {:done, result}) end
      )

    jobs = Enum.map(1..5, fn i -> {"job", %{idx: i}, []} end)
    {:ok, _} = Queue.add_bulk(queue, jobs, connection: conn)

    results = for _ <- 1..5, do: receive(do: ({:done, r} -> r), after: (10_000 -> :timeout))
    assert Enum.sort(results) == [1, 2, 3, 4, 5]

    Worker.close(worker)
  end

  test "failed jobs surface through the worker on_failed callback", %{conn: conn, queue: queue} do
    test_pid = self()

    {:ok, worker} =
      Worker.start_link(
        queue: queue,
        connection: conn,
        processor: fn _job -> raise "boom" end,
        on_failed: fn job, reason -> send(test_pid, {:failed, job.id, reason}) end
      )

    {:ok, job} = Queue.add(queue, "explode", %{}, connection: conn)

    assert_receive {:failed, job_id, _reason}, 10_000
    assert job_id == job.id
    assert {:ok, "failed"} = Queue.get_job_state(queue, job.id, connection: conn)

    Worker.close(worker)
  end

  # Regression: a job that stalled more than `max_stalled_count` allows is moved
  # back to `waiting` with its `deferred_failure` column set (see
  # `move_stalled_jobs_to_wait`). The worker must fail such a job immediately —
  # without running the processor and without retrying — instead of running the
  # user code again and letting the job cycle through active/stalled forever.
  test "job carrying deferred_failure is failed without running the processor or retrying",
       %{conn: conn, queue: queue} do
    test_pid = self()
    reason = "job stalled more than allowable limit"

    # Seed a normal waiting job that still has retry attempts left, so proving it
    # ends `failed` also proves the deferred failure bypasses the retry logic.
    {:ok, job} = Queue.add(queue, "stalled-job", %{}, connection: conn, attempts: 5)

    # Stamp the deferred failure exactly as the stalled-recovery flow does.
    {:ok, _} =
      Postgrex.query(
        Backends.Postgres.Connection.pool(conn),
        "UPDATE job SET deferred_failure = $1 WHERE queue = $2 AND id = $3",
        [reason, queue, job.id]
      )

    {:ok, worker} =
      Worker.start_link(
        queue: queue,
        connection: conn,
        processor: fn _job ->
          send(test_pid, :processor_ran)
          {:ok, :should_not_happen}
        end,
        on_completed: fn j, _result -> send(test_pid, {:completed, j.id}) end,
        on_failed: fn j, failed_reason ->
          send(test_pid, {:failed, j.id, j.attempts_made, failed_reason})
        end
      )

    # The job is failed immediately, carrying the deferred reason, with its
    # attempt counter advanced once.
    assert_receive {:failed, job_id, attempts_made, failed_reason}, 10_000
    assert job_id == job.id
    assert to_string(failed_reason) =~ "stalled more than allowable limit"
    assert attempts_made == 1

    # The processor never runs and the job never completes.
    refute_receive :processor_ran, 500
    refute_receive {:completed, _}, 200

    # The job ends in `failed` — not stuck in active/waiting, and not retried.
    assert {:ok, "failed"} = Queue.get_job_state(queue, job.id, connection: conn)

    backend = Backend.create(queue, connection: conn, backend: Backends.Postgres)
    {:ok, counts} = Backend.get_counts(backend)
    assert counts["failed"] == 1
    assert counts["active"] == 0
    assert counts["waiting"] == 0

    Worker.close(worker)
  end

  test "FlowProducer parent completes after its children are processed", %{conn: conn, queue: queue} do
    test_pid = self()

    {:ok, worker} =
      Worker.start_link(
        queue: queue,
        connection: conn,
        processor: fn job -> {:ok, job.name} end,
        on_completed: fn job, _result -> send(test_pid, {:completed, job.name}) end
      )

    flow = %{
      name: "parent",
      queue_name: queue,
      data: %{},
      children: [
        %{name: "child_a", queue_name: queue, data: %{}},
        %{name: "child_b", queue_name: queue, data: %{}}
      ]
    }

    {:ok, _result} = FlowProducer.add(flow, connection: conn)

    # Both children and, once their dependencies resolve, the parent complete.
    names = for _ <- 1..3, do: receive(do: ({:completed, n} -> n), after: (15_000 -> :timeout))
    assert Enum.sort(names) == ["child_a", "child_b", "parent"]

    Worker.close(worker)
  end

  test "FlowProducer honors a per-call backend override", %{conn: conn, queue: queue} do
    previous = Application.get_env(:bullmq, :backend)
    Application.put_env(:bullmq, :backend, Backends.Redis)

    on_exit(fn ->
      if previous do
        Application.put_env(:bullmq, :backend, previous)
      else
        Application.delete_env(:bullmq, :backend)
      end
    end)

    flow = %{
      name: "parent",
      queue_name: queue,
      data: %{},
      children: [
        %{name: "child", queue_name: queue, data: %{}}
      ]
    }

    {:ok, result} = FlowProducer.add(flow, connection: conn, backend: Backends.Postgres)

    assert result.job.backend == Backends.Postgres
    assert {:ok, 1} = Job.get_dependencies_count(result.job)
  end

  test "Queue.get_counts_per_priority returns correct counts per priority", %{
    conn: conn,
    queue: queue
  } do
    for i <- 0..41 do
      Queue.add(queue, "job#{i}", %{index: i},
        connection: conn,
        backend: Backends.Postgres,
        priority: rem(i, 4)
      )
    end

    {:ok, counts} =
      Queue.get_counts_per_priority(queue, [0, 1, 2, 3],
        connection: conn,
        backend: Backends.Postgres
      )

    assert counts == %{0 => 11, 1 => 11, 2 => 10, 3 => 10}
  end

  test "Queue.get_counts_per_priority returns zero counts when queue is empty", %{
    conn: conn,
    queue: queue
  } do
    {:ok, counts} =
      Queue.get_counts_per_priority(queue, [0, 1, 2, 3],
        connection: conn,
        backend: Backends.Postgres
      )

    assert counts == %{0 => 0, 1 => 0, 2 => 0, 3 => 0}
  end

  test "QueueEvents streams lifecycle events", %{conn: conn, queue: queue} do
    {:ok, events} = QueueEvents.start_link(queue: queue, connection: conn)
    QueueEvents.subscribe(events)
    Process.sleep(200)

    {:ok, job} = Queue.add(queue, "evented", %{foo: "bar"}, connection: conn)

    assert_receive {:bullmq_event, :added, added}, 10_000
    assert added["jobId"] == job.id
    assert added["name"] == "evented"

    QueueEvents.close(events)
  end

  test "QueueEvents honors a per-instance backend override", %{conn: conn, queue: queue} do
    previous = Application.get_env(:bullmq, :backend)
    Application.put_env(:bullmq, :backend, Backends.Redis)

    on_exit(fn ->
      if previous do
        Application.put_env(:bullmq, :backend, previous)
      else
        Application.delete_env(:bullmq, :backend)
      end
    end)

    {:ok, events} =
      QueueEvents.start_link(queue: queue, connection: conn, backend: Backends.Postgres)

    QueueEvents.subscribe(events)
    Process.sleep(200)

    {:ok, job} =
      Queue.add(queue, "evented-explicit", %{foo: "bar"},
        connection: conn,
        backend: Backends.Postgres
      )

    assert_receive {:bullmq_event, :added, added}, 10_000
    assert added["jobId"] == job.id
    assert added["name"] == "evented-explicit"

    QueueEvents.close(events)
  end

  test "Queue honors a per-instance backend override across later calls", %{
    conn: conn,
    queue: queue
  } do
    previous = Application.get_env(:bullmq, :backend)
    Application.put_env(:bullmq, :backend, Backends.Redis)

    on_exit(fn ->
      if previous do
        Application.put_env(:bullmq, :backend, previous)
      else
        Application.delete_env(:bullmq, :backend)
      end
    end)

    queue_name = :"pg_queue_#{System.unique_integer([:positive])}"

    {:ok, server} =
      Queue.start_link(name: queue_name, queue: queue, connection: conn, backend: Backends.Postgres)

    on_exit(fn ->
      if Process.alive?(server) do
        GenServer.stop(server)
      end
    end)

    {:ok, job} = Queue.add(queue_name, "evented-explicit", %{foo: "bar"})
    assert {:ok, "waiting"} = Queue.get_job_state(queue_name, job.id)

    Process.sleep(200)
    assert {:ok, meta} = Queue.get_meta(queue_name)
    assert meta.version == BullMQ.Version.full_version()
  end

  test "JobScheduler.upsert registers and lists a scheduler", %{conn: conn, queue: queue} do
    {:ok, _job} =
      JobScheduler.upsert(
        conn,
        queue,
        "every-scheduler",
        %{every: 1000},
        "scheduled-job",
        %{payload: 1}
      )

    assert {:ok, scheduler} = JobScheduler.get(conn, queue, "every-scheduler")
    assert scheduler.name == "scheduled-job" or scheduler.key == "every-scheduler"

    assert {:ok, count} = JobScheduler.count(conn, queue)
    assert count >= 1
  end

  test "delayed jobs are promoted and processed", %{conn: conn, queue: queue} do
    test_pid = self()

    {:ok, worker} =
      Worker.start_link(
        queue: queue,
        connection: conn,
        processor: fn job -> {:ok, job.data["v"]} end,
        on_completed: fn job, result -> send(test_pid, {:completed, job.id, result}) end
      )

    {:ok, job} = Queue.add(queue, "delayed", %{v: 7}, connection: conn, delay: 500)
    assert {:ok, "delayed"} = Queue.get_job_state(queue, job.id, connection: conn)

    assert_receive {:completed, job_id, 7}, 10_000
    assert job_id == job.id

    Worker.close(worker)
  end
end
