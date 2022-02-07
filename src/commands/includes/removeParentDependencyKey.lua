--[[
  Check if this job has a parent. If so we will just remove it from
  the parent child list, but if it is the last child we should move the parent to "wait/paused"
  which requires code from "moveToFinished"
]]

--- @include "destructureJobKey"

local function moveParentToWait(parentQueuePrefix, parentId, emitEvent)
  if rcall("HEXISTS", parentQueuePrefix .. "meta", "paused") ~= 1 then
    rcall("RPUSH", parentQueuePrefix .. "wait", parentId)
  else
    rcall("RPUSH", parentQueuePrefix .. "paused", parentId)
  end

  if emitEvent then
    local parentEventStream = parentQueuePrefix .. "events"
    rcall("XADD", parentEventStream, "*", "event", "active", "jobId", parentId, "prev", "waiting-children")
  end
end

local function removeParentDependencyKey(jobKey, hard, baseKey)
  local parent = rcall("HGET", jobKey, "parent")
  local parentData
  local parentQueuePrefix
  local parentId
  local parentKey

  if type(parent) == "string" then
      parentData = cjson.decode(parent)
      parentQueuePrefix = parentData['queueKey'] .. ":"
      parentId = parentData['id']
      parentKey = parentQueuePrefix .. parentData['id']
  end
  if( (type(parentKey) == "string") and parentKey ~= "" and (rcall("EXISTS", parentKey) == 1)) then
    local parentDependenciesKey = parentKey .. ":dependencies"
    local result = rcall("SREM", parentDependenciesKey, jobKey)
    if result > 0 then
      local pendingDependencies = rcall("SCARD", parentDependenciesKey)
      if pendingDependencies == 0 then
        rcall("ZREM", parentQueuePrefix .. "waiting-children", parentId)

        if hard then  
          if parentQueuePrefix == baseKey then
            removeParentDependencyKey(parentKey, hard, baseKey)
            rcall("DEL", parentKey, parentKey .. ':logs',
              parentKey .. ':dependencies', parentKey .. ':processed')
          else
            moveParentToWait(parentQueuePrefix, parentId)
          end
        else
          moveParentToWait(parentQueuePrefix, parentId, true)
        end
      end
    end
  end
end
