--[[
  Get count jobs in wait or prioritized.
]]

local function getWaitPlusPrioritizedCount(waitKey, prioritizedKey)
  local waitCount = rcall("LLEN", waitKey)
  local prioritizedCount = rcall("ZCARD", prioritizedKey)

  return waitCount + prioritizedCount
end
  