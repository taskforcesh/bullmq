--[[
  Function to add job considering priority.
]]

-- Includes
--- @include "moveJobFromPriorityToWaitIfNeeded"

local function addJobWithPriority(waitKey, priorityKey, priority, targetKey, paused, jobId)
  rcall("ZADD", priorityKey, priority, jobId)
  if not paused then
    moveJobFromPriorityToWaitIfNeeded(waitKey, priorityKey)
  end
end
