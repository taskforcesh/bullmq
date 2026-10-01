defmodule BullMQ.RedisConnectionUrlParsingTest do
  use ExUnit.Case, async: true

  alias BullMQ.RedisConnection

  describe "parse_redis_url/1" do
    test "parses host, port, and database" do
      opts = RedisConnection.parse_redis_url("redis://example.com:1234/2")

      assert opts[:host] == "example.com"
      assert opts[:port] == 1234
      assert opts[:database] == 2
      assert opts[:username] == nil
      assert opts[:password] == nil
    end

    test "parses username and password from user:pass@ userinfo" do
      opts = RedisConnection.parse_redis_url("redis://myuser:mypass@example.com:1234/2")

      assert opts[:username] == "myuser"
      assert opts[:password] == "mypass"
    end

    test "treats single-value userinfo as a password, not a username" do
      opts = RedisConnection.parse_redis_url("redis://justapassword@example.com:1234")

      assert opts[:username] == nil
      assert opts[:password] == "justapassword"
    end

    test "defaults to port 6379 when missing" do
      opts = RedisConnection.parse_redis_url("redis://example.com/0")

      assert opts[:port] == 6379
    end
  end
end
