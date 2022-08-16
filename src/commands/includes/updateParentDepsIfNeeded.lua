--[[
  Validate and move or add dependencies to parent.
]]

-- Includes
--- @include "addJobWithPriority"
--- @include "getTargetQueueList"

local function updateParentDepsIfNeeded(parentKey, parentQueueKey, parentDependenciesKey,
  parentId, jobIdKey, returnvalue )
  local processedSet = parentKey .. ":processed"
  rcall("HSET", processedSet, jobIdKey, returnvalue)
  local activeParent = rcall("ZSCORE", parentQueueKey .. ":waiting-children", parentId)
  if rcall("SCARD", parentDependenciesKey) == 0 and activeParent then 
    rcall("ZREM", parentQueueKey .. ":waiting-children", parentId)
    local parentTarget = getTargetQueueList(parentQueueKey .. ":meta", parentQueueKey .. ":wait", parentQueueKey .. ":paused")
    local priority = tonumber(rcall("HGET", parentKey, "priority"))
    -- Standard or priority add
    if priority == 0 then
      rcall("RPUSH", parentTarget, parentId)
    else
      addJobWithPriority(parentQueueKey .. ":priority", priority, parentTarget, parentId)
    end

    rcall("XADD", parentQueueKey .. ":events", "*", "event", "waiting", "jobId", parentId, "prev", "waiting-children")
  end
end
