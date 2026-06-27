defmodule BullMQ.CancellationToken do
  @moduledoc """
  Provides cooperative job cancellation for BullMQ workers.

  The `CancellationToken` is a simple reference that enables push-based
  cancellation notifications. When a job is cancelled, the processor
  receives a `{:cancel, token, reason}` message in its mailbox.

  ## Design

  This implementation is pure Elixir with zero overhead:
  - No ETS tables
  - No GenServer processes
  - O(1) cancellation check via `receive after 0`
  - Direct process messaging for instant notification

  The token is just a reference. The Worker tracks which process is
  running each job, and sends cancellation messages directly to that process.

  ## Usage

  Processors that accept a cancellation token receive it as the second argument:

      processor: fn job, cancel_token ->
        # Check for cancellation between work chunks
        Enum.reduce_while(job.data.items, {:ok, []}, fn item, {:ok, acc} ->
          receive do
            {:cancel, ^cancel_token, reason} ->
              {:halt, {:error, {:cancelled, reason}}}
          after
            0 -> {:cont, {:ok, [process_item(item) | acc]}}
          end
        end)
      end

  ### Pattern: Wrap Long Operations

  For operations that block and need cancellation support:

      processor: fn job, cancel_token ->
        task = Task.async(fn -> long_running_work(job.data) end)

        # Wait for either task completion or cancellation
        receive do
          {:cancel, ^cancel_token, reason} ->
            Task.shutdown(task, :brutal_kill)
            {:error, {:cancelled, reason}}

          {^task, result} ->
            result
        end
      end

  ### Pattern: Periodic Check in Loop

      processor: fn job, cancel_token ->
        process_with_cancellation(job.data.items, cancel_token, [])
      end

      defp process_with_cancellation([], _token, acc), do: {:ok, Enum.reverse(acc)}
      defp process_with_cancellation([item | rest], token, acc) do
        receive do
          {:cancel, ^token, reason} -> {:error, {:cancelled, reason}}
        after
          0 ->
            result = process_item(item)
            process_with_cancellation(rest, token, [result | acc])
        end
      end

  ## Cancelling Jobs

  From outside the processor, cancel running jobs via the Worker:

      # Cancel a specific job
      BullMQ.Worker.cancel_job(worker, job_id, "User requested cancellation")

      # Cancel all running jobs
      BullMQ.Worker.cancel_all_jobs(worker, "Worker shutting down")

  ## Backward Compatibility

  Processors with arity 1 (single argument) continue to work:

      processor: fn job ->
        # This processor doesn't support cancellation
        {:ok, process(job)}
      end

  ## Notes

  - Cancellation is cooperative: processors must check their mailbox
  - If a processor ignores the cancellation message, the job completes normally
  - The `receive after 0` pattern is non-blocking and O(1)
  - Token matching with `^cancel_token` ensures you only catch your own cancellation
  """

  @type t :: reference()
  @type reason :: String.t() | atom() | nil

  @doc """
  Creates a new cancellation token.

  Returns a unique reference that can be used to identify cancellation messages.
  """
  @spec new() :: t()
  def new do
    make_ref()
  end

  @doc """
  Sends a cancellation message to a process.

  The target process will receive `{:cancel, token, reason}` in its mailbox.
  """
  @spec cancel(pid(), t(), reason()) :: :ok
  def cancel(pid, token, reason \\ nil) when is_pid(pid) do
    send(pid, {:cancel, token, reason})
    :ok
  end

  @doc """
  Checks if a cancellation message is waiting in the current process mailbox.

  This is a non-blocking O(1) check. Returns `{:cancelled, reason}` if
  a cancellation message is found, or `:ok` if not.

  Note: This consumes the cancellation message from the mailbox.

  ## Example

      case BullMQ.CancellationToken.check(cancel_token) do
        {:cancelled, reason} ->
          {:error, {:cancelled, reason}}
        :ok ->
          continue_work()
      end
  """
  @spec check(t()) :: :ok | {:cancelled, reason()}
  def check(token) do
    receive do
      {:cancel, ^token, reason} -> {:cancelled, reason}
    after
      0 -> :ok
    end
  end

  @doc """
  Checks for cancellation and raises if cancelled.

  Useful for simple checkpoint-style cancellation:

      def process_items(items, token) do
        Enum.map(items, fn item ->
          BullMQ.CancellationToken.check!(token)
          process_item(item)
        end)
      end
  """
  @spec check!(t()) :: :ok
  def check!(token) do
    case check(token) do
      :ok -> :ok
      {:cancelled, reason} -> raise "Job cancelled: #{inspect(reason)}"
    end
  end
end
