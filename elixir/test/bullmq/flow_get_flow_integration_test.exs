defmodule BullMQ.FlowGetFlowIntegrationTest do
  @moduledoc """
  Integration tests for `BullMQ.FlowProducer.get_flow/2` (Node.js
  `FlowProducer.getFlow`) and for the job options stored by flows and bulk
  adds (they must use the Node.js option names).
  """
  use ExUnit.Case, async: false

  @moduletag :integration

  alias BullMQ.{FlowProducer, Job, Queue, RedisConnection, Worker}

  @redis_url BullMQ.TestHelper.redis_url()
  @test_prefix BullMQ.TestHelper.test_prefix()

  setup do
    conn = :"get_flow_conn_#{System.unique_integer([:positive])}"
    {:ok, pid} = RedisConnection.start_link(name: conn, url: @redis_url)
    Process.unlink(pid)

    queue_name = "get-flow-#{System.unique_integer([:positive])}"
    child_queue = "#{queue_name}-children"

    on_exit(fn ->
      {:ok, cleanup} = Redix.start_link(@redis_url)

      for q <- [queue_name, child_queue] do
        case Redix.command(cleanup, ["KEYS", "#{@test_prefix}:#{q}:*"]) do
          {:ok, [_ | _] = keys} -> Redix.command(cleanup, ["DEL" | keys])
          _ -> :ok
        end
      end

      Redix.stop(cleanup)
      RedisConnection.close(conn)
    end)

    {:ok, conn: conn, queue_name: queue_name, child_queue: child_queue}
  end

  defp names(nodes), do: nodes |> Enum.map(& &1.job.name) |> Enum.sort()

  describe "get_flow/2" do
    test "returns the whole tree with jobs read from the datastore", ctx do
      {:ok, added} =
        FlowProducer.add(
          %{
            name: "root",
            queue_name: ctx.queue_name,
            data: %{level: 0},
            children: [
              %{name: "child-a", queue_name: ctx.child_queue, data: %{level: 1}},
              %{
                name: "child-b",
                queue_name: ctx.child_queue,
                data: %{level: 1},
                children: [
                  %{name: "grandchild", queue_name: ctx.queue_name, data: %{level: 2}}
                ]
              }
            ]
          },
          connection: ctx.conn,
          prefix: @test_prefix
        )

      {:ok, tree} =
        FlowProducer.get_flow(%{id: added.job.id, queue_name: ctx.queue_name},
          connection: ctx.conn,
          prefix: @test_prefix
        )

      assert %Job{name: "root", data: %{"level" => 0}} = tree.job
      assert tree.job.id == added.job.id
      assert tree.job.queue_name == ctx.queue_name
      assert names(tree.children) == ["child-a", "child-b"]

      child_b = Enum.find(tree.children, &(&1.job.name == "child-b"))
      assert child_b.job.queue_name == ctx.child_queue
      assert child_b.job.parent_key == "#{@test_prefix}:#{ctx.queue_name}:#{added.job.id}"
      assert [%{job: %Job{name: "grandchild"}, children: []}] = child_b.children

      child_a = Enum.find(tree.children, &(&1.job.name == "child-a"))
      assert child_a.children == []

      # Jobs in the tree are usable (connection/backend set)
      assert {:ok, "waiting-children"} = Job.get_state(tree.job)
      assert {:ok, "waiting"} = Job.get_state(child_a.job)
    end

    test "respects depth", ctx do
      {:ok, added} =
        FlowProducer.add(
          %{
            name: "root",
            queue_name: ctx.queue_name,
            children: [
              %{
                name: "child",
                queue_name: ctx.queue_name,
                children: [%{name: "grandchild", queue_name: ctx.queue_name}]
              }
            ]
          },
          connection: ctx.conn,
          prefix: @test_prefix
        )

      opts = [connection: ctx.conn, prefix: @test_prefix]

      {:ok, only_root} =
        FlowProducer.get_flow(%{id: added.job.id, queue_name: ctx.queue_name, depth: 1}, opts)

      assert only_root.job.name == "root"
      assert only_root.children == []

      {:ok, two_levels} =
        FlowProducer.get_flow([id: added.job.id, queue_name: ctx.queue_name, depth: 2], opts)

      assert [%{job: %Job{name: "child"}, children: []}] = two_levels.children
    end

    test "max_children limits the children fetched per dependency type", ctx do
      # More children than `set-max-listpack-entries` (128) so the dependencies
      # set is a real hash table and SSCAN honours its COUNT hint (a small
      # listpack-encoded set is always returned whole, as in Node.js).
      total = 150

      children =
        for i <- 1..total, do: %{name: "child-#{i}", queue_name: ctx.child_queue, data: %{i: i}}

      {:ok, added} =
        FlowProducer.add(
          %{name: "root", queue_name: ctx.queue_name, children: children},
          connection: ctx.conn,
          prefix: @test_prefix
        )

      opts = [connection: ctx.conn, prefix: @test_prefix]

      {:ok, tree} =
        FlowProducer.get_flow(%{id: added.job.id, queue_name: ctx.queue_name}, opts)

      # Default max_children is 20 (a COUNT hint, so a few more may come back)
      assert length(tree.children) >= 20
      assert length(tree.children) < total

      {:ok, tree} =
        FlowProducer.get_flow(
          %{id: added.job.id, queue_name: ctx.queue_name, max_children: 1_000},
          opts
        )

      assert length(tree.children) == total
    end

    test "includes processed, failed and ignored children", ctx do
      {:ok, added} =
        FlowProducer.add(
          %{
            name: "root",
            queue_name: ctx.queue_name,
            children: [
              %{name: "ok", queue_name: ctx.child_queue},
              %{
                name: "ignored",
                queue_name: ctx.child_queue,
                opts: %{ignore_dependency_on_failure: true}
              },
              %{
                name: "fatal",
                queue_name: ctx.child_queue,
                opts: %{fail_parent_on_failure: true}
              }
            ]
          },
          connection: ctx.conn,
          prefix: @test_prefix
        )

      test_pid = self()

      {:ok, worker} =
        Worker.start_link(
          queue: ctx.child_queue,
          connection: ctx.conn,
          prefix: @test_prefix,
          processor: fn
            %Job{name: "ok"} -> {:ok, "done"}
            %Job{name: name} -> {:error, "#{name} failed"}
          end,
          on_completed: fn job, _ -> send(test_pid, {:finished, job.name}) end,
          on_failed: fn job, _ -> send(test_pid, {:finished, job.name}) end
        )

      for _ <- 1..3, do: assert_receive({:finished, _}, 5_000)
      Worker.close(worker)

      {:ok, tree} =
        FlowProducer.get_flow(%{id: added.job.id, queue_name: ctx.queue_name},
          connection: ctx.conn,
          prefix: @test_prefix
        )

      # processed, unprocessed, failed, ignored — as in Node.js
      assert Enum.map(tree.children, & &1.job.name) == ["ok", "fatal", "ignored"]
      [ok, fatal, ignored] = tree.children
      assert ok.job.return_value == "done"
      assert fatal.job.failed_reason == "fatal failed"
      assert ignored.job.failed_reason == "ignored failed"
    end

    test "returns nil when the root job does not exist", ctx do
      assert {:ok, nil} =
               FlowProducer.get_flow(%{id: "missing", queue_name: ctx.queue_name},
                 connection: ctx.conn,
                 prefix: @test_prefix
               )
    end
  end

  describe "stored job options" do
    defp stored_opts(ctx, queue, id) do
      {:ok, raw} =
        RedisConnection.command(ctx.conn, ["HGET", "#{@test_prefix}:#{queue}:#{id}", "opts"])

      Jason.decode!(raw)
    end

    test "flow children store the Node.js option names", ctx do
      {:ok, added} =
        FlowProducer.add(
          %{
            name: "root",
            queue_name: ctx.queue_name,
            children: [
              %{
                name: "c1",
                queue_name: ctx.child_queue,
                opts: %{
                  attempts: 2,
                  continue_parent_on_failure: true,
                  remove_dependency_on_failure: true,
                  remove_on_complete: true
                }
              },
              %{
                name: "c2",
                queue_name: ctx.child_queue,
                opts: %{fail_parent_on_failure: true, ignore_dependency_on_failure: true}
              }
            ]
          },
          connection: ctx.conn,
          prefix: @test_prefix
        )

      [c1, c2] = Enum.sort_by(added.children, & &1.job.name)

      opts1 = stored_opts(ctx, ctx.child_queue, c1.job.id)
      assert opts1["attempts"] == 2
      assert opts1["cpof"] == true
      assert opts1["rdof"] == true
      assert opts1["removeOnComplete"] == true

      opts2 = stored_opts(ctx, ctx.child_queue, c2.job.id)
      assert opts2["fpof"] == true
      assert opts2["idof"] == true

      for opts <- [opts1, opts2], key <- Map.keys(opts) do
        refute key =~ "_", "unexpected snake_case option #{key} in #{inspect(opts)}"
      end

      # Read back through the Elixir API, they decode to the snake_case names
      {:ok, job} =
        Queue.get_job(ctx.child_queue, c1.job.id, connection: ctx.conn, prefix: @test_prefix)

      assert job.opts["continue_parent_on_failure"] == true
      assert job.opts["remove_dependency_on_failure"] == true
    end

    test "add and add_bulk store the Node.js option names", ctx do
      {:ok, job} =
        Queue.add(ctx.queue_name, "single", %{},
          connection: ctx.conn,
          prefix: @test_prefix,
          attempts: 3,
          remove_on_fail: 10,
          fail_parent_on_failure: true,
          continue_parent_on_failure: true
        )

      {:ok, [bulk]} =
        Queue.add_bulk(
          ctx.queue_name,
          [{"bulk", %{}, [attempts: 2, ignore_dependency_on_failure: true]}],
          connection: ctx.conn,
          prefix: @test_prefix
        )

      single = stored_opts(ctx, ctx.queue_name, job.id)
      assert single["attempts"] == 3
      assert single["removeOnFail"] == 10
      assert single["fpof"] == true
      assert single["cpof"] == true

      bulk_opts = stored_opts(ctx, ctx.queue_name, bulk.id)
      assert bulk_opts["attempts"] == 2
      assert bulk_opts["idof"] == true

      for opts <- [single, bulk_opts], key <- Map.keys(opts) do
        refute key =~ "_", "unexpected snake_case option #{key} in #{inspect(opts)}"
      end
    end
  end
end
