defmodule BullMQ.IntegrationTest do
  @moduledoc """
  Integration tests that require a running Redis instance.

  Run with: mix test --include integration
  """
  use ExUnit.Case, async: false

  @moduletag :integration

  alias BullMQ.{Job, Keys, Scripts}

  @redis_url BullMQ.TestHelper.redis_url()
  @test_prefix BullMQ.TestHelper.test_prefix()

  setup do
    # Start Redis connection for this test
    {:ok, conn} = Redix.start_link(@redis_url)

    # Unlink so test process death doesn't cascade
    Process.unlink(conn)

    # Clean up test keys before each test
    cleanup_keys(conn)

    on_exit(fn ->
      # Stop the test connection
      try do
        Redix.stop(conn)
      catch
        :exit, _ -> :ok
      end

      # Cleanup after test - need a fresh connection since conn is now closed
      case Redix.start_link(@redis_url) do
        {:ok, cleanup_conn} ->
          cleanup_keys(cleanup_conn)
          Redix.stop(cleanup_conn)

        _ ->
          :ok
      end
    end)

    {:ok, conn: conn}
  end

  defp cleanup_keys(conn) do
    case Redix.command(conn, ["KEYS", "#{@test_prefix}:*"]) do
      {:ok, [_ | _] = keys} ->
        Redix.command(conn, ["DEL" | keys])

      _ ->
        :ok
    end
  end

  # ---------------------------------------------------------------------------
  # Job Tests
  # ---------------------------------------------------------------------------

  describe "Job struct operations" do
    @tag :integration
    test "stores and retrieves job data from Redis", %{conn: conn} do
      queue_name = "test-job-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)

      job = Job.new(queue_name, "email-job", %{to: "user@example.com", subject: "Hello"})
      redis_data = Job.to_redis(job)

      # Store job in Redis
      args = Enum.flat_map(redis_data, fn {k, v} -> [k, v] end)
      {:ok, _} = Redix.command(conn, ["HSET", Keys.job(ctx, job.id) | args])

      # Retrieve and verify
      {:ok, stored} = Redix.command(conn, ["HGETALL", Keys.job(ctx, job.id)])
      stored_map = Enum.chunk_every(stored, 2) |> Map.new(fn [k, v] -> {k, v} end)

      assert stored_map["name"] == "email-job"

      assert Jason.decode!(stored_map["data"]) == %{
               "to" => "user@example.com",
               "subject" => "Hello"
             }
    end

    @tag :integration
    test "job IDs are unique when added to queue", %{conn: _conn} do
      queue_name = "test-unique-#{System.unique_integer([:positive])}"
      pool_name = :"unique_test_pool_#{System.unique_integer([:positive])}"

      # Start a proper connection pool (Queue.add requires RedisConnection, not raw Redix)
      {:ok, _pool} = BullMQ.RedisConnection.start_link(name: pool_name, url: @redis_url)
      on_exit(fn -> BullMQ.RedisConnection.close(pool_name) end)

      jobs =
        for _ <- 1..100 do
          {:ok, job} =
            BullMQ.Queue.add(queue_name, "test", %{}, connection: pool_name, prefix: @test_prefix)

          job
        end

      ids = Enum.map(jobs, & &1.id)
      assert length(ids) == 100
      assert length(Enum.uniq(ids)) == 100, "All job IDs should be unique"

      # IDs should be sequential integers (as strings)
      assert ids == Enum.map(1..100, &Integer.to_string/1)
    end

    @tag :integration
    test "job preserves all options", %{conn: _conn} do
      job =
        Job.new("queue", "test", %{key: "value"},
          priority: 5,
          delay: 1000,
          attempts: 3,
          backoff: %{type: :exponential, delay: 500},
          remove_on_complete: true,
          remove_on_fail: 100
        )

      assert job.priority == 5
      assert job.delay == 1000
      assert job.opts[:attempts] == 3
      assert job.opts[:backoff] == %{type: :exponential, delay: 500}
      assert job.opts[:remove_on_complete] == true
      assert job.opts[:remove_on_fail] == 100
    end
  end

  # ---------------------------------------------------------------------------
  # Keys Tests
  # ---------------------------------------------------------------------------

  describe "Redis key generation" do
    @tag :integration
    test "generates correct key patterns", %{conn: conn} do
      ctx = Keys.context(@test_prefix, "myqueue")

      # Verify key format
      assert Keys.wait(ctx) == "#{@test_prefix}:myqueue:wait"
      assert Keys.active(ctx) == "#{@test_prefix}:myqueue:active"
      assert Keys.delayed(ctx) == "#{@test_prefix}:myqueue:delayed"
      assert Keys.completed(ctx) == "#{@test_prefix}:myqueue:completed"
      assert Keys.failed(ctx) == "#{@test_prefix}:myqueue:failed"
      assert Keys.job(ctx, "123") == "#{@test_prefix}:myqueue:123"
      assert Keys.lock(ctx, "123") == "#{@test_prefix}:myqueue:123:lock"
      assert Keys.logs(ctx, "123") == "#{@test_prefix}:myqueue:123:logs"

      # Verify we can use these keys in Redis
      {:ok, _} = Redix.command(conn, ["SET", Keys.meta(ctx), "test"])
      {:ok, value} = Redix.command(conn, ["GET", Keys.meta(ctx)])
      assert value == "test"
    end

    @tag :integration
    test "key context works with different prefixes", %{conn: conn} do
      ctx1 = Keys.context("prefix1", "queue")
      ctx2 = Keys.context("prefix2", "queue")

      {:ok, _} = Redix.command(conn, ["SET", Keys.meta(ctx1), "value1"])
      {:ok, _} = Redix.command(conn, ["SET", Keys.meta(ctx2), "value2"])

      {:ok, v1} = Redix.command(conn, ["GET", Keys.meta(ctx1)])
      {:ok, v2} = Redix.command(conn, ["GET", Keys.meta(ctx2)])

      assert v1 == "value1"
      assert v2 == "value2"

      # Cleanup
      Redix.command(conn, ["DEL", Keys.meta(ctx1), Keys.meta(ctx2)])
    end
  end

  # ---------------------------------------------------------------------------
  # Queue State Tests
  # ---------------------------------------------------------------------------

  describe "Queue state management" do
    @tag :integration
    test "jobs in wait list", %{conn: conn} do
      queue_name = "test-wait-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)

      # Add multiple jobs to wait list
      _job_ids =
        for i <- 1..5 do
          job_id = "job-#{i}"
          {:ok, _} = Redix.command(conn, ["RPUSH", Keys.wait(ctx), job_id])
          job_id
        end

      # Verify list length
      {:ok, len} = Redix.command(conn, ["LLEN", Keys.wait(ctx)])
      assert len == 5

      # Verify order (FIFO)
      {:ok, first} = Redix.command(conn, ["LINDEX", Keys.wait(ctx), 0])
      assert first == "job-1"
    end

    @tag :integration
    test "delayed jobs with scores", %{conn: conn} do
      queue_name = "test-delayed-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)
      now = System.system_time(:millisecond)

      # Add delayed jobs with different timestamps
      delays = [1000, 5000, 3000, 10000, 2000]

      for {delay, i} <- Enum.with_index(delays, 1) do
        score = now + delay
        {:ok, _} = Redix.command(conn, ["ZADD", Keys.delayed(ctx), score, "job-#{i}"])
      end

      # Get jobs ordered by score (earliest first)
      {:ok, ordered} = Redix.command(conn, ["ZRANGE", Keys.delayed(ctx), 0, -1])

      # job-1 (1000), job-5 (2000), job-3 (3000), job-2 (5000), job-4 (10000)
      assert ordered == ["job-1", "job-5", "job-3", "job-2", "job-4"]
    end

    @tag :integration
    test "prioritized jobs ordering", %{conn: conn} do
      queue_name = "test-priority-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)

      # Add jobs with different priorities (lower = higher priority)
      priorities = [{1, "high"}, {5, "medium"}, {10, "low"}, {1, "also-high"}, {3, "mid"}]

      for {priority, name} <- priorities do
        {:ok, _} = Redix.command(conn, ["ZADD", Keys.prioritized(ctx), priority, name])
      end

      # Get ordered by priority
      {:ok, ordered} = Redix.command(conn, ["ZRANGE", Keys.prioritized(ctx), 0, -1])

      # Both priority-1 jobs come first (order between them is undefined), then mid, medium, low
      assert "low" == List.last(ordered)
      assert Enum.take(ordered, 2) |> Enum.sort() == ["also-high", "high"]
    end

    @tag :integration
    test "active jobs tracking", %{conn: conn} do
      queue_name = "test-active-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)

      # Simulate moving jobs to active
      {:ok, _} = Redix.command(conn, ["RPUSH", Keys.active(ctx), "job-1", "job-2", "job-3"])

      {:ok, active_count} = Redix.command(conn, ["LLEN", Keys.active(ctx)])
      assert active_count == 3

      # Simulate job completion (remove from active)
      {:ok, _} = Redix.command(conn, ["LREM", Keys.active(ctx), 1, "job-2"])

      {:ok, active_count} = Redix.command(conn, ["LLEN", Keys.active(ctx)])
      assert active_count == 2
    end

    @tag :integration
    test "completed jobs with timestamps", %{conn: conn} do
      queue_name = "test-completed-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)
      now = System.system_time(:millisecond)

      # Add completed jobs
      for i <- 1..10 do
        {:ok, _} = Redix.command(conn, ["ZADD", Keys.completed(ctx), now + i, "job-#{i}"])
      end

      {:ok, count} = Redix.command(conn, ["ZCARD", Keys.completed(ctx)])
      assert count == 10

      # Get recent completed jobs
      {:ok, recent} = Redix.command(conn, ["ZRANGE", Keys.completed(ctx), -3, -1])
      assert recent == ["job-8", "job-9", "job-10"]
    end

    @tag :integration
    test "failed jobs tracking", %{conn: conn} do
      queue_name = "test-failed-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)
      now = System.system_time(:millisecond)

      # Add failed jobs
      {:ok, _} = Redix.command(conn, ["ZADD", Keys.failed(ctx), now, "job-1"])
      {:ok, _} = Redix.command(conn, ["ZADD", Keys.failed(ctx), now + 100, "job-2"])

      {:ok, count} = Redix.command(conn, ["ZCARD", Keys.failed(ctx)])
      assert count == 2
    end
  end

  # ---------------------------------------------------------------------------
  # Job Locks Tests
  # ---------------------------------------------------------------------------

  describe "Job locking" do
    @tag :integration
    test "acquires and releases lock", %{conn: conn} do
      queue_name = "test-lock-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)
      job_id = "job-123"
      token = "worker-token-abc"

      # Acquire lock
      {:ok, result} = Redix.command(conn, ["SET", Keys.lock(ctx, job_id), token, "PX", 30000, "NX"])
      assert result == "OK"

      # Verify lock exists
      {:ok, stored_token} = Redix.command(conn, ["GET", Keys.lock(ctx, job_id)])
      assert stored_token == token

      # Try to acquire again (should fail)
      {:ok, result} =
        Redix.command(conn, ["SET", Keys.lock(ctx, job_id), "other-token", "PX", 30000, "NX"])

      assert result == nil

      # Release lock
      {:ok, _} = Redix.command(conn, ["DEL", Keys.lock(ctx, job_id)])

      # Now can acquire again
      {:ok, result} =
        Redix.command(conn, ["SET", Keys.lock(ctx, job_id), "new-token", "PX", 30000, "NX"])

      assert result == "OK"
    end

    @tag :integration
    test "lock expiration", %{conn: conn} do
      queue_name = "test-lock-expire-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)
      job_id = "job-456"
      token = "worker-token"

      # Acquire lock with very short TTL
      {:ok, _} = Redix.command(conn, ["SET", Keys.lock(ctx, job_id), token, "PX", 100, "NX"])

      # Wait for expiration
      Process.sleep(150)

      # Lock should be gone
      {:ok, result} = Redix.command(conn, ["GET", Keys.lock(ctx, job_id)])
      assert result == nil
    end

    @tag :integration
    test "extend lock duration", %{conn: conn} do
      queue_name = "test-lock-extend-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)
      job_id = "job-789"
      token = "worker-token"

      # Acquire lock
      {:ok, _} = Redix.command(conn, ["SET", Keys.lock(ctx, job_id), token, "PX", 1000])

      # Extend lock
      {:ok, _} = Redix.command(conn, ["PEXPIRE", Keys.lock(ctx, job_id), 5000])

      # Verify TTL was extended
      {:ok, ttl} = Redix.command(conn, ["PTTL", Keys.lock(ctx, job_id)])
      assert ttl > 1000
    end
  end

  # ---------------------------------------------------------------------------
  # Job Logs Tests
  # ---------------------------------------------------------------------------

  describe "Job logs" do
    @tag :integration
    test "adds and retrieves logs", %{conn: conn} do
      queue_name = "test-logs-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)
      job_id = "job-with-logs"

      # Add log entries
      logs = ["Starting job", "Processing step 1", "Processing step 2", "Job completed"]

      for log <- logs do
        {:ok, _} = Redix.command(conn, ["RPUSH", Keys.logs(ctx, job_id), log])
      end

      # Retrieve all logs
      {:ok, stored_logs} = Redix.command(conn, ["LRANGE", Keys.logs(ctx, job_id), 0, -1])
      assert stored_logs == logs
    end

    @tag :integration
    test "logs have size limit", %{conn: conn} do
      queue_name = "test-logs-limit-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)
      job_id = "job-many-logs"
      max_logs = 100

      # Add more than max logs
      for i <- 1..150 do
        {:ok, _} = Redix.command(conn, ["RPUSH", Keys.logs(ctx, job_id), "Log entry #{i}"])
      end

      # Trim to max
      {:ok, _} = Redix.command(conn, ["LTRIM", Keys.logs(ctx, job_id), -max_logs, -1])

      {:ok, count} = Redix.command(conn, ["LLEN", Keys.logs(ctx, job_id)])
      assert count == max_logs
    end
  end

  # ---------------------------------------------------------------------------
  # Scripts Tests
  # ---------------------------------------------------------------------------

  describe "Lua scripts" do
    @tag :integration
    test "scripts are loaded from rawScripts directory" do
      # Verify key scripts are available
      assert Scripts.exists?(:add_standard_job)
      assert Scripts.exists?(:move_to_active)
      assert Scripts.exists?(:move_to_finished)
      assert Scripts.exists?(:extend_lock)
      assert Scripts.exists?(:move_stalled_jobs_to_wait)
      assert Scripts.exists?(:pause)
      assert Scripts.exists?(:drain)
    end

    @tag :integration
    test "script key counts are correct" do
      # Verify some known key counts
      {_, key_count} = Scripts.get(:extend_lock)
      assert key_count == 2

      {_, key_count} = Scripts.get(:release_lock)
      assert key_count == 1

      {_, key_count} = Scripts.get(:add_log)
      assert key_count == 2
    end

    @tag :integration
    test "extend_lock script works", %{conn: conn} do
      queue_name = "test-script-lock-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)
      job_id = "script-job"
      token = "script-token"

      # First, set up the lock manually
      {:ok, _} = Redix.command(conn, ["SET", Keys.lock(ctx, job_id), token, "PX", 1000])

      # Add to stalled set (required by script)
      {:ok, _} = Redix.command(conn, ["SADD", Keys.stalled(ctx), job_id])

      # Get the extend_lock script
      {script, _} = Scripts.get(:extend_lock)

      # Execute the script
      keys = [Keys.lock(ctx, job_id), Keys.stalled(ctx)]
      args = [token, "5000", job_id]

      {:ok, result} = Redix.command(conn, ["EVAL", script, length(keys)] ++ keys ++ args)

      # Script should return 1 on success
      assert result == 1

      # Verify TTL was extended
      {:ok, ttl} = Redix.command(conn, ["PTTL", Keys.lock(ctx, job_id)])
      assert ttl > 1000
    end

    @tag :integration
    test "pause script works", %{conn: conn} do
      queue_name = "test-script-pause-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)

      # Get pause script
      {script, key_count} = Scripts.get(:pause)

      # Build keys based on key count
      keys =
        [
          Keys.wait(ctx),
          Keys.paused(ctx),
          Keys.meta(ctx),
          Keys.prioritized(ctx),
          Keys.pc(ctx),
          Keys.marker(ctx),
          Keys.events(ctx)
        ]
        |> Enum.take(key_count)

      args = ["paused"]

      {:ok, _result} = Redix.command(conn, ["EVAL", script, length(keys)] ++ keys ++ args)

      # Verify queue is paused
      {:ok, paused} = Redix.command(conn, ["HGET", Keys.meta(ctx), "paused"])
      assert paused == "1"
    end
  end

  # ---------------------------------------------------------------------------
  # Queue Metrics Tests
  # ---------------------------------------------------------------------------

  describe "Queue metrics" do
    @tag :integration
    test "tracks job counts across states", %{conn: conn} do
      queue_name = "test-metrics-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)
      now = System.system_time(:millisecond)

      # Add jobs to different states
      {:ok, _} = Redix.command(conn, ["RPUSH", Keys.wait(ctx), "w1", "w2", "w3"])
      {:ok, _} = Redix.command(conn, ["RPUSH", Keys.active(ctx), "a1", "a2"])
      {:ok, _} = Redix.command(conn, ["ZADD", Keys.delayed(ctx), now + 10000, "d1"])

      {:ok, _} =
        Redix.command(conn, [
          "ZADD",
          Keys.completed(ctx),
          now,
          "c1",
          now + 1,
          "c2",
          now + 2,
          "c3",
          now + 3,
          "c4"
        ])

      {:ok, _} = Redix.command(conn, ["ZADD", Keys.failed(ctx), now, "f1"])

      # Get counts
      {:ok, waiting} = Redix.command(conn, ["LLEN", Keys.wait(ctx)])
      {:ok, active} = Redix.command(conn, ["LLEN", Keys.active(ctx)])
      {:ok, delayed} = Redix.command(conn, ["ZCARD", Keys.delayed(ctx)])
      {:ok, completed} = Redix.command(conn, ["ZCARD", Keys.completed(ctx)])
      {:ok, failed} = Redix.command(conn, ["ZCARD", Keys.failed(ctx)])

      assert waiting == 3
      assert active == 2
      assert delayed == 1
      assert completed == 4
      assert failed == 1
    end

    @tag :integration
    test "cleans old completed jobs", %{conn: conn} do
      queue_name = "test-clean-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)
      now = System.system_time(:millisecond)

      # Add completed jobs with different ages
      # 1 hour ago
      old_time = now - 3600_000

      {:ok, _} = Redix.command(conn, ["ZADD", Keys.completed(ctx), old_time, "old-1"])
      {:ok, _} = Redix.command(conn, ["ZADD", Keys.completed(ctx), old_time + 100, "old-2"])
      {:ok, _} = Redix.command(conn, ["ZADD", Keys.completed(ctx), now, "new-1"])
      {:ok, _} = Redix.command(conn, ["ZADD", Keys.completed(ctx), now + 100, "new-2"])

      # Remove jobs older than 30 minutes
      grace = now - 1800_000
      {:ok, removed} = Redix.command(conn, ["ZREMRANGEBYSCORE", Keys.completed(ctx), "-inf", grace])

      assert removed == 2

      {:ok, remaining} = Redix.command(conn, ["ZCARD", Keys.completed(ctx)])
      assert remaining == 2
    end
  end

  # ---------------------------------------------------------------------------
  # Event Stream Tests
  # ---------------------------------------------------------------------------

  describe "Event stream" do
    @tag :integration
    test "publishes job events", %{conn: conn} do
      queue_name = "test-events-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)

      # Add events
      events = [
        ["event", "added", "jobId", "job-1"],
        ["event", "active", "jobId", "job-1"],
        ["event", "completed", "jobId", "job-1", "returnvalue", "success"],
        ["event", "added", "jobId", "job-2"],
        ["event", "failed", "jobId", "job-2", "failedReason", "error"]
      ]

      for event <- events do
        {:ok, _} = Redix.command(conn, ["XADD", Keys.events(ctx), "*" | event])
      end

      # Read all events
      {:ok, entries} = Redix.command(conn, ["XRANGE", Keys.events(ctx), "-", "+"])
      assert length(entries) == 5

      # Verify event structure
      [_id, fields] = List.first(entries)
      assert "added" in fields
      assert "job-1" in fields
    end

    @tag :integration
    test "stream has max length", %{conn: conn} do
      queue_name = "test-events-max-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)
      max_events = 100

      # Add many events with exact MAXLEN (not approximate ~)
      for i <- 1..150 do
        {:ok, _} =
          Redix.command(conn, [
            "XADD",
            Keys.events(ctx),
            "MAXLEN",
            max_events,
            "*",
            "event",
            "test",
            "index",
            "#{i}"
          ])
      end

      # Check length is exactly max
      {:ok, len} = Redix.command(conn, ["XLEN", Keys.events(ctx)])
      assert len == max_events
    end
  end

  # ---------------------------------------------------------------------------
  # Stalled Jobs Tests
  # ---------------------------------------------------------------------------

  describe "Stalled job detection" do
    @tag :integration
    test "detects stalled jobs without locks", %{conn: conn} do
      queue_name = "test-stalled-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)

      # Add jobs to active list
      {:ok, _} = Redix.command(conn, ["RPUSH", Keys.active(ctx), "job-1", "job-2", "job-3"])

      # Only job-1 has a lock
      {:ok, _} = Redix.command(conn, ["SET", Keys.lock(ctx, "job-1"), "token", "PX", 30000])

      # Check which jobs have locks
      active_jobs = ["job-1", "job-2", "job-3"]

      stalled_jobs =
        Enum.filter(active_jobs, fn job_id ->
          {:ok, lock} = Redix.command(conn, ["GET", Keys.lock(ctx, job_id)])
          lock == nil
        end)

      assert stalled_jobs == ["job-2", "job-3"]
    end

    @tag :integration
    test "stalled check timestamp tracking", %{conn: conn} do
      queue_name = "test-stalled-check-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)
      now = System.system_time(:millisecond)

      # Record last stalled check
      {:ok, _} = Redix.command(conn, ["SET", Keys.stalled_check(ctx), now])

      # Get last check time
      {:ok, last_check} = Redix.command(conn, ["GET", Keys.stalled_check(ctx)])
      assert String.to_integer(last_check) == now
    end
  end

  # ---------------------------------------------------------------------------
  # Rate Limiter Tests
  # ---------------------------------------------------------------------------

  describe "Rate limiting" do
    @tag :integration
    test "tracks rate limit counter", %{conn: conn} do
      queue_name = "test-ratelimit-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)

      # Increment counter
      {:ok, count} = Redix.command(conn, ["INCR", Keys.limiter(ctx)])
      assert count == 1

      {:ok, count} = Redix.command(conn, ["INCR", Keys.limiter(ctx)])
      assert count == 2
    end

    @tag :integration
    test "rate limit with TTL", %{conn: conn} do
      queue_name = "test-ratelimit-ttl-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)

      # Set counter with expiry
      {:ok, _} = Redix.command(conn, ["SET", Keys.limiter(ctx), 5, "PX", 1000])

      {:ok, count} = Redix.command(conn, ["GET", Keys.limiter(ctx)])
      assert count == "5"

      # Wait for expiry
      Process.sleep(1100)

      {:ok, count} = Redix.command(conn, ["GET", Keys.limiter(ctx)])
      assert count == nil
    end
  end

  # ---------------------------------------------------------------------------
  # Job Dependencies Tests (Flows)
  # ---------------------------------------------------------------------------

  describe "Job dependencies" do
    @tag :integration
    test "tracks parent-child relationships", %{conn: conn} do
      queue_name = "test-deps-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)
      parent_id = "parent-job"
      child_ids = ["child-1", "child-2", "child-3"]

      # Add children as dependencies of parent
      {:ok, _} = Redix.command(conn, ["SADD", Keys.dependencies(ctx, parent_id) | child_ids])

      # Verify dependencies
      {:ok, deps} = Redix.command(conn, ["SMEMBERS", Keys.dependencies(ctx, parent_id)])
      assert Enum.sort(deps) == Enum.sort(child_ids)

      # Mark a child as processed
      {:ok, _} = Redix.command(conn, ["HSET", Keys.processed(ctx, parent_id), "child-1", "result1"])

      {:ok, processed} = Redix.command(conn, ["HGETALL", Keys.processed(ctx, parent_id)])
      assert processed == ["child-1", "result1"]
    end

    @tag :integration
    test "waiting-children state", %{conn: conn} do
      queue_name = "test-waiting-children-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)
      now = System.system_time(:millisecond)

      # Add parent to waiting-children
      {:ok, _} = Redix.command(conn, ["ZADD", Keys.waiting_children(ctx), now, "parent-1"])

      {:ok, waiting} = Redix.command(conn, ["ZRANGE", Keys.waiting_children(ctx), 0, -1])
      assert waiting == ["parent-1"]
    end
  end

  # ---------------------------------------------------------------------------
  # Marker/Blocking Tests
  # ---------------------------------------------------------------------------

  describe "Marker operations" do
    @tag :integration
    test "marker indicates jobs available", %{conn: conn} do
      queue_name = "test-marker-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)

      # Initially no marker
      {:ok, members} = Redix.command(conn, ["ZRANGE", Keys.marker(ctx), 0, -1])
      assert members == []

      # Add marker when job is added
      {:ok, _} = Redix.command(conn, ["ZADD", Keys.marker(ctx), 0, "0"])

      {:ok, members} = Redix.command(conn, ["ZRANGE", Keys.marker(ctx), 0, -1])
      assert members == ["0"]
    end
  end

  # ---------------------------------------------------------------------------
  # Deduplication Tests
  # ---------------------------------------------------------------------------

  describe "Job deduplication" do
    @tag :integration
    test "tracks deduplication IDs", %{conn: conn} do
      queue_name = "test-dedup-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)
      dedup_id = "unique-operation-123"

      # Set dedup key with job ID
      {:ok, _} = Redix.command(conn, ["SET", Keys.dedup(ctx, dedup_id), "job-1", "PX", 60000])

      # Check if deduplicated
      {:ok, existing} = Redix.command(conn, ["GET", Keys.dedup(ctx, dedup_id)])
      assert existing == "job-1"

      # Another job with same dedup ID should find existing
      {:ok, existing} = Redix.command(conn, ["GET", Keys.dedup(ctx, dedup_id)])
      assert existing == "job-1"
    end

    @tag :integration
    test "dedup key expires", %{conn: conn} do
      queue_name = "test-dedup-expire-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)
      dedup_id = "expiring-op"

      # Set with short TTL
      {:ok, _} = Redix.command(conn, ["SET", Keys.dedup(ctx, dedup_id), "job-1", "PX", 100])

      Process.sleep(150)

      {:ok, result} = Redix.command(conn, ["GET", Keys.dedup(ctx, dedup_id)])
      assert result == nil
    end
  end

  # ---------------------------------------------------------------------------
  # Repeat/Scheduler Tests
  # ---------------------------------------------------------------------------

  describe "Repeatable jobs" do
    @tag :integration
    test "stores repeat job configuration", %{conn: conn} do
      queue_name = "test-repeat-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)

      repeat_key = "email:every:60000"

      config =
        Jason.encode!(%{
          name: "send-email",
          every: 60000,
          data: %{template: "welcome"},
          opts: %{attempts: 3}
        })

      {:ok, _} = Redix.command(conn, ["HSET", Keys.repeat(ctx), repeat_key, config])

      {:ok, stored} = Redix.command(conn, ["HGET", Keys.repeat(ctx), repeat_key])
      assert stored == config
    end

    @tag :integration
    test "job scheduler sorted set", %{conn: conn} do
      queue_name = "test-scheduler-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)
      now = System.system_time(:millisecond)

      # Add scheduled jobs
      {:ok, _} = Redix.command(conn, ["ZADD", Keys.job_scheduler(ctx), now + 60000, "job:1"])
      {:ok, _} = Redix.command(conn, ["ZADD", Keys.job_scheduler(ctx), now + 120_000, "job:2"])

      # Get next scheduled
      {:ok, next} = Redix.command(conn, ["ZRANGE", Keys.job_scheduler(ctx), 0, 0, "WITHSCORES"])

      [job_key, _score] = next
      assert job_key == "job:1"
    end
  end

  # ---------------------------------------------------------------------------
  # Pipeline/Transaction Tests
  # ---------------------------------------------------------------------------

  describe "Redis pipelines" do
    @tag :integration
    test "executes multiple commands atomically", %{conn: conn} do
      queue_name = "test-pipeline-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)

      commands = [
        ["RPUSH", Keys.wait(ctx), "job-1"],
        ["RPUSH", Keys.wait(ctx), "job-2"],
        ["LLEN", Keys.wait(ctx)],
        ["LPOP", Keys.wait(ctx)],
        ["LLEN", Keys.wait(ctx)]
      ]

      {:ok, results} = Redix.pipeline(conn, commands)

      assert results == [1, 2, 2, "job-1", 1]
    end

    @tag :integration
    test "transaction with MULTI/EXEC", %{conn: conn} do
      queue_name = "test-transaction-#{System.unique_integer([:positive])}"
      ctx = Keys.context(@test_prefix, queue_name)

      # Use transaction for atomic move
      {:ok, _} = Redix.command(conn, ["RPUSH", Keys.wait(ctx), "job-to-move"])

      {:ok, results} =
        Redix.pipeline(conn, [
          ["MULTI"],
          ["LPOP", Keys.wait(ctx)],
          ["RPUSH", Keys.active(ctx), "job-to-move"],
          ["EXEC"]
        ])

      # EXEC returns the results of queued commands
      [_multi, _queued1, _queued2, exec_results] = results
      assert exec_results == ["job-to-move", 1]
    end
  end
end
