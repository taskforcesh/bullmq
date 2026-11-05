--[[
  Function to move job to wait to be picked up by a waiting worker.
]]

-- Includes
--- @include "addJobInTargetList"
--- @include "isQueuePausedOrMaxed"

local function moveJobToWait(metaKey, activeKey, waitKey, pausedKey, markerKey, eventStreamKey,
  jobId, pushCmd)
  local isPausedOrMaxed = isQueuePausedOrMaxed(metaKey, activeKey)
  addJobInTargetList(waitKey, markerKey, pushCmd, isPausedOrMaxed, jobId)

  rcall("XADD", eventStreamKey, "*", "event", "waiting", "jobId", jobId, 'prev', 'active')
end
