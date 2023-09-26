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

    -- Promote delayed jobs
    KEYS[8] paused key
    KEYS[9] meta key
    KEYS[10] pc priority counter

    -- Arguments
    ARGV[1] key prefix
    ARGV[2] timestamp
    ARGV[3] optional job ID
    ARGV[4] opts

    opts - token - lock token
    opts - lockDuration
    opts - limiter
]]
local rcall = redis.call
local waitKey = KEYS[1]
local activeKey = KEYS[2]
local rateLimiterKey = KEYS[6]
local delayedKey = KEYS[7]
local opts = cmsgpack.unpack(ARGV[4])

-- Includes
--- @include "includes/getNextDelayedTimestamp"
--- @include "includes/getRateLimitTTL"
--- @include "includes/getTargetQueueList"
--- @include "includes/moveJobFromPriorityToActive"
--- @include "includes/prepareJobForProcessing"
--- @include "includes/promoteDelayedJobs"

local target, paused = getTargetQueueList(KEYS[9], waitKey, KEYS[8])

-- Check if there are delayed jobs that we can move to wait.
promoteDelayedJobs(delayedKey, waitKey, target, KEYS[3], KEYS[4], ARGV[1],
                   ARGV[2], paused, KEYS[10])

local maxJobs = tonumber(opts['limiter'] and opts['limiter']['max'])
local expireTime = getRateLimitTTL(maxJobs, rateLimiterKey)

local jobId = nil
if ARGV[3] ~= "" then
    jobId = ARGV[3]

    -- clean stalled key
    rcall("SREM", KEYS[5], jobId)
end

if not jobId or (jobId and string.sub(jobId, 1, 2) == "0:") then
    -- If jobId is special ID 0:delay, then there is no job to process
    if jobId then rcall("LREM", activeKey, 1, jobId) end

    -- Check if we are rate limited first.
    if expireTime > 0 then return {0, 0, expireTime, 0} end

    -- paused queue
    if paused then return {0, 0, 0, 0} end

    -- no job ID, try non-blocking move from wait to active
    jobId = rcall("RPOPLPUSH", waitKey, activeKey)

    -- Since it is possible that between a call to BRPOPLPUSH and moveToActive
    -- another script puts a new maker in wait, we need to check again.
    if jobId and string.sub(jobId, 1, 2) == "0:" then
        rcall("LREM", activeKey, 1, jobId)
        jobId = rcall("RPOPLPUSH", waitKey, activeKey)
    end
end

if jobId then
    return prepareJobForProcessing(KEYS, ARGV[1], target, jobId, ARGV[2],
                                   maxJobs, expireTime, opts)
else
    jobId = moveJobFromPriorityToActive(KEYS[3], activeKey, KEYS[10])
    if jobId then
        return prepareJobForProcessing(KEYS, ARGV[1], target, jobId, ARGV[2],
                                       maxJobs, expireTime, opts)
    end
end

-- Return the timestamp for the next delayed job if any.
local nextTimestamp = getNextDelayedTimestamp(delayedKey)
if (nextTimestamp ~= nil) then return {0, 0, 0, nextTimestamp} end

return {0, 0, 0, 0}
