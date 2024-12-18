--[[
  Function to move from waitingChildren to failed.
  Returns parent data and failedReason from parent.
]]

-- Includes
--- @include "removeDeduplicationKeyIfNeeded"
--- @include "removeJobsOnFail"

local function moveParentFromWaitingChildrenToFailed( parentQueueKey, parentKey, parentId, jobIdKey, timestamp)
  if rcall("ZREM", parentQueueKey .. ":waiting-children", parentId) == 1 then
    local parentQueuePrefix = parentQueueKey .. ":"
    local parentFailedKey = parentQueueKey .. ":failed"
    rcall("ZADD", parentFailedKey, timestamp, parentId)
    local failedReason = "child " .. jobIdKey .. " failed"
    rcall("HMSET", parentKey, "failedReason", failedReason, "finishedOn", timestamp)
    rcall("XADD", parentQueueKey .. ":events", "*", "event", "failed", "jobId", parentId, "failedReason",
      failedReason, "prev", "waiting-children")

    local jobAttributes = rcall("HMGET", parentKey, "parent", "deid", "opts")

    removeDeduplicationKeyIfNeeded(parentQueueKey .. ":", jobAttributes[2])

    local parentRawOpts = jobAttributes[3]
    local parentOpts = cjson.decode(parentRawOpts)
    
    removeJobsOnFail(parentQueuePrefix, parentFailedKey, parentId, parentOpts, timestamp)

    if jobAttributes[1] then
      return cjson.decode(jobAttributes[1]), failedReason
    end
    
    return nil, nil
  end
end
