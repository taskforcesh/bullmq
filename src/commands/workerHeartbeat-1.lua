--[[
  Renews a Worker's liveness lease (and the expiry of the registry keys).

  Input:
    KEYS[1] leases key ({base}:leases)

    ARGV[1] base key
    ARGV[2] Worker id
    ARGV[3] lease duration (ms)

  Output:
    1 - Lease renewed.
    0 - The Worker is not registered or its lease expired (even if not
        swept): the caller must register again.
]]
local rcall = redis.call

--- @include "includes/workerRegistry"

local baseKey = ARGV[1]
local workerId = ARGV[2]
local leaseMs = tonumber(ARGV[3])
local workerKey = baseKey .. ":" .. workerId .. ":worker"

if not rcall("ZSCORE", KEYS[1], workerId) or rcall("EXISTS", workerKey) == 0 then
  return 0
end

local now = getWorkerRegistryTime()
rcall("ZADD", KEYS[1], now + leaseMs, workerId)
rcall("HSET", workerKey, "hb", now)
rcall("PEXPIRE", workerKey, leaseMs)
refreshWorkerRegistry(baseKey, KEYS[1], now)
return 1
