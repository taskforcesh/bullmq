
--[[
  Get job scheduler template
  Input:
    KEYS[1] repeat key
    KEYS[2] prefix key

    ARGV[1] job scheduler id
]]
local rcall = redis.call

local millis = rcall("ZSCORE", KEYS[1], ARGV[1])

rcall('SET', 'DEBUG1', 'here')

if millis ~= false then
  rcall('SET', 'DEBUG', millis)
  local templateJobId = "repeat:" .. ARGV[1] .. ":" .. millis

    rcall('SET', 'DEBUG2', templateJobId)
    rcall('SET', 'DEBUG3', KEYS[2] .. templateJobId)

  return {rcall("HGETALL", KEYS[2] .. templateJobId), templateJobId} -- get job data
end

return {0, 0}