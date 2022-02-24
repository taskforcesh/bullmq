--[[
  Validate and move parent to active if needed.
]]

local function updateParentIfNeeded(parentQueueKey, parentDependenciesKey, parentId )
  local activeParent = rcall("ZSCORE", parentQueueKey .. ":waiting-children", parentId)
  if rcall("SCARD", parentDependenciesKey) == 0 and activeParent then 
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
