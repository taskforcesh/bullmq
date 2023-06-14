--[[
  Function to add job considering priority.
]]
local function addJobWithPriority(waitKey, priorityKey, priority, targetKey, paused, jobId)
  rcall("ZADD", priorityKey, priority, jobId)
  if not paused then
    local waitLen = rcall("LLEN", KEYS[1])

    if waitLen == 0 then
      local prioritizedJob = rcall("ZPOPMIN", priorityKey)
      if #prioritizedJob > 0 then
        jobId = prioritizedJob[1]
        rcall("LPUSH", targetKey, jobId)
      end  
    end
  end
end
