import Config

config :bullmq,
  prefix: "bullmq_test",
  connections: [
    redis: [
      host: "localhost",
      port: 6379,
      pool_size: 3
    ]
  ]

config :logger, level: :warning

config :elixir, :time_zone_database, Tz.TimeZoneDatabase
