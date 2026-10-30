--[[
  Removes expired relay nodes and expired retained messages, and prunes at
  most 100 subscriptions of removed nodes, including cleanup left by earlier
  calls. Any node may call it periodically.

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] max nodes to remove in this call

  Output:
    Array with the ids of the removed nodes.
]]
local rcall = redis.call

--- @include "includes/relayIndex"
--- @include "includes/refreshRelayNamespace"

local baseKey = ARGV[1]
local limit = tonumber(ARGV[2])
local removed = {}

if limit <= 0 then
  return removed
end

local now = getRelayTime()
local nodes = rcall("ZRANGEBYSCORE", KEYS[1], "-inf", now, "LIMIT", 0, limit)
for i = 1, #nodes do
  removeRelayNode(baseKey, KEYS[1], nodes[i], now)
  removed[#removed + 1] = nodes[i]
end

rcall("ZREMRANGEBYSCORE", baseKey .. ":retained", "-inf", now)
refreshRelayNamespace(baseKey, KEYS[1], now)
pruneRelayNodes(baseKey, 100)

return removed
