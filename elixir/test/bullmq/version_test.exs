defmodule BullMQ.VersionTest do
  use ExUnit.Case, async: true

  alias BullMQ.Version

  describe "version/0" do
    test "returns a semver version string" do
      version = Version.version()

      assert is_binary(version)
      assert Regex.match?(~r/^\d+\.\d+\.\d+$/, version)
    end

    test "returns the expected BullMQ version" do
      # This should match the Node.js BullMQ version for Lua script compatibility
      assert Version.version() == "5.65.1"
    end
  end

  describe "full_version/0" do
    test "returns version with bullmq prefix" do
      full = Version.full_version()

      assert String.starts_with?(full, "bullmq:")
      assert String.ends_with?(full, Version.version())
    end

    test "returns the expected format" do
      assert Version.full_version() == "bullmq:5.65.1"
    end
  end

  describe "lib_name/0" do
    test "returns bullmq" do
      assert Version.lib_name() == "bullmq"
    end
  end

  describe "consistency" do
    test "full_version is lib_name:version" do
      expected = "#{Version.lib_name()}:#{Version.version()}"
      assert Version.full_version() == expected
    end
  end
end
