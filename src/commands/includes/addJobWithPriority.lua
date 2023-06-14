--[[
  Function to add job considering priority.
]]
local function addJobWithPriority(waitKey, priorityKey, priority, targetKey, paused, jobId)
  if paused then
    rcall("ZADD", priorityKey, priority, jobId)
  else
    local waitLen = rcall("LLEN", KEYS[1])

    if waitLen == 0 then
      rcall("LPUSH", targetKey, jobId)
    else
      rcall("ZADD", priorityKey, priority, jobId)
    end
  end
end
