--[[
  Validate and move parent to active if needed.
]]

-- Includes
--- @include "getTargetQueueList"

local function moveParentToWaitIfNeeded(parentQueueKey, parentDependenciesKey, parentId )
  local isParentActive = rcall("ZSCORE", parentQueueKey .. ":waiting-children", parentId)
  if rcall("SCARD", parentDependenciesKey) == 0 and isParentActive then 
    rcall("ZREM", parentQueueKey .. ":waiting-children", parentId)
    local parentTarget = getTargetQueueList(parentQueueKey .. ":meta", parentQueueKey .. ":wait", parentQueueKey .. ":paused")
    rcall("RPUSH", parentTarget, parentId)

    rcall("XADD", parentQueueKey .. ":events", "*", "event", "active", "jobId", parentId, "prev", "waiting-children")
  end
end
