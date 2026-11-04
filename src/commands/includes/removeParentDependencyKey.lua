--[[
  Check if this job has a parent. If so we will just remove it from
  the parent child list, but if it is the last child we should move the parent to "wait/paused"
  which requires code from "moveToFinished"
]]

-- Includes
--- @include "destructureJobKey"
--- @include "moveParentToWait"
--- @include "removeJobKeys"

local function _moveParentToWait(parentKey, parentId, timestamp, emitEvent)
  -- Same as when the last child completes, so the parent keeps its priority
  -- and delay. Callers that don't know the current time can't delay the
  -- parent, so it becomes due right away.
  local parentQueueKey = string.sub(parentKey, 1, #parentKey - #parentId - 1)
  moveParentToWait(parentQueueKey, parentKey, parentId, timestamp or 0, not emitEvent)
end

local function removeParentDependencyKey(jobKey, hard, parentKey, baseKey, debounceId, timestamp)
  if parentKey then
    local parentDependenciesKey = parentKey .. ":dependencies"
    local result = rcall("SREM", parentDependenciesKey, jobKey)
    if result > 0 then
      local pendingDependencies = rcall("SCARD", parentDependenciesKey)
      if pendingDependencies == 0 then
        local parentId = getJobIdFromKey(parentKey)
        local parentPrefix = getJobKeyPrefix(parentKey, parentId)

        local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)

        if numRemovedElements == 1 then
          if hard then -- remove parent in same queue
            if parentPrefix == baseKey then
              removeParentDependencyKey(parentKey, hard, nil, baseKey, nil, timestamp)
              removeJobKeys(parentKey)
              if debounceId then
                rcall("DEL", parentPrefix .. "de:" .. debounceId)
              end
            else
              _moveParentToWait(parentKey, parentId, timestamp)
            end
          else
            _moveParentToWait(parentKey, parentId, timestamp, true)
          end
        end
      end
      return true
    end
  else
    local parentAttributes = rcall("HMGET", jobKey, "parentKey", "deid")
    local missedParentKey = parentAttributes[1]
    if( (type(missedParentKey) == "string") and missedParentKey ~= ""
      and (rcall("EXISTS", missedParentKey) == 1)) then
      local parentDependenciesKey = missedParentKey .. ":dependencies"
      local result = rcall("SREM", parentDependenciesKey, jobKey)
      if result > 0 then
        local pendingDependencies = rcall("SCARD", parentDependenciesKey)
        if pendingDependencies == 0 then
          local parentId = getJobIdFromKey(missedParentKey)
          local parentPrefix = getJobKeyPrefix(missedParentKey, parentId)

          local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)

          if numRemovedElements == 1 then
            if hard then
              if parentPrefix == baseKey then
                removeParentDependencyKey(missedParentKey, hard, nil, baseKey, nil, timestamp)
                removeJobKeys(missedParentKey)
                if parentAttributes[2] then
                  rcall("DEL", parentPrefix .. "de:" .. parentAttributes[2])
                end
              else
                _moveParentToWait(missedParentKey, parentId, timestamp)
              end
            else
              _moveParentToWait(missedParentKey, parentId, timestamp, true)
            end
          end
        end
        return true
      end
    end
  end
  return false
end
