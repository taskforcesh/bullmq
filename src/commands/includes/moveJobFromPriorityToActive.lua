--[[
  Function to move job from priority state to active.
]]

local function moveJobFromPriorityToActive(priorityKey, activeKey)
  local prioritizedJob = rcall("ZPOPMIN", priorityKey)
  if #prioritizedJob > 0 then
    local jobId = string.match(prioritizedJob[1], "[%d]+:(.*)")
    rcall("LPUSH", activeKey, jobId)
    return jobId
  end
end
  