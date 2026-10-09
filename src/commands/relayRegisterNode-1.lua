--[[
  Registers (or refreshes) a relay node and its liveness lease.

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] node id
    ARGV[3] lease duration (ms)

  Output:
    1 - Registered.
   -5 - Invalid id.
]]
local rcall = redis.call

--- @include "includes/relayTopics"

local baseKey = ARGV[1]
local nodeId = ARGV[2]

if not isValidRelayId(nodeId) then
  return -5
end

local time = rcall("TIME")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
rcall("ZADD", KEYS[1], now + tonumber(ARGV[3]), nodeId)
rcall("SET", baseKey .. ":alive:" .. nodeId, "1", "PX", tonumber(ARGV[3]))
return 1
