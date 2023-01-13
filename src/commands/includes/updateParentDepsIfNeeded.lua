--[[
  Validate and move or add dependencies to parent.
]]

-- Includes
--- @include "addDelayMarkerIfNeeded"
--- @include "addJobWithPriority"
--- @include "getNextDelayedTimestamp"
--- @include "getTargetQueueList"

local function updateParentDepsIfNeeded(parentKey, parentQueueKey, parentDependenciesKey,
  parentId, jobIdKey, returnvalue, timestamp )
  local processedSet = parentKey .. ":processed"
  rcall("HSET", processedSet, jobIdKey, returnvalue)
  local activeParent = rcall("ZSCORE", parentQueueKey .. ":waiting-children", parentId)
  if rcall("SCARD", parentDependenciesKey) == 0 and activeParent then 
    rcall("ZREM", parentQueueKey .. ":waiting-children", parentId)
    local parentTarget = getTargetQueueList(parentQueueKey .. ":meta", parentQueueKey .. ":wait",
      parentQueueKey .. ":paused")
    local jobAttributes = rcall("HMGET", parentKey, "priority", "delay")
    local priority = tonumber(jobAttributes[1]) or 0
    local delay = tonumber(jobAttributes[2]) or 0
    if delay > 0 then
      local delayedTimestamp = tonumber(timestamp) + delay 
      local score = delayedTimestamp * 0x1000
      local parentDelayedKey = parentQueueKey .. ":delayed" 
      rcall("ZADD", parentDelayedKey, score, parentId)

      addDelayMarkerIfNeeded(parentTarget, parentDelayedKey)
    -- Standard or priority add
    elseif priority == 0 then
      rcall("RPUSH", parentTarget, parentId)
    else
      addJobWithPriority(parentQueueKey .. ":priority", priority, parentTarget, parentId)
    end

    rcall("XADD", parentQueueKey .. ":events", "*", "event", "waiting", "jobId", parentId, "prev", "waiting-children")
  end
end
