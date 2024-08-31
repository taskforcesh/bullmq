--[[
  Function to add job considering priority.
]]

-- Includes
--- @include "addBaseMarkerIfNeeded"

local function addJobWithPriority(markerKey, prioritizedKey, priority, jobId, priorityCounterKey,
  isPausedOrMaxed)
  local prioCounter = rcall("INCR", priorityCounterKey)
  local score = priority * 0x100000000 + prioCounter % 0x100000000
  rcall("ZADD", prioritizedKey, score, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
