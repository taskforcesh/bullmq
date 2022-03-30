--[[
  Function to trim events, default 10000.
]]

local function trimEvents(metaKey, eventStreamKey)
  local opts
  local maxEvents = rcall("HMGET", metaKey, "opts.maxLenEvents", "opts")
  if maxEvents[2] then
    opts = cjson.decode(maxEvents[2])
  end
  if maxEvents[1] ~= false then
    rcall("XTRIM", eventStreamKey, "MAXLEN", "~", maxEvents[1])
  elseif (opts and opts["maxLenEvents"]) ~= nil then
    rcall("XTRIM", eventStreamKey, "MAXLEN", "~", opts["maxLenEvents"])
  else
    rcall("XTRIM", eventStreamKey, "MAXLEN", "~", 10000)
  end
end
