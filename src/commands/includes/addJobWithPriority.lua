--[[
  Function to add job considering priority.
]]

-- Includes
--- @include "addPriorityMarkerIfNeeded"

local function addJobWithPriority(waitKey, priorityKey, priority, paused, jobId)
  rcall("ZADD", priorityKey, priority, jobId)
  if not paused then
    addPriorityMarkerIfNeeded(waitKey)
  end
end
