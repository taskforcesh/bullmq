--[[
  Helpers shared by the worker registry scripts (the Redis side of migration
  0005_worker_registry). The registry of a queue lives under one base key,
  {queue}:workers:
    {base}:leases          Worker id -> lease end (ms)
    {base}:started         Worker id -> registered at (ms)
    {base}:{id}:worker     info (JSON) and hb (last heartbeat, ms)

  Scripts use the server clock, so leases don't depend on the clocks of the
  Workers. Every key expires on its own, so a queue whose Workers all vanish
  leaves nothing behind, even if no other Worker ever sweeps it.
]]

local function getWorkerRegistryTime()
  local time = rcall("TIME")
  return tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
end

local function isValidWorkerId(id)
  return type(id) == "string" and #id > 0 and #id <= 64 and
    string.match(id, "^[%w_%-]+$") ~= nil
end

--[[
  Removes a Worker immediately: its lease, registration time and record are
  freed. Returns 1 if it was registered, 0 otherwise.
]]
local function removeWorker(baseKey, leasesKey, workerId)
  local removed = rcall("ZREM", leasesKey, workerId)
  rcall("ZREM", baseKey .. ":started", workerId)
  rcall("UNLINK", baseKey .. ":" .. workerId .. ":worker")
  return removed
end

-- Keeps the registry keys expiring with the longest lease, or removes them
-- once no Worker is live. Called after every change to the Worker set.
local function refreshWorkerRegistry(baseKey, leasesKey, now)
  local last = rcall("ZRANGE", leasesKey, -1, -1, "WITHSCORES")
  local leasesUntil = last[2] and tonumber(last[2]) or 0
  if leasesUntil > now then
    rcall("PEXPIREAT", leasesKey, leasesUntil)
    rcall("PEXPIREAT", baseKey .. ":started", leasesUntil)
  else
    rcall("UNLINK", leasesKey, baseKey .. ":started")
  end
end
