--[[
  Validate and move parent to a wait status (waiting, delayed or prioritized) if needed.
]]
-- Includes
--- @include "moveParentToWait"
local function moveParentToWaitIfNoPendingDependencies(parentQueueKey, parentDependenciesKey, parentKey, parentId, timestamp)
  local doNotHavePendingDependencies = rcall("SCARD", parentDependenciesKey) == 0
  if doNotHavePendingDependencies then
    if rcall("EXISTS", parentKey) == 1 then
      local parentWaitingChildrenKey = parentQueueKey .. ":waiting-children"
      if rcall("ZSCORE", parentWaitingChildrenKey, parentId) then    
        rcall("ZREM", parentWaitingChildrenKey, parentId)
        moveParentToWait(parentQueueKey, parentKey, parentId, timestamp)
      end
    end
  end
end
