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
local prioritizedKey = KEYS[6]

local nextMillis = ARGV[1]
local jobSchedulerId = ARGV[3]
local templateOpts = cmsgpack.unpack(ARGV[5])
local prefixKey = ARGV[8]

-- Includes
--- @include "includes/addDelayedJob"
--- @include "includes/addJobWithPriority"
--- @include "includes/getOrSetMaxEvents"
--- @include "includes/getTargetQueueList"
--- @include "includes/isQueuePaused"
--- @include "includes/removeJob"
--- @include "includes/storeJob"
--- @include "includes/storeJobScheduler"

-- If we are overriding a repeatable job we must delete the delayed job for
-- the next iteration.
local schedulerKey = repeatKey .. ":" .. jobSchedulerId
local nextDelayedJobKey = schedulerKey .. ":" .. nextMillis
local nextDelayedJobId = "repeat:" .. jobSchedulerId .. ":" .. nextMillis
local prevMillis = rcall("ZSCORE", repeatKey, jobSchedulerId)

if prevMillis ~= false then
    local currentJobId = "repeat:" .. jobSchedulerId .. ":" .. prevMillis

    if rcall("EXISTS", nextDelayedJobKey) ~= 1 or currentJobId == nextDelayedJobId then
        if rcall("ZSCORE", delayedKey, currentJobId) ~= false then
            removeJob(currentJobId, true, prefixKey, true --[[remove debounce key]] )
            rcall("ZREM", delayedKey, currentJobId)
        elseif rcall("ZSCORE", prioritizedKey, currentJobId) ~= false then
            removeJob(currentJobId, true, prefixKey, true --[[remove debounce key]] )
            rcall("ZREM", prioritizedKey, currentJobId)
        else
            if isQueuePaused(KEYS[5]) then
                if rcall("LREM", KEYS[4], 1, currentJobId) > 0 then
                    removeJob(currentJobId, true, prefixKey, true --[[remove debounce key]] )
                end
            else
                if rcall("LREM", KEYS[3], 1, currentJobId) > 0 then
                    removeJob(currentJobId, true, prefixKey, true --[[remove debounce key]] )
                end
            end
        end
    end
end

local schedulerOpts = cmsgpack.unpack(ARGV[2])
storeJobScheduler(jobSchedulerId, schedulerKey, repeatKey, nextMillis, schedulerOpts, ARGV[4], templateOpts)

if rcall("EXISTS", nextDelayedJobKey) ~= 1 then
    local eventsKey = KEYS[9]
    local metaKey = KEYS[5]
    local maxEvents = getOrSetMaxEvents(metaKey)

    rcall("INCR", KEYS[8])

    local delayedOpts = cmsgpack.unpack(ARGV[6])

    local delay, priority = storeJob(eventsKey, nextDelayedJobKey, nextDelayedJobId, schedulerOpts['name'], ARGV[4],
        delayedOpts, ARGV[7], nil, nil, jobSchedulerId)

    if delay ~= 0 then
        addDelayedJob(nextDelayedJobId, delayedKey, eventsKey,
            ARGV[7], maxEvents, KEYS[7], delay)
    else
        local isPaused = isQueuePaused(KEYS[5])
      
        -- Standard or priority add
        if priority == 0 then
            if isPaused then
                -- LIFO or FIFO
                local pushCmd = delayedOpts['lifo'] and 'RPUSH' or 'LPUSH'
                rcall(pushCmd, KEYS[4], nextDelayedJobId)
            else
                -- LIFO or FIFO
                local pushCmd = delayedOpts['lifo'] and 'RPUSH' or 'LPUSH'
                rcall(pushCmd, KEYS[3], nextDelayedJobId)
            end
        else
            -- Priority add
            addJobWithPriority(KEYS[7], KEYS[6], priority, nextDelayedJobId, KEYS[10], isPaused)
        end
        -- Emit waiting event
        rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents,  "*", "event", "waiting", "jobId", nextDelayedJobId)
    end

    if ARGV[9] ~= "" then
        rcall("HSET", ARGV[9], "nrjid", nextDelayedJobId)
    end

    return nextDelayedJobId .. "" -- convert to string
end
