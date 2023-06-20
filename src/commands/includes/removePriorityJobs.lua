-- Includes
--- @include "batches"
--- @include "getZSetItems"
--- @include "removeJob"

local function removePriorityJobKeys(keys, hard, baseKey, max)
  for i, key in ipairs(keys) do
    removeJob(string.match(key, "[%d]+:(.*)"), hard, baseKey)
  end
  return max - #keys
end
  
local function removePriorityJobs(keyName, hard, baseKey, max)
  local jobs = getZSetItems(keyName, max)
  local count = removePriorityJobKeys(jobs, hard, baseKey, max)
  if(#jobs > 0) then
    for from, to in batches(#jobs, 7000) do
      rcall("ZREM", keyName, unpack(jobs))
    end
  end
  return count
end
