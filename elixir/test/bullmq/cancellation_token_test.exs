defmodule BullMQ.CancellationTokenTest do
  use ExUnit.Case, async: true

  alias BullMQ.CancellationToken

  describe "new/0" do
    test "creates a unique reference" do
      token1 = CancellationToken.new()
      token2 = CancellationToken.new()

      assert is_reference(token1)
      assert is_reference(token2)
      refute token1 == token2
    end
  end

  describe "cancel/3" do
    test "sends cancellation message to target process" do
      token = CancellationToken.new()
      target_pid = self()

      CancellationToken.cancel(target_pid, token, "test reason")

      assert_receive {:cancel, ^token, "test reason"}
    end

    test "sends cancellation message with nil reason" do
      token = CancellationToken.new()
      target_pid = self()

      CancellationToken.cancel(target_pid, token)

      assert_receive {:cancel, ^token, nil}
    end

    test "sends cancellation message with atom reason" do
      token = CancellationToken.new()
      target_pid = self()

      CancellationToken.cancel(target_pid, token, :shutdown)

      assert_receive {:cancel, ^token, :shutdown}
    end

    test "can cancel from different process" do
      token = CancellationToken.new()
      test_pid = self()

      spawn(fn ->
        CancellationToken.cancel(test_pid, token, "cancelled from another process")
      end)

      assert_receive {:cancel, ^token, "cancelled from another process"}
    end
  end

  describe "check/1" do
    test "returns :ok when no cancellation message" do
      token = CancellationToken.new()
      assert CancellationToken.check(token) == :ok
    end

    test "returns {:cancelled, reason} when cancellation message present" do
      token = CancellationToken.new()
      send(self(), {:cancel, token, "test reason"})

      assert CancellationToken.check(token) == {:cancelled, "test reason"}
    end

    test "consumes the cancellation message" do
      token = CancellationToken.new()
      send(self(), {:cancel, token, "test reason"})

      assert CancellationToken.check(token) == {:cancelled, "test reason"}
      # Second check should return :ok since message was consumed
      assert CancellationToken.check(token) == :ok
    end

    test "only matches the correct token" do
      token1 = CancellationToken.new()
      token2 = CancellationToken.new()

      send(self(), {:cancel, token1, "reason1"})

      # Should not match token2
      assert CancellationToken.check(token2) == :ok
      # Should match token1
      assert CancellationToken.check(token1) == {:cancelled, "reason1"}
    end
  end

  describe "check!/1" do
    test "returns :ok when no cancellation message" do
      token = CancellationToken.new()
      assert CancellationToken.check!(token) == :ok
    end

    test "raises when cancellation message present" do
      token = CancellationToken.new()
      send(self(), {:cancel, token, "test reason"})

      assert_raise RuntimeError, ~r/Job cancelled/, fn ->
        CancellationToken.check!(token)
      end
    end
  end

  describe "integration patterns" do
    test "receive after 0 pattern for chunked processing" do
      token = CancellationToken.new()
      items = [1, 2, 3, 4, 5]

      # Process without cancellation
      result =
        Enum.reduce_while(items, {:ok, []}, fn item, {:ok, acc} ->
          receive do
            {:cancel, ^token, reason} ->
              {:halt, {:error, {:cancelled, reason}}}
          after
            0 -> {:cont, {:ok, [item * 2 | acc]}}
          end
        end)

      assert result == {:ok, [10, 8, 6, 4, 2]}
    end

    test "receive after 0 pattern handles mid-processing cancellation" do
      token = CancellationToken.new()
      items = [1, 2, 3, 4, 5]

      # Send cancellation message before starting
      send(self(), {:cancel, token, "user cancelled"})

      result =
        Enum.reduce_while(items, {:ok, []}, fn item, {:ok, acc} ->
          receive do
            {:cancel, ^token, reason} ->
              {:halt, {:error, {:cancelled, reason}}}
          after
            0 -> {:cont, {:ok, [item * 2 | acc]}}
          end
        end)

      assert result == {:error, {:cancelled, "user cancelled"}}
    end

    test "task cancellation pattern" do
      token = CancellationToken.new()
      test_pid = self()

      # Start a task that does some work
      task =
        Task.async(fn ->
          Process.sleep(100)
          :completed
        end)

      # Cancel after a short delay
      spawn(fn ->
        Process.sleep(10)
        CancellationToken.cancel(test_pid, token, "timeout")
      end)

      # Wait for either task or cancellation
      result =
        receive do
          {:cancel, ^token, reason} ->
            Task.shutdown(task, :brutal_kill)
            {:error, {:cancelled, reason}}

          {^task, result} ->
            {:ok, result}
        end

      assert result == {:error, {:cancelled, "timeout"}}
    end

    test "task completion before cancellation" do
      _token = CancellationToken.new()

      # Start a task that completes quickly
      task =
        Task.async(fn ->
          Process.sleep(10)
          :completed
        end)

      # Wait for task completion using Task.await which handles the message properly
      result = Task.await(task)

      assert result == :completed
    end
  end

  describe "concurrency" do
    test "multiple concurrent tokens work independently" do
      tokens = for _ <- 1..10, do: CancellationToken.new()

      # Start tasks that check for cancellation
      tasks =
        Enum.map(tokens, fn token ->
          Task.async(fn ->
            Process.sleep(50)

            receive do
              {:cancel, ^token, reason} -> {:cancelled, reason}
            after
              0 -> :completed
            end
          end)
        end)

      # Cancel only even-indexed tokens by sending to the task processes
      tokens
      |> Enum.with_index()
      |> Enum.filter(fn {_, i} -> rem(i, 2) == 0 end)
      |> Enum.each(fn {token, i} ->
        task = Enum.at(tasks, i)
        CancellationToken.cancel(task.pid, token, "cancelled")
      end)

      # Wait for all tasks
      results = Task.await_many(tasks)

      # Even-indexed tasks should be cancelled, odd-indexed should complete
      results
      |> Enum.with_index()
      |> Enum.each(fn {result, i} ->
        if rem(i, 2) == 0 do
          assert result == {:cancelled, "cancelled"}
        else
          assert result == :completed
        end
      end)
    end

    test "token pattern matching ensures isolation" do
      token1 = CancellationToken.new()
      token2 = CancellationToken.new()

      # Send cancellation for token1
      send(self(), {:cancel, token1, "cancel1"})

      # Check token2 should not see token1's cancellation
      assert CancellationToken.check(token2) == :ok

      # Check token1 should see cancellation
      assert CancellationToken.check(token1) == {:cancelled, "cancel1"}
    end

    test "rapid cancellation and check cycles" do
      for _ <- 1..100 do
        token = CancellationToken.new()

        # Initially not cancelled
        assert CancellationToken.check(token) == :ok

        # Send cancellation
        send(self(), {:cancel, token, "rapid"})

        # Now cancelled
        assert CancellationToken.check(token) == {:cancelled, "rapid"}

        # After consuming, not cancelled
        assert CancellationToken.check(token) == :ok
      end
    end
  end

  describe "scalability" do
    test "handles thousands of tokens efficiently" do
      count = 10_000

      {time_create, tokens} =
        :timer.tc(fn ->
          for _ <- 1..count, do: CancellationToken.new()
        end)

      # Creating 10K tokens should be very fast (< 100ms)
      assert time_create < 100_000

      # Check all tokens
      {time_check, _} =
        :timer.tc(fn ->
          Enum.each(tokens, fn token ->
            CancellationToken.check(token)
          end)
        end)

      # Checking 10K tokens should be very fast (< 100ms)
      assert time_check < 100_000
    end
  end
end
