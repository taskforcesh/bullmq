
--[[
  Function to move job from wait state to active.
]]

local function moveJobFromWaitToActive(priorityKey, eventsKey, jobKey, jobId, processedOn)
  rcall("ZREM", priorityKey, jobId) -- remove from priority
  rcall("XADD", eventsKey, "*", "event", "active", "jobId", jobId, "prev", "waiting")
  rcall("HSET", jobKey, "processedOn", processedOn)
  rcall("HINCRBY", jobKey, "attemptsMade", 1)
end
