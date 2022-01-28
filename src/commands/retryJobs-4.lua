--[[
  Attempts to retry all failed jobs

  Input:
    KEYS[1] base key
    KEYS[2] events stream
    KEYS[3] failed state key
    KEYS[4] wait state key

    ARGV[1]  count

  Output:
    1  means the operation is not completed
    0  means the operation is completed
]]
local baseKey = KEYS[1]
local maxCount = tonumber(ARGV[1])

local rcall = redis.call;

-- Includes
--- @include "includes/batches"

local function getZSetItems(keyName, max)
  return rcall('ZRANGE', keyName, 0, max - 1)
end

local jobs = getZSetItems(KEYS[3], maxCount)

if (#jobs > 0) then
  for i, key in ipairs(jobs) do
    local jobKey = baseKey .. key
    rcall("HDEL", jobKey, "finishedOn", "processedOn", "failedReason")

    -- Emit waiting event
    rcall("XADD", KEYS[2], "*", "event", "waiting", "jobId", key);
  end

  for from, to in batches(#jobs, 7000) do
    rcall("ZREM", KEYS[3], unpack(jobs, from, to))
    rcall("LPUSH", KEYS[4], unpack(jobs, from, to))
  end
end

maxCount = maxCount - #jobs

if(maxCount <= 0) then
  return 1
end

return 0
