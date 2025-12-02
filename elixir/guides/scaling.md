# Scaling BullMQ Elixir

This guide explains how to scale BullMQ workers in Elixir, comparing it with Node.js patterns and showing best practices for production deployments.

## Elixir vs Node.js Scaling Model

### Node.js Architecture

In Node.js, each worker runs in a single-threaded event loop. To utilize multiple CPU cores, you need multiple OS processes:

```
Machine (8 cores)
┌─────────────────────────────────────────────────────┐
│ Process 1    Process 2    Process 3    Process 4   │
│ ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│ │ Worker  │  │ Worker  │  │ Worker  │  │ Worker  │ │
│ │ 1 thread│  │ 1 thread│  │ 1 thread│  │ 1 thread│ │
│ └─────────┘  └─────────┘  └─────────┘  └─────────┘ │
│ Process 5    Process 6    Process 7    Process 8   │
│ ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│ │ Worker  │  │ Worker  │  │ Worker  │  │ Worker  │ │
│ └─────────┘  └─────────┘  └─────────┘  └─────────┘ │
└─────────────────────────────────────────────────────┘
               8 OS processes = 8 workers
```

- Each worker = 1 OS process (~30-50MB memory)
- Managed by PM2, cluster module, or container orchestration
- No shared memory between workers

### Elixir Architecture

Elixir runs on the BEAM VM, which automatically uses all CPU cores with lightweight processes:

```
Machine (8 cores)
┌─────────────────────────────────────────────────────┐
│              Single BEAM VM Process                 │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │Scheduler│ │Scheduler│ │Scheduler│ │Scheduler│   │
│  │ Core 1  │ │ Core 2  │ │ Core 3  │ │ Core 4  │   │
│  │┌───────┐│ │┌───────┐│ │┌───────┐│ │┌───────┐│   │
│  ││Worker1││ ││Worker3││ ││Worker5││ ││Worker7││   │
│  ││Worker2││ ││Worker4││ ││Worker6││ ││Worker8││   │
│  │└───────┘│ │└───────┘│ │└───────┘│ │└───────┘│   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │Scheduler│ │Scheduler│ │Scheduler│ │Scheduler│   │
│  │ Core 5  │ │ Core 6  │ │ Core 7  │ │ Core 8  │   │
│  │ ...     │ │ ...     │ │ ...     │ │ ...     │   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
└─────────────────────────────────────────────────────┘
     1 OS process, 8 schedulers, many workers
```

- Single OS process utilizes ALL cores
- Workers are lightweight (~2KB each)
- Can have thousands of workers in one VM
- Schedulers automatically distribute work

### Key Differences

| Aspect                         | Node.js                     | Elixir                   |
| ------------------------------ | --------------------------- | ------------------------ |
| **Process per core**           | Required                    | Not needed               |
| **Memory per worker**          | ~30-50MB                    | ~2KB                     |
| **Max workers/machine**        | ~CPU cores                  | Thousands                |
| **Inter-worker communication** | IPC/Redis                   | Direct message passing   |
| **Scaling complexity**         | Higher (process management) | Lower (just add workers) |

## Scaling Strategies

### 1. Vertical Scaling (Single Machine)

In Elixir, you scale vertically by spawning more workers within the same application:

```elixir
defmodule MyApp.Application do
  use Application

  def start(_type, _args) do
    # Scale based on CPU cores
    num_workers = System.schedulers_online() * 2  # 2 workers per core

    workers = for i <- 1..num_workers do
      Supervisor.child_spec(
        {BullMQ.Worker,
          queue: "jobs",
          connection: :redis,
          concurrency: 500,
          processor: &MyApp.JobProcessor.process/1},
        id: :"worker_#{i}"
      )
    end

    children = [
      {BullMQ.RedisConnection, name: :redis, host: "localhost"}
      | workers
    ]

    Supervisor.start_link(children, strategy: :one_for_one)
  end
end
```

**Benchmark Results** (from our tests):

| Workers | Concurrency | Throughput  |
| ------- | ----------- | ----------- |
| 1       | 500         | ~4,100 j/s  |
| 5       | 500         | ~12,400 j/s |
| 10      | 500         | ~16,500 j/s |

### 2. Horizontal Scaling (Multiple Machines)

For horizontal scaling, deploy the same application to multiple machines:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Machine 1     │     │   Machine 2     │     │   Machine 3     │
│   BEAM VM       │     │   BEAM VM       │     │   BEAM VM       │
│   10 workers    │     │   10 workers    │     │   10 workers    │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                          ┌──────▼──────┐
                          │    Redis    │
                          └─────────────┘
```

Each machine runs independently. BullMQ's Lua scripts ensure atomic job distribution - no coordination between machines needed.

### 3. Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bullmq-workers
spec:
  replicas: 5 # 5 pods
  template:
    spec:
      containers:
        - name: worker
          image: myapp:latest
          resources:
            requests:
              cpu: '2'
              memory: '512Mi'
            limits:
              cpu: '4'
              memory: '1Gi'
          env:
            - name: WORKER_COUNT
              value: '8' # 8 workers per pod
            - name: CONCURRENCY
              value: '500'
```

```elixir
# In your application
num_workers = String.to_integer(System.get_env("WORKER_COUNT", "4"))
concurrency = String.to_integer(System.get_env("CONCURRENCY", "500"))
```

## Supervision Tree

BullMQ Elixir uses OTP supervision for fault tolerance:

