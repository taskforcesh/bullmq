defmodule BullMQ.UtilsTest do
  use ExUnit.Case, async: true

  alias BullMQ.Utils

  describe "get_opt/3 with list of keys" do
    test "returns value for the first matching key in a map" do
      opts = %{"pattern" => "* * * * *", pattern: "old"}
      assert Utils.get_opt(opts, ["pattern", :pattern]) == "* * * * *"
    end

    test "falls back to subsequent keys if earlier ones are missing" do
      opts = %{pattern: "0 0 * * *"}
      assert Utils.get_opt(opts, ["pattern", :pattern]) == "0 0 * * *"
    end

    test "supports multiple fallback keys (e.g. camelCase and snake_case)" do
      opts1 = %{"endDate" => 12345}
      assert Utils.get_opt(opts1, ["endDate", :end_date, "end_date", :endDate]) == 12345

      opts2 = %{end_date: 67890}
      assert Utils.get_opt(opts2, ["endDate", :end_date, "end_date", :endDate]) == 67890
    end

    test "preserves false values and does not fall back" do
      opts = %{"removeOnComplete" => false, remove_on_complete: true}
      assert Utils.get_opt(opts, ["removeOnComplete", :remove_on_complete]) == false

      opts2 = %{remove_on_complete: false}
      assert Utils.get_opt(opts2, ["removeOnComplete", :remove_on_complete], true) == false
    end

    test "preserves 0 and empty string" do
      assert Utils.get_opt(%{"count" => 0}, ["count", :count], 10) == 0
      assert Utils.get_opt(%{"tz" => ""}, ["tz", :tz], "UTC") == ""
    end

    test "returns default if none of the keys are present in map" do
      opts = %{"other" => "value"}
      assert Utils.get_opt(opts, ["pattern", :pattern], "default_pattern") == "default_pattern"
      assert Utils.get_opt(opts, ["pattern", :pattern]) == nil
    end

    test "returns default if map is empty or nil" do
      assert Utils.get_opt(%{}, ["pattern", :pattern], "default") == "default"
      assert Utils.get_opt(nil, ["pattern", :pattern], "default") == "default"
    end

    test "works with keyword lists" do
      opts = [attempts: 5, remove_on_complete: false]
      assert Utils.get_opt(opts, [:attempts, "attempts"], 1) == 5
      assert Utils.get_opt(opts, [:remove_on_complete, "removeOnComplete"], true) == false
      assert Utils.get_opt(opts, [:missing, "missing"], "fallback") == "fallback"
    end

    test "treats a single key (atom or string) passed instead of a list" do
      assert Utils.get_opt(%{every: 5000}, :every) == 5000
      assert Utils.get_opt(%{"every" => 5000}, "every") == 5000
      assert Utils.get_opt(%{}, :every, 1000) == 1000
    end
  end

  describe "get_opt/4 with two keys and default" do
    test "retrieves value using key1 if present" do
      opts = %{"every" => 1000}
      assert Utils.get_opt(opts, "every", :every, 5000) == 1000
    end

    test "retrieves value using key2 if key1 is absent" do
      opts = %{every: 2000}
      assert Utils.get_opt(opts, "every", :every, 5000) == 2000
    end

    test "returns default if neither key is present" do
      opts = %{}
      assert Utils.get_opt(opts, "every", :every, 5000) == 5000
      assert Utils.get_opt(opts, "every", :every, nil) == nil
    end

    test "preserves boolean false for key1 or key2" do
      assert Utils.get_opt(%{"removeOnFail" => false}, "removeOnFail", :remove_on_fail, true) ==
               false

      assert Utils.get_opt(%{remove_on_fail: false}, "removeOnFail", :remove_on_fail, true) == false
    end
  end

  describe "get_opts_value/4 with two keys" do
    test "retrieves value using key1 or key2 with optional default" do
      assert Utils.get_opts_value(%{"pattern" => "* * *"}, "pattern", :pattern) == "* * *"
      assert Utils.get_opts_value(%{pattern: "0 0 *"}, "pattern", :pattern) == "0 0 *"
      assert Utils.get_opts_value(%{}, "pattern", :pattern) == nil
      assert Utils.get_opts_value(%{}, "pattern", :pattern, "default") == "default"
      assert Utils.get_opts_value(nil, "pattern", :pattern, "default") == "default"
    end

    test "preserves false values" do
      assert Utils.get_opts_value(%{"remove" => false}, "remove", :remove, true) == false
      assert Utils.get_opts_value(%{remove: false}, "remove", :remove, true) == false
    end
  end

  describe "parse_int/2" do
    test "returns integer as-is" do
      assert Utils.parse_int(42) == 42
      assert Utils.parse_int(0) == 0
      assert Utils.parse_int(-10) == -10
    end

    test "converts float by rounding" do
      assert Utils.parse_int(12.7) == 13
      assert Utils.parse_int(12.3) == 12
      assert Utils.parse_int(-5.2) == -5
    end

    test "parses binary strings" do
      assert Utils.parse_int("123") == 123
      assert Utils.parse_int("-456") == -456
      assert Utils.parse_int("100px") == 100
    end

    test "returns default for nil, empty string, or invalid strings" do
      assert Utils.parse_int(nil) == 0
      assert Utils.parse_int(nil, 5) == 5
      assert Utils.parse_int("") == 0
      assert Utils.parse_int("", 10) == 10
      assert Utils.parse_int("invalid") == 0
      assert Utils.parse_int("invalid", -1) == -1
      assert Utils.parse_int(:atom, 99) == 99
    end
  end

  describe "parse_int_or_nil/1" do
    test "parses integers, floats, and strings" do
      assert Utils.parse_int_or_nil(42) == 42
      assert Utils.parse_int_or_nil(12.4) == 12
      assert Utils.parse_int_or_nil("500") == 500
      assert Utils.parse_int_or_nil("-1") == -1
    end

    test "returns nil for nil, empty string, and non-numeric values" do
      assert Utils.parse_int_or_nil(nil) == nil
      assert Utils.parse_int_or_nil("") == nil
      assert Utils.parse_int_or_nil("invalid") == nil
      assert Utils.parse_int_or_nil(:atom) == nil
    end
  end

  describe "parse_hash_data/1" do
    test "converts flat key-value list into a map" do
      list = ["k1", "v1", "k2", "v2"]
      expected = %{"k1" => "v1", "k2" => "v2"}
      assert Utils.parse_hash_data(list) == expected
    end

    test "handles odd number of elements by mapping trailing key to nil" do
      list = ["k1", "v1", "k2"]
      expected = %{"k1" => "v1", "k2" => nil}
      assert Utils.parse_hash_data(list) == expected
    end

    test "returns empty map for empty list, nil, or non-list" do
      assert Utils.parse_hash_data([]) == %{}
      assert Utils.parse_hash_data(nil) == %{}
    end

    test "preserves existing map if map passed" do
      map = %{"a" => 1, "b" => 2}
      assert Utils.parse_hash_data(map) == map
    end
  end

  describe "encode_job_opts/1" do
    test "takes only whitelisted keys and removes nil values" do
      input = %{
        attempts: 3,
        backoff: %{type: :exponential, delay: 1000},
        lifo: false,
        timeout: nil,
        remove_on_complete: true,
        remove_on_fail: false,
        repeat: %{every: 5000},
        deduplication: %{id: "custom-id"},
        fail_parent_on_failure: true,
        ignore_dependency: true,
        ignore_dependency_on_failure: false,
        remove_dependency: true,
        unknown_key: "should_be_removed",
        extra_opt: 123
      }

      encoded = Utils.encode_job_opts(input)

      assert encoded == %{
               attempts: 3,
               backoff: %{type: :exponential, delay: 1000},
               lifo: false,
               remove_on_complete: true,
               remove_on_fail: false,
               repeat: %{every: 5000},
               deduplication: %{id: "custom-id"},
               fail_parent_on_failure: true,
               ignore_dependency: true,
               ignore_dependency_on_failure: false,
               remove_dependency: true
             }

      refute Map.has_key?(encoded, :timeout)
      refute Map.has_key?(encoded, :unknown_key)
      refute Map.has_key?(encoded, :extra_opt)
    end

    test "preserves boolean false for lifo, remove_on_fail, etc." do
      input = %{lifo: false, remove_on_fail: false}
      assert Utils.encode_job_opts(input) == %{lifo: false, remove_on_fail: false}
    end

    test "works with keyword list" do
      input = [attempts: 5, unknown: "test", timeout: nil]
      assert Utils.encode_job_opts(input) == %{attempts: 5}
    end

    test "returns empty map for nil or non-map" do
      assert Utils.encode_job_opts(nil) == %{}
      assert Utils.encode_job_opts("invalid") == %{}
    end
  end

  describe "parse_client_info/1" do
    test "parses key=value pairs separated by spaces" do
      line = "id=123 addr=127.0.0.1:5432 name=bullmq_worker age=45"

      assert Utils.parse_client_info(line) == %{
               "id" => "123",
               "addr" => "127.0.0.1:5432",
               "name" => "bullmq_worker",
               "age" => "45"
             }
    end

    test "handles extra spaces between pairs" do
      line = "id=1   addr=127.0.0.1:5432   name=bullmq"

      assert Utils.parse_client_info(line) == %{
               "id" => "1",
               "addr" => "127.0.0.1:5432",
               "name" => "bullmq"
             }
    end

    test "returns empty map for nil, empty string, or non-binary" do
      assert Utils.parse_client_info(nil) == %{}
      assert Utils.parse_client_info("") == %{}
      assert Utils.parse_client_info(123) == %{}
    end
  end
end
