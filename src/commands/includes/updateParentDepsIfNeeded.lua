--[[
  Validate and move or add dependencies to parent.
]]

-- Includes
--- @include "addJobWithPriority"

local function updateParentDepsIfNeeded(parentKey, parentQueueKey, parentDependenciesKey,
  parentId, jobIdKey, returnvalue )
  local processedSet = parentKey .. ":processed"
  rcall("HSET", processedSet, jobIdKey, returnvalue)
  local activeParent = rcall("ZSCORE", parentQueueKey .. ":waiting-children", parentId)
  if rcall("SCARD", parentDependenciesKey) == 0 and activeParent then 
    rcall("ZREM", parentQueueKey .. ":waiting-children", parentId)
    local targetKey
    if rcall("HEXISTS", parentQueueKey .. ":meta", "paused") ~= 1 then
      targetKey = parentQueueKey .. ":wait"
    else
      targetKey = parentQueueKey .. ":paused"
    end
    local priority = rcall("HGET", parentKey, "priority")
    -- Standard or priority add
    if priority == 0 then
      rcall("RPUSH", targetKey, parentId)
    else
      addJobWithPriority(parentQueueKey .. ":priority", priority, targetKey, parentId)
    end

    rcall("XADD", parentQueueKey .. ":events", "*", "event", "active", "jobId", parentId, "prev", "waiting-children")
  end
end
