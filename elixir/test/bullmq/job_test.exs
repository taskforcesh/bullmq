defmodule BullMQ.JobTest do
  use ExUnit.Case, async: true

  alias BullMQ.Job

  describe "new/4" do
    test "creates a job with name and data" do
      job = Job.new("test-queue", "send-email", %{to: "user@example.com"})

      assert job.name == "send-email"
      assert job.data == %{to: "user@example.com"}
      assert job.queue_name == "test-queue"
    end

    test "creates a job with custom options" do
      job = Job.new("queue", "process", %{}, priority: 5, delay: 1000, attempts: 3)

      assert job.priority == 5
      assert job.delay == 1000
      assert job.opts[:attempts] == 3
    end

    test "creates a job with custom id" do
      job = Job.new("queue", "task", %{}, job_id: "custom-123")

      assert job.id == "custom-123"
    end

    test "sets timestamp to current time" do
      before = System.system_time(:millisecond)
      job = Job.new("queue", "test", %{})
      after_time = System.system_time(:millisecond)

      assert job.timestamp >= before
      assert job.timestamp <= after_time
    end
  end

  describe "from_redis/4" do
    test "parses job data from Redis hash" do
      redis_data = %{
        "name" => "email",
        "data" => Jason.encode!(%{to: "test@example.com"}),
        "opts" => Jason.encode!(%{priority: 1}),
        "timestamp" => "1700000000000",
        "delay" => "0",
        "priority" => "1",
        "progress" => "50",
        "attemptsMade" => "2",
        "returnvalue" => Jason.encode!(%{sent: true}),
        "failedReason" => nil,
        "stacktrace" => nil,
        "parentKey" => nil
      }

      job = Job.from_redis("job-123", "test-queue", redis_data)

      assert job.id == "job-123"
      assert job.name == "email"
      assert job.data == %{"to" => "test@example.com"}
      assert job.timestamp == 1_700_000_000_000
      assert job.delay == 0
      assert job.priority == 1
      assert job.progress == 50
      assert job.attempts_made == 2
      assert job.return_value == %{"sent" => true}
    end

    test "handles missing optional fields" do
      redis_data = %{
        "name" => "simple",
        "data" => "{}",
        "opts" => "{}",
        "timestamp" => "1700000000000"
      }

      job = Job.from_redis("job-456", "test-queue", redis_data)

      assert job.id == "job-456"
      assert job.name == "simple"
      assert job.data == %{}
      assert job.progress == 0
      assert job.attempts_made == 0
      assert job.return_value == nil
    end
  end

  describe "to_redis/1" do
    test "converts job to Redis hash format" do
      job = %Job{
        id: "job-789",
        name: "notification",
        queue_name: "test-queue",
        data: %{message: "Hello"},
        opts: %{priority: 2},
        timestamp: 1_700_000_000_000,
        delay: 5000,
        priority: 2,
        progress: 0,
        attempts_made: 0
      }

      redis_data = Job.to_redis(job)

      assert redis_data["name"] == "notification"
      assert Jason.decode!(redis_data["data"]) == %{"message" => "Hello"}
      assert redis_data["timestamp"] == "1700000000000"
    end

    test "includes all required fields" do
      job = Job.new("queue", "test", %{key: "value"})
      redis_data = Job.to_redis(job)

      required_fields = ["name", "data", "opts", "timestamp"]

      for field <- required_fields do
        assert Map.has_key?(redis_data, field), "Missing field: #{field}"
      end
    end
  end

  describe "state checks" do
    test "completed?/1" do
      assert Job.completed?(%Job{id: "1", name: "t", data: %{}, queue_name: "q", finished_on: 123, failed_reason: nil})
      refute Job.completed?(%Job{id: "1", name: "t", data: %{}, queue_name: "q", finished_on: nil})
      refute Job.completed?(%Job{id: "1", name: "t", data: %{}, queue_name: "q", finished_on: 123, failed_reason: "error"})
    end

    test "failed?/1" do
      assert Job.failed?(%Job{id: "1", name: "t", data: %{}, queue_name: "q", failed_reason: "error"})
      refute Job.failed?(%Job{id: "1", name: "t", data: %{}, queue_name: "q", failed_reason: nil})
    end

    test "active?/1" do
      assert Job.active?(%Job{id: "1", name: "t", data: %{}, queue_name: "q", processed_on: 123, finished_on: nil})
      refute Job.active?(%Job{id: "1", name: "t", data: %{}, queue_name: "q", processed_on: nil})
      refute Job.active?(%Job{id: "1", name: "t", data: %{}, queue_name: "q", processed_on: 123, finished_on: 456})
    end

    test "delayed?/1" do
      assert Job.delayed?(%Job{id: "1", name: "t", data: %{}, queue_name: "q", delay: 5000})
      refute Job.delayed?(%Job{id: "1", name: "t", data: %{}, queue_name: "q", delay: 0})
    end
  end

  describe "has_parent?/1" do
    test "returns true for jobs with parent" do
      job = %Job{
        id: "child",
        name: "child-job",
        data: %{},
        queue_name: "q",
        parent: %{id: "parent-123", queue: "parent-queue"}
      }

      assert Job.has_parent?(job)
    end

    test "returns false for jobs without parent" do
      job = Job.new("queue", "standalone", %{})
      refute Job.has_parent?(job)
    end
  end

  describe "opts encoding/decoding for Node.js interoperability" do
    test "encodes opts with short keys for Node.js compatibility" do
      job = %Job{
        id: "job-1",
        name: "test",
        queue_name: "queue",
        data: %{},
        opts: %{
          fail_parent_on_failure: true,
          keep_logs: 10,
          ignore_dependency_on_failure: true
        },
        timestamp: 1_700_000_000_000
      }

      redis_data = Job.to_redis(job)
      decoded_opts = Jason.decode!(redis_data["opts"])

      # Should use short keys
      assert decoded_opts["fpof"] == true
      assert decoded_opts["kl"] == 10
      assert decoded_opts["idof"] == true

      # Original keys should not be present
      refute Map.has_key?(decoded_opts, "fail_parent_on_failure")
      refute Map.has_key?(decoded_opts, "keep_logs")
    end

    test "encodes Elixir snake_case opts to short keys" do
      job = %Job{
        id: "job-2",
        name: "test",
        queue_name: "queue",
        data: %{},
        opts: %{
          fail_parent_on_failure: true,
          keep_logs: 5,
          remove_dependency_on_failure: true
        },
        timestamp: 1_700_000_000_000
      }

      redis_data = Job.to_redis(job)
      decoded_opts = Jason.decode!(redis_data["opts"])

      assert decoded_opts["fpof"] == true
      assert decoded_opts["kl"] == 5
      assert decoded_opts["rdof"] == true
    end

    test "decodes Node.js short keys back to full names" do
      # Simulates data coming from Node.js with short keys
      redis_data = %{
        "name" => "nodejs-job",
        "data" => "{}",
        "opts" => Jason.encode!(%{
          "fpof" => true,
          "kl" => 100,
          "idof" => false,
          "cpof" => true,
          "de" => %{"id" => "dedup-123"}
        }),
        "timestamp" => "1700000000000"
      }

      job = Job.from_redis("job-from-node", "queue", redis_data)

      # Should decode to snake_case for idiomatic Elixir
      assert job.opts["fail_parent_on_failure"] == true
      assert job.opts["keep_logs"] == 100
      assert job.opts["ignore_dependency_on_failure"] == false
      assert job.opts["continue_parent_on_failure"] == true
      assert job.opts["deduplication"] == %{"id" => "dedup-123"}
    end

    test "preserves unknown opts as-is" do
      redis_data = %{
        "name" => "custom",
        "data" => "{}",
        "opts" => Jason.encode!(%{
          "customOption" => "value",
          "attempts" => 3,
          "backoff" => %{"type" => "exponential", "delay" => 1000}
        }),
        "timestamp" => "1700000000000"
      }

      job = Job.from_redis("job-custom", "queue", redis_data)

      assert job.opts["customOption"] == "value"
      assert job.opts["attempts"] == 3
      assert job.opts["backoff"] == %{"type" => "exponential", "delay" => 1000}
    end

    test "round-trip encoding preserves data" do
      original_opts = %{
        fail_parent_on_failure: true,
        keep_logs: 50,
        attempts: 5,
        backoff: %{type: "fixed", delay: 2000}
      }

      job = %Job{
        id: "roundtrip-job",
        name: "test",
        queue_name: "queue",
        data: %{payload: "test"},
        opts: original_opts,
        timestamp: 1_700_000_000_000
      }

      # Encode to Redis format
      redis_data = Job.to_redis(job)

      # Decode back (simulating reading from Redis)
      reconstructed = Job.from_redis(job.id, job.queue_name, redis_data)

      # Should have equivalent data (decoded to snake_case)
      assert reconstructed.opts["fail_parent_on_failure"] == true
      assert reconstructed.opts["keep_logs"] == 50
      assert reconstructed.opts["attempts"] == 5
      assert reconstructed.opts["backoff"] == %{"type" => "fixed", "delay" => 2000}
    end
  end
end
