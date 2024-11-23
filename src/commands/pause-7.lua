--[[
  Pauses or resumes a queue globably.

  Input:
    KEYS[1] 'wait' or 'paused''
    KEYS[2] 'paused' or 'wait'
    KEYS[3] 'meta'
    KEYS[4] 'prioritized'
    KEYS[5] events stream key
    KEYS[6] 'delayed'
    KEYS|7] 'marker'

    ARGV[1] 'paused' or 'resumed'

  Event:
    publish paused or resumed event.
]]
local rcall = redis.call

-- Includes
--- @include "includes/addDelayMarkerIfNeeded"
--- @include "includes/getWaitPlusPrioritizedCount"

local markerKey = KEYS[7]

if ARGV[1] == "paused" then
    rcall("HSET", KEYS[3], "paused", 1)
    rcall("DEL", markerKey)
else
    rcall("HDEL", KEYS[3], "paused")
    --jobs in paused key
    local hasJobs = rcall("EXISTS", KEYS[1]) == 1

    if hasJobs then
        --move a maximum of 7000 per resumed call in order to not block
        --if users have more jobs in paused state, call resumed multiple times
        local jobs = rcall('LRANGE', KEYS[1], 0, 6999)
        rcall("RPUSH", KEYS[2], unpack(jobs))
        rcall("LTRIM", KEYS[1], #jobs, -1)
    end

    if getWaitPlusPrioritizedCount(KEYS[2], KEYS[4]) > 0 then
        -- Add marker if there are waiting or priority jobs
        rcall("ZADD", markerKey, 0, "0")
    else
        addDelayMarkerIfNeeded(markerKey, KEYS[6])
    end
end

rcall("XADD", KEYS[5], "*", "event", ARGV[1]);
