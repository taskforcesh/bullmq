--[[
  Function to add job into pending state.
]]

local function addPendingJobIfNeeded(isPending, pendingKey, jobId, timestamp)
  if isPending then
    rcall("ZADD", pendingKey, timestamp, jobId)
  end
end
