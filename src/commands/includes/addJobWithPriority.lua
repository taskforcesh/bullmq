--[[
  Function to add job considering priority.
]]

-- Includes
--- @include "addPriorityMarkerIfNeeded"

local function addJobWithPriority(waitKey, priorityKey, priority, paused, jobId, priorityCounterKey)
  local prioCounter = rcall("INCR", priorityCounterKey)
  local score = priority * 0x100000000 + bit.band(prioCounter, 0xffffffffffff)
  rcall("ZADD", priorityKey, score, jobId)
  if not paused then
    addPriorityMarkerIfNeeded(waitKey)
  end
end
