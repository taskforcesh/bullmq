--[[
  Function to recursively move from waitingChildren to failed.
]]

-- Includes
--- @include "moveParentToWaitIfNeeded"

local function moveParentFromWaitingChildrenToFailed( parentQueueKey, parentKey, parentId, jobIdKey, timestamp)
  if rcall("ZREM", parentQueueKey .. ":waiting-children", parentId) == 1 then
    rcall("ZADD", parentQueueKey .. ":failed", timestamp, parentId)
    local failedReason = "child " .. jobIdKey .. " failed"
    rcall("HMSET", parentKey, "failedReason", failedReason, "finishedOn", timestamp)
    rcall("XADD", parentQueueKey .. ":events", "*", "event", "failed", "jobId", parentId, "failedReason",
      failedReason, "prev", "waiting-children")

    local rawParentData = rcall("HGET", parentKey, "parent")

    if rawParentData ~= false then
      local parentData = cjson.decode(rawParentData)
      if parentData['fpof'] then
        moveParentFromWaitingChildrenToFailed(
          parentData['queueKey'],
          parentData['queueKey'] .. ':' .. parentData['id'],
          parentData['id'],
          parentKey,
          timestamp
        )
      elseif parentData['rdof'] then
        local grandParentKey = parentData['queueKey'] .. ':' .. parentData['id']
        local grandParentDependenciesSet = grandParentKey .. ":dependencies"
        if rcall("SREM", grandParentDependenciesSet, parentKey) == 1 then
          moveParentToWaitIfNeeded(parentData['queueKey'], grandParentDependenciesSet,
            grandParentKey, parentData['id'], timestamp)
        end
      end
    end
  end
end
