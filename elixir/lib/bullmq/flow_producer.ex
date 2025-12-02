defmodule BullMQ.FlowProducer do
  @moduledoc """
  Create job flows with parent-child dependencies.

  The FlowProducer allows you to create complex job hierarchies where parent
  jobs wait for their children to complete before being processed.

  All flow operations are atomic - either all jobs in a flow are added, or none are.
  This is achieved using Redis MULTI/EXEC transactions.

  ## Usage

      # Create a flow with parent and children
      {:ok, flow} = BullMQ.FlowProducer.add(%{
        name: "process_order",
        queue_name: "orders",
        data: %{order_id: 123},
        children: [
          %{name: "validate", queue_name: "validation", data: %{order_id: 123}},
          %{name: "check_inventory", queue_name: "inventory", data: %{order_id: 123}},
          %{name: "process_payment", queue_name: "payments", data: %{order_id: 123}}
        ]
      }, connection: :redis)

      # The parent job will be processed only after all children complete

  ## Flow Structure

  A flow is defined as a tree of jobs:

      %{
        name: "parent_job",
        queue_name: "main_queue",
        data: %{...},
        opts: %{...},
        children: [
          %{name: "child1", queue_name: "queue1", data: %{...}},
          %{
            name: "child2",
            queue_name: "queue2",
            data: %{...},
            children: [
              %{name: "grandchild", queue_name: "queue3", data: %{...}}
            ]
          }
        ]
      }

  ## Accessing Child Results

  When a parent job is processed, use methods on `BullMQ.Job` to access children:

      def process(%Job{} = job) do
        # Get children results
        {:ok, children_values} = BullMQ.Job.get_children_values(job)

        # Get ignored failures (when using ignore_dependency_on_failure)
        {:ok, ignored} = BullMQ.Job.get_ignored_children_failures(job)

        # Get pending dependencies
        {:ok, deps} = BullMQ.Job.get_dependencies(job)

        {:ok, process_with_children(job.data, children_values)}
      end

  ## Failure Handling

  By default, if a child fails, the parent will also fail. You can control
  this behavior with options:

    * `:fail_parent_on_failure` - If false, parent continues even if children fail
    * `:ignore_dependency_on_failure` - Ignore failed child and continue

  """

  alias BullMQ.{Job, Keys, Scripts}

  require Logger

  @type flow_node :: %{
          required(:name) => String.t(),
          required(:queue_name) => String.t(),
          optional(:data) => term(),
          optional(:opts) => map(),
          optional(:children) => [flow_node()]
        }

  @type flow_result :: %{
          job: Job.t(),
          children: [flow_result()]
        }

  @doc """
  Adds a job flow to the queue atomically.

  Creates the entire job hierarchy, with children being processed before
  their parent. The entire flow is added atomically using Redis MULTI/EXEC -
  either all jobs are added or none are.

  ## Parameters

    * `flow` - Flow definition (see module docs)
    * `opts` - Connection and other options

  ## Options

    * `:connection` - Redis connection (required)
    * `:prefix` - Queue prefix (default: "bull")

  ## Returns

  Returns `{:ok, flow_result}` with the created job hierarchy.
  """
  @spec add(flow_node(), keyword()) :: {:ok, flow_result()} | {:error, term()}
  def add(flow, opts \\ []) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")

    # Ensure scripts are loaded before building commands
    Scripts.ensure_scripts_loaded(conn, [:add_standard_job, :add_parent_job])

    # Build all commands and job tree structure without executing
    case build_flow_commands(flow, nil, prefix, []) do
      {:ok, commands, job_tree} ->
        # Execute all commands atomically in a transaction
        case Scripts.execute_transaction(conn, commands) do
          {:ok, results} ->
            # Check for errors in results
            errors = Enum.filter(results, &match?({:error, _}, &1))
            if Enum.empty?(errors) do
              # Extract job IDs from results and populate the job tree
              job_ids = Enum.map(results, fn {:ok, id} -> to_string(id) end)
              populated_tree = populate_job_ids(job_tree, job_ids, conn, prefix)
              {:ok, populated_tree}
            else
              {:error, {:transaction_failed, errors}}
            end

          {:error, reason} ->
            {:error, reason}
        end

      {:error, _} = error ->
        error
    end
  end

  @doc """
  Adds multiple job flows atomically.

  All flows are added in a single transaction - either all succeed or none do.
  This matches the Node.js FlowProducer.addBulk behavior.

  ## Examples

      flows = [
        %{name: "job1", queue_name: "q1", data: %{}, children: [...]},
        %{name: "job2", queue_name: "q2", data: %{}, children: [...]}
      ]

      {:ok, results} = BullMQ.FlowProducer.add_bulk(flows, connection: :redis)
  """
  @spec add_bulk([flow_node()], keyword()) :: {:ok, [flow_result()]} | {:error, term()}
  def add_bulk(flows, opts \\ []) do
    conn = Keyword.fetch!(opts, :connection)
    prefix = Keyword.get(opts, :prefix, "bull")

    # Ensure scripts are loaded before building commands
    Scripts.ensure_scripts_loaded(conn, [:add_standard_job, :add_parent_job])

    # Build all commands for all flows
    {all_commands, all_trees, errors} =
      Enum.reduce(flows, {[], [], []}, fn flow, {cmds_acc, trees_acc, errs_acc} ->
        case build_flow_commands(flow, nil, prefix, []) do
          {:ok, commands, job_tree} ->
            {cmds_acc ++ commands, trees_acc ++ [job_tree], errs_acc}
          {:error, _} = error ->
            {cmds_acc, trees_acc, errs_acc ++ [error]}
        end
      end)

    if not Enum.empty?(errors) do
      {:error, {:build_failed, errors}}
    else
      # Execute all commands atomically in a single transaction
      case Scripts.execute_transaction(conn, all_commands) do
        {:ok, results} ->
          # Check for errors in results
          result_errors = Enum.filter(results, &match?({:error, _}, &1))
          if Enum.empty?(result_errors) do
            # Extract job IDs and populate all trees
            job_ids = Enum.map(results, fn {:ok, id} -> to_string(id) end)
            populated_trees = populate_multiple_trees(all_trees, job_ids, conn, prefix)
            {:ok, populated_trees}
          else
            {:error, {:transaction_failed, result_errors}}
          end

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  # Private functions - Command Building Phase

  # Builds all commands for a flow without executing them.
  # Returns {:ok, commands, job_tree_template} where job_tree_template
  # has placeholder IDs that will be populated after execution.
  defp build_flow_commands(flow, parent_info, prefix, commands_acc) do
    # Support both queue_name (preferred) and queue (for backward compat)
    queue_name = Map.get(flow, :queue_name) || Map.get(flow, :queue)

    unless queue_name do
      throw {:error, {:missing_queue, "Flow node must have :queue_name or :queue"}}
    end

    name = Map.get(flow, :name)

    unless name do
      throw {:error, {:missing_name, "Flow node must have :name"}}
    end

    data = Map.get(flow, :data, %{})
    opts = Map.get(flow, :opts, %{}) |> normalize_opts()
    children = Map.get(flow, :children, [])

    # Generate job ID (like Node.js uses UUID)
    job_id = Map.get(opts, :job_id) || generate_id()

    ctx = Keys.new(queue_name, prefix: prefix)
    timestamp = System.system_time(:millisecond)

    # Build the queue key for this job
    queue_key = "#{prefix}:#{queue_name}"

    if Enum.empty?(children) do
      # Leaf node - add as standard job
      build_leaf_node_command(ctx, queue_name, name, data, opts, job_id, timestamp, parent_info, prefix, commands_acc)
    else
      # Parent node - add parent first, then children
      build_parent_node_commands(ctx, queue_name, queue_key, name, data, opts, job_id, timestamp, parent_info, prefix, children, commands_acc)
    end
  catch
    {:error, _} = error -> error
  end

  defp build_leaf_node_command(ctx, queue_name, name, data, opts, job_id, timestamp, parent_info, prefix, commands_acc) do
    job = build_job_map(job_id, name, data, queue_name, opts, timestamp, parent_info)
    encoded_opts = encode_job_opts(opts)

    {:ok, cmd} = Scripts.build_add_standard_job_command(ctx, job, encoded_opts)

    job_template = %{
      id: nil,  # Will be populated after execution
      name: name,
      data: data,
      queue_name: queue_name,
      opts: opts,
      prefix: prefix,
      timestamp: timestamp,
      parent: build_parent_from_info(parent_info),
      parent_key: build_parent_key_from_info(parent_info),
      children: []
    }

    {:ok, commands_acc ++ [cmd], job_template}
  end

  defp build_parent_node_commands(ctx, queue_name, queue_key, name, data, opts, job_id, timestamp, parent_info, prefix, children, commands_acc) do
    job = build_job_map(job_id, name, data, queue_name, opts, timestamp, parent_info)
    encoded_opts = encode_job_opts(opts)

    {:ok, cmd} = Scripts.build_add_parent_job_command(ctx, job, encoded_opts)

    # Build parent info for children
    parent_key = "#{queue_key}:#{job_id}"
    parent_info_for_children = %{
      id: job_id,
      queue: queue_name,
      queue_key: queue_key,
      key: parent_key,
      prefix: prefix
    }

    # Build commands for all children recursively
    {children_commands, children_templates} =
      Enum.reduce(children, {[], []}, fn child, {cmds, templates} ->
        case build_flow_commands(child, parent_info_for_children, prefix, []) do
          {:ok, child_cmds, child_template} ->
            {cmds ++ child_cmds, templates ++ [child_template]}
          {:error, _} = error ->
            throw error
        end
      end)

    job_template = %{
      id: nil,  # Will be populated after execution
      name: name,
      data: data,
      queue_name: queue_name,
      opts: opts,
      prefix: prefix,
      timestamp: timestamp,
      parent: build_parent_from_info(parent_info),
      parent_key: build_parent_key_from_info(parent_info),
      children: children_templates
    }

    # Parent command comes first, then all children commands
    {:ok, commands_acc ++ [cmd] ++ children_commands, job_template}
  end

  defp build_job_map(job_id, name, data, queue_name, opts, timestamp, parent_info) do
    %{
      id: job_id,
      name: name,
      data: data,
      queue_name: queue_name,
      opts: opts,
      timestamp: timestamp,
      parent: build_parent_from_info(parent_info)
    }
  end

  # Populates job IDs in the tree template after transaction execution
  defp populate_job_ids(tree_template, job_ids, conn, prefix) do
    {populated, _remaining_ids} = do_populate_job_ids(tree_template, job_ids, conn, prefix)
    populated
  end

  defp do_populate_job_ids(template, [job_id | rest_ids], conn, prefix) do
    job = %Job{
      id: job_id,
      name: template.name,
      data: template.data,
      queue_name: template.queue_name,
      opts: template.opts,
      prefix: prefix,
      timestamp: template.timestamp,
      connection: conn,
      parent: template.parent,
      parent_key: template.parent_key
    }

    # Populate children recursively
    {populated_children, remaining_ids} =
      Enum.reduce(template.children, {[], rest_ids}, fn child_template, {acc, ids} ->
        {populated_child, new_ids} = do_populate_job_ids(child_template, ids, conn, prefix)
        {acc ++ [populated_child], new_ids}
      end)

    result = %{job: job, children: populated_children}
    {result, remaining_ids}
  end

  defp populate_multiple_trees(trees, job_ids, conn, prefix) do
    {populated, _remaining} =
      Enum.reduce(trees, {[], job_ids}, fn tree, {acc, ids} ->
        {populated, remaining} = do_populate_job_ids(tree, ids, conn, prefix)
        {acc ++ [populated], remaining}
      end)
    populated
  end

  # Helper functions

  defp build_parent_from_info(nil), do: nil
  defp build_parent_from_info(parent_info) do
    %{
      id: Map.get(parent_info, :id),
      queue: Map.get(parent_info, :queue),
      queue_key: Map.get(parent_info, :queue_key)
    }
  end

  defp build_parent_key_from_info(nil), do: nil
  defp build_parent_key_from_info(parent_info) do
    Map.get(parent_info, :key)
  end

  defp normalize_opts(opts) when is_list(opts), do: Map.new(opts)
  defp normalize_opts(opts) when is_map(opts), do: opts
  defp normalize_opts(_), do: %{}

  defp encode_job_opts(opts) do
    opts
    |> Map.take([
      :attempts,
      :backoff,
      :lifo,
      :timeout,
      :remove_on_complete,
      :remove_on_fail,
      :deduplication,
      :fail_parent_on_failure,
      :ignore_dependency_on_failure,
      :remove_dependency
    ])
    |> Map.reject(fn {_k, v} -> is_nil(v) end)
  end

  defp generate_id do
    Base.encode16(:crypto.strong_rand_bytes(12), case: :lower)
  end
end
