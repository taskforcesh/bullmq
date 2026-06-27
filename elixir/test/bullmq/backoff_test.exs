defmodule BullMQ.BackoffTest do
  use ExUnit.Case, async: true

  alias BullMQ.Backoff

  describe "calculate/4 with fixed strategy" do
    test "returns constant delay for all attempts" do
      assert Backoff.calculate(:fixed, 1, 1000) == 1000
      assert Backoff.calculate(:fixed, 2, 1000) == 1000
      assert Backoff.calculate(:fixed, 5, 1000) == 1000
      assert Backoff.calculate(:fixed, 10, 1000) == 1000
    end
  end

  describe "calculate/4 with exponential strategy" do
    test "doubles delay for each attempt by default" do
      assert Backoff.calculate(:exponential, 1, 1000) == 1000
      assert Backoff.calculate(:exponential, 2, 1000) == 2000
      assert Backoff.calculate(:exponential, 3, 1000) == 4000
      assert Backoff.calculate(:exponential, 4, 1000) == 8000
    end

    test "handles very large attempt numbers gracefully" do
      # Should not overflow or cause errors
      result = Backoff.calculate(:exponential, 20, 1000)
      assert is_integer(result)
      assert result > 0
    end
  end

  describe "calculate_from_config/2" do
    test "accepts map configuration for fixed" do
      config = %{type: :fixed, delay: 2000}
      assert Backoff.calculate_from_config(config, 1) == 2000
      assert Backoff.calculate_from_config(config, 5) == 2000
    end

    test "accepts map configuration for exponential" do
      config = %{type: :exponential, delay: 500}
      assert Backoff.calculate_from_config(config, 1) == 500
      assert Backoff.calculate_from_config(config, 2) == 1000
      assert Backoff.calculate_from_config(config, 3) == 2000
    end

    test "handles nil config" do
      assert Backoff.calculate_from_config(nil, 1) == 0
    end

    test "handles integer delay directly" do
      assert Backoff.calculate_from_config(5000, 1) == 5000
    end
  end

  describe "calculate/4 with jitter" do
    test "adds randomness within jitter range" do
      # Run multiple times to verify jitter is applied
      results =
        for _ <- 1..100 do
          Backoff.calculate(:fixed, 1, 1000, jitter: 0.5)
        end

      min = Enum.min(results)
      max = Enum.max(results)

      # With 50% jitter on 1000ms delay:
      # Range should be 500-1500 (1000 ± 500)
      assert min >= 500
      assert max <= 1500
      # Should have some variation
      assert max > min
    end

    test "no jitter when jitter is 0" do
      results =
        for _ <- 1..10 do
          Backoff.calculate(:fixed, 1, 1000, jitter: 0)
        end

      assert Enum.all?(results, &(&1 == 1000))
    end

    test "full jitter when jitter is 1" do
      results =
        for _ <- 1..100 do
          Backoff.calculate(:fixed, 1, 1000, jitter: 1)
        end

      min = Enum.min(results)
      max = Enum.max(results)

      # With 100% jitter on 1000ms delay:
      # Range should be 0-2000 (1000 ± 1000)
      assert min >= 0
      assert max <= 2000
    end
  end

  describe "edge cases" do
    test "handles zero delay" do
      assert Backoff.calculate(:fixed, 1, 0) == 0
      assert Backoff.calculate(:exponential, 5, 0) == 0
    end

    test "handles negative jitter (treated as no jitter)" do
      result = Backoff.calculate(:fixed, 1, 1000, jitter: -0.5)
      assert result == 1000
    end
  end
end
