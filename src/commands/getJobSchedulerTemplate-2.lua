
--[[
  Get job scheduler template. Taking the last iterations job's data and options
  TODO: return a stored template in the job scheduler itself
  Input:
    KEYS[1] repeat key
    KEYS[2] prefix key

    ARGV[1] job scheduler id
]]
local rcall = redis.call

local millis = rcall("ZSCORE", KEYS[1], ARGV[1])

if millis ~= false then
  local templateJobId = "repeat:" .. ARGV[1] .. ":" .. millis

  return {rcall("HGETALL", KEYS[2] .. templateJobId)} -- get job data
end

return {0, 0}