--[[
  Functions to remove jobs.
]]

-- Includes
--- @include "removeJobs"

local function getListItems(keyName, max)
  return rcall('LRANGE', keyName, 0, max - 1)
end

local function removeListJobs(keyName, hard, baseKey, max)
  local jobs = getListItems(keyName, max)
  local count = removeJobs(jobs, hard, baseKey, max)
  rcall("LTRIM", keyName, #jobs, -1)
  return count
end
