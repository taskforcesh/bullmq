# This file is kept minimal as BullMQ is a library.
# Configuration should be provided by the consuming application.
#
# Example configuration in your app:
#
#     # In your config/config.exs
#     config :bullmq,
#       prefix: "bull"
#
# Or pass options directly to Queue/Worker functions.

import Config

# Import test config when running tests
if config_env() == :test do
  import_config "test.exs"
end
