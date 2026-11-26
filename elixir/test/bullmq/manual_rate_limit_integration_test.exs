defmodule BullMQ.ManualRateLimitIntegrationTest do
  @moduledoc """
  Integration tests for the Node.js-compatible manual rate limiting
  (`Queue.rate_limit/3`, the `:rate_limited` / `{:rate_limit_queue, ms}`
  processor returns), the global concurrency / rate limit setters, and
  `Job.move_to_delayed/3` + the `:delayed` processor return.
  """
  use ExUnit.Case, async: false

  @moduletag :integration

  alias BullMQ.{Job, Queue, RedisConnection, Worker}

  @redis_url BullMQ.TestHelper.redis_url()
  @test_prefix BullMQ.TestHelper.test_prefix()

  setup do
    conn = :"manual_rl_conn_#{System.unique_integer([:positive])}"
    {:ok, pid} = RedisConnection.start_link(name: conn, url: @redis_url, pool_size: 5)
    Process.unlink(pid)

    queue_name = "manual-rl-#{System.unique_integer([:positive])}"

    on_exit(fn ->
      {:ok, cleanup} = Redix.start_link(@redis_url)

      case Redix.command(cleanup, ["KEYS", "#{@test_prefix}:#{queue_name}:*"]) do
        {:ok, [_ | _] = keys} -> Redix.command(cleanup, ["DEL" | keys])
        _ -> :ok
      end

      Redix.stop(cleanup)
      RedisConnection.close(conn)
    end)

    {:ok, conn: conn, queue_name: queue_name, opts: [connection: conn, prefix: @test_prefix]}
  end

  defp now, do: System.system_time(:millisecond)

  describe "Queue.rate_limit/3" do
    test "sets the limiter key with a TTL, like Node.js setRateLimit", ctx do
      assert :ok = Queue.rate_limit(ctx.queue_name, 2_000, ctx.opts)

      limiter = "#{@test_prefix}:#{ctx.queue_name}:limiter"
      assert {:ok, "9007199254740991"} = RedisConnection.command(ctx.conn, ["GET", limiter])
      {:ok, pttl} = RedisConnection.command(ctx.conn, ["PTTL", limiter])
      assert pttl > 1_000 and pttl <= 2_000

      # Workers with a limiter see the window through get_rate_limit_ttl
      assert {:ok, ttl} = Queue.get_rate_limit_ttl(ctx.queue_name, ctx.opts ++ [max_jobs: 1])
      assert ttl > 1_000

      assert {:ok, 1} = Queue.remove_rate_limit_key(ctx.queue_name, ctx.opts)
      assert {:ok, nil} = RedisConnection.command(ctx.conn, ["GET", limiter])
    end

    test "works through a Queue process", ctx do
      {:ok, queue} =
        Queue.start_link(
          name: :"q_#{ctx.queue_name}",
          queue: ctx.queue_name,
          connection: ctx.conn,
          prefix: @test_prefix
        )

      assert :ok = Queue.rate_limit(queue, 1_000)

      {:ok, pttl} =
        RedisConnection.command(ctx.conn, ["PTTL", "#{@test_prefix}:#{ctx.queue_name}:limiter"])

      assert pttl > 0
      GenServer.stop(queue)
    end
  end

  describe ":rate_limited processor return" do
    @tag timeout: 15_000
    test "moves the job back to wait without consuming an attempt and waits for the limiter",
         ctx do
      test_pid = self()
      limit_ms = 1_000

      {:ok, job} = Queue.add(ctx.queue_name, "call-api", %{}, ctx.opts ++ [attempts: 1])

      {:ok, worker} =
        Worker.start_link(
          queue: ctx.queue_name,
          connection: ctx.conn,
          prefix: @test_prefix,
          limiter: %{max: 1, duration: 100},
          processor: fn job ->
            send(test_pid, {:processing, job.attempts_started, now()})

            if job.attempts_started == 1 do
              :ok = Queue.rate_limit(job.queue_name, limit_ms, ctx.opts)
              :rate_limited
            else
              {:ok, "done"}
            end
          end,
          on_completed: fn job, result -> send(test_pid, {:completed, job, result}) end,
          on_failed: fn job, reason -> send(test_pid, {:failed, job.id, reason}) end
        )

      assert_receive {:processing, 1, first_at}, 5_000

      # While limited, the job is back in wait (not delayed, not failed)
      Process.sleep(200)
      assert {:ok, "waiting"} = Queue.get_job_state(ctx.queue_name, job.id, ctx.opts)

      assert_receive {:processing, 2, second_at}, 5_000
      assert second_at - first_at >= limit_ms - 50

      assert_receive {:completed, completed, "done"}, 5_000
      refute_received {:failed, _, _}

      {:ok, stored} = Queue.get_job(ctx.queue_name, job.id, ctx.opts)
      # Only the successful run counts as an attempt (attempts: 1 was enough)
      assert stored.attempts_made == 1
      assert completed.id == job.id

      Worker.close(worker)
    end

    @tag timeout: 15_000
    test "moves a prioritized job back to prioritized, and processes it again", ctx do
      test_pid = self()

      {:ok, job} = Queue.add(ctx.queue_name, "call-api", %{}, ctx.opts ++ [priority: 5])

      {:ok, worker} =
        Worker.start_link(
          queue: ctx.queue_name,
          connection: ctx.conn,
          prefix: @test_prefix,
          limiter: %{max: 1, duration: 100},
          processor: fn job ->
            send(test_pid, {:processing, job.attempts_started})

            if job.attempts_started == 1 do
              :ok = Queue.rate_limit(job.queue_name, 500, ctx.opts)
              :rate_limited
            else
              {:ok, "done"}
            end
          end,
          on_completed: fn job, result -> send(test_pid, {:completed, job.id, result}) end
        )

      assert_receive {:processing, 1}, 5_000
      Process.sleep(200)
      assert {:ok, "prioritized"} = Queue.get_job_state(ctx.queue_name, job.id, ctx.opts)

      assert_receive {:processing, 2}, 5_000
      job_id = job.id
      assert_receive {:completed, ^job_id, "done"}, 5_000

      Worker.close(worker)
    end

    @tag timeout: 15_000
    test "{:rate_limit_queue, ms} sets the limiter and pauses fetching even without a limiter",
         ctx do
      test_pid = self()
      limit_ms = 800

      {:ok, job} = Queue.add(ctx.queue_name, "call-api", %{}, ctx.opts)

      {:ok, worker} =
        Worker.start_link(
          queue: ctx.queue_name,
          connection: ctx.conn,
          prefix: @test_prefix,
          concurrency: 2,
          processor: fn job ->
            send(test_pid, {:processing, job.id, job.attempts_started, now()})

            if job.attempts_started == 1,
              do: {:rate_limit_queue, limit_ms},
              else: :ok
          end,
          on_completed: fn job, _ -> send(test_pid, {:completed, job.id}) end,
          on_failed: fn job, reason -> send(test_pid, {:failed, job.id, reason}) end
        )

      job_id = job.id
      assert_receive {:processing, ^job_id, 1, first_at}, 5_000
      # Let the processor return and the worker apply the limit
      Process.sleep(100)

      {:ok, pttl} =
        RedisConnection.command(ctx.conn, ["PTTL", "#{@test_prefix}:#{ctx.queue_name}:limiter"])

      assert pttl > 0

      assert_receive {:processing, ^job_id, 2, second_at}, 5_000
      assert second_at - first_at >= limit_ms - 50
      assert_receive {:completed, ^job_id}, 5_000
      refute_received {:failed, _, _}

      Worker.close(worker)
    end

    @tag timeout: 15_000
    test "{:rate_limit, ms} keeps its previous behaviour (job moved to delayed)", ctx do
      test_pid = self()

      {:ok, job} = Queue.add(ctx.queue_name, "legacy", %{}, ctx.opts)

      {:ok, worker} =
        Worker.start_link(
          queue: ctx.queue_name,
          connection: ctx.conn,
          prefix: @test_prefix,
          processor: fn job ->
            send(test_pid, {:processing, job.attempts_started})

            if job.attempts_started == 1, do: {:rate_limit, 2_000}, else: :ok
          end
        )

      assert_receive {:processing, 1}, 5_000
      Process.sleep(200)
      assert {:ok, "delayed"} = Queue.get_job_state(ctx.queue_name, job.id, ctx.opts)

      # The legacy return does not touch the queue limiter
      assert {:ok, nil} =
               RedisConnection.command(ctx.conn, [
                 "GET",
                 "#{@test_prefix}:#{ctx.queue_name}:limiter"
               ])

      Worker.close(worker)
    end
  end

  describe "Job.move_to_delayed/3 and the :delayed return" do
    @tag timeout: 15_000
    test "the processor moves the job to delayed itself without consuming an attempt", ctx do
      test_pid = self()

      {:ok, job} = Queue.add(ctx.queue_name, "poll", %{}, ctx.opts ++ [attempts: 1])

      {:ok, worker} =
        Worker.start_link(
          queue: ctx.queue_name,
          connection: ctx.conn,
          prefix: @test_prefix,
          processor: fn job ->
            send(test_pid, {:processing, job.attempts_started, now()})

            if job.attempts_started < 3 do
              :ok = Job.move_to_delayed(job, now() + 300)
              send(test_pid, {:moved, Job.get_state(job)})
              :delayed
            else
              {:ok, :ready}
            end
          end,
          on_completed: fn job, _ -> send(test_pid, {:completed, job.id}) end,
          on_failed: fn job, reason -> send(test_pid, {:failed, job.id, reason}) end
        )

      job_id = job.id
      assert_receive {:processing, 1, t1}, 5_000
      assert_receive {:moved, {:ok, "delayed"}}, 1_000
      assert_receive {:processing, 2, t2}, 5_000
      assert_receive {:processing, 3, _}, 5_000
      assert_receive {:completed, ^job_id}, 5_000
      refute_received {:failed, _, _}
      assert t2 - t1 >= 250

      {:ok, stored} = Queue.get_job(ctx.queue_name, job_id, ctx.opts)
      assert stored.attempts_made == 1
      assert stored.attempts_started == 3

      Worker.close(worker)
    end

    test "returns an error when the token does not own the job lock", ctx do
      {:ok, job} = Queue.add(ctx.queue_name, "x", %{}, ctx.opts)
      {:ok, job} = Queue.get_job(ctx.queue_name, job.id, ctx.opts)

      assert {:error, {:move_to_delayed_failed, _code}} =
               Job.move_to_delayed(job, now() + 1_000, "not-the-token")
    end
  end

  describe "Job.get_state/1" do
    test "returns the job state from the datastore", ctx do
      get = fn %Job{id: id} -> Queue.get_job(ctx.queue_name, id, ctx.opts) |> elem(1) end

      waiting = Queue.add(ctx.queue_name, "w", %{}, ctx.opts) |> elem(1) |> get.()

      delayed =
        Queue.add(ctx.queue_name, "d", %{}, ctx.opts ++ [delay: 60_000]) |> elem(1) |> get.()

      prioritized =
        Queue.add(ctx.queue_name, "p", %{}, ctx.opts ++ [priority: 5]) |> elem(1) |> get.()

      assert {:ok, "waiting"} = Job.get_state(waiting)
      assert {:ok, "delayed"} = Job.get_state(delayed)
      assert {:ok, "prioritized"} = Job.get_state(prioritized)

      Queue.remove_job(ctx.queue_name, waiting.id, ctx.opts)
      assert {:ok, "unknown"} = Job.get_state(waiting)
    end

    test "works on the jobs returned by add and add_bulk, without reloading them", ctx do
      {:ok, added} = Queue.add(ctx.queue_name, "w", %{}, ctx.opts)
      assert {:ok, "waiting"} = Job.get_state(added)

      {:ok, [bulk_standard, bulk_delayed]} =
        Queue.add_bulk(ctx.queue_name, [{"a", %{}, []}, {"b", %{}, [delay: 60_000]}], ctx.opts)

      assert {:ok, "waiting"} = Job.get_state(bulk_standard)
      assert {:ok, "delayed"} = Job.get_state(bulk_delayed)

      {:ok, queue} =
        Queue.start_link(
          name: :"q_state_#{ctx.queue_name}",
          queue: ctx.queue_name,
          connection: ctx.conn,
          prefix: @test_prefix
        )

      {:ok, from_process} = Queue.add(queue, "p", %{}, priority: 3)
      assert {:ok, "prioritized"} = Job.get_state(from_process)
      {:ok, [from_process_bulk]} = Queue.add_bulk(queue, [{"q", %{}, []}])
      assert {:ok, "waiting"} = Job.get_state(from_process_bulk)
      GenServer.stop(queue)
    end
  end

  describe "global concurrency and rate limit" do
    test "set, get and remove the global concurrency", ctx do
      assert {:ok, nil} = Queue.get_global_concurrency(ctx.queue_name, ctx.opts)
      assert :ok = Queue.set_global_concurrency(ctx.queue_name, 4, ctx.opts)
      assert {:ok, 4} = Queue.get_global_concurrency(ctx.queue_name, ctx.opts)

      # Same meta field as Node.js
      assert {:ok, "4"} =
               RedisConnection.command(ctx.conn, [
                 "HGET",
                 "#{@test_prefix}:#{ctx.queue_name}:meta",
                 "concurrency"
               ])

      assert :ok = Queue.remove_global_concurrency(ctx.queue_name, ctx.opts)
      assert {:ok, nil} = Queue.get_global_concurrency(ctx.queue_name, ctx.opts)
    end

    test "set, get and remove the global rate limit", ctx do
      assert {:ok, nil} = Queue.get_global_rate_limit(ctx.queue_name, ctx.opts)
      assert :ok = Queue.set_global_rate_limit(ctx.queue_name, 10, 1_000, ctx.opts)

      assert {:ok, %{max: 10, duration: 1_000}} =
               Queue.get_global_rate_limit(ctx.queue_name, ctx.opts)

      assert :ok = Queue.remove_global_rate_limit(ctx.queue_name, ctx.opts)
      assert {:ok, nil} = Queue.get_global_rate_limit(ctx.queue_name, ctx.opts)
    end

    test "work through a Queue process", ctx do
      {:ok, queue} =
        Queue.start_link(
          name: :"q_#{ctx.queue_name}",
          queue: ctx.queue_name,
          connection: ctx.conn,
          prefix: @test_prefix
        )

      assert :ok = Queue.set_global_concurrency(queue, 2)
      assert {:ok, 2} = Queue.get_global_concurrency(queue)
      assert :ok = Queue.set_global_rate_limit(queue, 5, 500)
      assert {:ok, %{max: 5, duration: 500}} = Queue.get_global_rate_limit(queue)
      assert :ok = Queue.remove_global_concurrency(queue)
      assert :ok = Queue.remove_global_rate_limit(queue)
      assert {:ok, nil} = Queue.get_global_concurrency(queue)
      assert {:ok, nil} = Queue.get_global_rate_limit(queue)

      GenServer.stop(queue)
    end

    @tag timeout: 20_000
    test "global concurrency caps a worker with a higher local concurrency", ctx do
      test_pid = self()
      :ok = Queue.set_global_concurrency(ctx.queue_name, 1, ctx.opts)
      counter = :counters.new(2, [])

      for i <- 1..4, do: {:ok, _} = Queue.add(ctx.queue_name, "j#{i}", %{}, ctx.opts)

      {:ok, worker} =
        Worker.start_link(
          queue: ctx.queue_name,
          connection: ctx.conn,
          prefix: @test_prefix,
          concurrency: 4,
          processor: fn _job ->
            :counters.add(counter, 1, 1)
            current = :counters.get(counter, 1)
            if current > :counters.get(counter, 2), do: :counters.put(counter, 2, current)
            Process.sleep(100)
            :counters.sub(counter, 1, 1)
            :ok
          end,
          on_completed: fn job, _ -> send(test_pid, {:completed, job.id}) end
        )

      for _ <- 1..4, do: assert_receive({:completed, _}, 5_000)
      assert :counters.get(counter, 2) == 1

      Worker.close(worker)
    end

    @tag timeout: 20_000
    test "global rate limit applies to workers without a limiter", ctx do
      test_pid = self()
      :ok = Queue.set_global_rate_limit(ctx.queue_name, 1, 500, ctx.opts)

      for i <- 1..3, do: {:ok, _} = Queue.add(ctx.queue_name, "j#{i}", %{}, ctx.opts)

      {:ok, worker} =
        Worker.start_link(
          queue: ctx.queue_name,
          connection: ctx.conn,
          prefix: @test_prefix,
          concurrency: 3,
          processor: fn _job -> :ok end,
          on_completed: fn _job, _ -> send(test_pid, {:completed, now()}) end
        )

      times =
        for _ <- 1..3 do
          assert_receive {:completed, t}, 5_000
          t
        end
        |> Enum.sort()

      assert List.last(times) - List.first(times) >= 2 * 500 - 100

      Worker.close(worker)
    end
  end
end
