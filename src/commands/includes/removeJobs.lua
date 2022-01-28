--[[
  Functions remove jobs.
]]
local function getListItems(keyName, max)
  return rcall('LRANGE', keyName, 0, max - 1)
end

local function getZSetItems(keyName, max)
  return rcall('ZRANGE', keyName, 0, max - 1)
end

--- @include "removeParentDependencyKey"

local function removeJobs(keys, hard, baseKey, max)
  for i, key in ipairs(keys) do
    local jobKey = baseKey .. key
    removeParentDependencyKey(jobKey, hard, baseKey)
    rcall("DEL", jobKey)
    rcall("DEL", jobKey .. ':logs')
    rcall("DEL", jobKey .. ':dependencies')
    rcall("DEL", jobKey .. ':processed')
  end
  return max - #keys
end

local function removeListJobs(keyName, hard, baseKey, max)
  local jobs = getListItems(keyName, max)
  local count = removeJobs(jobs, hard, baseKey, max)
  rcall("LTRIM", keyName, #jobs, -1)
  return count
end

local function removeZSetJobs(keyName, hard, baseKey, max)
  local jobs = getZSetItems(keyName, max)
  local count = removeJobs(jobs, hard, baseKey, max)
  if(#jobs > 0) then
    rcall("ZREM", keyName, unpack(jobs))
  end
  return count
end
