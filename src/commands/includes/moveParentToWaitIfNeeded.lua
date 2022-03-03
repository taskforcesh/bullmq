--[[
  Validate and move parent to active if needed.
]]

local function moveParentToWaitIfNeeded(parentQueueKey, parentDependenciesKey, parentId )
  local isParentActive = rcall("ZSCORE", parentQueueKey .. ":waiting-children", parentId)
  if rcall("SCARD", parentDependenciesKey) == 0 and isParentActive then 
    rcall("ZREM", parentQueueKey .. ":waiting-children", parentId)
    if rcall("HEXISTS", parentQueueKey .. ":meta", "paused") ~= 1 then
      rcall("RPUSH", parentQueueKey .. ":wait", parentId)
    else
      rcall("RPUSH", parentQueueKey .. ":paused", parentId)
    end
    local parentEventStream = parentQueueKey .. ":events"
    rcall("XADD", parentEventStream, "*", "event", "active", "jobId", parentId, "prev", "waiting-children")
  end
end
