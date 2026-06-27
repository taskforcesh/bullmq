defmodule BullMQ do
  @moduledoc """
  BullMQ - A powerful, fast, and robust job queue for Elixir backed by Redis.

  BullMQ is a message queue and job scheduler that uses Redis as its backend.
  It provides a simple and reliable way to process background jobs with support
  for job priorities, retries, rate limiting, and distributed processing.

  ## Features

  * **Reliable job processing** - Jobs are persisted in Redis and survive crashes
  * **Concurrency control** - Process multiple jobs in parallel with configurable limits
  * **Rate limiting** - Control job processing rate per queue
  * **Job priorities** - Process high-priority jobs first
  * **Delayed jobs** - Schedule jobs to run at a specific time
  * **Job scheduling** - Create recurring jobs with cron expressions
  * **Retries with backoff** - Automatic retries with configurable backoff strategies
  * **Parent-child jobs** - Create job flows with dependencies
  * **Events** - Subscribe to job lifecycle events
  * **Stalled job recovery** - Automatic detection and recovery of stalled jobs
  * **Distributed processing** - Run workers across multiple nodes
  * **OpenTelemetry support** - Distributed tracing across services (compatible with Node.js)

  ## Quick Start

  Add BullMQ to your supervision tree:

      defmodule MyApp.Application do
        use Application

        def start(_type, _args) do
          children = [
            # Start the Redis connection pool
            {BullMQ.RedisConnection, name: :bullmq_redis, url: "redis://localhost:6379"},

            # Start a worker
            {BullMQ.Worker,
              name: :my_worker,
              queue: "my_queue",
              connection: :bullmq_redis,
              processor: &MyApp.JobProcessor.process/1,
              concurrency: 10}
          ]

          opts = [strategy: :one_for_one, name: MyApp.Supervisor]
          Supervisor.start_link(children, opts)
        end
      end

  Add jobs to the queue:

      # Add a simple job
      {:ok, job} = BullMQ.Queue.add("my_queue", "email", %{to: "user@example.com"})

      # Add a delayed job
      {:ok, job} = BullMQ.Queue.add("my_queue", "email", %{to: "user@example.com"},
        delay: :timer.minutes(5))

      # Add a job with retries
      {:ok, job} = BullMQ.Queue.add("my_queue", "email", %{to: "user@example.com"},
        attempts: 3,
        backoff: %{type: :exponential, delay: 1000})

  ## Architecture

  BullMQ uses Redis Lua scripts for atomic operations on job state transitions.
  This ensures reliability and consistency even in distributed environments.

  The main components are:

  * `BullMQ.Queue` - For adding jobs and managing queue state
  * `BullMQ.Worker` - For processing jobs with configurable concurrency
  * `BullMQ.Job` - Represents a job with its data and state
  * `BullMQ.QueueEvents` - For subscribing to job lifecycle events
  * `BullMQ.JobScheduler` - For creating recurring jobs

  ## Job States

  Jobs transition through the following states:

  * `:waiting` - Job is waiting to be processed
  * `:active` - Job is currently being processed
  * `:delayed` - Job is delayed and will be processed later
  * `:prioritized` - Job is in the priority queue
  * `:completed` - Job completed successfully
  * `:failed` - Job failed after all retries
  * `:waiting_children` - Parent job waiting for children to complete

  ## Compatibility

  This Elixir implementation is fully compatible with the Node.js BullMQ library.
  Jobs can be added from Node.js and processed in Elixir, or vice versa.
  """

  @doc """
  Returns the current BullMQ version.
  """
  @spec version() :: String.t()
  def version, do: "0.1.0"

  @doc """
  Returns the library identifier used in queue metadata.
  """
  @spec library_name() :: String.t()
  def library_name, do: "bullmq"
end
