--[[
  Registers (or refreshes) a Worker, its liveness lease and its info.

  Input:
    KEYS[1] leases key ({base}:leases)

    ARGV[1] base key
    ARGV[2] Worker id
    ARGV[3] lease duration (ms)
    ARGV[4] Worker info (JSON, opaque to the script)

  Output:
    1 - Registered.
   -1 - Invalid id.
]]
local rcall = redis.call

--- @include "includes/workerRegistry"

local baseKey = ARGV[1]
local workerId = ARGV[2]
local leaseMs = tonumber(ARGV[3])
local workerKey = baseKey .. ":" .. workerId .. ":worker"

if not isValidWorkerId(workerId) then
  return -1
end

local now = getWorkerRegistryTime()

-- Reusing an expired, unswept id starts a fresh registration.
if rcall("EXISTS", workerKey) == 0 then
  removeWorker(baseKey, KEYS[1], workerId)
end

rcall("ZADD", KEYS[1], now + leaseMs, workerId)
rcall("ZADD", baseKey .. ":started", "NX", now, workerId)
rcall("HSET", workerKey, "info", ARGV[4], "hb", now)
rcall("PEXPIRE", workerKey, leaseMs)
refreshWorkerRegistry(baseKey, KEYS[1], now)
return 1
