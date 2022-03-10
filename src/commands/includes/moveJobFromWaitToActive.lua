
--[[
  Function to move job from wait state to active.
]]

local function moveJobFromWaitToActive(waitKey, priorityKey, eventsKey, jobKey, jobId, processedOn)
  rcall("ZREM", priorityKey, jobId) -- remove from priority
  rcall("XADD", eventsKey, "*", "event", "active", "jobId", jobId, "prev", "waiting")
  rcall("HSET", jobKey, "processedOn", processedOn)
  rcall("HINCRBY", jobKey, "attemptsMade", 1)
  local len = rcall("LLEN", waitKey)
  if len == 0 then
    rcall("XADD", eventsKey, "*", "event", "drained");
  end
end
