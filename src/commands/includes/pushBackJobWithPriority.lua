--[[
  Function to add push back job considering priority in front of same prioritized jobs.
]]
local function pushBackJobWithPriority(priorityKey, priority, jobKey, jobId, timestamp)
  local firstPrioritizedPattern = rcall("ZRANGEBYSCORE", priorityKey, priority, priority, "LIMIT", 0, 1)

  if #firstPrioritizedPattern > 0 then
    local firstTimestamp = string.sub(firstPrioritizedPattern[1], 1, 13)
    local pprefix = (tonumber(firstTimestamp)-1)
    rcall("ZADD", priorityKey, priority,  pprefix .. ":" .. jobId)
    rcall("HSET", jobKey, "pprefix", pprefix)
  else
    rcall("ZADD", priorityKey, priority, timestamp .. ":" .. jobId)
    rcall("HSET", jobKey, "pprefix", timestamp)
  end
end
