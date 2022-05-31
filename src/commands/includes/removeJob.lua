--[[
  Function to remove job.
]]

-- Includes
--- @include "removeParentDependencyKey"

local function removeJob(key, hard, baseKey)
  local jobKey = baseKey .. key
  removeParentDependencyKey(jobKey, hard, nil, baseKey)
  rcall("DEL", jobKey, jobKey .. ':logs',
    jobKey .. ':dependencies', jobKey .. ':processed')
end
