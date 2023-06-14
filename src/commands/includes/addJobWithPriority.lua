--[[
  Function to add job considering priority.
]]
local function addJobWithPriority(priorityKey, priority, targetKey, paused, jobId)
  if paused then
    rcall("ZADD", priorityKey, priority, jobId)
  else
    rcall("RPUSH", targetKey, jobId)
  end
end
