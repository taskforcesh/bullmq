--[[
  Remove jobs from the specific set.

  Input:
    KEYS[1]  set key,
    KEYS[2]  events stream key

    ARGV[1]  jobKey prefix
    ARGV[2]  timestamp
    ARGV[3]  limit the number of jobs to be removed. 0 is unlimited
    ARGV[4]  set name, can be any of 'wait', 'active', 'paused', 'delayed', 'completed', or 'failed'
]]
local rcall = redis.call
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

-- Includes
--- @include "includes/batches"
--- @include "includes/removeJob"

local function getTimestamp(jobKey, attributes)
  if #attributes == 1 then
    return rcall("HGET", jobKey, attributes[1])
  end

  local jobTs
  for _, ts in ipairs(rcall("HMGET", jobKey, unpack(attributes))) do
    if (ts) then
      jobTs = ts
      break
    end
  end
  
  return jobTs
end

local function cleanList(listKey, jobKeyPrefix, rangeStart, rangeEnd, timestamp, skipCheckLock)
  local jobs = rcall("LRANGE", listKey, rangeStart, rangeEnd)
  local deleted = {}
  local deletedCount = 0
  local jobTS
  local deletionMarker = ''
  local jobIdsLen = #jobs
  for i, job in ipairs(jobs) do
    if limit > 0 and deletedCount >= limit then
      break
    end
  
    local jobKey = jobKeyPrefix .. job
    if (skipCheckLock or rcall("EXISTS", jobKey .. ":lock") == 0) then
      -- Find the right timestamp of the job to compare to maxTimestamp:
      -- * finishedOn says when the job was completed, but it isn't set unless the job has actually completed
      -- * processedOn represents when the job was last attempted, but it doesn't get populated until the job is first tried
      -- * timestamp is the original job submission time
      -- Fetch all three of these (in that order) and use the first one that is set so that we'll leave jobs that have been active within the grace period:
      jobTS = getTimestamp(jobKey, {"finishedOn", "processedOn", "timestamp"})
      if (not jobTS or jobTS < timestamp) then
        -- replace the entry with a deletion marker; the actual deletion will
        -- occur at the end of the script
        rcall("LSET", listKey, rangeEnd - jobIdsLen + i, deletionMarker)
        removeJob(job, true, jobKeyPrefix)
        deletedCount = deletedCount + 1
        table.insert(deleted, job)
      end
    end
  end

  rcall("LREM", listKey, 0, deletionMarker)

  return {deleted, deletedCount}
end

local function cleanSet(setKey, jobKeyPrefix, rangeStart, rangeEnd, timestamp, attributes)
  local jobs = rcall("ZRANGE", setKey, rangeStart, rangeEnd)
  local deleted = {}
  local deletedCount = 0
  local jobTS
  for i, job in ipairs(jobs) do
    if limit > 0 and deletedCount >= limit then
      break
    end
  
    local jobKey = jobKeyPrefix .. job
    -- * finishedOn says when the job was completed, but it isn't set unless the job has actually completed
    jobTS = getTimestamp(jobKey, attributes)
    if (not jobTS or jobTS < timestamp) then
      removeJob(job, true, jobKeyPrefix)
      deletedCount = deletedCount + 1
      table.insert(deleted, job)
    end
  end

  if(#deleted > 0) then
    for from, to in batches(#deleted, 7000) do
      rcall("ZREM", setKey, unpack(deleted, from, to))
    end
  end
  
  return {deleted, deletedCount}
end

local result
if ARGV[4] == "active" then
  result = cleanList(KEYS[1], ARGV[1], rangeStart, rangeEnd, ARGV[2], false)
elseif ARGV[4] == "delayed" then
  result = cleanSet(KEYS[1], ARGV[1], rangeStart, rangeEnd, ARGV[2], {"processedOn", "timestamp"})
elseif ARGV[4] == "wait" or ARGV[4] == "paused" then
  result = cleanList(KEYS[1], ARGV[1], rangeStart, rangeEnd, ARGV[2], true)
else
  result = cleanSet(KEYS[1], ARGV[1], rangeStart, rangeEnd, ARGV[2], {"finishedOn"} )
end

rcall("XADD", KEYS[2], "*", "event", "cleaned", "count", result[2])

return result[1]
