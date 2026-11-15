--[[
  Function to clean job list.
  Returns jobIds and deleted count number.
]]

-- Includes
--- @include "getTimestamp"
--- @include "isJobSchedulerJob"
--- @include "removeJob"

local function tryCleanListJob(listKey, listIndex, job, jobKeyPrefix, timestamp,
  isWaiting, jobSchedulersKey, jobName, deletionMarker)
  local jobKey = jobKeyPrefix .. job
  if (isWaiting or rcall("EXISTS", jobKey .. ":lock") == 0) and
    (jobName == nil or rcall("HGET", jobKey, "name") == jobName) and
    not isJobSchedulerJob(job, jobKey, jobSchedulersKey) then
    -- Find the right timestamp of the job to compare to maxTimestamp:
    -- * finishedOn says when the job was completed, but it isn't set unless the job has actually completed
    -- * processedOn represents when the job was last attempted, but it doesn't get populated until
    --   the job is first tried
    -- * timestamp is the original job submission time
    -- Fetch all three of these (in that order) and use the first one that is set so that we'll leave jobs
    -- that have been active within the grace period:
    local jobTS = getTimestamp(jobKey, {"finishedOn", "processedOn", "timestamp"})
    if (not jobTS or jobTS <= timestamp) then
      -- replace the entry with a deletion marker; the actual deletion will
      -- occur at the end of the script
      rcall("LSET", listKey, listIndex, deletionMarker)
      removeJob(job, true, jobKeyPrefix, true --[[remove debounce key]])
      return true
    end
  end
  return false
end

local function cleanList(listKey, jobKeyPrefix, rangeStart, rangeEnd,
  timestamp, isWaiting, jobSchedulersKey, limit, jobName)
  local deleted = {}
  local deletedCount = 0
  local deletionMarker = ''

  if jobName == nil then
    local jobs = rcall("LRANGE", listKey, rangeStart, rangeEnd)
    local jobIdsLen = #jobs
    for i, job in ipairs(jobs) do
      if limit > 0 and deletedCount >= limit then
        break
      end

      if tryCleanListJob(listKey, rangeEnd - jobIdsLen + i, job, jobKeyPrefix,
        timestamp, isWaiting, jobSchedulersKey, nil, deletionMarker) then
        deletedCount = deletedCount + 1
        table.insert(deleted, job)
      end
    end
  else
    -- Bounded 0-based chunks from tail to head prevent Redis LRANGE negative-index
    -- clamping when list length is an exact multiple of batchSize.
    local listLen = rcall("LLEN", listKey)
    if listLen > 0 then
      local batchSize = 1000
      local offset = 0
      while true do
        local batchEnd = listLen - 1 - offset
        if batchEnd < 0 then
          break
        end
        local batchStart = math.max(0, batchEnd - batchSize + 1)
        local batch = rcall("LRANGE", listKey, batchStart, batchEnd)
        for j = #batch, 1, -1 do
          if limit > 0 and deletedCount >= limit then
            break
          end

          local job = batch[j]
          if tryCleanListJob(listKey, batchStart + j - 1, job, jobKeyPrefix,
            timestamp, isWaiting, jobSchedulersKey, jobName, deletionMarker) then
            deletedCount = deletedCount + 1
            table.insert(deleted, job)
          end
        end

        if limit > 0 and deletedCount >= limit then
          break
        end
        offset = offset + #batch
      end
    end
  end

  if deletedCount > 0 then
    rcall("LREM", listKey, 0, deletionMarker)
  end

  return {deleted, deletedCount}
end
