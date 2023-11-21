--[[
  Validate and move parent to active if needed.
]]

-- Includes
--- @include "addDelayMarkerIfNeeded"
--- @include "addJobWithPriority"
--- @include "getTargetQueueList"

local function moveParentToWaitIfNeeded(parentQueueKey, parentDependenciesKey, parentKey, parentId, timestamp)
  local isParentActive = rcall("ZSCORE", parentQueueKey .. ":waiting-children", parentId)
  if rcall("SCARD", parentDependenciesKey) == 0 and isParentActive then 
    rcall("ZREM", parentQueueKey .. ":waiting-children", parentId)
    local parentWaitKey = parentQueueKey .. ":wait"
    local parentTarget, paused = getTargetQueueList(parentQueueKey .. ":meta", parentWaitKey,
      parentQueueKey .. ":paused")
    local jobAttributes = rcall("HMGET", parentKey, "priority", "delay")
    local priority = tonumber(jobAttributes[1]) or 0
    local delay = tonumber(jobAttributes[2]) or 0

    if delay > 0 then
      local delayedTimestamp = tonumber(timestamp) + delay 
      local score = delayedTimestamp * 0x1000
      local parentDelayedKey = parentQueueKey .. ":delayed" 
      rcall("ZADD", parentDelayedKey, score, parentId)
      rcall("XADD", parentQueueKey .. ":events", "*", "event", "delayed", "jobId", parentId,
        "delay", delayedTimestamp)

      addDelayMarkerIfNeeded(parentTarget, parentDelayedKey)
    else
      if priority == 0 then
        rcall("RPUSH", parentTarget, parentId)
      else
        addJobWithPriority(parentWaitKey, parentQueueKey .. ":prioritized", priority, paused,
          parentId, parentQueueKey .. ":pc")
      end
  
      rcall("XADD", parentQueueKey .. ":events", "*", "event", "waiting", "jobId", parentId,
        "prev", "waiting-children")
    end
  end
end
