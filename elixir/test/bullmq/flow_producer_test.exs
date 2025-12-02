defmodule BullMQ.FlowProducerTest do
  use ExUnit.Case, async: false

  alias BullMQ.{FlowProducer, Queue, Worker, Job, Keys, RedisConnection}

  @moduletag timeout: 120_000

  @redis_opts [host: "localhost", port: 6379]

  setup do
    # Generate unique queue name for each test
    queue_name = "test_flow_#{:erlang.unique_integer([:positive])}"
    conn_name = :"flow_test_conn_#{:erlang.unique_integer([:positive])}"

    # Start a Redis connection
    {:ok, _pid} = RedisConnection.start_link(Keyword.merge(@redis_opts, name: conn_name))

    # Clean up any existing data
    {:ok, keys} = RedisConnection.command(conn_name, ["KEYS", "bull:#{queue_name}*"])
    if length(keys) > 0 do
      RedisConnection.command(conn_name, ["DEL" | keys])
    end

    on_exit(fn ->
      # Try to cleanup, but don't fail if connection is already gone
      try do
        {:ok, keys} = RedisConnection.command(conn_name, ["KEYS", "bull:#{queue_name}*"])
        if length(keys) > 0 do
          RedisConnection.command(conn_name, ["DEL" | keys])
        end
      rescue
        _ -> :ok
      catch
        :exit, _ -> :ok
      end
    end)

    {:ok, %{queue_name: queue_name, conn: conn_name}}
  end

  describe "add/2 - basic flows" do
    test "adds a simple job without children", %{queue_name: queue_name, conn: conn} do
      flow = %{
        name: "simple_job",
        queue_name: queue_name,
        data: %{value: 42}
      }

      {:ok, result} = FlowProducer.add(flow, connection: conn)

      assert result.job.name == "simple_job"
      # Data may have atom or string keys depending on processing
      assert result.job.data[:value] == 42 || result.job.data["value"] == 42
      assert result.job.queue_name == queue_name
      assert result.children == []

      # Verify job is in waiting state
      ctx = Keys.new(queue_name, prefix: "bull")
      {:ok, wait_list} = RedisConnection.command(conn, ["LRANGE", Keys.wait(ctx), 0, -1])
      assert result.job.id in wait_list
    end

    test "adds a parent with single child", %{queue_name: queue_name, conn: conn} do
      flow = %{
        name: "parent_job",
        queue_name: queue_name,
        data: %{type: "parent"},
        children: [
          %{
            name: "child_job",
            queue_name: queue_name,
            data: %{type: "child"}
          }
        ]
      }

      {:ok, result} = FlowProducer.add(flow, connection: conn)

      # Parent should be created
      assert result.job.name == "parent_job"
      # Data can have atom or string keys
      assert result.job.data[:type] == "parent" || result.job.data["type"] == "parent"

      # Child should be created
      assert length(result.children) == 1
      child = hd(result.children)
      assert child.job.name == "child_job"
      assert child.job.data[:type] == "child" || child.job.data["type"] == "child"

      # Parent should be in waiting-children state
      ctx = Keys.new(queue_name, prefix: "bull")
      {:ok, wc_list} = RedisConnection.command(conn, ["ZRANGE", Keys.waiting_children(ctx), 0, -1])
      assert result.job.id in wc_list

      # Child should be in waiting state
      {:ok, wait_list} = RedisConnection.command(conn, ["LRANGE", Keys.wait(ctx), 0, -1])
      assert child.job.id in wait_list
    end

    test "adds a parent with multiple children", %{queue_name: queue_name, conn: conn} do
      flow = %{
        name: "parent_job",
        queue_name: queue_name,
        data: %{aggregate: true},
        children: [
          %{name: "child_1", queue_name: queue_name, data: %{id: 1}},
          %{name: "child_2", queue_name: queue_name, data: %{id: 2}},
          %{name: "child_3", queue_name: queue_name, data: %{id: 3}}
        ]
      }

      {:ok, result} = FlowProducer.add(flow, connection: conn)

      assert result.job.name == "parent_job"
      assert length(result.children) == 3

      child_names = Enum.map(result.children, fn c -> c.job.name end)
      assert "child_1" in child_names
      assert "child_2" in child_names
      assert "child_3" in child_names

      # Parent should be in waiting-children
      ctx = Keys.new(queue_name, prefix: "bull")
      {:ok, wc_list} = RedisConnection.command(conn, ["ZRANGE", Keys.waiting_children(ctx), 0, -1])
      assert result.job.id in wc_list

      # All children should be in waiting
      {:ok, wait_list} = RedisConnection.command(conn, ["LRANGE", Keys.wait(ctx), 0, -1])
      for child <- result.children do
        assert child.job.id in wait_list
      end
    end

    test "supports 'queue' for backward compatibility", %{queue_name: queue_name, conn: conn} do
      # Using 'queue' instead of 'queue_name'
      flow = %{
        name: "compat_job",
        queue: queue_name,
        data: %{compat: true},
        children: [
          %{name: "child", queue: queue_name, data: %{}}
        ]
      }

      {:ok, result} = FlowProducer.add(flow, connection: conn)

      assert result.job.name == "compat_job"
      assert result.job.queue_name == queue_name
      assert length(result.children) == 1
    end
  end

  describe "add/2 - nested flows" do
    test "adds deeply nested flow", %{queue_name: queue_name, conn: conn} do
      flow = %{
        name: "root",
        queue_name: queue_name,
        data: %{level: 0},
        children: [
          %{
            name: "level1",
            queue_name: queue_name,
            data: %{level: 1},
            children: [
              %{
                name: "level2",
                queue_name: queue_name,
                data: %{level: 2},
                children: [
                  %{name: "leaf", queue_name: queue_name, data: %{level: 3}}
                ]
              }
            ]
          }
        ]
      }

      {:ok, result} = FlowProducer.add(flow, connection: conn)

      # Verify structure
      assert result.job.name == "root"
      assert length(result.children) == 1

      level1 = hd(result.children)
      assert level1.job.name == "level1"
      assert length(level1.children) == 1

      level2 = hd(level1.children)
      assert level2.job.name == "level2"
      assert length(level2.children) == 1

      leaf = hd(level2.children)
      assert leaf.job.name == "leaf"
      assert leaf.children == []
    end

    test "adds mixed depth children", %{queue_name: queue_name, conn: conn} do
      flow = %{
        name: "root",
        queue_name: queue_name,
        data: %{},
        children: [
          # Leaf child
          %{name: "leaf_child", queue_name: queue_name, data: %{}},
          # Branch child
          %{
            name: "branch_child",
            queue_name: queue_name,
            data: %{},
            children: [
              %{name: "grandchild", queue_name: queue_name, data: %{}}
            ]
          }
        ]
      }

      {:ok, result} = FlowProducer.add(flow, connection: conn)

      assert result.job.name == "root"
      assert length(result.children) == 2

      leaf = Enum.find(result.children, fn c -> c.job.name == "leaf_child" end)
      assert leaf.children == []

      branch = Enum.find(result.children, fn c -> c.job.name == "branch_child" end)
      assert length(branch.children) == 1
      assert hd(branch.children).job.name == "grandchild"
    end
  end

  describe "add/2 - multi-queue flows" do
    test "adds flow with children in different queues", %{queue_name: queue_name, conn: conn} do
      other_queue = "#{queue_name}_other"

      flow = %{
        name: "parent",
        queue_name: queue_name,
        data: %{},
        children: [
          %{name: "child_same", queue_name: queue_name, data: %{}},
          %{name: "child_other", queue_name: other_queue, data: %{}}
        ]
      }

      {:ok, result} = FlowProducer.add(flow, connection: conn)

      # Check parent
      assert result.job.queue_name == queue_name

      # Check children are in their respective queues
      child_same = Enum.find(result.children, fn c -> c.job.name == "child_same" end)
      child_other = Enum.find(result.children, fn c -> c.job.name == "child_other" end)

      assert child_same.job.queue_name == queue_name
      assert child_other.job.queue_name == other_queue

      # Verify both are in waiting state in their queues
      ctx_main = Keys.new(queue_name, prefix: "bull")
      ctx_other = Keys.new(other_queue, prefix: "bull")

      {:ok, wait_main} = RedisConnection.command(conn, ["LRANGE", Keys.wait(ctx_main), 0, -1])
      {:ok, wait_other} = RedisConnection.command(conn, ["LRANGE", Keys.wait(ctx_other), 0, -1])

      assert child_same.job.id in wait_main
      assert child_other.job.id in wait_other

      # Cleanup other queue
      {:ok, keys} = RedisConnection.command(conn, ["KEYS", "bull:#{other_queue}*"])
      if length(keys) > 0 do
        RedisConnection.command(conn, ["DEL" | keys])
      end
    end
  end

  describe "add/2 - job options" do
    test "passes opts to parent job", %{queue_name: queue_name, conn: conn} do
      flow = %{
        name: "parent_with_opts",
        queue_name: queue_name,
        data: %{},
        opts: %{attempts: 5, timeout: 30_000},
        children: [
          %{name: "child", queue_name: queue_name, data: %{}}
        ]
      }

      {:ok, result} = FlowProducer.add(flow, connection: conn)

      assert result.job.opts[:attempts] == 5 or result.job.opts["attempts"] == 5
    end

    test "passes opts to child jobs", %{queue_name: queue_name, conn: conn} do
      flow = %{
        name: "parent",
        queue_name: queue_name,
        data: %{},
        children: [
          %{
            name: "child_with_opts",
            queue_name: queue_name,
            data: %{},
            opts: %{attempts: 3, remove_on_complete: true}
          }
        ]
      }

      {:ok, result} = FlowProducer.add(flow, connection: conn)

      child = hd(result.children)
      child_opts = child.job.opts

      # Opts can be atoms or strings depending on processing
      attempts = child_opts[:attempts] || child_opts["attempts"]
      assert attempts == 3
    end
  end

  describe "add_bulk/2" do
    test "adds multiple flows at once", %{queue_name: queue_name, conn: conn} do
      flows = [
        %{
          name: "flow1_parent",
          queue_name: queue_name,
          data: %{flow: 1},
          children: [
            %{name: "flow1_child", queue_name: queue_name, data: %{}}
          ]
        },
        %{
          name: "flow2_parent",
          queue_name: queue_name,
          data: %{flow: 2},
          children: [
            %{name: "flow2_child", queue_name: queue_name, data: %{}}
          ]
        }
      ]

      {:ok, results} = FlowProducer.add_bulk(flows, connection: conn)

      assert length(results) == 2

      flow1 = Enum.find(results, fn r -> r.job.name == "flow1_parent" end)
      flow2 = Enum.find(results, fn r -> r.job.name == "flow2_parent" end)

      assert flow1 != nil
      assert flow2 != nil
      assert length(flow1.children) == 1
      assert length(flow2.children) == 1
    end

    test "returns build failure on validation error", %{conn: conn} do
      # One valid flow and one with missing required field
      flows = [
        %{
          name: "valid_flow",
          queue_name: "test_queue",
          data: %{}
        },
        # This should cause an error - missing queue_name/queue
        %{
          name: "invalid_flow",
          data: %{}
        }
      ]

      result = FlowProducer.add_bulk(flows, connection: conn)

      # Should return build failure since validation happens before transaction
      assert match?({:error, {:build_failed, _}}, result)
    end
  end

  describe "get_children_values/1" do
    test "returns empty map when no children processed", %{queue_name: queue_name, conn: conn} do
      # Create a job without children
      {:ok, added} = Queue.add(queue_name, "test_job", %{}, connection: conn)

      job = %Job{
        id: added.id,
        name: "test_job",
        queue_name: queue_name,
        data: %{},
        connection: conn,
        prefix: "bull"
      }

      {:ok, values} = Job.get_children_values(job)
      assert values == %{}
    end
  end

  describe "get_dependencies/1" do
    test "returns empty list when no dependencies", %{queue_name: queue_name, conn: conn} do
      {:ok, added} = Queue.add(queue_name, "test_job", %{}, connection: conn)

      job = %Job{
        id: added.id,
        name: "test_job",
        queue_name: queue_name,
        data: %{},
        connection: conn,
        prefix: "bull"
      }

      {:ok, deps} = Job.get_dependencies(job)
      assert deps == []
    end

    test "returns dependencies for parent job", %{queue_name: queue_name, conn: conn} do
      flow = %{
        name: "parent",
        queue_name: queue_name,
        data: %{},
        children: [
          %{name: "child1", queue_name: queue_name, data: %{}},
          %{name: "child2", queue_name: queue_name, data: %{}}
        ]
      }

      {:ok, result} = FlowProducer.add(flow, connection: conn)

      parent_job = %Job{
        id: result.job.id,
        name: result.job.name,
        queue_name: queue_name,
        data: %{},
        connection: conn,
        prefix: "bull"
      }

      {:ok, deps} = Job.get_dependencies(parent_job)

      # Should have 2 dependencies (the children)
      assert length(deps) == 2
    end
  end

  describe "get_dependencies_count/1" do
    test "returns correct count", %{queue_name: queue_name, conn: conn} do
      flow = %{
        name: "parent",
        queue_name: queue_name,
        data: %{},
        children: [
          %{name: "child1", queue_name: queue_name, data: %{}},
          %{name: "child2", queue_name: queue_name, data: %{}},
          %{name: "child3", queue_name: queue_name, data: %{}}
        ]
      }

      {:ok, result} = FlowProducer.add(flow, connection: conn)

      parent_job = %Job{
        id: result.job.id,
        name: result.job.name,
        queue_name: queue_name,
        data: %{},
        connection: conn,
        prefix: "bull"
      }

      {:ok, count} = Job.get_dependencies_count(parent_job)
      assert count == 3
    end
  end

  describe "Worker integration" do
    @describetag :integration

    @tag timeout: 60_000
    test "parent moves to waiting after all children complete", %{queue_name: queue_name, conn: conn} do
      # Track processed jobs
      test_pid = self()

      # Start worker
      {:ok, worker} = Worker.start_link(
        queue: queue_name,
        connection: conn,
        processor: fn job ->
          send(test_pid, {:processed, job.name, job.id})
          {:ok, %{result: job.name}}
        end
      )

      # Create flow
      flow = %{
        name: "parent",
        queue_name: queue_name,
        data: %{type: "parent"},
        children: [
          %{name: "child1", queue_name: queue_name, data: %{id: 1}},
          %{name: "child2", queue_name: queue_name, data: %{id: 2}}
        ]
      }

      {:ok, result} = FlowProducer.add(flow, connection: conn)
      parent_id = result.job.id

      # Wait for children to be processed first
      assert_receive {:processed, "child1", _}, 10_000
      assert_receive {:processed, "child2", _}, 10_000

      # After children complete, parent should move to waiting and be processed
      assert_receive {:processed, "parent", ^parent_id}, 10_000

      Worker.close(worker)
    end

    @tag timeout: 60_000
    test "parent can access children results after completion", %{queue_name: queue_name, conn: conn} do
      test_pid = self()

      {:ok, worker} = Worker.start_link(
        queue: queue_name,
        connection: conn,
        processor: fn job ->
          if job.name == "parent" do
            # Get children values
            parent_job = %Job{
              id: job.id,
              name: job.name,
              queue_name: queue_name,
              data: job.data,
              connection: conn,
              prefix: "bull"
            }

            {:ok, values} = Job.get_children_values(parent_job)
            send(test_pid, {:parent_values, values})
          end

          # Return a value for children
          {:ok, %{name: job.name, value: 100}}
        end
      )

      flow = %{
        name: "parent",
        queue_name: queue_name,
        data: %{},
        children: [
          %{name: "child1", queue_name: queue_name, data: %{}},
          %{name: "child2", queue_name: queue_name, data: %{}}
        ]
      }

      {:ok, _result} = FlowProducer.add(flow, connection: conn)

      # Wait for parent to be processed and check it received children values
      assert_receive {:parent_values, values}, 15_000

      # Values should contain children's return values
      # Keys are the full job keys like "bull:queue:jobId"
      assert map_size(values) == 2

      Worker.close(worker)
    end

    @tag timeout: 60_000
    test "deeply nested flow processes in correct order", %{queue_name: queue_name, conn: conn} do
      test_pid = self()
      processed_order = Agent.start_link(fn -> [] end) |> elem(1)

      {:ok, worker} = Worker.start_link(
        queue: queue_name,
        connection: conn,
        processor: fn job ->
          Agent.update(processed_order, fn list -> list ++ [job.name] end)
          send(test_pid, {:processed, job.name})
          {:ok, %{}}
        end
      )

      flow = %{
        name: "root",
        queue_name: queue_name,
        data: %{},
        children: [
          %{
            name: "branch",
            queue_name: queue_name,
            data: %{},
            children: [
              %{name: "leaf", queue_name: queue_name, data: %{}}
            ]
          }
        ]
      }

      {:ok, _result} = FlowProducer.add(flow, connection: conn)

      # Wait for all jobs
      assert_receive {:processed, "leaf"}, 10_000
      assert_receive {:processed, "branch"}, 10_000
      assert_receive {:processed, "root"}, 10_000

      # Verify order
      order = Agent.get(processed_order, & &1)
      leaf_idx = Enum.find_index(order, &(&1 == "leaf"))
      branch_idx = Enum.find_index(order, &(&1 == "branch"))
      root_idx = Enum.find_index(order, &(&1 == "root"))

      # Leaf must be processed before branch
      assert leaf_idx < branch_idx
      # Branch must be processed before root
      assert branch_idx < root_idx

      Agent.stop(processed_order)
      Worker.close(worker)
    end
  end
end
