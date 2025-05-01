--[[
  Function to recursively move from waitingChildren to failed.
]]

-- Includes
--- @include "moveParentToWaitIfNoPendingDependencies"
--- @include "moveParentToWaitIfNeeded"
--- @include "moveParentToWait"
--- @include "removeJobsOnFail"

local moveParentToFailedIfNeeded
local moveChildFromDependenciesIfNeeded
moveParentToFailedIfNeeded = function (parentQueueKey, parentKey, parentId, jobIdKey, timestamp)
  if rcall("EXISTS", parentKey) == 1 then
    local parentWaitingChildrenKey = parentQueueKey .. ":waiting-children"
    local parentDelayedKey = parentQueueKey .. ":delayed"
    local parentPrioritizedKey = parentQueueKey .. ":prioritized"
    local parentWaitingChildrenOrDelayedKey
    local prevState
    if rcall("ZSCORE", parentWaitingChildrenKey, parentId) then
      parentWaitingChildrenOrDelayedKey = parentWaitingChildrenKey
      prevState = "waiting-children"
    elseif rcall("ZSCORE", parentDelayedKey, parentId) then
      parentWaitingChildrenOrDelayedKey = parentDelayedKey
      prevState = "delayed"
      rcall("HSET", parentKey, "delay", 0)
    end

    if parentWaitingChildrenOrDelayedKey then
      rcall("ZREM", parentWaitingChildrenOrDelayedKey, parentId)
      local parentQueuePrefix = parentQueueKey .. ":"
      local parentFailedKey = parentQueueKey .. ":failed"
      local deferredFailure = "child " .. jobIdKey .. " failed"
      rcall("HSET", parentKey, "defa", deferredFailure)
      moveParentToWait(parentQueueKey, parentKey, parentId, timestamp)
    else
      if not rcall("ZSCORE", parentQueueKey .. ":failed", parentId) then
        local deferredFailure = "child " .. jobIdKey .. " failed"
        rcall("HSET", parentKey, "defa", deferredFailure)
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
        moveParentToWaitIfNeeded(parentData['queueKey'], parentKey, parentData['id'], timestamp)
      end
    elseif parentData['idof'] or parentData['rdof'] then
      if rcall("SREM", parentDependenciesChildrenKey, childKey) == 1 then
        moveParentToWaitIfNoPendingDependencies(parentData['queueKey'], parentDependenciesChildrenKey,
          parentKey, parentData['id'], timestamp)
        if parentData['idof'] then
          local parentFailedChildrenKey = parentKey .. ":failed"
          rcall("HSET", parentFailedChildrenKey, childKey, failedReason)
        end
      end
    end
  end
end
