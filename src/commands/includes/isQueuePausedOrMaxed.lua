--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]

local function isQueuePausedOrMaxed(queueMetaKey, activeKey, pendingKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")

  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      local pendingCount = rcall("ZCARD", pendingKey)
      return (activeCount + pendingCount) >= tonumber(queueAttributes[2])
    end
  end
  return false
end
