--[[
  Validate and move parent to a wait status (waiting, delayed or prioritized) if needed.
]]
--- @include "moveParentToWait"
local function moveParentToWaitIfNeeded(parentQueueKey, parentDependenciesKey, parentKey, parentId, timestamp)
    local isParentActive = rcall("ZSCORE", parentQueueKey .. ":waiting-children", parentId)
    if isParentActive and rcall("SCARD", parentDependenciesKey) == 0 then
        moveParentToWait(parentQueueKey, parentKey, parentId, timestamp)
    end
end
