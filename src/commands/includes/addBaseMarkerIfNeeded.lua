--[[
  Add marker if needed when a job is available.
]]

local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed, markerMember)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, markerMember)
  end  
end
