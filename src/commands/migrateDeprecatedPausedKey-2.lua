--[[
  Move paused job ids to wait state to repair these states

  Input:
    KEYS[1] paused key
    KEYS[2] wait key

    ARGV[1] count
]]

local maxCount = tonumber(ARGV[1])

local rcall = redis.call

local hasJobs = rcall("EXISTS", KEYS[1]) == 1

if hasJobs then
    local jobs = rcall('LRANGE', KEYS[1], 0, maxCount - 1)
    rcall("RPUSH", KEYS[2], unpack(jobs))
    rcall("LTRIM", KEYS[1], #jobs, -1)

    if (maxCount - #jobs) <= 0 then
        return 1
    end
end

return 0
 