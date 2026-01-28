defmodule BullMQ.MixProject do
  use Mix.Project

  @version "1.2.5"
  @source_url "https://github.com/taskforcesh/bullmq"
  @description "A powerful, fast, and robust job queue for Elixir backed by Redis"

  def project do
    [
      app: :bullmq,
      version: @version,
      elixir: "~> 1.15",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      aliases: aliases(),

      # Hex
      package: package(),
      description: @description,

      # Docs
      name: "BullMQ",
      source_url: @source_url,
      homepage_url: "https://bullmq.io",
      docs: docs(),

      # Dialyzer
      dialyzer: [
        plt_file: {:no_warn, "priv/plts/dialyzer.plt"},
        plt_add_apps: [:mix, :ex_unit],
        flags: [
          :error_handling,
          :missing_return,
          :underspecs,
          :unknown
        ]
      ],

      # Test coverage
      test_coverage: [tool: ExCoveralls]
    ]
  end

  def cli do
    [
      preferred_envs: [
        coveralls: :test,
        "coveralls.detail": :test,
        "coveralls.post": :test,
        "coveralls.html": :test
      ]
    ]
  end

  def application do
    [
      extra_applications: [:logger, :crypto]
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    [
      # Redis client
      {:redix, "~> 1.3"},

      # Connection pooling
      {:nimble_pool, "~> 1.0"},

      # Configuration validation
      {:nimble_options, "~> 1.0"},

      # JSON encoding/decoding
      {:jason, "~> 1.4"},

      # Cron expression parsing
      {:crontab, "~> 1.1"},

      # MessagePack encoding for Lua scripts
      {:msgpax, "~> 2.4"},

      # UUID generation
      {:elixir_uuid, "~> 1.2"},

      # Telemetry for instrumentation
      {:telemetry, "~> 1.2"},

      # OpenTelemetry for distributed tracing (optional)
      {:opentelemetry_api, "~> 1.0", optional: true},

      # Development and test dependencies
      {:dialyxir, "~> 1.4", only: [:dev, :test], runtime: false},
      {:ex_doc, "~> 0.31", only: :dev, runtime: false},
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
      {:excoveralls, "~> 0.18", only: :test},
      {:mox, "~> 1.1", only: :test},
      {:stream_data, "~> 0.6", only: [:dev, :test]}
    ]
  end

  defp package do
    [
      name: "bullmq",
      # Note: Lua scripts must be included in priv/scripts for the package to work.
      # They are copied from ../rawScripts via `yarn copy:lua:elixir` before release.
      files: ~w(lib priv .formatter.exs mix.exs README.md LICENSE CHANGELOG.md),
      licenses: ["MIT"],
      links: %{
        "GitHub" => @source_url,
        "Changelog" => "#{@source_url}/blob/master/elixir/CHANGELOG.md",
        "Documentation" => "https://bullmq.io"
      },
      maintainers: ["Taskforce.sh Inc."]
    ]
  end

  defp docs do
    [
      main: "readme",
      source_ref: "v#{@version}",
      source_url: @source_url,
      extras: [
        "README.md": [title: "Overview"],
        "CHANGELOG.md": [title: "Changelog"],
        "guides/introduction.md": [title: "Introduction"],
        "guides/getting_started.md": [title: "Getting Started"],
        "guides/job_options.md": [title: "Job Options"],
        "guides/workers.md": [title: "Workers"],
        "guides/manual_processing.md": [title: "Manual Job Processing"],
        "guides/job_cancellation.md": [title: "Job Cancellation"],
        "guides/deduplication.md": [title: "Deduplication"],
        "guides/queue_events.md": [title: "Queue Events"],
        "guides/job_schedulers.md": [title: "Job Schedulers"],
        "guides/rate_limiting.md": [title: "Rate Limiting"],
        "guides/flows.md": [title: "Flows & Parent-Child Jobs"],
        "guides/telemetry.md": [title: "Telemetry"],
        "guides/scaling.md": [title: "Scaling"],
        "guides/benchmarks.md": [title: "Benchmarks"]
      ],
      groups_for_extras: [
        Guides: ~r/guides\/.*/
      ],
      groups_for_modules: [
        Core: [
          BullMQ,
          BullMQ.Queue,
          BullMQ.Worker,
          BullMQ.Job
        ],
        Configuration: [
          BullMQ.Config,
          BullMQ.Types
        ],
        Events: [
          BullMQ.QueueEvents,
          BullMQ.Telemetry
        ],
        Scheduling: [
          BullMQ.JobScheduler,
          BullMQ.Backoff
        ],
        Advanced: [
          BullMQ.FlowProducer,
          BullMQ.RateLimiter,
          BullMQ.StalledChecker
        ],
        Internal: [
          BullMQ.Scripts,
          BullMQ.Keys,
          BullMQ.RedisConnection
        ]
      ],
      nest_modules_by_prefix: [BullMQ]
    ]
  end

  defp aliases do
    [
      setup: ["deps.get", "cmd --cd assets npm install"],
      test: ["test"],
      "test.watch": ["test.watch"],
      lint: ["format --check-formatted", "credo --strict", "dialyzer"],
      "scripts.copy": &copy_lua_scripts/1
    ]
  end

  # Copy Lua scripts from rawScripts to priv/scripts
  # This ensures scripts are available at compile time
  defp copy_lua_scripts(_args) do
    source_dir = Path.expand("../rawScripts", __DIR__)
    target_dir = Path.expand("priv/scripts", __DIR__)

    File.mkdir_p!(target_dir)

    case File.ls(source_dir) do
      {:ok, files} ->
        lua_files = Enum.filter(files, &String.ends_with?(&1, ".lua"))

        Enum.each(lua_files, fn file ->
          source = Path.join(source_dir, file)
          target = Path.join(target_dir, file)
          File.cp!(source, target)
        end)

        Mix.shell().info("Copied #{length(lua_files)} Lua scripts to priv/scripts/")

      {:error, reason} ->
        Mix.raise("Failed to read rawScripts directory: #{inspect(reason)}")
    end
  end
end
