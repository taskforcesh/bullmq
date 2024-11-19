--[[
  Move next job to be processed to active, lock it and fetch its data. The job
  may be delayed, in that case we need to move it to the delayed set instead.

  This operation guarantees that the worker owns the job during the lock
  expiration time. The worker is responsible of keeping the lock fresh
  so that no other worker picks this job again.

  Input:
    KEYS[1] wait key
    KEYS[2] active key
    KEYS[3] prioritized key
    KEYS[4] stream events key
    KEYS[5] stalled key

    -- Rate limiting
    KEYS[6] rate limiter key
    KEYS[7] delayed key

    -- Delayed jobs
    KEYS[8]  meta key
    KEYS[9]  pc priority counter

    -- Marker
    KEYS[10] marker key

    -- Arguments
    ARGV[1] key prefix
    ARGV[2] timestamp
    ARGV[3] opts

    opts - token - lock token
    opts - lockDuration
    opts - limiter
]]
local rcall = redis.call
local waitKey = KEYS[1]
local activeKey = KEYS[2]
local eventStreamKey = KEYS[4]
local rateLimiterKey = KEYS[6]
local delayedKey = KEYS[7]
local opts = cmsgpack.unpack(ARGV[3])

-- Includes
--- @include "includes/getNextDelayedTimestamp"
--- @include "includes/getRateLimitTTL"
--- @include "includes/isQueuePausedOrMaxed"
--- @include "includes/moveJobFromPriorityToActive"
--- @include "includes/prepareJobForProcessing"
--- @include "includes/promoteDelayedJobs"

local isPausedOrMaxed = isQueuePausedOrMaxed(KEYS[8], activeKey)

-- Check if there are delayed jobs that we can move to wait.
local markerKey = KEYS[10]
promoteDelayedJobs(delayedKey, markerKey, KEYS[1], KEYS[3], eventStreamKey, ARGV[1],
                   ARGV[2], KEYS[9], isPausedOrMaxed)

local maxJobs = tonumber(opts['limiter'] and opts['limiter']['max'])
local expireTime = getRateLimitTTL(maxJobs, rateLimiterKey)

-- Check if we are rate limited first.
if expireTime > 0 then return {0, 0, expireTime, 0} end

-- paused or maxed queue
if isPausedOrMaxed then return {0, 0, 0, 0} end

-- no job ID, try non-blocking move from wait to active
local jobId = rcall("RPOPLPUSH", waitKey, activeKey)

if jobId then
    return prepareJobForProcessing(ARGV[1], rateLimiterKey, eventStreamKey, jobId, ARGV[2],
                                   maxJobs, markerKey, opts)
else
    jobId = moveJobFromPriorityToActive(KEYS[3], activeKey, KEYS[9])
    if jobId then
        return prepareJobForProcessing(ARGV[1], rateLimiterKey, eventStreamKey, jobId, ARGV[2],
                                       maxJobs, markerKey, opts)
    end
end

-- Return the timestamp for the next delayed job if any.
local nextTimestamp = getNextDelayedTimestamp(delayedKey)
if nextTimestamp ~= nil then return {0, 0, 0, nextTimestamp} end

return {0, 0, 0, 0}
