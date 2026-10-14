--[[
  Unregisters a relay node and frees its inbox immediately. Prunes at most
  100 subscriptions; subsequent sweeps finish the cleanup (or the namespace
  expires, if it was the last node).

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] node id

  Output:
    1 - Removed.
    0 - The node was not registered.
]]
local rcall = redis.call

--- @include "includes/relayIndex"
--- @include "includes/refreshRelayNamespace"

local now = getRelayTime()
local removed = removeRelayNode(ARGV[1], KEYS[1], ARGV[2], now)
refreshRelayNamespace(ARGV[1], KEYS[1], now)
pruneRelayNodes(ARGV[1], 100)
return removed
