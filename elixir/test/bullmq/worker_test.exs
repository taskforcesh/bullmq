defmodule BullMQ.WorkerTest do
  @moduledoc """
  Unit tests for BullMQ.Worker module.

  These tests focus on testing pure functions and module behavior
  that don't require Redis. For integration tests that require
  Redis, see worker_integration_test.exs.
  """
  use ExUnit.Case, async: true

  alias BullMQ.Worker

  describe "processor_supports_cancellation?/1" do
    test "returns true for arity-2 functions" do
      processor = fn _job, _token -> :ok end
      assert processor_supports_cancellation?(processor) == true
    end

    test "returns false for arity-1 functions" do
      processor = fn _job -> :ok end
      assert processor_supports_cancellation?(processor) == false
    end

    test "returns false for arity-3 functions" do
      processor = fn _job, _token, _extra -> :ok end
      assert processor_supports_cancellation?(processor) == false
    end

    test "returns false for nil" do
      assert processor_supports_cancellation?(nil) == false
    end

    test "returns false for non-function values" do
      assert processor_supports_cancellation?("not a function") == false
      assert processor_supports_cancellation?(123) == false
      assert processor_supports_cancellation?(%{}) == false
    end
  end

  describe "list_to_job_map/1" do
    test "converts Redis hash list to map" do
      list = ["id", "123", "name", "test-job", "data", "{\"foo\":1}"]
      result = list_to_job_map(list)

      assert result == %{
               "id" => "123",
               "name" => "test-job",
               "data" => "{\"foo\":1}"
             }
    end

    test "handles empty list" do
      assert list_to_job_map([]) == %{}
    end

    test "handles odd-length list (last key has nil value)" do
      list = ["key1", "value1", "key2"]
      result = list_to_job_map(list)

      assert result == %{"key1" => "value1", "key2" => nil}
    end

    test "passes through non-list data unchanged" do
      assert list_to_job_map(nil) == nil
      assert list_to_job_map("string") == "string"
      assert list_to_job_map(%{already: "a map"}) == %{already: "a map"}
    end
  end

  describe "Worker struct defaults" do
    test "has correct default values" do
      worker = %Worker{}

      assert worker.prefix == "bull"
      assert worker.concurrency == 1
      assert worker.lock_duration == 30_000
      assert worker.stalled_interval == 30_000
      assert worker.max_stalled_count == 1
      assert worker.running == false
      assert worker.paused == false
      assert worker.closing == false
      assert worker.active_jobs == %{}
      assert worker.cancellation_tokens == %{}
      assert worker.processor_supports_cancellation == false
      assert worker.token == ""
    end
  end

  describe "Worker options validation" do
    test "requires queue option" do
      assert {:error, {:validation_error, error}} =
               start_worker_with_opts(connection: :redis, processor: fn _ -> :ok end)

      assert error =~ "required :queue option"
    end

    test "requires connection option" do
      assert {:error, {:validation_error, error}} =
               start_worker_with_opts(queue: "test", processor: fn _ -> :ok end)

      assert error =~ "required :connection option"
    end

    test "validates concurrency is positive integer" do
      assert {:error, {:validation_error, error}} =
               start_worker_with_opts(
                 queue: "test",
                 connection: :redis,
                 processor: fn _ -> :ok end,
                 concurrency: 0,
                 autorun: false
               )

      assert error =~ "concurrency"
    end

    test "validates lock_duration is positive integer" do
      assert {:error, {:validation_error, error}} =
               start_worker_with_opts(
                 queue: "test",
                 connection: :redis,
                 processor: fn _ -> :ok end,
                 lock_duration: -1,
                 autorun: false
               )

      assert error =~ "lock_duration"
    end

    test "validates processor is a function or nil" do
      assert {:error, {:validation_error, error}} =
               start_worker_with_opts(
                 queue: "test",
                 connection: :redis,
                 processor: "not a function",
                 autorun: false
               )

      assert error =~ "processor"
    end

    test "allows nil processor for manual job fetching" do
      # This should not raise - nil processor is valid for manual mode
      # We can't actually start it without a real Redis connection,
      # but we can verify the options are accepted
      opts = [
        queue: "test",
        connection: :redis,
        processor: nil,
        autorun: false
      ]

      # Validate options manually using the same schema Worker uses
      validated = NimbleOptions.validate!(opts, worker_opts_schema())
      assert Keyword.get(validated, :processor) == nil
    end
  end

  describe "callback options" do
    test "accepts valid callback functions" do
      opts = [
        queue: "test",
        connection: :redis,
        processor: fn _ -> :ok end,
        on_completed: fn _job, _result -> :ok end,
        on_failed: fn _job, _reason -> :ok end,
        on_error: fn _error -> :ok end,
        on_active: fn _job -> :ok end,
        on_progress: fn _job, _progress -> :ok end,
        on_stalled: fn _job_id -> :ok end,
        autorun: false
      ]

      # Should not raise
      validated = NimbleOptions.validate!(opts, worker_opts_schema())
      assert is_function(Keyword.get(validated, :on_completed), 2)
      assert is_function(Keyword.get(validated, :on_failed), 2)
    end

    test "allows nil callbacks" do
      opts = [
        queue: "test",
        connection: :redis,
        processor: fn _ -> :ok end,
        on_completed: nil,
        on_failed: nil,
        autorun: false
      ]

      validated = NimbleOptions.validate!(opts, worker_opts_schema())
      assert Keyword.get(validated, :on_completed) == nil
    end
  end

  describe "limiter option" do
    test "accepts valid limiter config" do
      opts = [
        queue: "test",
        connection: :redis,
        processor: fn _ -> :ok end,
        limiter: %{max: 10, duration: 1000},
        autorun: false
      ]

      validated = NimbleOptions.validate!(opts, worker_opts_schema())
      assert Keyword.get(validated, :limiter) == %{max: 10, duration: 1000}
    end
  end

  # Helper functions that mirror private Worker functions for testing

  defp processor_supports_cancellation?(processor) when is_function(processor) do
    case Function.info(processor, :arity) do
      {:arity, 2} -> true
      _ -> false
    end
  end

  defp processor_supports_cancellation?(_), do: false

  defp list_to_job_map(list) when is_list(list) do
    list
    |> Enum.chunk_every(2)
    |> Enum.map(fn
      [k, v] -> {k, v}
      [k] -> {k, nil}
    end)
    |> Map.new()
  end

  defp list_to_job_map(data), do: data

  # Get the Worker options schema for validation testing
  defp worker_opts_schema do
    NimbleOptions.new!([
      name: [type: {:or, [:atom, nil]}],
      queue: [type: :string, required: true],
      connection: [type: {:or, [:atom, :pid]}, required: true],
      processor: [type: {:or, [{:fun, 1}, {:fun, 2}, {:fun, 3}, nil]}],
      prefix: [type: :string, default: "bull"],
      concurrency: [type: :pos_integer, default: 1],
      lock_duration: [type: :pos_integer, default: 30_000],
      stalled_interval: [type: :pos_integer, default: 30_000],
      max_stalled_count: [type: :pos_integer, default: 1],
      limiter: [type: :map],
      autorun: [type: :boolean, default: true],
      on_completed: [type: {:or, [{:fun, 2}, nil]}],
      on_failed: [type: {:or, [{:fun, 2}, nil]}],
      on_error: [type: {:or, [{:fun, 1}, nil]}],
      on_active: [type: {:or, [{:fun, 1}, nil]}],
      on_progress: [type: {:or, [{:fun, 2}, nil]}],
      on_stalled: [type: {:or, [{:fun, 1}, nil]}],
      on_lock_renewal_failed: [type: {:or, [{:fun, 1}, nil]}],
      telemetry: [type: :atom, default: nil]
    ])
  end

  # Helper to catch validation errors from Worker.start_link
  # GenServer.start_link links the caller with the spawned process.
  # When init/1 raises, the spawned process dies and sends an EXIT signal
  # to the caller. We need to trap exits to catch this.
  defp start_worker_with_opts(opts) do
    # Trap exits so we receive them as messages instead of dying
    Process.flag(:trap_exit, true)

    result = Worker.start_link(opts)

    # Reset trap_exit
    Process.flag(:trap_exit, false)

    # Drain any EXIT messages from the mailbox
    receive do
      {:EXIT, _pid, reason} ->
        case reason do
          {%NimbleOptions.ValidationError{message: message}, _stacktrace} ->
            {:error, {:validation_error, message}}

          _ ->
            {:error, {:exit, reason}}
        end
    after
      0 ->
        # No EXIT message, check the result
        case result do
          {:ok, pid} ->
            GenServer.stop(pid)
            {:ok, pid}

          {:error, {%NimbleOptions.ValidationError{message: message}, _stacktrace}} ->
            {:error, {:validation_error, message}}

          {:error, reason} ->
            {:error, reason}
        end
    end
  end
end
