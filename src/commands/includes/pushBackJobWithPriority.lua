--[[
  Function to add push back job considering priority in front of same prioritized jobs.
]]
local function pushBackJobWithPriority(priorityKey, priority, jobKey, jobId)
  local pprefix = rcall("HGET", jobKey, "pp")
  rcall("ZADD", priorityKey, priority, pprefix .. ":" .. jobId)
end
