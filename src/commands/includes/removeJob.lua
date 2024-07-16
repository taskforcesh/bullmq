--[[
  Function to remove job.
]]

-- Includes
--- @include "removeJobKeys"
--- @include "removeParentDependencyKey"

local function removeJob(jobId, hard, baseKey)
  local jobKey = baseKey .. jobId
  removeParentDependencyKey(jobKey, hard, nil, baseKey)
  removeJobKeys(jobKey)
end
