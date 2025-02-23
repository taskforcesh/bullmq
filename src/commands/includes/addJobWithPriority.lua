--[[
  Function to add job considering priority.
]]

-- Includes
--- @include "addBaseMarkerIfNeeded"
--- @include "getPriorityScore"

local function addJobWithPriority(markerKey, prioritizedKey, priority, jobId, priorityCounterKey,
  isPausedOrMaxed)
  local score = getPriorityScore(priority, priorityCounterKey)
  rcall("ZADD", prioritizedKey, score, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
