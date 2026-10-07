--[[
  Unsubscribes a relay endpoint from a topic pattern.

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] node id
    ARGV[3] endpoint id
    ARGV[4] pattern

  Output:
    1 - Removed.
    0 - The endpoint was not subscribed to the pattern.
]]
local rcall = redis.call

--- @include "includes/removeRelaySubscription"

local baseKey = ARGV[1]
local nodeId = ARGV[2]
local endpointId = ARGV[3]

local removed = removeRelaySubscription(baseKey, nodeId, endpointId, ARGV[4])
local endpointKey = baseKey .. ":ep:" .. nodeId .. ":" .. endpointId
if rcall("EXISTS", endpointKey) == 0 then
  rcall("SREM", baseKey .. ":eps:" .. nodeId, endpointId)
end
return removed
