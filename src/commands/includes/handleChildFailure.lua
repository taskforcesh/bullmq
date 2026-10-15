--[[
  Function to resolve a failed child on its parent according to the child's
  failure options, once the child is no longer a pending dependency.
]]

-- Includes
--- @include "moveParentToWaitIfNoPendingDependencies"
--- @include "moveParentToWaitIfNeeded"
--- @include "moveParentToWait"

local handleChildFailureAndMoveParentToWait = function (parentQueueKey, parentKey, parentId, jobIdKey, timestamp)
  if rcall("EXISTS", parentKey) == 1 then
    local parentWaitingChildrenKey = parentQueueKey .. ":waiting-children"
    local parentDelayedKey = parentQueueKey .. ":delayed"
    local parentWaitingChildrenOrDelayedKey
    if rcall("ZSCORE", parentWaitingChildrenKey, parentId) then
      parentWaitingChildrenOrDelayedKey = parentWaitingChildrenKey
    elseif rcall("ZSCORE", parentDelayedKey, parentId) then
      parentWaitingChildrenOrDelayedKey = parentDelayedKey
      rcall("HSET", parentKey, "delay", 0)
    end

    if parentWaitingChildrenOrDelayedKey then
      rcall("ZREM", parentWaitingChildrenOrDelayedKey, parentId)
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

local function handleChildFailure(parentData, parentKey, childKey, failedReason, timestamp)
  if parentData['fpof'] then
    local parentUnsuccessfulChildrenKey = parentKey .. ":unsuccessful"
    rcall("ZADD", parentUnsuccessfulChildrenKey, timestamp, childKey)
    handleChildFailureAndMoveParentToWait(
      parentData['queueKey'],
      parentKey,
      parentData['id'],
      childKey,
      timestamp
    )
  elseif parentData['cpof'] then
    local parentFailedChildrenKey = parentKey .. ":failed"
    rcall("HSET", parentFailedChildrenKey, childKey, failedReason)
    moveParentToWaitIfNeeded(parentData['queueKey'], parentKey, parentData['id'], timestamp)
  elseif parentData['idof'] or parentData['rdof'] then
    moveParentToWaitIfNoPendingDependencies(parentData['queueKey'], parentKey .. ":dependencies",
      parentKey, parentData['id'], timestamp)
    if parentData['idof'] then
      local parentFailedChildrenKey = parentKey .. ":failed"
      rcall("HSET", parentFailedChildrenKey, childKey, failedReason)
    end
  end
end
