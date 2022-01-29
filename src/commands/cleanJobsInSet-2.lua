--[[
  Remove jobs from the specific set.

  Input:
    KEYS[1]  set key,
    KEYS[2]  events stream key

    ARGV[1]  jobId
    ARGV[2]  timestamp
    ARGV[3]  limit the number of jobs to be removed. 0 is unlimited
    ARGV[4]  set name, can be any of 'wait', 'active', 'paused', 'delayed', 'completed', or 'failed'
]]
local rcall = redis.call
local command = "ZRANGE"
local isList = false

if ARGV[4] == "wait" or ARGV[4] == "active" or ARGV[4] == "paused" then
  command = "LRANGE"
  isList = true
end

local rangeStart = 0
local rangeEnd = -1

local limit = tonumber(ARGV[3])

-- If we're only deleting _n_ items, avoid retrieving all items
-- for faster performance
--
-- Start from the tail of the list, since that's where oldest elements
-- are generally added for FIFO lists
if limit > 0 then
  rangeStart = -1 - limit + 1
  rangeEnd = -1
end

local jobs = rcall(command, KEYS[1], rangeStart, rangeEnd)
local deleted = {}
local deletedCount = 0
local jobTS
for _, job in ipairs(jobs) do
  if limit > 0 and deletedCount >= limit then
    break
  end

  local jobKey = ARGV[1] .. job
  if (rcall("EXISTS", jobKey .. ":lock") == 0) then
    jobTS = rcall("HGET", jobKey, "timestamp")
    if (not jobTS or jobTS < ARGV[2]) then
      if isList then
        rcall("LREM", KEYS[1], 0, job)
      else
        rcall("ZREM", KEYS[1], job)
      end
      rcall("DEL", jobKey, jobKey .. ":logs")
      deletedCount = deletedCount + 1
      table.insert(deleted, job)
    end
  end
end

rcall("XADD", KEYS[2], "*", "event", "cleaned", "count", deletedCount)

return deleted
