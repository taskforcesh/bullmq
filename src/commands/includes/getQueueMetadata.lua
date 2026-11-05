--[[
  Function to get queue metadata.
]]

local function getQueueMetadata(queueMetaKey, activeKey, waitKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency", "max", "duration")

  if queueAttributes[1] then
    return true, queueAttributes[3], queueAttributes[4]
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      if activeCount >= tonumber(queueAttributes[2]) then
        return true, queueAttributes[3], queueAttributes[4]
      else
        return false, queueAttributes[3], queueAttributes[4]
      end
    end
  end
  return false, queueAttributes[3], queueAttributes[4]
end
