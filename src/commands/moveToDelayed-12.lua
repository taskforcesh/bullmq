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
    KEYS[8] stalled key
    KEYS[9] wait key
    KEYS[10] rate limiter key
    KEYS[11] paused key
    KEYS[12] pc priority counter

    ARGV[1] key prefix
    ARGV[2] timestamp
    ARGV[3] the id of the job
    ARGV[4] queue token
    ARGV[5] delay value
    ARGV[6] skip attempt
    ARGV[7] optional job fields to update
    ARGV[8] fetch next?
    ARGV[9] opts

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
--- @include "includes/fetchNextJob"
--- @include "includes/getDelayedScore"
--- @include "includes/getOrSetMaxEvents"
--- @include "includes/removeLock"
--- @include "includes/updateJobFields"

local jobKey = KEYS[5]
local markerKey = KEYS[1]
local metaKey = KEYS[7]
local token = ARGV[4] 
if rcall("EXISTS", jobKey) == 1 then
    local errorCode = removeLock(jobKey, KEYS[8], token, ARGV[3])
    if errorCode < 0 then
        return errorCode
    end

    updateJobFields(jobKey, ARGV[7])
    
    local delayedKey = KEYS[4]
    local jobId = ARGV[3]
    local delay = tonumber(ARGV[5])

    local numRemovedElements = rcall("LREM", KEYS[2], -1, jobId)
    if numRemovedElements < 1 then return -3 end

    local score, delayedTimestamp = getDelayedScore(delayedKey, ARGV[2], delay)

    if ARGV[6] == "0" then
        rcall("HINCRBY", jobKey, "atm", 1)
    end

    rcall("HSET", jobKey, "delay", ARGV[5])

    local maxEvents = getOrSetMaxEvents(metaKey)

    rcall("ZADD", delayedKey, score, jobId)
    rcall("XADD", KEYS[6], "MAXLEN", "~", maxEvents, "*", "event", "delayed",
          "jobId", jobId, "delay", delayedTimestamp)

    -- Try to get next job to avoid an extra roundtrip if the queue is not closing,
    -- and not rate limited.
    if (ARGV[8] == "1") then
        local opts = cmsgpack.unpack(ARGV[9])
        local result = fetchNextJob(KEYS[9], KEYS[2], KEYS[3], KEYS[6],
            KEYS[10], KEYS[4], KEYS[11], metaKey, KEYS[12], markerKey,
            ARGV[1], ARGV[2], opts)
        if result and type(result[1]) == "table" then
            return result
        end
    end

    -- Check if we need to push a marker job to wake up sleeping workers.
    addDelayMarkerIfNeeded(markerKey, delayedKey)

    return 0
else
    return -1
end
