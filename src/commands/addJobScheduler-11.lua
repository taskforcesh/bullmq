--[[
  Adds a job scheduler, i.e. a job factory that creates jobs based on a given schedule (repeat options).

    Input:
      KEYS[1]  'repeat' key
      KEYS[2]  'delayed' key
      KEYS[3]  'wait' key
      KEYS[4]  'paused' key
      KEYS[5]  'meta' key
      KEYS[6]  'prioritized' key
      KEYS[7]  'marker' key
      KEYS[8]  'id' key
      KEYS[9]  'events' key
      KEYS[10] 'pc' priority counter
      KEYS[11] 'active' key
      
      ARGV[1] next milliseconds
      ARGV[2] msgpacked options
            [1]  name
            [2]  tz?
            [3]  patten?
            [4]  endDate?
            [5]  every?
      ARGV[3] jobs scheduler id
      ARGV[4] Json stringified template data
      ARGV[5] mspacked template opts
      ARGV[6] msgpacked delayed opts
      ARGV[7] timestamp
      ARGV[8] prefix key
      ARGV[9] producer key

      Output:
        repeatableKey  - OK
]]
local rcall = redis.call
local repeatKey = KEYS[1]
local delayedKey = KEYS[2]
local waitKey = KEYS[3]
local pausedKey = KEYS[4]
local metaKey = KEYS[5]
local prioritizedKey = KEYS[6]
local eventsKey = KEYS[9]

local nextMillis = ARGV[1]
local jobSchedulerId = ARGV[3]
local templateOpts = cmsgpack.unpack(ARGV[5])
local prefixKey = ARGV[8]

-- Includes
--- @include "includes/addJobFromScheduler"
--- @include "includes/getOrSetMaxEvents"
--- @include "includes/isQueuePaused"
--- @include "includes/removeJob"
--- @include "includes/storeJobScheduler"

-- If we are overriding a repeatable job we must delete the delayed job for
-- the next iteration.
local schedulerKey = repeatKey .. ":" .. jobSchedulerId
local nextDelayedJobKey = schedulerKey .. ":" .. nextMillis
local nextDelayedJobId = "repeat:" .. jobSchedulerId .. ":" .. nextMillis

local maxEvents = getOrSetMaxEvents(metaKey)

local function removeJobFromScheduler(prefixKey, delayedKey, prioritizedKey, waitKey, pausedKey, jobId,
    metaKey, eventsKey)
    if rcall("ZSCORE", delayedKey, jobId) then
        removeJob(jobId, true, prefixKey, true --[[remove debounce key]] )
        rcall("ZREM", delayedKey, jobId)
        return true
    elseif rcall("ZSCORE", prioritizedKey, jobId) then
        removeJob(jobId, true, prefixKey, true --[[remove debounce key]] )
        rcall("ZREM", prioritizedKey, jobId)
        return true
    else
        local pausedOrWaitKey = waitKey
        if isQueuePaused(metaKey) then
            pausedOrWaitKey = pausedKey
        end

        if rcall("LREM", pausedOrWaitKey, 1, jobId) > 0 then
            removeJob(jobId, true, prefixKey, true --[[remove debounce key]] )
            return true
        end
    end
    return false
end

if rcall("EXISTS", nextDelayedJobKey) == 1 then
    if not removeJobFromScheduler(prefixKey, delayedKey, prioritizedKey, waitKey, pausedKey,
        nextDelayedJobId, metaKey, eventsKey) then
        rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event",
            "duplicated", "jobId", nextDelayedJobId)

        return nextDelayedJobId .. "" -- convert to string
    end
end

local prevMillis = rcall("ZSCORE", repeatKey, jobSchedulerId)

if prevMillis then    
    local currentJobId = "repeat:" .. jobSchedulerId .. ":" .. prevMillis
    local currentDelayedJobKey = schedulerKey .. ":" .. prevMillis
    
    if currentJobId ~= nextDelayedJobId and rcall("EXISTS", currentDelayedJobKey) == 1 then
        removeJobFromScheduler(prefixKey, delayedKey, prioritizedKey, waitKey, pausedKey,
            currentJobId, metaKey, eventsKey)
    end
end

local schedulerOpts = cmsgpack.unpack(ARGV[2])
storeJobScheduler(jobSchedulerId, schedulerKey, repeatKey, nextMillis, schedulerOpts, ARGV[4], templateOpts)

rcall("INCR", KEYS[8])

addJobFromScheduler(nextDelayedJobKey, nextDelayedJobId, ARGV[6], waitKey, pausedKey,
    KEYS[11], metaKey, prioritizedKey, KEYS[10], delayedKey, KEYS[7], eventsKey,
    schedulerOpts['name'], maxEvents, ARGV[7], ARGV[4], jobSchedulerId)

if ARGV[9] ~= "" then
    rcall("HSET", ARGV[9], "nrjid", nextDelayedJobId)
end

return nextDelayedJobId .. "" -- convert to string
