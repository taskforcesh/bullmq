--[[
  Add delay marker if needed.
]]

-- Includes
--- @include "getNextDelayedTimestamp"

local function addDelayMarkerIfNeeded(target, delayedKey)
  if rcall("LLEN", target) == 0 then
    local nextTimestamp = getNextDelayedTimestamp(delayedKey)
    if nextTimestamp ~= nil then
      rcall("LPUSH", target, "0:" .. nextTimestamp)
    end
  end
end
