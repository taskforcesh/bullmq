defmodule BullMQ.KeysTest do
  use ExUnit.Case, async: true

  alias BullMQ.Keys

  describe "context/2" do
    test "creates a context with prefix and name" do
      ctx = Keys.context("bull", "test-queue")
      assert ctx.prefix == "bull"
      assert ctx.name == "test-queue"
    end

    test "creates a context with default prefix" do
      ctx = Keys.context("test-queue")
      assert ctx.prefix == "bull"
      assert ctx.name == "test-queue"
    end
  end

  describe "key generation" do
    setup do
      {:ok, ctx: Keys.context("bull", "emails")}
    end

    test "generates wait key", %{ctx: ctx} do
      assert Keys.wait(ctx) == "bull:emails:wait"
    end

    test "generates active key", %{ctx: ctx} do
      assert Keys.active(ctx) == "bull:emails:active"
    end

    test "generates delayed key", %{ctx: ctx} do
      assert Keys.delayed(ctx) == "bull:emails:delayed"
    end

    test "generates prioritized key", %{ctx: ctx} do
      assert Keys.prioritized(ctx) == "bull:emails:prioritized"
    end

    test "generates completed key", %{ctx: ctx} do
      assert Keys.completed(ctx) == "bull:emails:completed"
    end

    test "generates failed key", %{ctx: ctx} do
      assert Keys.failed(ctx) == "bull:emails:failed"
    end

    test "generates stalled key", %{ctx: ctx} do
      assert Keys.stalled(ctx) == "bull:emails:stalled"
    end

    test "generates limiter key", %{ctx: ctx} do
      assert Keys.limiter(ctx) == "bull:emails:limiter"
    end

    test "generates events key", %{ctx: ctx} do
      assert Keys.events(ctx) == "bull:emails:events"
    end

    test "generates marker key", %{ctx: ctx} do
      assert Keys.marker(ctx) == "bull:emails:marker"
    end

    test "generates meta key", %{ctx: ctx} do
      assert Keys.meta(ctx) == "bull:emails:meta"
    end

    test "generates id key", %{ctx: ctx} do
      assert Keys.id(ctx) == "bull:emails:id"
    end

    test "generates waiting-children key", %{ctx: ctx} do
      assert Keys.waiting_children(ctx) == "bull:emails:waiting-children"
    end

    test "generates repeat key", %{ctx: ctx} do
      assert Keys.repeat(ctx) == "bull:emails:repeat"
    end

    test "generates schedulers key", %{ctx: ctx} do
      assert Keys.schedulers(ctx) == "bull:emails:sc"
    end
  end

  describe "job-specific keys" do
    setup do
      {:ok, ctx: Keys.context("bull", "emails")}
    end

    test "generates job key", %{ctx: ctx} do
      assert Keys.job(ctx, "123") == "bull:emails:123"
    end

    test "generates lock key", %{ctx: ctx} do
      assert Keys.lock(ctx, "123") == "bull:emails:123:lock"
    end

    test "generates dependencies key", %{ctx: ctx} do
      assert Keys.dependencies(ctx, "123") == "bull:emails:123:dependencies"
    end

    test "generates processed key", %{ctx: ctx} do
      assert Keys.processed(ctx, "123") == "bull:emails:123:processed"
    end

    test "generates logs key", %{ctx: ctx} do
      assert Keys.logs(ctx, "123") == "bull:emails:123:logs"
    end
  end

  describe "key/1" do
    test "generates base key without suffix" do
      ctx = Keys.context("bull", "emails")
      assert Keys.key(ctx) == "bull:emails"
    end
  end

  describe "custom prefix" do
    test "uses custom prefix in all keys" do
      ctx = Keys.context("myapp", "notifications")

      assert Keys.wait(ctx) == "myapp:notifications:wait"
      assert Keys.active(ctx) == "myapp:notifications:active"
      assert Keys.job(ctx, "456") == "myapp:notifications:456"
    end
  end
end
