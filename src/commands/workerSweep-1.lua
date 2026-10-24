--[[
  Removes expired Workers of a queue. Any Worker may call it periodically.

  Input:
    KEYS[1] leases key ({base}:leases)

    ARGV[1] base key
    ARGV[2] max Workers to remove in this call

  Output:
    Array with the ids of the removed Workers.
]]
local rcall = redis.call

--- @include "includes/workerRegistry"

local baseKey = ARGV[1]
local limit = tonumber(ARGV[2])
local removed = {}

if limit <= 0 then
  return removed
end

local now = getWorkerRegistryTime()
local workers = rcall("ZRANGEBYSCORE", KEYS[1], "-inf", now, "LIMIT", 0, limit)
for i = 1, #workers do
  removeWorker(baseKey, KEYS[1], workers[i])
  removed[#removed + 1] = workers[i]
end

refreshWorkerRegistry(baseKey, KEYS[1], now)
return removed
