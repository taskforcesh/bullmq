--[[
  Read-only list of the live Workers of a queue, for getWorkers().

  Input:
    KEYS[1] leases key ({base}:leases)

    ARGV[1] base key

  Output (one array per Worker):
    { id, registered at, lease until, info, last heartbeat } (ordered by
    registration; a Worker whose lease expired is not listed)
]]
local rcall = redis.call

--- @include "includes/workerRegistry"

local baseKey = ARGV[1]
local now = getWorkerRegistryTime()
local rows = {}

local started = rcall("ZRANGE", baseKey .. ":started", 0, -1, "WITHSCORES")
for i = 1, #started, 2 do
  local workerId = started[i]
  local leaseUntil = rcall("ZSCORE", KEYS[1], workerId)
  if leaseUntil and tonumber(leaseUntil) > now then
    local record = rcall("HMGET", baseKey .. ":" .. workerId .. ":worker",
      "info", "hb")
    if record[1] then
      rows[#rows + 1] = { workerId, started[i + 1], leaseUntil, record[1],
        record[2] or "" }
    end
  end
end

return rows
