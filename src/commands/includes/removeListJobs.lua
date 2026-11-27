--[[
  Functions to remove jobs.
]]

-- Includes
--- @include "filterOutJobsToIgnore"
--- @include "removeJobs"

local function getListItems(keyName, max)
  return rcall('LRANGE', keyName, 0, max - 1)
end

local function removeListJobs(keyName, hard, baseKey, max, jobsToIgnore)
  local jobs = getListItems(keyName, max)
  local readCount = #jobs
  local keptJobs = {}

  if jobsToIgnore then
    for i = 1, readCount do
      if jobsToIgnore[jobs[i]] then
        table.insert(keptJobs, jobs[i])
      end
    end
    jobs = filterOutJobsToIgnore(jobs, jobsToIgnore)
  end

  local count = removeJobs(jobs, hard, baseKey, max)
  -- Trim every entry that was read, then put the ignored ones back
  -- at the head in their original order.
  rcall("LTRIM", keyName, readCount, -1)
  for i = #keptJobs, 1, -1 do
    rcall("LPUSH", keyName, keptJobs[i])
  end
  return count
end
