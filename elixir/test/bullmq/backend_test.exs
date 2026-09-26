defmodule BullMQ.BackendTest do
  use ExUnit.Case, async: true

  alias BullMQ.Backend

  defmodule LegacyBackend do
    defstruct [:name]

    def add_job_scheduler(%__MODULE__{}, id, next, s_opts, t_data, t_opts, d_opts, now, prod_id) do
      {:ok,
       %{
         id: id,
         next: next,
         s_opts: s_opts,
         t_data: t_data,
         t_opts: t_opts,
         d_opts: d_opts,
         now: now,
         prod_id: prod_id
       }}
    end

    def is_maxed(%__MODULE__{}) do
      {:ok, true}
    end
  end

  defmodule ModernBackend do
    defstruct [:name]

    def add_job_scheduler(%__MODULE__{}, id, next, opts) do
      {:ok, %{id: id, next: next, opts: opts}}
    end

    def maxed?(%__MODULE__{}) do
      false
    end
  end

  describe "add_job_scheduler backward compatibility" do
    test "Backend.add_job_scheduler/4 unpacks opts when backend only implements add_job_scheduler/9" do
      backend = %LegacyBackend{name: "legacy"}

      assert {:ok, result} =
               Backend.add_job_scheduler(
                 backend,
                 "sched_1",
                 12345,
                 scheduler_opts: %{every: 1000},
                 template_data: "{}",
                 template_opts: %{},
                 delayed_opts: %{},
                 now: 10000,
                 producer_id: "prod_1"
               )

      assert result.id == "sched_1"
      assert result.next == 12345
      assert result.s_opts == %{every: 1000}
      assert result.t_data == "{}"
      assert result.t_opts == %{}
      assert result.d_opts == %{}
      assert result.now == 10000
      assert result.prod_id == "prod_1"
    end

    test "Backend.add_job_scheduler/9 delegates directly to LegacyBackend.add_job_scheduler/9" do
      backend = %LegacyBackend{name: "legacy"}

      assert {:ok, result} =
               Backend.add_job_scheduler(
                 backend,
                 "sched_1",
                 12345,
                 %{every: 1000},
                 "{}",
                 %{},
                 %{},
                 10000,
                 "prod_1"
               )

      assert result.id == "sched_1"
      assert result.prod_id == "prod_1"
    end

    test "Backend.add_job_scheduler/9 packs opts when backend implements add_job_scheduler/4" do
      backend = %ModernBackend{name: "modern"}

      assert {:ok, result} =
               Backend.add_job_scheduler(
                 backend,
                 "sched_1",
                 12345,
                 %{every: 1000},
                 "{}",
                 %{},
                 %{},
                 10000,
                 "prod_1"
               )

      assert result.id == "sched_1"
      opts = Map.new(result.opts)
      assert opts.scheduler_opts == %{every: 1000}
      assert opts.template_data == "{}"
      assert opts.template_opts == %{}
      assert opts.delayed_opts == %{}
      assert opts.now == 10000
      assert opts.producer_id == "prod_1"
    end
  end

  describe "maxed? and is_maxed backward compatibility" do
    test "Backend.maxed?/1 falls back to is_maxed/1 if backend only implements is_maxed/1" do
      backend = %LegacyBackend{name: "legacy"}
      assert Backend.maxed?(backend) == true
    end

    test "Backend.is_maxed/1 calls is_maxed/1 directly if backend implements is_maxed/1" do
      backend = %LegacyBackend{name: "legacy"}
      assert Backend.is_maxed(backend) == {:ok, true}
    end

    test "Backend.is_maxed/1 wraps maxed?/1 if backend implements maxed?/1" do
      backend = %ModernBackend{name: "modern"}
      assert Backend.is_maxed(backend) == {:ok, false}
      assert Backend.maxed?(backend) == false
    end
  end
end
