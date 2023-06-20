--[[
  Function to add job considering priority.
]]

-- Includes
--- @include "addPriorityMarkerIfNeeded"

local function addJobWithPriority(waitKey, priorityKey, jobKey, priority, paused, jobId, priorityPrefixKey)
  local pprefix = rcall("INCR", priorityPrefixKey)
  rcall("ZADD", priorityKey, priority, pprefix .. ":" .. jobId)
  rcall("HSET", jobKey, "pp", pprefix)
  if not paused then
    addPriorityMarkerIfNeeded(waitKey)
  end
end
