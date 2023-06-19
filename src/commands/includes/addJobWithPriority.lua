--[[
  Function to add job considering priority.
]]

-- Includes
--- @include "addPriorityMarkerIfNeeded"

local function addJobWithPriority(waitKey, priorityKey, jobKey, priority, paused, jobId, timestamp)
  rcall("ZADD", priorityKey, priority, timestamp .. ":" .. jobId)
  rcall("HSET", jobKey, "pprefix", timestamp)
  if not paused then
    addPriorityMarkerIfNeeded(waitKey)
  end
end
