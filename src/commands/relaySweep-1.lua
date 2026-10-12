--[[
  Marks expired relay nodes dead and prunes at most 100 subscriptions/empty
  endpoints, including cleanup left by earlier calls. Any node may call it
  periodically.

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] max nodes to remove in this call

  Output:
    Array with the ids of the removed nodes.
]]
local rcall = redis.call

--- @include "includes/removeRelayNode"
--- @include "includes/pruneRelayNodes"

local baseKey = ARGV[1]
local limit = tonumber(ARGV[2])
local removed = {}

local time = rcall("TIME")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if limit <= 0 then
  return removed
end
local nodes = rcall("ZRANGEBYSCORE", KEYS[1], "-inf", now, "LIMIT", 0, limit)
for i = 1, #nodes do
  local nodeId = nodes[i]
  removeRelayNode(baseKey, KEYS[1], nodeId)
  removed[#removed + 1] = nodeId
end

pruneRelayNodes(baseKey, 100)

return removed
