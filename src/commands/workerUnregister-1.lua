--[[
  Unregisters a Worker.

  Input:
    KEYS[1] leases key ({base}:leases)

    ARGV[1] base key
    ARGV[2] Worker id

  Output:
    1 - Removed.
    0 - The Worker was not registered.
]]
local rcall = redis.call

--- @include "includes/workerRegistry"

local removed = removeWorker(ARGV[1], KEYS[1], ARGV[2])
refreshWorkerRegistry(ARGV[1], KEYS[1], getWorkerRegistryTime())
return removed
