--[[
  Check if this job has a parent. If so we will just remove it from
  the parent child list, but if it is the last child we should move the parent to "wait/paused"
  which requires code from "moveToFinished"
]]

--- @include "destructureJobKey"

local function moveParentToWait(parentPrefix, parentId, emitEvent)
  if rcall("HEXISTS", parentPrefix .. "meta", "paused") ~= 1 then
    rcall("RPUSH", parentPrefix .. "wait", parentId)
  else
    rcall("RPUSH", parentPrefix .. "paused", parentId)
  end

  if emitEvent then
    local parentEventStream = parentPrefix .. "events"
    rcall("XADD", parentEventStream, "*", "event", "active", "jobId", parentId, "prev", "waiting-children")
  end
end

local function removeParentDependencyKey(jobKey, hard, baseKey)
  local parentKey = rcall("HGET", jobKey, "parentKey")
  if( (type(parentKey) == "string") and parentKey ~= "" and (rcall("EXISTS", parentKey) == 1)) then
    local parentDependenciesKey = parentKey .. ":dependencies"
    local result = rcall("SREM", parentDependenciesKey, jobKey)
    if result > 0 then
      local pendingDependencies = rcall("SCARD", parentDependenciesKey)
      if pendingDependencies == 0 then
        local parentId = getJobIdFromKey(parentKey)
        local parentPrefix = getJobKeyPrefix(parentKey, parentId)

        rcall("ZREM", parentPrefix .. "waiting-children", parentId)

        if hard then  
          if parentPrefix == baseKey then
            removeParentDependencyKey(parentKey, hard, baseKey)
            rcall("DEL", parentKey, parentKey .. ':logs',
              parentKey .. ':dependencies', parentKey .. ':processed')
          else
            moveParentToWait(parentPrefix, parentId)
          end
        else
          moveParentToWait(parentPrefix, parentId, true)
        end
      end
    end
  end
end

