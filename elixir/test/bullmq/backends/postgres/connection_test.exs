defmodule BullMQ.Backends.Postgres.ConnectionTest do
  @moduledoc """
  Unit tests for `BullMQ.Backends.Postgres.Connection.build_postgrex_opts/2`.

  These do not require a running PostgreSQL instance — they assert how caller
  options (notably `:ssl`) are translated into the keyword list handed to
  `Postgrex`.
  """
  use ExUnit.Case, async: true

  alias BullMQ.Backends.Postgres.Connection

  describe "build_postgrex_opts/2 SSL handling" do
    test "omits :ssl when not provided (backward compatible)" do
      opts = Connection.build_postgrex_opts([hostname: "localhost"], "bullmq")
      refute Keyword.has_key?(opts, :ssl)
    end

    test "forwards an explicit :ssl keyword list to Postgrex" do
      opts =
        Connection.build_postgrex_opts(
          [hostname: "localhost", ssl: [verify: :verify_none]],
          "bullmq"
        )

      assert Keyword.get(opts, :ssl) == [verify: :verify_none]
    end

    test "forwards :ssl true" do
      opts = Connection.build_postgrex_opts([hostname: "localhost", ssl: true], "bullmq")
      assert Keyword.get(opts, :ssl) == true
    end

    test "forwards :ssl false explicitly" do
      opts = Connection.build_postgrex_opts([hostname: "localhost", ssl: false], "bullmq")
      assert Keyword.get(opts, :ssl) == false
    end

    test "explicit :ssl works with the :url form too" do
      opts =
        Connection.build_postgrex_opts(
          [url: "postgres://u:p@host:5432/db", ssl: [verify: :verify_none]],
          "bullmq"
        )

      assert Keyword.get(opts, :ssl) == [verify: :verify_none]
    end

    test "derives SSL from URL sslmode=require when :ssl is not given" do
      for mode <- ["require"] do
        opts =
          Connection.build_postgrex_opts(
            [url: "postgres://u:p@host:5432/db?sslmode=#{mode}"],
            "bullmq"
          )

        assert Keyword.get(opts, :ssl) == [verify: :verify_none],
               "expected sslmode=#{mode} to enable SSL"
      end
    end

    test "requires explicit :ssl options for URL certificate verification modes" do
      for mode <- ["verify-ca", "verify-full"] do
        assert_raise ArgumentError,
                     "sslmode=#{mode} requires explicit :ssl options with verify: :verify_peer",
                     fn ->
                       Connection.build_postgrex_opts(
                         [url: "postgres://host:5432/db?sslmode=#{mode}"],
                         "bullmq"
                       )
                     end
      end
    end

    test "accepts verification modes with explicit certificate verification options" do
      ssl = [verify: :verify_peer, cacertfile: "/path/to/ca.pem"]

      opts =
        Connection.build_postgrex_opts(
          [url: "postgres://host:5432/db?sslmode=verify-full", ssl: ssl],
          "bullmq"
        )

      assert Keyword.get(opts, :ssl) == ssl
    end

    test "rejects verification modes with explicit non-verifying SSL options" do
      assert_raise ArgumentError,
                   "sslmode=verify-ca requires explicit :ssl options with verify: :verify_peer",
                   fn ->
                     Connection.build_postgrex_opts(
                       [url: "postgres://host:5432/db?sslmode=verify-ca", ssl: true],
                       "bullmq"
                     )
                   end
    end

    test "does not enable SSL for sslmode=disable" do
      opts =
        Connection.build_postgrex_opts(
          [url: "postgres://u:p@host:5432/db?sslmode=disable"],
          "bullmq"
        )

      refute Keyword.has_key?(opts, :ssl)
    end

    test "explicit :ssl takes precedence over the URL sslmode" do
      opts =
        Connection.build_postgrex_opts(
          [url: "postgres://u:p@host:5432/db?sslmode=require", ssl: false],
          "bullmq"
        )

      assert Keyword.get(opts, :ssl) == false
    end
  end
end
