--[[
  Time helpers shared by the relay scripts. Scripts use the server clock, so
  leases and expiries don't depend on the clocks of the nodes.
]]

local function getRelayTime()
  local time = rcall("TIME")
  return tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
end

-- Highest score of a sorted set (0 if empty): the latest lease or expiry.
local function getRelayLastScore(key)
  local last = rcall("ZRANGE", key, -1, -1, "WITHSCORES")
  return last[2] and tonumber(last[2]) or 0
end
