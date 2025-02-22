--[[
  Function to recursively move from waitingChildren to failed.
]]

-- Includes
--- @include "moveParentToWaitIfNeeded"
--- @include "removeDeduplicationKeyIfNeeded"
--- @include "removeJobsOnFail"

local function moveParentFromWaitingChildrenToFailed( parentQueueKey, parentKey, parentId, jobIdKey, timestamp)
  if rcall("ZREM", parentQueueKey .. ":waiting-children", parentId) == 1 then
    local parentQueuePrefix = parentQueueKey .. ":"
    local parentFailedKey = parentQueueKey .. ":failed"
    rcall("ZADD", parentFailedKey, timestamp, parentId)
    local failedReason = "child " .. jobIdKey .. " failed"
    rcall("HSET", parentKey, "failedReason", failedReason, "finishedOn", timestamp)
    rcall("XADD", parentQueueKey .. ":events", "*", "event", "failed", "jobId", parentId, "failedReason",
      failedReason, "prev", "waiting-children")

    local jobAttributes = rcall("HMGET", parentKey, "parent", "deid", "opts")

    removeDeduplicationKeyIfNeeded(parentQueueKey .. ":", jobAttributes[2])

    if jobAttributes[1] then
      local parentData = cjson.decode(jobAttributes[1])
      if parentData['fpof'] then
        moveParentFromWaitingChildrenToFailed(
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
  elseif rcall("EXISTS", parentKey) == 1 then
    local failedReason = rcall("HGET", parentKey, "failedReason")

    -- make sure to not overwrite the failed reason if already existed
    if not failedReason then
      rcall("HSET", parentKey, "failedReason", "child " .. jobIdKey .. " failed")
    end
  end
end
