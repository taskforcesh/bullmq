--[[
  Add delay marker if needed.
]]

-- Includes
--- @include "getNextDelayedTimestamp"

local function addDelayMarkerIfNeeded(targetKey, delayedKey)
  local waitLen = rcall("LLEN", targetKey)
  if waitLen <= 1 then
    local nextTimestamp = getNextDelayedTimestamp(delayedKey)
    if nextTimestamp ~= nil then
      -- Check if there is already a marker with older timestamp
      -- if there is, we need to replace it.
      if waitLen == 1 then
        local marker = rcall("LINDEX", targetKey, 0)
        local oldTimestamp = tonumber(marker:sub(3))
        if oldTimestamp and oldTimestamp > nextTimestamp then
          rcall("LSET", targetKey, 0, "0:" .. nextTimestamp)
        end
      else
        -- if there is no marker, then we need to add one
        rcall("LPUSH", targetKey, "0:" .. nextTimestamp)
      end
    end
  end
end
