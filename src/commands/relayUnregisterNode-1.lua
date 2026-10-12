--[[
  Unregisters a relay node and unlinks its inbox immediately. Prunes at most
  100 subscriptions/empty endpoints; subsequent sweeps finish the cleanup.

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] node id

  Output:
    1 - Removed.
    0 - The node was not registered.
]]
local rcall = redis.call

--- @include "includes/removeRelayNode"
--- @include "includes/pruneRelayNodes"

local removed = removeRelayNode(ARGV[1], KEYS[1], ARGV[2])
pruneRelayNodes(ARGV[1], 100)
return removed
