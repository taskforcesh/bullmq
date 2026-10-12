--[[
  Registers (or refreshes) a relay node and its liveness lease.

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] node id
    ARGV[3] lease duration (ms)

  Output:
    1 - Registered.
    0 - Old subscriptions still being pruned; retry before registering.
   -5 - Invalid id.
]]
local rcall = redis.call

--- @include "includes/relayTopics"
--- @include "includes/removeRelayNode"
--- @include "includes/pruneRelayNodes"

local baseKey = ARGV[1]
local nodeId = ARGV[2]

if not isValidRelayId(nodeId) then
  return -5
end

-- Never reactivate stale routes, including when recovering before a sweep.
-- Each retry releases Redis after at most 100 subscriptions/empty endpoints.
if rcall("EXISTS", baseKey .. ":alive:" .. nodeId) == 0 then
  removeRelayNode(baseKey, KEYS[1], nodeId)
  pruneRelayNode(baseKey, nodeId, 100)
  if rcall("SISMEMBER", baseKey .. ":cleanup", nodeId) == 1 then
    return 0
  end
end

local time = rcall("TIME")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
rcall("ZADD", KEYS[1], now + tonumber(ARGV[3]), nodeId)
rcall("SET", baseKey .. ":alive:" .. nodeId, "1", "PX", tonumber(ARGV[3]))
return 1
