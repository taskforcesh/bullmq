# Job Flows

Job Flows allow you to create parent-child relationships between jobs, enabling complex workflows with dependencies.

## Overview

A flow is a tree of jobs where:

- **Parent jobs** wait for all their **children** to complete before running
- Children can have their own children (nested flows)
- Results from children are available to the parent when it runs
- **All jobs in a flow are added atomically** (all or nothing) using Redis MULTI/EXEC transactions

## Basic Flow

A parent job waits for all its children to complete before running:

```elixir
# All jobs are added atomically - either all succeed or none do
{:ok, flow} = BullMQ.FlowProducer.add(%{
  name: "generate-report",
  queue_name: "reports",
  data: %{report_id: 123},
  children: [
    %{
      name: "fetch-users",
      queue_name: "data-fetch",
      data: %{source: "users"}
    },
    %{
      name: "fetch-orders",
      queue_name: "data-fetch",
      data: %{source: "orders"}
    }
  ]
}, connection: :my_redis)
```

Execution order:

1. `fetch-users` and `fetch-orders` run (possibly in parallel)
2. When both complete, `generate-report` runs

## Flow Structure

A flow is defined as a tree of jobs:

```elixir
%{
  name: "parent_job",
  queue_name: "main_queue",
  data: %{...},
  opts: %{...},        # Job options (priority, attempts, etc.)
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
```

## Nested Flows

Children can have their own children:

```elixir
BullMQ.FlowProducer.add(%{
  name: "deploy-application",
  queue_name: "deploy",
  data: %{app: "myapp"},
  children: [
    %{
      name: "build",
      queue_name: "build",
      data: %{},
      children: [
        %{name: "compile", queue_name: "build", data: %{}},
        %{name: "test", queue_name: "test", data: %{}}
      ]
    },
    %{
      name: "prepare-infra",
      queue_name: "infrastructure",
      data: %{}
    }
  ]
}, connection: :my_redis)
```

Execution:

1. `compile` and `test` run in parallel
2. When both complete, `build` runs
3. `prepare-infra` runs independently (in parallel with build steps)
4. When `build` and `prepare-infra` both complete, `deploy-application` runs

## Accessing Child Results

When a parent job is processed, it can access the results of its children using methods on `BullMQ.Job`:

```elixir
# Child processor
def process(%BullMQ.Job{name: "fetch-data"} = job) do
  data = fetch_from_source(job.data["source"])
  {:ok, %{data: data, count: length(data)}}
end

# Parent processor
def process(%BullMQ.Job{name: "aggregate"} = job) do
  # Get children results
  {:ok, children_values} = BullMQ.Job.get_children_values(job)

  # children_values is a map of child job keys to their return values
  total = Enum.reduce(children_values, 0, fn {_key, value}, acc ->
    acc + value["count"]
  end)

  {:ok, %{total: total}}
end
```

### Available Methods

- **`BullMQ.Job.get_children_values/1`** - Get return values from completed children
- **`BullMQ.Job.get_ignored_children_failures/1`** - Get failures from children that were ignored
- **`BullMQ.Job.get_dependencies/1`** - Get list of pending child job keys
- **`BullMQ.Job.get_dependencies_count/1`** - Get count of pending dependencies

## Flow Options

Apply options to individual jobs in the flow:

```elixir
BullMQ.FlowProducer.add(%{
  name: "parent",
  queue_name: "main",
  data: %{},
  opts: %{
    priority: 1
  },
  children: [
    %{
      name: "important-child",
      queue_name: "tasks",
      data: %{},
      opts: %{
        priority: 1,
        attempts: 5,
        backoff: %{type: "exponential", delay: 1000}
      }
    },
    %{
      name: "batch-child",
      queue_name: "tasks",
      data: %{},
      opts: %{
        priority: 10  # Lower priority
      }
    }
  ]
}, connection: :my_redis)
```

## Common Patterns

### ETL Pipeline

```elixir
BullMQ.FlowProducer.add(%{
  name: "load-data",
  queue_name: "etl",
  data: %{destination: "warehouse"},
  children: [
    %{
      name: "transform",
      queue_name: "etl",
      data: %{},
      children: [
        %{name: "extract-api", queue_name: "etl", data: %{source: "api"}},
        %{name: "extract-db", queue_name: "etl", data: %{source: "database"}}
      ]
    }
  ]
}, connection: :my_redis)
```

