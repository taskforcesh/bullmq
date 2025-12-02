defmodule BullMQ.Telemetry do
  @moduledoc """
  Telemetry integration for BullMQ.

  BullMQ emits various telemetry events that you can attach handlers to
  for metrics, logging, and monitoring.

  ## Event Names

  All events are prefixed with `[:bullmq, ...]`.

  ### Job Events

    * `[:bullmq, :job, :add]` - A job was added to the queue
      * Measurements: `%{queue_time: native_time}` (time to add to Redis)
      * Metadata: `%{queue: name, job_id: id, job_name: name}`

    * `[:bullmq, :job, :start]` - A job started processing
      * Measurements: `%{system_time: native_time}`
      * Metadata: `%{queue: name, job_id: id, job_name: name, worker: pid}`

    * `[:bullmq, :job, :complete]` - A job completed successfully
      * Measurements: `%{duration: native_time}`
      * Metadata: `%{queue: name, job_id: id, job_name: name, worker: pid}`

    * `[:bullmq, :job, :fail]` - A job failed
      * Measurements: `%{duration: native_time}`
      * Metadata: `%{queue: name, job_id: id, job_name: name, worker: pid, error: term}`

    * `[:bullmq, :job, :retry]` - A job is being retried
      * Measurements: `%{attempt: integer, delay: ms}`
      * Metadata: `%{queue: name, job_id: id, job_name: name}`

    * `[:bullmq, :job, :progress]` - Job progress updated
      * Measurements: `%{progress: 0..100}`
      * Metadata: `%{queue: name, job_id: id}`

  ### Worker Events

    * `[:bullmq, :worker, :start]` - Worker started
      * Measurements: `%{concurrency: integer}`
      * Metadata: `%{queue: name, worker: pid}`

    * `[:bullmq, :worker, :stop]` - Worker stopped
      * Measurements: `%{uptime: native_time}`
      * Metadata: `%{queue: name, worker: pid}`

    * `[:bullmq, :worker, :stalled_check]` - Stalled job check executed
      * Measurements: `%{recovered: integer, failed: integer}`
      * Metadata: `%{queue: name}`

  ### Queue Events

    * `[:bullmq, :queue, :pause]` - Queue was paused
    * `[:bullmq, :queue, :resume]` - Queue was resumed
    * `[:bullmq, :queue, :drain]` - Queue was drained

  ### Rate Limiting Events

    * `[:bullmq, :rate_limit, :hit]` - Rate limit was hit
      * Measurements: `%{delay: ms}`
      * Metadata: `%{queue: name}`

  ## Example Setup

      # In your application.ex
      :telemetry.attach_many(
        "bullmq-logger",
        [
          [:bullmq, :job, :complete],
          [:bullmq, :job, :fail],
          [:bullmq, :rate_limit, :hit]
        ],
        &MyApp.Telemetry.handle_event/4,
        nil
      )

  ## Prometheus/StatsD Integration

      defmodule MyApp.Telemetry do
        def handle_event([:bullmq, :job, :complete], measurements, metadata, _config) do
          :prometheus_histogram.observe(
            :job_duration_seconds,
            [metadata.queue],
            measurements.duration / 1_000_000_000
          )
        end

        def handle_event([:bullmq, :job, :fail], _measurements, metadata, _config) do
          :prometheus_counter.inc(:job_failures_total, [metadata.queue])
        end
      end
  """

  @type event_name :: atom()
  @type measurements :: map()
  @type metadata :: map()

  @doc """
  Attaches a handler function to BullMQ events.

  This is a convenience wrapper around `:telemetry.attach/4`.

  ## Example

      BullMQ.Telemetry.attach(
        "my-handler",
        [:job, :complete],
        fn _event, measurements, metadata, _config ->
          IO.puts("Job \#{metadata.job_id} completed in \#{measurements.duration}ns")
        end
      )
  """
  @spec attach(String.t(), [atom()], (list(), map(), map(), term() -> :ok), term()) :: :ok | {:error, term()}
  def attach(handler_id, event_suffix, handler_fn, config \\ nil) do
    event = [:bullmq | event_suffix]
    :telemetry.attach(handler_id, event, handler_fn, config)
  end

  @doc """
  Attaches a handler to multiple BullMQ events.

  ## Example

      BullMQ.Telemetry.attach_many("my-handler", [
        [:job, :complete],
        [:job, :fail],
        [:worker, :start]
      ], &handle_event/4)
  """
  @spec attach_many(String.t(), [[atom()]], (list(), map(), map(), term() -> :ok), term()) ::
          :ok | {:error, term()}
  def attach_many(handler_id, event_suffixes, handler_fn, config \\ nil) do
    events = Enum.map(event_suffixes, fn suffix -> [:bullmq | suffix] end)
    :telemetry.attach_many(handler_id, events, handler_fn, config)
  end

  @doc """
  Emits a telemetry event.

  This is used internally by BullMQ. You typically don't need to call this directly.
  """
  @spec emit(event_name() | [event_name()], measurements(), metadata()) :: :ok
  def emit(event_name, measurements, metadata) when is_atom(event_name) do
    emit([event_name], measurements, metadata)
  end

  def emit(event_suffix, measurements, metadata) when is_list(event_suffix) do
    event = [:bullmq | event_suffix]
    :telemetry.execute(event, measurements, metadata)
  end

  @doc """
  Spans a function call with telemetry events.

  Emits start and stop/exception events around the function call.

  ## Example

      BullMQ.Telemetry.span([:job, :process], %{job_id: "123"}, fn ->
        do_work()
      end)
  """
  @spec span([atom()], metadata(), (() -> result)) :: result when result: term()
  def span(event_suffix, metadata, fun) do
    start_time = System.monotonic_time()
    event_prefix = [:bullmq | event_suffix]

    :telemetry.execute(
      event_prefix ++ [:start],
      %{system_time: System.system_time()},
      metadata
    )

    try do
      result = fun.()
      duration = System.monotonic_time() - start_time

      :telemetry.execute(
        event_prefix ++ [:stop],
        %{duration: duration},
        metadata
      )

      result
    rescue
      exception ->
        duration = System.monotonic_time() - start_time

        :telemetry.execute(
          event_prefix ++ [:exception],
          %{duration: duration},
          Map.merge(metadata, %{
            kind: :error,
            reason: exception,
            stacktrace: __STACKTRACE__
          })
        )

        reraise exception, __STACKTRACE__
    catch
      kind, reason ->
        duration = System.monotonic_time() - start_time

        :telemetry.execute(
          event_prefix ++ [:exception],
          %{duration: duration},
          Map.merge(metadata, %{
            kind: kind,
            reason: reason,
            stacktrace: __STACKTRACE__
          })
        )

        :erlang.raise(kind, reason, __STACKTRACE__)
    end
  end

  # Convenience functions for common events

  @doc false
  def job_added(queue, job_id, job_name, duration) do
    emit([:job, :add], %{queue_time: duration}, %{
      queue: queue,
      job_id: job_id,
      job_name: job_name
    })
  end

  @doc false
  def job_started(queue, job_id, job_name, worker_pid) do
    emit([:job, :start], %{system_time: System.system_time()}, %{
      queue: queue,
      job_id: job_id,
      job_name: job_name,
      worker: worker_pid
    })
  end

  @doc false
  def job_completed(queue, job_id, job_name, worker_pid, duration) do
    emit([:job, :complete], %{duration: duration}, %{
      queue: queue,
      job_id: job_id,
      job_name: job_name,
      worker: worker_pid
    })
  end

  @doc false
  def job_failed(queue, job_id, job_name, worker_pid, duration, error) do
    emit([:job, :fail], %{duration: duration}, %{
      queue: queue,
      job_id: job_id,
      job_name: job_name,
      worker: worker_pid,
      error: error
    })
  end

  @doc false
  def job_retried(queue, job_id, job_name, attempt, delay) do
    emit([:job, :retry], %{attempt: attempt, delay: delay}, %{
      queue: queue,
      job_id: job_id,
      job_name: job_name
    })
  end

  @doc false
  def worker_started(queue, worker_pid, concurrency) do
    emit([:worker, :start], %{concurrency: concurrency}, %{
      queue: queue,
      worker: worker_pid
    })
  end

  @doc false
  def worker_stopped(queue, worker_pid, uptime) do
    emit([:worker, :stop], %{uptime: uptime}, %{
      queue: queue,
      worker: worker_pid
    })
  end

  @doc false
  def rate_limit_hit(queue, delay) do
    emit([:rate_limit, :hit], %{delay: delay}, %{queue: queue})
  end
end
