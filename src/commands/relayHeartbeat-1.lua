--[[
  Renews a relay node's liveness lease.

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

local nodeId = ARGV[2]

if not rcall("ZSCORE", KEYS[1], nodeId) or
  rcall("EXISTS", ARGV[1] .. ":alive:" .. nodeId) == 0 then
  return 0
end

local time = rcall("TIME")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
rcall("ZADD", KEYS[1], now + tonumber(ARGV[3]), nodeId)
rcall("SET", ARGV[1] .. ":alive:" .. nodeId, "1", "PX", tonumber(ARGV[3]))
return 1
