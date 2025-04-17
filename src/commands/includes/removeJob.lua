--[[
  Function to remove job.
]]

-- Includes
--- @include "removeDeduplicationKey"
--- @include "removeJobKeys"
--- @include "removeParentDependencyKey"

local function removeJob(jobId, hard, baseKey, shouldRemoveDeduplicationKey)
  local jobKey = baseKey .. jobId
  removeParentDependencyKey(jobKey, hard, nil, baseKey)
  if shouldRemoveDeduplicationKey then
    removeDeduplicationKey(baseKey, jobKey)
  end
  removeJobKeys(jobKey)
end
