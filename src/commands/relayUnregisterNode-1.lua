--[[
  Unregisters a relay node, removing its subscriptions and inbox.

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

return removeRelayNode(ARGV[1], KEYS[1], ARGV[2])
