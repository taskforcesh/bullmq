--[[
  Moves job from active to delayed set.

  Input:
    KEYS[1] marker key
    KEYS[2] active key
    KEYS[3] prioritized key
    KEYS[4] delayed key
    KEYS[5] job key
    KEYS[6] events stream
    KEYS[7] meta key

    ARGV[1] key prefix
    ARGV[2] timestamp
    ARGV[3] delayedTimestamp
    ARGV[4] the id of the job
    ARGV[5] queue token
    ARGV[6] delay value
    ARGV[7] skip attempt

  Output:
    0 - OK
   -1 - Missing job.
   -3 - Job not in active set.

  Events:
    - delayed key.
]]
local rcall = redis.call

-- Includes
--- @include "includes/addDelayMarkerIfNeeded"
--- @include "includes/getOrSetMaxEvents"
--- @include "includes/isQueuePaused"

local jobKey = KEYS[5]
local metaKey = KEYS[7]
if rcall("EXISTS", jobKey) == 1 then
    local delayedKey = KEYS[4]
    if ARGV[5] ~= "0" then
        local lockKey = jobKey .. ':lock'
        if rcall("GET", lockKey) == ARGV[5] then
            rcall("DEL", lockKey)
        else
            return -2
        end
    end

    local jobId = ARGV[4]
    local score = tonumber(ARGV[3])
    local delayedTimestamp = (score / 0x1000)

    local numRemovedElements = rcall("LREM", KEYS[2], -1, jobId)
    if numRemovedElements < 1 then return -3 end

    if ARGV[7] == "0" then
        rcall("HINCRBY", jobKey, "atm", 1)
    end
    
    rcall("HSET", jobKey, "delay", ARGV[6])

    local maxEvents = getOrSetMaxEvents(metaKey)

    rcall("ZADD", delayedKey, score, jobId)
    rcall("XADD", KEYS[6], "MAXLEN", "~", maxEvents, "*", "event", "delayed",
          "jobId", jobId, "delay", delayedTimestamp)

    -- Check if we need to push a marker job to wake up sleeping workers.
    local isPaused = isQueuePaused(metaKey)
    if not isPaused then
        local markerKey = KEYS[1]
        addDelayMarkerIfNeeded(markerKey, delayedKey)
    end

    return 0
else
    return -1
end
