--[[
  Validate and move parent to a wait status (waiting, delayed or prioritized) if needed.
]]
--- @include "moveParentToWait"
local function moveParentToWaitIfNeeded(parentQueueKey, parentDependenciesKey, parentKey, parentId, timestamp)
    local hasPendingDependencies = rcall("SCARD", parentDependenciesKey) == 0
    if hasPendingDependencies then
        moveParentToWait(parentQueueKey, parentKey, parentId, timestamp)
    end
end
