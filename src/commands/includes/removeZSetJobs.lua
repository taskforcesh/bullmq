-- Includes
--- @include "batches"
--- @include "getZSetItems"
--- @include "removeJobs"  

local function removeZSetJobs(keyName, hard, baseKey, max, jobsToIgnore)
  local jobs = getZSetItems(keyName, max)

  -- filter out jobs to ignore
  if jobsToIgnore then
    local filteredJobs = {}
    for i = 1, #jobs do
      if not jobsToIgnore[jobs[i]] then
        table.insert(filteredJobs, jobs[i])
      end
    end
    jobs = filteredJobs
  end

  local count = removeJobs(jobs, hard, baseKey, max)
  if(#jobs > 0) then
    for from, to in batches(#jobs, 7000) do
      rcall("ZREM", keyName, unpack(jobs, from, to))
    end
  end
  return count
end
