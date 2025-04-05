--[[
  Function to recursively move from waitingChildren to failed.
]]

-- Includes
--- @include "moveParentToWaitIfNeeded"
--- @include "moveParentToWait"
--- @include "removeDeduplicationKeyIfNeeded"
--- @include "removeJobsOnFail"

local moveParentToFailedIfNeeded
local moveChildFromDependenciesIfNeeded
moveParentToFailedIfNeeded = function (parentQueueKey, parentKey, parentId, jobIdKey, timestamp)
  if rcall("EXISTS", parentKey) == 1 then
    local parentWaitingChildrenKey = parentQueueKey .. ":waiting-children"
    local parentDelayedKey = parentQueueKey .. ":delayed"
    local parentPrioritizedKey = parentQueueKey .. ":prioritized"
    local parentWaitingChildrenOrDelayedOrPrioritizedKey
    local prevState
    if rcall("ZSCORE", parentWaitingChildrenKey, parentId) then
      parentWaitingChildrenOrDelayedOrPrioritizedKey = parentWaitingChildrenKey
      prevState = "waiting-children"
    elseif rcall("ZSCORE", parentDelayedKey, parentId) then
      parentWaitingChildrenOrDelayedOrPrioritizedKey = parentDelayedKey
      prevState = "delayed"
    elseif rcall("ZSCORE", parentPrioritizedKey, parentId) then
      parentWaitingChildrenOrDelayedOrPrioritizedKey = parentPrioritizedKey
      prevState = "prioritized"
    end

    if parentWaitingChildrenOrDelayedOrPrioritizedKey then
      rcall("ZREM", parentWaitingChildrenOrDelayedOrPrioritizedKey, parentId)
      local parentQueuePrefix = parentQueueKey .. ":"
      local parentFailedKey = parentQueueKey .. ":failed"
      rcall("ZADD", parentFailedKey, timestamp, parentId)
      local failedReason = "child " .. jobIdKey .. " failed"
      rcall("HSET", parentKey, "failedReason", failedReason, "finishedOn", timestamp)
      rcall("XADD", parentQueueKey .. ":events", "*", "event", "failed", "jobId", parentId, "failedReason",
        failedReason, "prev", prevState)

      local jobAttributes = rcall("HMGET", parentKey, "parent", "deid", "opts")

      removeDeduplicationKeyIfNeeded(parentQueueKey .. ":", jobAttributes[2])

      moveChildFromDependenciesIfNeeded(jobAttributes[1], parentKey, failedReason, timestamp)

      local parentRawOpts = jobAttributes[3]
      local parentOpts = cjson.decode(parentRawOpts)
      
      removeJobsOnFail(parentQueuePrefix, parentFailedKey, parentId, parentOpts, timestamp)
    else
      local grandParentKey = rcall("HGET", parentKey, "parentKey")

      if grandParentKey then
        local grandParentUnsuccesssfulSet = grandParentKey .. ":unsuccessful"
        rcall("ZADD", grandParentUnsuccesssfulSet, timestamp, parentKey)
      end
    end
  end
end

moveChildFromDependenciesIfNeeded = function (rawParentData, childKey, failedReason, timestamp)
  if rawParentData then
    local parentData = cjson.decode(rawParentData)
    local parentKey = parentData['queueKey'] .. ':' .. parentData['id']
    local parentDependenciesChildrenKey = parentKey .. ":dependencies"
    if parentData['fpof'] then
      if rcall("SREM", parentDependenciesChildrenKey, childKey) == 1 then
        local parentUnsuccesssfulChildrenKey = parentKey .. ":unsuccessful"
        rcall("ZADD", parentUnsuccesssfulChildrenKey, timestamp, childKey)
        moveParentToFailedIfNeeded(
          parentData['queueKey'],
          parentKey,
          parentData['id'],
          childKey,
          timestamp
        )
      end
    elseif parentData['cpof'] then
      if rcall("SREM", parentDependenciesChildrenKey, childKey) == 1 then
        local parentFailedChildrenKey = parentKey .. ":failed"
        rcall("HSET", parentFailedChildrenKey, childKey, failedReason)
        moveParentToWait(parentData['queueKey'], parentKey, parentData['id'], timestamp)
      end
    elseif parentData['idof'] or parentData['rdof'] then
      if rcall("SREM", parentDependenciesChildrenKey, childKey) == 1 then
        moveParentToWaitIfNeeded(parentData['queueKey'], parentDependenciesChildrenKey,
          parentKey, parentData['id'], timestamp)
        if parentData['idof'] then
          local parentFailedChildrenKey = parentKey .. ":failed"
          rcall("HSET", parentFailedChildrenKey, childKey, failedReason)
        end
      end
    end
  end
end
