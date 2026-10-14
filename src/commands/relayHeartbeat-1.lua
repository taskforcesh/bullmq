--[[
  Renews a relay node's liveness lease (and the expiry of its namespace).

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] node id
    ARGV[3] lease duration (ms)

  Output:
    1 - Lease renewed.
    0 - The node is not registered or its lease expired (even if not swept):
        the caller must register again and restore its subscriptions.
]]
local rcall = redis.call

--- @include "includes/refreshRelayNamespace"

local baseKey = ARGV[1]
local nodeId = ARGV[2]
local leaseMs = tonumber(ARGV[3])
local nodeKey = baseKey .. ":" .. nodeId .. ":node"

if not rcall("ZSCORE", KEYS[1], nodeId) or rcall("EXISTS", nodeKey) == 0 then
  return 0
end

local now = getRelayTime()
rcall("ZADD", KEYS[1], now + leaseMs, nodeId)
rcall("HSET", nodeKey, "hb", now)
rcall("PEXPIRE", nodeKey, leaseMs)
rcall("PEXPIRE", baseKey .. ":" .. nodeId .. ":inbox", leaseMs)
refreshRelayNamespace(baseKey, KEYS[1], now)
return 1
