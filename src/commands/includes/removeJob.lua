--[[
  Function to remove job.
]]

-- Includes
--- @include "removeDebounceKey"
--- @include "removeJobKeys"
--- @include "removeParentDependencyKey"

local function removeJob(jobId, hard, baseKey, shouldRemoveDebounceKey)
  local jobKey = baseKey .. jobId
  removeParentDependencyKey(jobKey, hard, nil, baseKey)
  if shouldRemoveDebounceKey then
    removeDebounceKey(baseKey, jobKey)
  end
  removeJobKeys(jobKey)
end
