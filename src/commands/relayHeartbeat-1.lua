--[[
  Renews a relay node's liveness lease.

  Input:
    KEYS[1] nodes key ({base}:nodes)

    ARGV[1] base key
    ARGV[2] node id
    ARGV[3] lease duration (ms)

  Output:
    1 - Lease renewed.
    0 - The node is not registered (it was swept after its lease expired):
        the caller must register again and restore its subscriptions.
]]
local rcall = redis.call

local nodeId = ARGV[2]

if rcall("SISMEMBER", KEYS[1], nodeId) == 0 then
  return 0
end

rcall("SET", ARGV[1] .. ":alive:" .. nodeId, "1", "PX", tonumber(ARGV[3]))
return 1
