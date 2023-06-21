--[[
  Function to move job from priority state to active.
]]

local function moveJobFromPriorityToActive(priorityKey, activeKey)
  local prioritizedJob = rcall("ZPOPMIN", priorityKey)
  if #prioritizedJob > 0 then
    rcall("LPUSH", activeKey, prioritizedJob[1])
    return prioritizedJob[1]
  end
end
  