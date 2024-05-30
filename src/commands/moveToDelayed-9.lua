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
    KEYS[8] id key
    KEYS[9] stalled key

    ARGV[1] key prefix
    ARGV[2] timestamp
    ARGV[3] the id of the job
    ARGV[4] queue token
    ARGV[5] delay value
    ARGV[6] skip attempt

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
--- @include "includes/removeLock"

local jobKey = KEYS[5]
local metaKey = KEYS[7]
local token = ARGV[4] 
if rcall("EXISTS", jobKey) == 1 then
    local errorCode = removeLock(jobKey, KEYS[9], token, ARGV[3])
    if errorCode < 0 then
        return errorCode
    end

    local jobCounter = rcall("INCR", KEYS[8])
    local delayedKey = KEYS[4]
    local jobId = ARGV[3]
    local delay = tonumber(ARGV[5])
    local delayedTimestamp = (delay > 0 and (tonumber(ARGV[2]) + delay)) or 0
    -- Bake in the job id first 12 bits into the timestamp
    -- to guarantee correct execution order of delayed jobs
    -- (up to 4096 jobs per given timestamp or 4096 jobs apart per timestamp)
    --
    -- WARNING: Jobs that are so far apart that they wrap around will cause FIFO to fail
    local score = delayedTimestamp * 0x1000 + bit.band(jobCounter, 0xfff)

    local numRemovedElements = rcall("LREM", KEYS[2], -1, jobId)
    if numRemovedElements < 1 then return -3 end

    if ARGV[6] == "0" then
        rcall("HINCRBY", jobKey, "atm", 1)
    end
    
    rcall("HSET", jobKey, "delay", ARGV[5])

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
