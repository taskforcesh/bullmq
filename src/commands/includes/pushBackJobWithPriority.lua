--[[
  Function to add push back job considering priority in front of same prioritized jobs.
]]
local function pushBackJobWithPriority(priorityKey, priority, jobId, priorityCounterKey)
  local prioCounter = rcall("INCR", priorityCounterKey)
  local score = (priority-1) * 0x100000000 + bit.band(prioCounter, 0xffffffffffff)
  rcall("ZADD", priorityKey, score, jobId)
end
