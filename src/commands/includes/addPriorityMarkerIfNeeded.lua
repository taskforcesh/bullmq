--[[
  Function to move prioritized job to wait if needed.
]]
local function addPriorityMarkerIfNeeded(waitKey)
  local waitLen = rcall("LLEN", waitKey)

  if waitLen == 0 then
    rcall("LPUSH", waitKey, "0:0")
  end
end
