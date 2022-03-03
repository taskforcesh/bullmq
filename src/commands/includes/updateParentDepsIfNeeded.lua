--[[
  Add processed results, validate and move parent to active if needed.
]]

-- Includes
--- @include "moveParentToWaitifNeeded"

local function updateParentDepsIfNeeded(parentKey, parentQueueKey, parentDependenciesKey,
  parentId, jobIdKey, returnvalue )
  local processedSet = parentKey .. ":processed"
  rcall("HSET", processedSet, jobIdKey, returnvalue)
  moveParentToWaitifNeeded(parentQueueKey, parentDependenciesKey, parentId )
end
