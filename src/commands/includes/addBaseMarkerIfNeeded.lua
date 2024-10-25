--[[
  Add marker if needed when a job is available.
]]

local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed, markerScore)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, markerScore, "0")
  end  
end
