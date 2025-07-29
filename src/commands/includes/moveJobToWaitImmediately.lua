--[[
  Function to move job to wait to immediately be picked up by a waiting worker.
]]

-- Includes
--- @include "addJobInTargetList"
--- @include "getTargetQueueList"

local function moveJobToWaitImmediately(metaKey, activeKey, waitKey, pausedKey, markerKey, eventStreamKey, jobId)
  local target, isPausedOrMaxed = getTargetQueueList(metaKey, activeKey, waitKey, pausedKey)

  addJobInTargetList(target, markerKey, "RPUSH", isPausedOrMaxed, jobId)

  rcall("XADD", eventStreamKey, "*", "event", "waiting", "jobId", jobId, 'prev', 'active')
end
