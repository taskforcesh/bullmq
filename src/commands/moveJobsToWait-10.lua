--[[
  Move completed, failed or delayed jobs to wait, or to prioritized
  if the job has a priority.

  Input:
    KEYS[1] base key
    KEYS[2] events stream
    KEYS[3] state key (failed, completed, delayed)
    KEYS[4] 'wait'
    KEYS[5] 'paused'
    KEYS[6] 'meta'
    KEYS[7] 'active'
    KEYS[8] 'marker'
    KEYS[9] 'prioritized'
    KEYS[10] 'pc' priority counter

    ARGV[1] count
    ARGV[2] timestamp
    ARGV[3] prev state

  Output:
    1  means the operation is not completed
    0  means the operation is completed
]]
local maxCount = tonumber(ARGV[1])
local timestamp = tonumber(ARGV[2])

local rcall = redis.call;

-- Includes
--- @include "includes/addBaseMarkerIfNeeded"
--- @include "includes/batches"
--- @include "includes/getOrSetMaxEvents"
--- @include "includes/getPriorityScore"
--- @include "includes/isQueuePausedOrMaxed"
--- @include "includes/moveChildBackToParentDependencies"

local metaKey = KEYS[6]
local isPausedOrMaxed = isQueuePausedOrMaxed(metaKey, KEYS[7])

local jobs = rcall('ZRANGEBYSCORE', KEYS[3], 0, timestamp, 'LIMIT', 0, maxCount)
if (#jobs > 0) then

    if ARGV[3] == "failed" then
        for i, key in ipairs(jobs) do
            local jobKey = KEYS[1] .. key
            rcall("HDEL", jobKey, "finishedOn", "processedOn", "failedReason")
            moveChildBackToParentDependencies(jobKey, ARGV[3])
        end
    elseif ARGV[3] == "completed" then
        for i, key in ipairs(jobs) do
            local jobKey = KEYS[1] .. key
            rcall("HDEL", jobKey, "finishedOn", "processedOn", "returnvalue")
            moveChildBackToParentDependencies(jobKey, ARGV[3])
        end
    end

    local maxEvents = getOrSetMaxEvents(metaKey)

    for i, key in ipairs(jobs) do
        -- Emit waiting event
        rcall("XADD", KEYS[2], "MAXLEN", "~", maxEvents, "*", "event",
              "waiting", "jobId", key, "prev", ARGV[3]);
    end

    local standardJobs = {}
    for i, key in ipairs(jobs) do
        local priority = tonumber(rcall("HGET", KEYS[1] .. key, "priority")) or 0
        if priority == 0 then
            standardJobs[#standardJobs + 1] = key
        else
            rcall("ZADD", KEYS[9], getPriorityScore(priority, KEYS[10]), key)
        end
    end

    for from, to in batches(#jobs, 7000) do
        rcall("ZREM", KEYS[3], unpack(jobs, from, to))
    end

    for from, to in batches(#standardJobs, 7000) do
        rcall("LPUSH", KEYS[4], unpack(standardJobs, from, to))
    end

    addBaseMarkerIfNeeded(KEYS[8], isPausedOrMaxed)
end

maxCount = maxCount - #jobs

if (maxCount <= 0) then return 1 end

return 0
