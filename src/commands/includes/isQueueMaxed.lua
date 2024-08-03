--[[
  Function to check if queue is maxed or not.
]]
local function isQueueMaxed(queueMetaKey, activeKey, pendingKey)
  local maxConcurrency = rcall("HGET", queueMetaKey, "concurrency")

  if maxConcurrency then
    local activeCount = rcall("LLEN", activeKey)
    local pendingCount = rcall("ZCARD", pendingKey)
    if (activeCount + pendingCount) >= tonumber(maxConcurrency) then
      return true
    end
  end

  return false
end
