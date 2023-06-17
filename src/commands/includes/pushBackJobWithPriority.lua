--[[
  Function to add push back job considering priority in front of same prioritized jobs.
]]
local function pushBackJobWithPriority(priorityKey, priority, jobId, timestamp)
  local firstPrioritizedPattern = rcall("ZRANGEBYSCORE", priorityKey, priority, priority, "LIMIT", 0, 1)

  if #firstPrioritizedPattern > 0 then
    --local firstTimestamp = string.match(firstJob[1], "(.*):.*")
    local firstTimestamp = string.sub(firstPrioritizedPattern[1], 1, 13)
    rcall("ZADD", priorityKey, priority, (tonumber(firstTimestamp)-1) .. ":" .. jobId)
  else
    rcall("ZADD", priorityKey, priority, timestamp .. ":" .. jobId)
  end
end
