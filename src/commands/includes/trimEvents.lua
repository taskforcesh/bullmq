--[[
  Function to trim events, default 10000.
]]

local function trimEvents(metaKey, eventStreamKey)
  local maxEvents = rcall("HMGET", metaKey, "opts.maxLenEvents", "maxLenEvents")
  if maxEvents[1] ~= false then
    rcall("XTRIM", eventStreamKey, "MAXLEN", "~", maxEvents[1])
  elseif maxEvents[2] ~= false then
    rcall("XTRIM", eventStreamKey, "MAXLEN", "~", maxEvents[2])
  else
    rcall("XTRIM", eventStreamKey, "MAXLEN", "~", 10000)
  end
end
