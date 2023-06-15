--[[
  Function to move prioritized job to wait if needed.
]]
local function moveJobFromPriorityToWaitIfNeeded(waitKey, priorityKey)
  local waitLen = rcall("LLEN", waitKey)

  if waitLen == 0 then
    local prioritizedJob = rcall("ZPOPMIN", priorityKey)
    if #prioritizedJob > 0 then
      local prioritizedJobId = prioritizedJob[1]
      rcall("LPUSH", waitKey, prioritizedJobId)
    end
  end
end
