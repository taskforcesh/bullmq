--[[
  Function to recursively move from waitingChildren to failed.
]]

-- Includes
--- @include "moveParentToWaitIfNeeded"
--- @include "removeDeduplicationKeyIfNeeded"
--- @include "removeJobsOnFail"

local function moveParentToFailedIfNeeded(parentQueueKey, parentKey, parentId, jobIdKey, timestamp)
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

      if jobAttributes[1] then
        local parentData = cjson.decode(jobAttributes[1])
        local grandParentKey = parentData['queueKey'] .. ':' .. parentData['id']
        local grandParentUnsuccesssful = grandParentKey .. ":unsuccessful"
        rcall("ZADD", grandParentUnsuccesssful, timestamp, parentKey)
        if parentData['fpof'] then
          moveParentToFailedIfNeeded(
            parentData['queueKey'],
            parentData['queueKey'] .. ':' .. parentData['id'],
            parentData['id'],
            parentKey,
            timestamp
          )
        elseif parentData['idof'] or parentData['rdof'] then
          local grandParentKey = parentData['queueKey'] .. ':' .. parentData['id']
          local grandParentDependenciesSet = grandParentKey .. ":dependencies"
          if rcall("SREM", grandParentDependenciesSet, parentKey) == 1 then
            moveParentToWaitIfNeeded(parentData['queueKey'], grandParentDependenciesSet,
              grandParentKey, parentData['id'], timestamp)
            if parentData['idof'] then
              local grandParentFailedSet = grandParentKey .. ":failed"
              rcall("HSET", grandParentFailedSet, parentKey, failedReason)
            end
          end
        end
      end

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
