--[[
  Function to add job considering priority.
]]

-- Includes
--- @include "addPriorityMarkerIfNeeded"
--- @include "getPriorityScore"

local function addJobWithPriority(waitKey, prioritizedKey, priority, paused, jobId, priorityCounterKey)
  local score = getPriorityScore(priority, priorityCounterKey)
  rcall("ZADD", prioritizedKey, score, jobId)
  if not paused then
    addPriorityMarkerIfNeeded(waitKey)
  end
end
