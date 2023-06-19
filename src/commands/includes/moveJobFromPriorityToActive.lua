--[[
  Function to move job from priority state to active.
  Input:
    keys[1] wait key
    keys[2] active key
    keys[3] priority key
    keys[4] stream events key
    keys[5] stalled key

    -- Rate limiting
    keys[6] rate limiter key
    keys[7] delayed key

    opts - token - lock token
    opts - lockDuration
    opts - limiter
]]

local function moveJobFromPriorityToActive(priorityKey, activeKey)
  local prioritizedJob = rcall("ZPOPMIN", priorityKey)
  if #prioritizedJob > 0 then
    local jobId = string.sub(prioritizedJob[1], 15, -1)
    rcall("LPUSH", activeKey, jobId)
    return jobId
  end
end
  