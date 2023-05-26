--[[
  Add delay marker if needed.
]]

-- Includes
--- @include "getNextDelayedTimestamp"

local function addDelayMarkerIfNeeded(targetKey, delayedKey)
  if rcall("LLEN", targetKey) == 0 then
    local nextTimestamp = getNextDelayedTimestamp(delayedKey)
    if nextTimestamp ~= nil then
      rcall("LPUSH", targetKey, "0:" .. nextTimestamp)
    end
  end
end
