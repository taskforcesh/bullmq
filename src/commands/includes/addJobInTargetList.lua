--[[
  Function to add job in target list and add marker if needed.
]]

-- Includes
--- @include "addBaseMarkerIfNeeded"

local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId, markerMember)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed, markerMember)
end
