--[[
  Check if this job has a parent. If so we will just remove it from
  the parent child list, but if it is the last child we should move the parent to "wait/paused"
  which requires code from "moveToFinished"
]]

--- @include "destructureJobKey"

local function removeParentDependencyKey(jobKey)
  local parentKey = rcall("HGET", jobKey, "parentKey")
  if( (type(parentKey) == "string") and parentKey ~= "" and (rcall("EXISTS", parentKey) == 1)) then
      local parentDependenciesKey = parentKey .. ":dependencies"
      local result = rcall("SREM", parentDependenciesKey, jobKey)
      if result > 0 and rcall("SCARD", parentDependenciesKey) == 0 then
          local parentId = getJobIdFromKey(parentKey)
          local parentPrefix = getJobKeyPrefix(parentKey, parentId)

          rcall("ZREM", parentPrefix .. "waiting-children", parentId)

          if rcall("HEXISTS", parentPrefix .. "meta", "paused") ~= 1 then
              rcall("RPUSH", parentPrefix .. "wait", parentId)
          else
              rcall("RPUSH", parentPrefix .. "paused", parentId)
          end

          local parentEventStream = parentPrefix .. "events"
          rcall("XADD", parentEventStream, "*", "event", "active", "jobId", parentId, "prev", "waiting-children")
      end
  end
end
