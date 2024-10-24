--[[
  Add marker if needed when a job is available.
]]

local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed, jobCounter, markerCount)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, (jobCounter or 1) % (markerCount or 1), "0")
  end  
end
