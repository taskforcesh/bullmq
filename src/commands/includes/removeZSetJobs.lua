-- Includes
--- @include "batches"
--- @include "getZSetItems"
--- @include "removeJobs"  

local function removeZSetJobs(keyName, hard, baseKey, max)
  local jobs = getZSetItems(keyName, max)
  local count = removeJobs(jobs, hard, baseKey, max)
  if(#jobs > 0) then
    for from, to in batches(#jobs, 7000) do
      rcall("ZREM", keyName, unpack(jobs, from, to))
    end
  end
  return count
end
