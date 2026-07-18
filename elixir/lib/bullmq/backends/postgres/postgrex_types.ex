if Code.ensure_loaded?(Postgrex.Types) do
  require Postgrex.Types

  # A Postgrex types module that decodes `json`/`jsonb` columns with Jason, so the
  # backend receives already-parsed Elixir terms for the `data`/`opts`/… columns.
  Postgrex.Types.define(BullMQ.Backends.Postgres.PostgrexTypes, [], json: Jason)
else
  defmodule BullMQ.Backends.Postgres.PostgrexTypes do
  end
end
