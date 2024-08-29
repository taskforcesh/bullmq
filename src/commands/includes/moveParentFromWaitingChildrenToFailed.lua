--[[
  Function to move from waitingChildren to failed.
  Returns parent data and failedReason from parent.
]]

-- Includes
--- @include "removeDebounceKeyIfNeeded"

local function moveParentFromWaitingChildrenToFailed( parentQueueKey, parentKey, parentId, jobIdKey, timestamp)
  if rcall("ZREM", parentQueueKey .. ":waiting-children", parentId) == 1 then
    rcall("ZADD", parentQueueKey .. ":failed", timestamp, parentId)
    local failedReason = "child " .. jobIdKey .. " failed"
    rcall("HMSET", parentKey, "failedReason", failedReason, "finishedOn", timestamp)
    rcall("XADD", parentQueueKey .. ":events", "*", "event", "failed", "jobId", parentId, "failedReason",
      failedReason, "prev", "waiting-children")

    local jobAttributes = rcall("HMGET", parentKey, "parent", "deid")

    removeDebounceKeyIfNeeded(parentQueueKey, jobAttributes[2])

    if jobAttributes[1] then
      return cjson.decode(jobAttributes[1]), failedReason
    end
    
    return nil, nil
  end
end
