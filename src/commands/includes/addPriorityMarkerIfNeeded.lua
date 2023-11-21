--[[
  Function priority marker to wait if needed
  in order to wake up our workers and to respect priority
  order as much as possible
]]
local function addPriorityMarkerIfNeeded(waitKey)
  local waitLen = rcall("LLEN", waitKey)

  if waitLen == 0 then
    rcall("LPUSH", waitKey, "0:0")
  end
end