```
Application Supervisor
├── Registry (for named processes)
├── DynamicSupervisor (WorkerSupervisor)
│   └── Worker 1
│   └── Worker 2
│   └── ...
└── DynamicSupervisor (QueueEventsSupervisor)
    └── QueueEvents listeners

Worker (GenServer)
├── LockManager (linked GenServer)
│   └── Single timer for lock renewal
└── Job Task processes
```

### Fault Tolerance

**If a Worker crashes:**

- Supervisor restarts it automatically
- Active jobs may become stalled (picked up after stalled check interval)
- Other workers continue processing

**If LockManager crashes:**

- Worker is terminated (linked process)
- Supervisor restarts the Worker
- Worker creates new LockManager on restart

**If a Job Task crashes:**

- Job is moved to failed (if no retries) or delayed (for retry)
- Worker continues processing other jobs

### Best Practices

1. **Always use supervisors:**

```elixir
# Good - supervised
children = [
  {BullMQ.Worker, queue: "jobs", ...}
]
Supervisor.start_link(children, strategy: :one_for_one)

# Avoid - unsupervised
{:ok, worker} = BullMQ.Worker.start_link(queue: "jobs", ...)
```

2. **Use restart strategies appropriately:**

```elixir
# For workers that should always run
Supervisor.child_spec(
  {BullMQ.Worker, opts},
  restart: :permanent  # Always restart (default)
)

# For temporary workers
Supervisor.child_spec(
  {BullMQ.Worker, opts},
  restart: :temporary  # Never restart
)
```

3. **Set appropriate max_restarts:**

```elixir
Supervisor.start_link(children,
  strategy: :one_for_one,
  max_restarts: 10,      # Max 10 restarts
  max_seconds: 60        # Within 60 seconds
)
```

## Dynamic Worker Management

For dynamic scaling based on load:

```elixir
defmodule MyApp.WorkerManager do
  use GenServer

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  def scale_up(count \\ 1) do
    GenServer.call(__MODULE__, {:scale_up, count})
  end

  def scale_down(count \\ 1) do
    GenServer.call(__MODULE__, {:scale_down, count})
  end

  def worker_count do
    GenServer.call(__MODULE__, :worker_count)
  end

  @impl true
  def init(opts) do
    {:ok, %{
      queue: Keyword.fetch!(opts, :queue),
      connection: Keyword.fetch!(opts, :connection),
      processor: Keyword.fetch!(opts, :processor),
      concurrency: Keyword.get(opts, :concurrency, 500),
      workers: []
    }}
  end

  @impl true
  def handle_call({:scale_up, count}, _from, state) do
    new_workers = for _ <- 1..count do
      {:ok, pid} = DynamicSupervisor.start_child(
        BullMQ.WorkerSupervisor,
        {BullMQ.Worker,
          queue: state.queue,
          connection: state.connection,
          concurrency: state.concurrency,
          processor: state.processor}
      )
      pid
    end

    {:reply, :ok, %{state | workers: state.workers ++ new_workers}}
  end

  @impl true
  def handle_call({:scale_down, count}, _from, state) do
    {to_stop, to_keep} = Enum.split(state.workers, count)

    Enum.each(to_stop, fn pid ->
      BullMQ.Worker.close(pid)
      DynamicSupervisor.terminate_child(BullMQ.WorkerSupervisor, pid)
    end)

    {:reply, :ok, %{state | workers: to_keep}}
  end

  @impl true
  def handle_call(:worker_count, _from, state) do
    {:reply, length(state.workers), state}
  end
end
```

## Optimization Guidelines

### Workers per Machine

**Rule of thumb:** Start with 2× CPU cores for I/O-bound jobs

```elixir
num_workers = System.schedulers_online() * 2
```

For CPU-bound jobs, use 1× CPU cores to avoid context switching overhead.

### Concurrency per Worker

**Sweet spot:** 200-500 concurrent jobs per worker

Above 500, you hit diminishing returns due to sequential job fetching from Redis.

### Total Capacity Formula

```
Throughput ≈ num_workers × ~4,000 j/s (for instant jobs)
Throughput ≈ num_workers × concurrency / avg_job_time (for real jobs)
```

**Example:** 10 workers × 500 concurrency with 10ms jobs:

- Theoretical max: 10 × 500 / 0.01 = 500,000 j/s
- Actual (with Redis overhead): ~40,000-50,000 j/s

### Memory Considerations

Each worker + LockManager uses minimal memory (~100KB overhead + job data). The main memory consumers are:

- Job data in flight
- Task processes for concurrent jobs

Estimate: `base_memory + (concurrency × avg_job_memory)`

## Monitoring

Use Telemetry events for monitoring worker health:

```elixir
:telemetry.attach_many(
  "worker-monitor",
  [
    [:bullmq, :job, :completed],
    [:bullmq, :job, :failed],
    [:bullmq, :worker, :stalled]
  ],
  fn event, measurements, metadata, _config ->
    # Send to your metrics system
    StatsD.increment("bullmq.#{event}")
  end,
  nil
)
```

## Summary

1. **Start simple:** One BEAM VM per machine with multiple workers
2. **Scale workers first:** Add more workers before adding machines
3. **Use supervisors:** Always run workers under supervision
4. **Monitor and tune:** Use telemetry to find optimal worker/concurrency settings
5. **Scale horizontally last:** Add machines when single machine is saturated

The key advantage of Elixir is that you get multi-core utilization "for free" - no process managers, no cluster modules, just spawn more workers in the same application.