### Order Processing

```elixir
BullMQ.FlowProducer.add(%{
  name: "complete-order",
  queue_name: "orders",
  data: %{order_id: 123},
  children: [
    %{name: "validate-order", queue_name: "validation", data: %{order_id: 123}},
    %{name: "charge-payment", queue_name: "payments", data: %{order_id: 123}},
    %{name: "reserve-inventory", queue_name: "inventory", data: %{order_id: 123}}
  ]
}, connection: :my_redis)
```

### Report Generation

```elixir
BullMQ.FlowProducer.add(%{
  name: "email-report",
  queue_name: "notifications",
  data: %{recipients: ["admin@example.com"]},
  children: [
    %{
      name: "generate-pdf",
      queue_name: "reports",
      data: %{format: "pdf"},
      children: [
        %{name: "query-sales", queue_name: "data", data: %{type: "sales"}},
        %{name: "query-users", queue_name: "data", data: %{type: "users"}}
      ]
    }
  ]
}, connection: :my_redis)
```

## Worker Setup

Each queue in a flow needs a worker:

```elixir
# Workers for different queues in the flow
{:ok, _} = BullMQ.Worker.start_link(
  queue: "data-fetch",
  connection: :my_redis,
  processor: &MyApp.DataFetcher.process/1
)

{:ok, _} = BullMQ.Worker.start_link(
  queue: "reports",
  connection: :my_redis,
  processor: &MyApp.ReportGenerator.process/1
)
```

## Adding Multiple Flows

Use `add_bulk/2` to add multiple flows atomically. All flows are added in a single
Redis transaction - either all succeed or none do:

```elixir
flows = [
  %{
    name: "flow1_parent",
    queue_name: "main",
    data: %{flow: 1},
    children: [
      %{name: "flow1_child", queue_name: "tasks", data: %{}}
    ]
  },
  %{
    name: "flow2_parent",
    queue_name: "main",
    data: %{flow: 2},
    children: [
      %{name: "flow2_child", queue_name: "tasks", data: %{}}
    ]
  }
]

# All flows are added atomically
{:ok, results} = BullMQ.FlowProducer.add_bulk(flows, connection: :my_redis)
```

## Error Handling in Flows

When a child fails, the parent's behavior depends on the child's configuration:

```elixir
BullMQ.FlowProducer.add(%{
  name: "parent",
  queue_name: "main",
  data: %{},
  children: [
    %{
      name: "critical-child",
      queue_name: "tasks",
      data: %{},
      opts: %{
        attempts: 3  # Retry 3 times before failing
      }
    },
    %{
      name: "optional-child",
      queue_name: "tasks",
      data: %{},
      opts: %{
        # If this child fails, ignore it and continue with parent
        ignore_dependency_on_failure: true
      }
    }
  ]
}, connection: :my_redis)
```

### Failure Options

- **`:attempts`** - Number of retry attempts before marking as failed
- **`:fail_parent_on_failure`** - If `false`, parent continues even if child fails (default: `true`)
- **`:ignore_dependency_on_failure`** - Ignore failed child and let parent continue

If a child exhausts all retries:

1. Child moves to `failed`
2. Parent remains in `waiting-children` until all children resolve
3. Parent can access failed children via `BullMQ.Job.get_ignored_children_failures/1`

## Map-Reduce Pattern

```elixir
# Create a reducer parent with mapper children
items = fetch_large_dataset()
chunks = Enum.chunk_every(items, 100)

children = Enum.map(chunks, fn chunk ->
  %{
    name: "map-chunk",
    queue_name: "mappers",
    data: %{items: chunk}
  }
end)

BullMQ.FlowProducer.add(%{
  name: "reduce-results",
  queue_name: "reducers",
  data: %{},
  children: children
}, connection: :my_redis)
```

## Node.js Compatibility

Flows are fully compatible with Node.js BullMQ:

- Flows created in Elixir can be processed by Node.js workers
- Flows created in Node.js can be processed by Elixir workers
- Mixed environments work seamlessly

## Limitations

- Maximum depth of nested flows: ~100 levels (practical limit)
- All children must complete (or fail) before parent runs
- Children in the same flow can run in parallel
- Parent cannot cancel running children

## Next Steps

- Learn about [Workers](workers.md) to process flow jobs
- Configure [Job Options](job_options.md) for flow nodes
- Set up [Queue Events](queue_events.md) to monitor flow execution
