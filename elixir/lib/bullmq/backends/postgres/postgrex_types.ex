require Postgrex.Types

# A Postgrex types module that decodes `json`/`jsonb` columns with Jason, so the
# backend receives already-parsed Elixir terms for the `data`/`opts`/… columns.
Postgrex.Types.define(BullMQ.Backends.Postgres.PostgrexTypes, [], json: Jason)
