--[[
  Registers (or refreshes) a relay node, its liveness lease and its info.

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] node id
    ARGV[3] lease duration (ms)
    ARGV[4] node info (JSON, opaque to the script)
    ARGV[5] layout version of the caller
    ARGV[6] max inbox length

  Output:
    1 - Registered.
    0 - Old subscriptions still being pruned; retry before registering.
   -5 - Invalid id.
   -6 - The namespace uses a different data layout version.
]]
local rcall = redis.call

--- @include "includes/relayIndex"
--- @include "includes/refreshRelayNamespace"

local baseKey = ARGV[1]
local nodeId = ARGV[2]
local leaseMs = tonumber(ARGV[3])
local nodeKey = baseKey .. ":" .. nodeId .. ":node"

if not isValidRelayId(nodeId) then
  return -5
end

local layout = rcall("HGET", baseKey .. ":layout", "layout")
if layout and layout ~= ARGV[5] then
  return -6
end

local now = getRelayTime()

-- Never reactivate stale routes, including when recovering before a sweep.
-- Each retry releases Redis after at most 100 subscriptions.
if rcall("EXISTS", nodeKey) == 0 then
  removeRelayNode(baseKey, KEYS[1], nodeId, now)
  refreshRelayNamespace(baseKey, KEYS[1], now)
  pruneRelayNode(baseKey, nodeId, 100)
  if rcall("ZSCORE", baseKey .. ":cleanup", nodeId) then
    return 0
  end
end

rcall("HSET", baseKey .. ":layout", "layout", ARGV[5])
rcall("ZADD", KEYS[1], now + leaseMs, nodeId)
rcall("ZADD", baseKey .. ":started", "NX", now, nodeId)
rcall("HSET", nodeKey, "info", ARGV[4], "hb", now)
rcall("HSET", nodeKey, "maxLen", tonumber(ARGV[6]) or 10000)
rcall("PEXPIRE", nodeKey, leaseMs)
rcall("PEXPIRE", baseKey .. ":" .. nodeId .. ":inbox", leaseMs)
refreshRelayNamespace(baseKey, KEYS[1], now)
return 1
