--[[
  Function to clean job set.
  Returns jobIds and deleted count number.
]]

-- Includes
--- @include "batches"
--- @include "getJobsInZset"
--- @include "getTimestamp"
--- @include "removeJob"

local function cleanSet(setKey, jobKeyPrefix, rangeStart, rangeEnd, timestamp, limit, attributes)
  local jobs = getJobsInZset(setKey, rangeStart, rangeEnd, timestamp, limit)
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
