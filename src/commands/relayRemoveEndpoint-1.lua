--[[
  Removes every subscription of a relay endpoint.

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] node id
    ARGV[3] endpoint id

  Output:
    Number of removed subscriptions.
]]
local rcall = redis.call

--- @include "includes/removeRelayEndpoint"

return removeRelayEndpoint(ARGV[1], ARGV[2], ARGV[3])
