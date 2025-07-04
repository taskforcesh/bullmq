--[[
  Get job scheduler record.

  Input:
    KEYS[1] 'repeat' key

    ARGV[1] id
]]

local rcall = redis.call
local jobSchedulerKey = KEYS[1] .. ":" .. ARGV[1]

local score = rcall("ZSCORE", KEYS[1], ARGV[1])

if score then
  return {rcall("HGETALL", jobSchedulerKey), score} -- get job data
end

return {nil, nil}
