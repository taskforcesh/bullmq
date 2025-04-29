--[[
  Validate and move parent to a wait status (waiting, delayed or prioritized) if needed.
]]
--- @include "moveParentToWait"
local function moveParentToWaitIfNeeded(parentQueueKey, parentDependenciesKey, parentKey, parentId, timestamp)
    local doNotHavePendingDependencies = rcall("SCARD", parentDependenciesKey) == 0
    if doNotHavePendingDependencies then
        moveParentToWait(parentQueueKey, parentKey, parentId, timestamp)
    end
end
