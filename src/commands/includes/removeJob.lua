--[[
  Function to remove job.
]]

-- Includes
--- @include "removeDeduplicationKeyIfNeededOnRemoval"
--- @include "removeJobKeys"
--- @include "removeParentDependencyKey"

local function removeJob(jobId, hard, baseKey, shouldRemoveDeduplicationKey)
  local jobKey = baseKey .. jobId
  removeParentDependencyKey(jobKey, hard, nil, baseKey)
  if shouldRemoveDeduplicationKey then
    local deduplicationId = rcall("HGET", jobKey, "deid")
    removeDeduplicationKeyIfNeededOnRemoval(baseKey, jobId, deduplicationId)
  end
  removeJobKeys(jobKey)
end
