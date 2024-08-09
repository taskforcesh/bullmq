--[[
  Function to check for the meta.paused key to decide if we are paused or not
  (since an empty list and !EXISTS are not really the same).
]]

local function getTargetQueueList(queueMetaKey, activeKey, waitKey, pausedKey, pendingKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")

  if queueAttributes[1] then
    return pausedKey, true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      local pendingCount = rcall("ZCARD", pendingKey)
      if (activeCount + pendingCount) >= tonumber(queueAttributes[2]) then
        return waitKey, true
      else
        return waitKey, false
      end
    end
  end
  return waitKey, false
end
